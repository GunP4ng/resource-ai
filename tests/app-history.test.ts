import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, writeFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { requestBridge } from "../scripts/app.ts";
import { createHistoryRoutes } from "../src/app-history-routes.ts";
import { createMemoryRuntimeDatabase } from "../src/o-runtime-db.ts";
import { createLocalAuth, LOCAL_AUTH_LIMITS } from "../src/o-auth.ts";
import { createCaseStore } from "../src/o-case-store.ts";
import { createPhotoStore } from "../src/photos.ts";
import { decideCase } from "../src/assessment.ts";
import { createFileResourceProvider } from "../src/o-resources.ts";
import { createOperationalApp } from "../src/operations.ts";
import { receiveHistory } from "../src/o-history.ts";
import { historyConfiguration, loadHistoryMount } from "../src/o-history-runtime.ts";
import { syntheticDocuments } from "./o-history-fixture.ts";
import { caseListPage } from "../src/app-views.ts";

const origin = "http://localhost:3000", base = "/research/history";
const password = "synthetic history password";
const signal = () => new AbortController().signal;
async function fixture(t: { after(fn: () => unknown): void }) {
  const directory = await mkdtemp(join(tmpdir(), "o-history-routes-")), artifactPath = join(directory, "archive.json");
  const runtime = createMemoryRuntimeDatabase(); let now = 1_800_000_000_000;
  const auth = createLocalAuth(runtime, { origin, now: () => now });
  const reader = await auth.create("reader", password), other = await auth.create("other", password);
  const loggedReader = await auth.login("reader", password, signal()), loggedOther = await auth.login("other", password, signal());
  const readerCookie = loggedReader.setCookie.split(";")[0], otherCookie = loggedOther.setCookie.split(";")[0];
  assert.ok(readerCookie); assert.ok(otherCookie);
  const readerLogin = { ...loggedReader, setCookie: readerCookie }, otherLogin = { ...loggedOther, setCookie: otherCookie };
  const docs = syntheticDocuments(); await writeFile(artifactPath, JSON.stringify(receiveHistory(docs.commentBytes, docs.evidenceBytes)), { mode: 0o600 });
  const config = historyConfiguration({ RESOURCE_HISTORY_ARTIFACT: artifactPath, RESOURCE_HISTORY_READER_ACTOR_ID: reader.actorId,
    RESOURCE_APP_AUTH: "local-operator", RESOURCE_MODEL_RUNNER: "local" });
  const mount = loadHistoryMount(config, runtime); assert.ok(mount);
  const cases = createCaseStore(() => now, undefined, runtime);
  const photos = await createPhotoStore({ root: join(directory, "photos"), authorize: cases.authorize, retentionMs: 60000, maxPhotos: 10 });
  const observed = [mock.method(cases, "begin"), mock.method(cases, "commit"), mock.method(cases, "read"),
    mock.method(cases, "list"), mock.method(photos, "resolver"), mock.method(photos, "read"),
    mock.method(photos, "put"), mock.method(photos, "assertCanTransmit"), mock.method(photos, "revoke")];
  const resourcesRoot = join(directory, "resources"); await mkdir(resourcesRoot, { mode: 0o700 });
  const provider = await createFileResourceProvider({ root: resourcesRoot, caseStore: cases });
  let runnerCalls = 0, resourceCalls = 0; const runnerInputs: string[] = [];
  const app = createOperationalApp({ origin, localAuth: auth, caseStore: cases, photoStore: photos, photoPolicy: { retentionMs: 60000 },
    presentationMode: "offline", runner: async (input, signal, resources) => { runnerCalls++; signal.throwIfAborted(); runnerInputs.push(JSON.stringify({ input, resources }));
      return { proposal: decideCase(input) }; }, resources: (input, signal) => { resourceCalls++; return provider(input, signal); } });
  const routes = createHistoryRoutes(app.fetch, { origin, localAuth: auth, mount });
  t.after(async () => { routes.dispose(); app.dispose(); await routes.settled(); await app.close();
    for (const spy of observed) spy.mock.restore(); cases.dispose(); runtime.close(); await rm(directory, { recursive: true, force: true }); });
  const request = (path = base, cookie: string | undefined = readerLogin.setCookie, init: RequestInit = {}) =>
    new Request(origin + path, { ...init, headers: { ...(cookie ? { cookie } : {}), ...Object.fromEntries(new Headers(init.headers)) } });
  return { runtime, auth, reader, other, mount, routes, app, photos, directory, observed, readerLogin, otherLogin, request,
    runnerInputs, advance: () => { now += LOCAL_AUTH_LIMITS.sessionMs; }, counts: () => ({ runnerCalls, resourceCalls }) };
}
test("native Request routes render all accepted records without touching runner/resources/photos/cases/leases", async t => {
  const f = await fixture(t), before = f.runtime.database.serialize(), files = await readdir(f.directory, { recursive: true });
  for (const path of [base, ...Array.from({ length: 14 }, (_, i) => base + "/cases/" + (i + 1))]) {
    const result = await f.routes.fetch(f.request(path)); assert.equal(result.status, 200);
    assert.ok((await result.text()).includes("과거 실행 기록"));
  }
  assert.deepEqual(f.runtime.database.serialize(), before);
  assert.deepEqual(await readdir(f.directory, { recursive: true }), files);
  assert.deepEqual(f.counts(), { runnerCalls: 0, resourceCalls: 0 });
  for (const spy of f.observed) assert.equal(spy.mock.callCount(), 0);
});
test("real HTTP bridge serves accepted archive for current reader with no operational or photo side effects", async t => {
  const f = await fixture(t), before = f.runtime.database.serialize(), files = await readdir(f.directory, { recursive: true });
  const server = createServer(requestBridge(origin, f.routes.fetch));
  await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  t.after(() => new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())));
  const address = server.address(); assert.ok(address && typeof address === "object");
  for (const path of [base, ...Array.from({ length: 14 }, (_, i) => base + "/cases/" + (i + 1))]) {
    const result: Response = await fetch(`http://127.0.0.1:${address.port}${path}`, { headers: { cookie: f.readerLogin.setCookie }, signal: AbortSignal.timeout(2000) });
    assert.equal(result.status, 200);
    assert.match(result.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(result.headers.get("cache-control"), "private, no-store");
    assert.ok(result.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"));
    assert.ok((await result.text()).includes("과거 실행 기록"));
  }
  assert.deepEqual(f.runtime.database.serialize(), before);
  assert.deepEqual(await readdir(f.directory, { recursive: true }), files);
  assert.deepEqual(f.counts(), { runnerCalls: 0, resourceCalls: 0 });
  for (const spy of f.observed) assert.equal(spy.mock.callCount(), 0);
});
test("wrong reader and forged historical/current actor headers never grant access or disclose metadata", async t => {
  const f = await fixture(t);
  for (const cookie of [undefined, f.otherLogin.setCookie]) {
    const request = new Request(origin + base, { headers: { ...(cookie ? { cookie } : {}), "x-actor-id": f.reader.actorId,
      "x-user-id": f.mount.archive.evidence.cases[0]?.actorId ?? "historical", authorization: "Bearer forged" } });
    const result = await f.routes.fetch(request); assert.equal(result.status, 403);
    const html = await result.text(); assert.ok(html.includes('href="/cases"')); assert.ok(html.includes("권한"));
    assert.equal(html.includes("synthetic-case-"), false); assert.equal(html.includes(f.reader.actorId), false);
  }
});
for (const revoke of ["expiry", "disable", "logout", "reset"] as const) test(`${revoke} invalidates an existing reader session`, async t => {
  const f = await fixture(t);
  switch (revoke) {
    case "expiry": f.advance(); break;
    case "disable": f.auth.disable("reader"); break;
    case "logout": f.auth.logout(f.request()); break;
    case "reset": await f.auth.resetPassword("reader", password + " replacement"); break;
  }
  assert.equal((await f.routes.fetch(f.request())).status, 403);
});
test("absent configuration and unknown records provide unavailable recovery without contents", async t => {
  const f = await fixture(t);
  for (const localAuth of [f.auth, undefined]) {
    const routes = createHistoryRoutes(f.app.fetch, { origin, localAuth });
    const result = await routes.fetch(f.request()); assert.equal(result.status, 404);
    const html = await result.text(); assert.ok(html.includes('href="/cases"')); assert.ok(html.includes("구성되지"));
  }
  for (const path of ["/cases/99", "/cases/01", "/cases/1/input", "/cases/1/photos", "/data", "/download", "/report", "/export"])
    assert.equal((await f.routes.fetch(f.request(base + path))).status, 404);
});
test("authenticated mutations are GET-only and unauthorized mutations stay forbidden", async t => {
  const f = await fixture(t);
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
    const result = await f.routes.fetch(f.request(base, f.readerLogin.setCookie, { method }));
    assert.equal(result.status, 405); assert.equal(result.headers.get("allow"), "GET");
    assert.equal((await f.routes.fetch(f.request(base, f.otherLogin.setCookie, { method }))).status, 403);
  }
});
test("origin checks, cancellation and disposal stop archive requests", async t => {
  const f = await fixture(t);
  assert.equal((await f.routes.fetch(new Request("http://localhost:3001" + base, { headers: { cookie: f.readerLogin.setCookie } }))).status, 400);
  for (const headers of [new Headers({ origin: "https://foreign.invalid" }), new Headers({ "sec-fetch-site": "cross-site" })])
    assert.equal((await f.routes.fetch(f.request(base, f.readerLogin.setCookie, { headers }))).status, 403);
  const controller = new AbortController(); controller.abort();
  assert.equal((await f.routes.fetch(f.request(base, f.readerLogin.setCookie, { signal: controller.signal }))).status, 408);
  f.routes.dispose(); assert.equal((await f.routes.fetch(f.request())).status, 408); await f.routes.settled();
});
for (const during of ["disable", "logout", "expiry", "abort", "deadline", "error", "dispose"] as const)
  test(`publication fails safely after controlled archive access: ${during}`, async t => {
    const f = await fixture(t), controller = new AbortController();
    let virtualTime = 1000, lookups = 0;
    const mount = { readerActorId: f.reader.actorId, get archive() {
      lookups++;
      switch (during) {
        case "disable": f.auth.disable("reader"); break;
        case "logout": f.auth.logout(f.request()); break;
        case "expiry": f.advance(); break;
        case "abort": controller.abort(); break;
        case "deadline": virtualTime += 100; break;
        case "error": throw new Error("PRIVATE-SENTINEL " + f.directory);
        case "dispose": routes.dispose(); break;
      }
      return f.mount.archive;
    } };
    const routes = createHistoryRoutes(f.app.fetch, { origin, localAuth: f.auth, mount, timeoutMs: during === "deadline" ? 100 : 10000 });
    const clock = during === "deadline" ? mock.method(performance, "now", () => virtualTime) : undefined;
    try {
      const result = await routes.fetch(f.request(base, f.readerLogin.setCookie, { signal: controller.signal }));
      assert.equal(result.status, during === "error" ? 502 : during === "deadline" ? 504 : during === "abort" || during === "dispose" ? 408 : 403);
      assert.equal(lookups, 1);
      const html = await result.text(); assert.equal(html.includes("synthetic-case-"), false);
      assert.equal(html.includes("과거 실행 기록"), false); assert.ok(html.includes('href="/cases"'));
      assert.equal(html.includes("PRIVATE-SENTINEL"), false); assert.equal(html.includes(f.directory), false);
    } finally { clock?.mock.restore(); routes.dispose(); await routes.settled(); }
  });
test("currentness is asserted before any archive access", async t => {
  const f = await fixture(t), resolve = f.auth.resolve;
  const intercepted = mock.method(f.auth, "resolve", (...args: Parameters<typeof resolve>) => {
    const identity = resolve(...args); f.auth.disable("reader"); return identity;
  });
  let lookups = 0;
  const mount = { readerActorId: f.reader.actorId, get archive() { lookups++; return f.mount.archive; } };
  const routes = createHistoryRoutes(f.app.fetch, { origin, localAuth: f.auth, mount });
  try {
    const result = await routes.fetch(f.request()); assert.equal(result.status, 403); assert.equal(lookups, 0);
    const html = await result.text(); assert.equal(html.includes("synthetic-case-"), false);
    assert.equal(html.includes("과거 실행 기록"), false); assert.ok(html.includes('href="/cases"'));
    assert.equal(html.includes(f.reader.actorId), false);
  } finally { intercepted.mock.restore(); routes.dispose(); await routes.settled(); }
});
test("native case list links only local operators; ordinary input, demo, report and model paths exclude archive metadata", async t => {
  const f = await fixture(t);
  assert.equal(caseListPage("", false).includes('href="/research/history"'), false);
  assert.ok(caseListPage("", true).includes('href="/research/history">비공개 연구 기록 확인</a>'));
  assert.equal(caseListPage("", true).includes("synthetic-case-"), false);
  const listing = await f.routes.fetch(f.request("/cases")); assert.equal(listing.status, 200);
  assert.ok((await listing.text()).includes('href="/research/history"'));
  for (const path of ["/", "/demo/normal", "/demo/review", "/cases/synthetic-case-1/input", "/cases/synthetic-case-1/report"]) {
    const html = await (await f.routes.fetch(f.request(path))).text();
    assert.equal(html.includes("synthetic-shared-historical-actor"), false); assert.equal(html.includes(f.mount.archive.package.sha256), false);
  }
  const submitted = await f.routes.fetch(f.request("/cases", f.readerLogin.setCookie, { method: "POST",
    headers: { origin, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ description: "Synthetic current input", assessmentDate: "2026-11-17",
      process: "", polymer: "", contamination: "", hazardousContact: "unknown", massKg: "", region: "" }) }));
  assert.equal(submitted.status, 303); assert.deepEqual(f.counts(), { runnerCalls: 1, resourceCalls: 1 });
  const currentPath = submitted.headers.get("location"); assert.ok(currentPath);
  for (const suffix of ["", "/report", "/input"]) {
    const result = await f.routes.fetch(f.request(currentPath + suffix)); assert.equal(result.status, 200);
    const current = await result.text();
    assert.equal(current.includes("synthetic-shared-historical-actor"), false);
    assert.equal(current.includes(f.mount.archive.package.sha256), false);
  }
  assert.equal(f.runnerInputs.join().includes(f.mount.archive.package.sha256), false);
  assert.equal(f.runnerInputs.join().includes("synthetic-shared-historical-actor"), false);
});
