import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile, access } from "node:fs/promises";
import { PhotonImage } from "@silvia-odwyer/photon-node";
import { openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { randomInt } from "node:crypto";
import { createApp } from "../src/app.ts";
import { createOperationalApp, type OperationalClock } from "../src/operations.ts";
import { createCaseStore } from "../src/o-case-store.ts";
import { createLocalAuth } from "../src/o-auth.ts";
import { openRuntimeDatabase } from "../src/o-runtime-db.ts";
import { createFileResourceProvider } from "../src/o-resources.ts";
import { createPhotoStore } from "../src/photos.ts";
import { prepareCaseRecord, createBundledSnapshotReader } from "../src/case-record.ts";
import { revision } from "../src/o-validation.ts";
import { parseCaseInput } from "../src/input.ts";
import type { ResourceProvider } from "../src/session.ts";
import { syntheticCase } from "./h-fixtures.ts";

const origin = "http://localhost:3000", secret = "integration-only long password";
const localRuntime = { identity: "local-operator", storage: "sqlite", runner: "local" } as const;
const signal = () => new AbortController().signal;
function pixels() {
  const image = new PhotonImage(new Uint8Array([255, 0, 0, 255]), 1, 1);
  try { return new Uint8Array(image.get_bytes()); } finally { image.free(); }
}
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function post(path: string, cookie: string, data: unknown): Request {
  return new Request(origin + path, { method: "POST", headers: { origin, cookie: cookie.split(";")[0] ?? "", "content-type": "application/json" }, body: JSON.stringify(data) });
}
const get = (path: string, cookie: string) => new Request(origin + path, { headers: { cookie: cookie.split(";")[0] ?? "" } });
async function fixture(t: { after(fn: () => unknown): void }) {
  const root = await mkdtemp(join(tmpdir(), "o-runtime-integration-"));
  const db = await openRuntimeDatabase(join(root, "state"));
  const cases = createCaseStore(Date.now, undefined, db), auth = createLocalAuth(db, { origin });
  const { actorId } = await auth.create("operator", secret);
  const logged = await auth.login("operator", secret, signal());
  const cookie = logged.setCookie.split(";")[0]; assert.ok(cookie);
  const apps: ReturnType<typeof createOperationalApp>[] = [];
  t.after(async () => { for (const app of apps) { app.dispose(); await app.close(); } cases.dispose(); db.close(); await rm(root, { recursive: true, force: true }); });
  const app = (options: Parameters<typeof createOperationalApp>[0] = { origin }) => {
    const app = createOperationalApp({ localAuth: auth, runtime: localRuntime, caseStore: cases, ...options }); apps.push(app); return app;
  };
  return { root, db, cases, auth, cookie, actorId, app };
}
async function submit(app: ReturnType<typeof createOperationalApp>, cookie: string) {
  const { caseId: _caseId, ...raw } = syntheticCase;
  const result = await app.fetch(post("/cases", cookie, raw)); assert.equal(result.status, 303);
  const path = result.headers.get("location"); assert.ok(path); return path;
}

test("native login, create, edit and canonical input export recover the same actor after restart", async t => {
  const f = await fixture(t), app = f.app();
  const loginForm = await app.fetch(get("/login", ""));
  assert.equal(loginForm.status, 200);
  const html = await loginForm.text(); assert.match(html, /method="post" action="\/login"/); assert.match(html, /type="password"/);
  assert.equal((await app.fetch(get("/", ""))).status, 403);
  const login = await app.fetch(new Request(origin + "/login", { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username: "operator", password: secret }) }));
  assert.equal(login.status, 303); assert.equal(login.headers.get("location"), "/cases");
  const cookie = login.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie);
  const home = await app.fetch(get("/", cookie)); assert.equal(home.headers.get("set-cookie"), null);
  const created = await app.fetch(new Request(origin + "/cases", { method: "POST", headers: { origin, cookie, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ description: "persisted held input", polymer: "", massKg: "", process: "", contamination: "", region: "", hazardousContact: "unknown", assessmentDate: "2026-11-06" }) }));
  assert.equal(created.status, 303);
  const path = created.headers.get("location"); assert.ok(path);
  const edit = await app.fetch(new Request(origin + path + "/answers", { method: "POST", headers: { origin, cookie, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ baseVersion: "1", photoSelection: "explicit", answers: '{"polymer":"PP","massKg":100}' }) }));
  assert.equal(edit.status, 303);
  const exported = await app.fetch(get(path + "/input", cookie)); assert.equal(exported.status, 200);
  const input = parseCaseInput(await exported.json()); assert.ok(input.ok); assert.equal(input.value.massKg, 100);
  assert.equal(exported.headers.get("etag"), `"${revision(input.value)}"`); assert.equal(exported.headers.get("cache-control"), "private, no-store");
  const before = await (await app.fetch(get(path + "/report", cookie))).text();
  assert.ok((await (await app.fetch(get("/cases", cookie))).text()).includes(path));
  app.dispose(); await app.close(); f.cases.dispose(); f.db.close();
  const db = await openRuntimeDatabase(join(f.root, "state")), cases = createCaseStore(Date.now, undefined, db), auth = createLocalAuth(db, { origin });
  const second = createOperationalApp({ origin, caseStore: cases, localAuth: auth, runtime: { ...localRuntime, runner: "azure" } });
  try {
    const logged = await auth.login("operator", secret, signal()); assert.equal(logged.identity.actorId, f.actorId);
    const recovered = await second.fetch(get(path + "/report", logged.setCookie)); assert.equal(recovered.status, 200);
    assert.equal(await recovered.text(), before);
    assert.equal((await second.fetch(get(path + "/input", cookie))).status, 403);
  } finally { second.dispose(); await second.close(); cases.dispose(); db.close(); }
});

test("another operator cannot list, read, export, edit, report, preview or revoke an owned case", async t => {
  const f = await fixture(t);
  const photoStore = await createPhotoStore({ root: join(f.root, "photos"), authorize: f.cases.authorize, retentionMs: 60000, maxPhotos: 10 });
  const app = f.app({ origin, photoStore, photoPolicy: { retentionMs: 60000 } }), path = await submit(app, f.cookie);
  const upload = new FormData(); upload.set("baseVersion", "1"); upload.set("store", "yes"); upload.set("file", new File([pixels()], "private.png", { type: "image/png" }));
  assert.equal((await app.fetch(new Request(origin + path + "/photos", { method: "POST", headers: { origin, cookie: f.cookie }, body: upload }))).status, 303);
  await f.auth.create("other", secret);
  const other = await f.auth.login("other", secret, signal());
  const list = await app.fetch(get("/cases", other.setCookie)); assert.equal(list.status, 200); assert.ok(!(await list.text()).includes(path));
  const ref = f.cases.read(`actor:${f.actorId}`, path.slice(7))?.photos[0]?.photoRef; assert.ok(ref);
  for (const request of [get(path, other.setCookie), get(path + "/input", other.setCookie), get(path + "/report", other.setCookie),
    post(path + "/answers", other.setCookie, { baseVersion: 1, patch: { massKg: 1 } }), get(`${path}/photos/${ref}`, other.setCookie),
    post(`${path}/photos/${ref}/withdraw-storage`, other.setCookie, {}), post(`${path}/photos/${ref}/withdraw-model`, other.setCookie, {})]) assert.equal((await app.fetch(request)).status, 404);
  assert.equal((await app.fetch(post("/logout", other.setCookie, {}))).status, 303);
  assert.equal((await app.fetch(get(path, f.cookie))).status, 200);
});

for (const action of ["logout", "disable", "reset"] as const) test(`${action} during blocked resources prevents publication and private response`, { timeout: 10000 }, async t => {
  const f = await fixture(t), entered = deferred(), release = deferred();
  let blocked = false;
  const resources: ResourceProvider = async () => { if (blocked) { entered.resolve(); await release.promise; } return {}; };
  const app = f.app({ origin, resources }), path = await submit(app, f.cookie), before = f.cases.read(`actor:${f.actorId}`, path.slice(7));
  blocked = true;
  const pending = app.fetch(post(path + "/answers", f.cookie, { baseVersion: 1, patch: { massKg: 2001 } }));
  try {
    await entered.promise;
    switch (action) {
      case "logout": assert.equal((await app.fetch(post("/logout", f.cookie, {}))).status, 303); break;
      case "disable": f.auth.disable("operator"); break;
      case "reset": await f.auth.resetPassword("operator", "replacement integration password"); break;
    }
    release.resolve(); assert.equal((await pending).status, 403);
    assert.deepEqual(f.cases.read(`actor:${f.actorId}`, path.slice(7)), before);
    assert.equal((await app.fetch(get(path + "/report", f.cookie))).status, 403);
  } finally { release.resolve(); await pending; }
});

test("original request deadline includes delayed login body and cannot create a late session", async t => {
  const f = await fixture(t), entered = deferred(), release = deferred();
  let time = 0;
  const timers = new Map<() => void, number>();
  const clock: OperationalClock = { now: () => time, schedule(callback, delay) { timers.set(callback, time + delay); return () => timers.delete(callback); } };
  const app = f.app({ origin, timeoutMs: 200, clock });
  const body = new ReadableStream<Uint8Array>({ async pull(controller) { entered.resolve(); await release.promise; try { controller.close(); } catch (error) { if (!(error instanceof TypeError)) throw error; } } });
  const pending = app.fetch(new Request(origin + "/login", { method: "POST", headers: { origin, "content-type": "application/json" }, body, duplex: "half" } as RequestInit & { duplex: "half" }));
  await entered.promise; time = 200;
  for (const [callback, at] of timers) if (at <= time) callback();
  assert.equal((await pending).status, 504); release.resolve(); await app.settled();
  assert.equal(f.db.database.query<{ n: number }, []>("SELECT count(*) AS n FROM sessions").get()?.n, 1);
});

test("unavailable auth storage makes private access and readiness 503 even without a cookie", async t => {
  const f = await fixture(t), app = f.app(); f.db.close();
  for (const path of ["/", "/cases", "/health", "/operations/readiness"]) assert.equal((await app.fetch(get(path, ""))).status, 503);
});

test("shutdown waits for actual blocked work after cancelling the HTTP response", { timeout: 10000 }, async t => {
  const f = await fixture(t), entered = deferred(), release = deferred();
  const app = f.app({ origin, resources: async () => { entered.resolve(); await release.promise; return {}; } });
  const { caseId: _caseId, ...raw } = syntheticCase;
  const request = app.fetch(post("/cases", f.cookie, raw));
  try {
    await entered.promise; app.dispose(); assert.equal((await request).status, 408);
    let closed = false; const closing = app.close().then(() => { closed = true; });
    await Promise.resolve(); assert.equal(closed, false); f.db.assertReady();
    release.resolve(); await closing; assert.equal(closed, true);
    assert.deepEqual(f.cases.list(`actor:${f.actorId}`), []);
  } finally { release.resolve(); await request; }
});

test("resource corruption and actual SQLite abort preserve the previous report and recovery path", async t => {
  const f = await fixture(t), root = join(f.root, "artifacts"); await mkdir(root, { mode: 0o700 });
  const resources = await createFileResourceProvider({ root, caseStore: f.cases }), app = f.app({ origin, resources }), path = await submit(app, f.cookie);
  const before = f.cases.read(`actor:${f.actorId}`, path.slice(7)); assert.ok(before);
  const directory = join(root, f.actorId, before.input.caseId); await mkdir(directory, { recursive: true, mode: 0o700 });
  const artifactPath = join(directory, revision(before.input) + ".json"); await writeFile(artifactPath, "private broken artifact", { mode: 0o600 });
  const failed = await app.fetch(post(path + "/answers", f.cookie, { baseVersion: 1, patch: { massKg: before.input.massKg } })); assert.equal(failed.status, 503);
  const page = await failed.text(); assert.ok(page.includes(`href="${path}"`)); assert.ok(!page.includes("private broken artifact"));
  assert.deepEqual(f.cases.read(`actor:${f.actorId}`, before.input.caseId), before);
  await rm(artifactPath);
  f.db.database.exec("CREATE TEMP TRIGGER integration_abort BEFORE UPDATE ON cases BEGIN SELECT RAISE(ABORT,'private storage failure'); END");
  try { assert.equal((await app.fetch(post(path + "/answers", f.cookie, { baseVersion: 1, patch: { massKg: 2001 } }))).status, 503); }
  finally { f.db.database.exec("DROP TRIGGER integration_abort"); }
  assert.deepEqual(f.cases.read(`actor:${f.actorId}`, before.input.caseId), before);
  assert.equal((await app.fetch(get(path + "/report", f.cookie))).status, 200);
});

for (const kind of ["synthetic", "field"] as const) test(`saved ${kind} declaration binds the exact exported input and clears on a different revision`, async t => {
  const f = await fixture(t), root = join(f.root, "artifacts"); await mkdir(root, { mode: 0o700 });
  const resources = await createFileResourceProvider({ root, caseStore: f.cases }), app = f.app({ origin, resources }), path = await submit(app, f.cookie);
  const exported = parseCaseInput(await (await app.fetch(get(path + "/input", f.cookie))).json()); assert.ok(exported.ok);
  // No synthetic operational supplements or approvals are presented as field data.
  const artifact = await prepareCaseRecord(exported.value, { dataOrigin: { kind, reference: "integration declaration only; no approval" }, codeRevision: "497fdb0144ddcbb36fd0974d616dfdb78e435750", signal: signal(), sources: createBundledSnapshotReader(fileURLToPath(new URL("../", import.meta.url))) });
  const directory = join(root, f.actorId, exported.value.caseId); await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, revision(exported.value) + ".json"), JSON.stringify(artifact), { mode: 0o600 });
  assert.equal((await app.fetch(post(path + "/answers", f.cookie, { baseVersion: 1, patch: { massKg: exported.value.massKg } }))).status, 303);
  const saved = f.cases.read(`actor:${f.actorId}`, exported.value.caseId); assert.equal(saved?.review?.hash, artifact.sha256); assert.equal(saved?.review?.origin.kind, kind);
  const html = await (await app.fetch(get(path + "/report", f.cookie))).text(); assert.ok(html.includes(artifact.sha256)); assert.match(html, kind === "synthetic" ? /합성 자료 · 현장 근거 아님/ : /현장 자료로 선언된 검토 아티팩트 · 인간·법적 승인 아님/);
  assert.equal((await app.fetch(post(path + "/answers", f.cookie, { baseVersion: 2, patch: { massKg: 2001 } }))).status, 303);
  assert.equal(f.cases.read(`actor:${f.actorId}`, exported.value.caseId)?.review, null);
});

test("confirmed publication cannot be masked by a post-commit rollback write", async t => {
  const f = await fixture(t);
  const app = createApp({ origin, localAuth: f.auth, caseStore: f.cases, runtime: localRuntime,
    preparer: {
      prepareSubmit: () => syntheticCase, prepareAnswer: input => input,
      evaluate: async input => ({ decision: { state: "needs-information", caseId: input.caseId, questions: ["mass review required"], evidence: [] } }),
    }, committed: () => { f.db.database.exec("PRAGMA query_only=ON"); } });
  try {
    const result = await app(post("/cases", f.cookie, {})); assert.equal(result.status, 303);
    assert.equal(f.cases.read(`actor:${f.actorId}`, syntheticCase.caseId)?.version, 1);
  } finally { f.db.database.exec("PRAGMA query_only=OFF"); await app.settled(); }
});

test("packaged account CLI provisions from an unrelated working directory", { timeout: 30000 }, async t => {
  const f = await fixture(t), root = fileURLToPath(new URL("../", import.meta.url));
  await promisify(execFile)(process.execPath, ["run", "build:app"], { cwd: root, timeout: 20000 });
  const secretPath = join(f.root, "stdin-secret"); await writeFile(secretPath, secret + "\n", { mode: 0o600 });
  const fd = openSync(secretPath, "r");
  try {
    const child = spawn(process.execPath, [join(root, "dist/app/o-account.js"), "create", "--state-dir", join(f.root, "packaged-state"), "--username", "packaged", "--stdin-secret"], { cwd: tmpdir(), timeout: 10000, env: { ...process.env, RESOURCE_MODEL_RUNNER: "local" }, stdio: [fd, "ignore", "pipe"] });
    let diagnostic = ""; child.stderr?.on("data", chunk => { diagnostic += String(chunk); });
    const [code] = await once(child, "exit"); assert.equal(code, 0, diagnostic);
  } finally { closeSync(fd); }
  const db = await openRuntimeDatabase(join(f.root, "packaged-state"));
  try { const auth = createLocalAuth(db, { origin }); assert.ok((await auth.login("packaged", secret, signal())).identity.actorId); }
  finally { db.close(); }
});

test("packaged local operator launcher serves actual HTTP and exits cleanly", { timeout: 30000 }, async t => {
  const f = await fixture(t), root = fileURLToPath(new URL("../", import.meta.url));
  await promisify(execFile)(process.execPath, ["run", "build:app"], { cwd: root, timeout: 20000 });
  // A backdated, real uploaded photo must be queued by startup expiry sweep,
  // then physically deleted before its durable obligation is completed.
  const at = Date.now() - 7_200_000, old = createCaseStore(() => at, undefined, f.db);
  const photos = await createPhotoStore({ root: join(f.root, "state", "photos"), authorize: old.authorize, retentionMs: 3600000, maxPhotos: 10, now: () => at });
  const owner = `actor:${f.actorId}`, initial = old.begin(owner, syntheticCase.caseId, null);
  await old.run(initial, syntheticCase, async () => undefined);
  old.commit(initial, { decision: { state: "needs-information", caseId: syntheticCase.caseId, questions: ["검토 필요"], evidence: [] } }, () => {});
  const lease = old.begin(owner, syntheticCase.caseId, 1);
  const receipt = await photos.put(f.actorId, syntheticCase.caseId, pixels(), "image/png", { recordId: "cleanup-regression", store: true, model: false, visibleContentReviewed: false, expiresAt: at + 3600000 }, signal());
  old.associate(lease, receipt, () => {}); old.dispose();
  const reservation = createServer();
  await new Promise<void>((done, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", done); });
  const address = reservation.address(); assert.ok(address && typeof address !== "string");
  await new Promise<void>((done, reject) => reservation.close(error => error ? reject(error) : done()));
  const child = spawn(process.execPath, [join(root, "dist/app/app.js")], { cwd: tmpdir(), timeout: 10000, env: { ...process.env, PORT: String(address.port), RESOURCE_APP_AUTH: "local-operator", RESOURCE_STATE_DIR: join(f.root, "state"), RESOURCE_MODEL_RUNNER: "local", RESOURCE_PRIVATE_PHOTOS: "on" }, stdio: ["ignore", "pipe", "pipe"] });
  child.stderr.on("data", () => {});
  const exited = once(child, "exit"), lines = createInterface({ input: child.stdout });
  try {
    await Promise.race([new Promise<void>(done => lines.on("line", line => { if (line.startsWith("Re:Source app:")) done(); })), exited.then(() => { throw new Error("launcher exited before readiness"); })]);
    const url = `http://localhost:${address.port}`;
    const login = await fetch(url + "/login", { method: "POST", redirect: "manual", headers: { origin: url, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username: "operator", password: secret }), signal: AbortSignal.timeout(3000) });
    assert.equal(login.status, 303); const cookie = login.headers.get("set-cookie"); assert.ok(cookie);
    assert.equal((await fetch(url + "/cases", { headers: { cookie: cookie.split(";")[0] ?? "" }, signal: AbortSignal.timeout(3000) })).status, 200);
    await assert.rejects(access(join(f.root, "state", "photos", receipt.photoRef + ".json")), { code: "ENOENT" });
    assert.deepEqual(f.cases.pendingCleanup(owner), []);
    child.kill("SIGTERM"); const [code] = await exited; assert.equal(code, 0);
  } finally { lines.close(); if (child.exitCode === null) child.kill("SIGKILL"); await exited; }
});

for (const placement of ["same-owner", "other-owner"] as const) test(`launcher startup cleanup retains an unreadable photo while deleting a later ${placement} photo`, { timeout: 15000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), "o-cleanup-startup-")), state = join(root, "state"), at = Date.now();
  const db = await openRuntimeDatabase(state), cases = createCaseStore(() => at, undefined, db);
  t.after(async () => { cases.dispose(); db.close(); await rm(root, { recursive: true, force: true }); });
  const photosRoot = join(state, "photos");
  const photos = await createPhotoStore({ root: photosRoot, authorize: cases.authorize, retentionMs: 3600000, maxPhotos: 10 });
  const obligations: { readonly owner: string; readonly caseId: string; readonly photoRef: string }[] = [];
  for (const suffix of ["a", "b"] as const) {
    const actor = placement === "same-owner" ? "cleanup-a" : `cleanup-${suffix}`, owner = `actor:${actor}`;
    const input = { ...syntheticCase, caseId: `cleanup-${suffix}` }, initial = cases.begin(owner, input.caseId, null);
    await cases.run(initial, input, async () => undefined);
    cases.commit(initial, { decision: { state: "needs-information", caseId: input.caseId, questions: ["검토 필요"], evidence: [] } }, () => {});
    const receipt = await photos.put(actor, input.caseId, pixels(), "image/png", { recordId: `cleanup-${suffix}`, store: true, model: false, visibleContentReviewed: false, expiresAt: at + 3600000 }, signal());
    cases.associate(cases.begin(owner, input.caseId, 1), receipt, () => {});
    cases.withdraw(owner, input.caseId, receipt.photoRef, true);
    obligations.push({ owner, caseId: input.caseId, photoRef: receipt.photoRef });
  }
  const failed = obligations[0], healthy = obligations[1]; assert.ok(failed && healthy);
  const failedPath = join(photosRoot, failed.photoRef + ".json"), healthyPath = join(photosRoot, healthy.photoRef + ".json");
  await writeFile(failedPath, "{unreadable", { mode: 0o600 });
  const queued = () => db.database.query<{ owner: string; caseId: string; photoRef: string }, []>("SELECT owner,case_id AS caseId,photo_ref AS photoRef FROM photo_cleanup ORDER BY owner,queued_at,case_id,photo_ref").all();
  assert.deepEqual(queued(), obligations); await access(healthyPath);
  const { RESOURCE_RESOURCES_DIR: _resourcesRoot, ...environment } = process.env;
  const port = randomInt(40000, 60000);
  const child = spawn(process.execPath, [fileURLToPath(new URL("../scripts/app.ts", import.meta.url))], { cwd: tmpdir(), timeout: 10000,
    env: { ...environment, PORT: String(port), RESOURCE_APP_AUTH: "local-operator", RESOURCE_STATE_DIR: state, RESOURCE_PRIVATE_PHOTOS: "on", RESOURCE_MODEL_RUNNER: "local" }, stdio: ["ignore", "pipe", "pipe"] });
  let diagnostic = ""; child.stderr.on("data", chunk => { diagnostic += String(chunk); });
  const exited = once(child, "exit"), lines = createInterface({ input: child.stdout });
  try {
    const started = await Promise.race([new Promise<"ready">(done => lines.on("line", line => { if (line.startsWith("Re:Source app:")) done("ready"); })), exited.then(() => "exited" as const)]);
    if (started === "ready") child.kill("SIGTERM");
    const [code, termination] = await exited;
    t.diagnostic(`Actual source launcher startup port=${port} outcome=${started} exit=${String(code)} signal=${String(termination)} stderr=${diagnostic.trim()}`);
    // Cleanup is awaited before listen: its filesystem/SQLite contract remains
    // observable even in worker environments that prohibit loopback binding.
    await assert.rejects(access(healthyPath), { code: "ENOENT" });
    assert.deepEqual(queued(), [failed]); await access(failedPath);
    if (started === "ready") assert.equal(code, 0);
  } finally { lines.close(); if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await exited; }
});
