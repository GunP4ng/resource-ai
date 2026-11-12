import { test } from "node:test";
import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { mkdir, chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openRuntimeDatabase } from "../src/o-runtime-db.ts";
import { createCaseStore } from "../src/o-case-store.ts";
import { createOperatorRuntime } from "../src/o-operational-runtime.ts";
import { createOperationalApp } from "../src/operations.ts";
import { createFileResourceProvider } from "../src/o-resources.ts";
import { parseOperationalConfiguration, readOperationalConfiguration } from "../src/o-operations-config.ts";
import { inspectOperationJournal } from "../scripts/o-journal.ts";
import { revision } from "../src/o-validation.ts";
import { prepareCaseRecord, createBundledSnapshotReader } from "../src/case-record.ts";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { origin, secret, signal, post, login, loginCookie, fixture, response } from "./o-operational-fixtures.ts";

test("login failure keeps the strict 303 assertion and reports sanitized status, body and elapsed time", async () => {
  const cookie = "synthetic-cookie-value";
  await assert.rejects(login({ fetch: async () => new Response(`<style>private styles</style><p>Login unavailable ${secret} resource_operator=${cookie} password=hidden-password</p>`,
    { status: 503, headers: { "set-cookie": `resource_operator=${cookie}; HttpOnly` } }) }), error => {
    assert.ok(error instanceof assert.AssertionError); assert.equal(error.actual, 503); assert.equal(error.expected, 303);
    assert.match(error.message, /login status=503 elapsedMs=\d+ body=/); assert.match(error.message, /Login unavailable/);
    for (const value of [secret, cookie, "hidden-password", "private styles"]) assert.equal(error.message.includes(value), false);
    return true;
  });
});

test("disk assembly uses native login, exact package binding and SDK transport; synthetic presentation survives restart", async t => {
  const f = await fixture(t);
  const artifact = await prepareCaseRecord(f.snapshot.input, { dataOrigin: { kind: "synthetic", reference: "assembly verification" }, codeRevision: "74c8c3d9a3bae87b560f72e05068f991ca255265", signal: signal(),
    sources: createBundledSnapshotReader(new URL("../", import.meta.url).pathname) });
  const folder = join(f.resourcesRoot, f.actor.actorId, f.snapshot.input.caseId); await mkdir(folder, { recursive: true, mode: 0o700 });
  await writeFile(join(folder, revision(f.snapshot.input) + ".json"), JSON.stringify(artifact), { mode: 0o600 });
  const config = parseOperationalConfiguration({ ...f.config, grants: [{ ...f.config.grants[0], artifactSha256: artifact.sha256 }] });
  let calls = 0;
  const runtime = await createOperatorRuntime({ ...f, origin, configuration: config, privatePhotos: false, transport: async () => { calls++; return response(f.snapshot.input); } });
  try {
    const cookie = await login(runtime.app);
    assert.equal((await runtime.app.fetch(post(f.path + "/answers", cookie, { baseVersion: 1, patch: { massKg: f.snapshot.input.massKg } }))).status, 303);
    assert.equal(calls, 1);
    const saved = runtime.caseStore.read(`actor:${f.actor.actorId}`, f.snapshot.input.caseId);
    assert.equal(saved?.presentation?.mode, "synthetic"); assert.equal(saved?.review?.hash, artifact.sha256);
  } finally { await runtime.close(); }
  const rows = inspectOperationJournal(f.stateRoot); assert.equal(rows[0]?.state, "consumed");
  assert.equal(JSON.parse(rows[0]?.binding ?? "null").artifact.hash, artifact.sha256);
  assert.equal(JSON.parse(rows[0]?.binding ?? "null").artifact.origin, "synthetic");
  const terminal = JSON.parse(rows[0]?.terminal ?? "null"); assert.equal(terminal.usage.total, 0);
  assert.equal(JSON.parse(rows[0]?.response ?? "null").requestId, "observed-synthetic-request");
  assert.equal(JSON.stringify(rows).includes("synthetic-refresh"), false);
  const db = await openRuntimeDatabase(f.stateRoot);
  try {
    const cases = createCaseStore(Date.now, undefined, db);
    try { assert.equal(cases.read(`actor:${f.actor.actorId}`, f.snapshot.input.caseId)?.presentation?.mode, "synthetic"); }
    finally { cases.dispose(); }
  } finally { db.close(); }
});

for (const problem of ["account", "revision", "artifact", "audit-write"] as const) test(`assembly ${problem} failure dispatches zero requests`, async t => {
  const f = await fixture(t); let calls = 0;
  const config = parseOperationalConfiguration({ ...f.config,
    target: { ...f.config.target, accountIdSha256: problem === "account" ? "c".repeat(64) : f.config.target.accountIdSha256 },
    grants: [{ ...f.config.grants[0], inputRevision: problem === "revision" ? "c".repeat(64) : revision(f.snapshot.input), artifactSha256: problem === "artifact" ? "c".repeat(64) : null }],
    journalCapacity: problem === "audit-write" ? 10 : 100 });
  const runtime = await createOperatorRuntime({ ...f, origin, configuration: config, privatePhotos: false, transport: async () => { calls++; return response(f.snapshot.input); } });
  let writer: Database | undefined;
  try {
    const cookie = await login(runtime.app);
    writer = problem === "audit-write" ? new Database(join(f.stateRoot, "operations", "journal.sqlite")) : undefined;
    writer?.exec("BEGIN IMMEDIATE");
    const result = await runtime.app.fetch(post(f.path + "/answers", cookie, { baseVersion: 1, patch: { massKg: f.snapshot.input.massKg } }));
    assert.equal(result.status, problem === "account" ? 503 : 502); assert.equal(calls, 0);
    assert.deepEqual(runtime.caseStore.read(`actor:${f.actor.actorId}`, f.snapshot.input.caseId), f.snapshot);
  } finally { try { if (writer) { try { writer.exec("ROLLBACK"); } finally { writer.close(); } } } finally { await runtime.close(); } }
});

test("account disable after invocation preserves the old disk case and retains success usage evidence", async t => {
  const f = await fixture(t), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const runtime = await createOperatorRuntime({ ...f, origin, configuration: f.config, privatePhotos: false, transport: async () => { entered.resolve(); await release.promise; return response(f.snapshot.input); } });
  try {
    const cookie = await login(runtime.app), pending = runtime.app.fetch(post(f.path + "/answers", cookie, { baseVersion: 1, patch: { massKg: f.snapshot.input.massKg } }));
    await entered.promise; await runtime.localAuth.disable("operator"); release.resolve();
    assert.equal((await pending).status, 403); await runtime.settled();
    assert.deepEqual(runtime.caseStore.read(`actor:${f.actor.actorId}`, f.snapshot.input.caseId), f.snapshot);
  } finally { release.resolve(); await runtime.close(); }
  const rows = inspectOperationJournal(f.stateRoot), terminal = JSON.parse(rows[0]?.terminal ?? "null");
  assert.equal(rows[0]?.state, "consumed"); assert.equal(terminal.outcome, "success"); assert.equal(terminal.usage.total, 0);
});

test("configuration file checks private metadata without accepting missing credentials or expired approval", async t => {
  const f = await fixture(t), path = join(f.root, "operations.json");
  await writeFile(path, JSON.stringify(f.config), { mode: 0o600 }); assert.deepEqual(readOperationalConfiguration(path), f.config);
  await chmod(path, 0o644); assert.throws(() => readOperationalConfiguration(path));
  await chmod(path, 0o600); await writeFile(path, JSON.stringify({ ...f.config, validUntil: Date.now() - 1 })); assert.throws(() => readOperationalConfiguration(path));
});

test("cancelled disk execution returns promptly while settled waits for late provider metadata", async t => {
  const f = await fixture(t), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), controller = new AbortController();
  let settled = false;
  const runtime = await createOperatorRuntime({ ...f, origin, configuration: f.config, privatePhotos: false, transport: async () => { entered.resolve(); await release.promise; return response(f.snapshot.input); } });
  try {
    const cookie = await login(runtime.app);
    const pending = runtime.app.fetch(new Request(post(f.path + "/answers", cookie, { baseVersion: 1, patch: { massKg: f.snapshot.input.massKg } }), { signal: controller.signal }));
    await entered.promise; controller.abort(); assert.equal((await pending).status, 408);
    const drained = runtime.settled().then(() => { settled = true; });
    await new Promise<void>(done => setImmediate(done)); assert.equal(settled, false);
    release.resolve(); await drained; assert.equal(settled, true);
    assert.deepEqual(runtime.caseStore.read(`actor:${f.actor.actorId}`, f.snapshot.input.caseId), f.snapshot);
  } finally { release.resolve(); await runtime.close(); }
  const row = inspectOperationJournal(f.stateRoot)[0]; assert.equal(row?.state, "consumed");
  assert.equal(JSON.parse(row?.terminal ?? "null").usage, null);
  assert.equal(JSON.parse(row?.response ?? "null").requestId, "observed-synthetic-request");
});

test("disk app remains unsettled after the original deadline until the terminal audit callback drains", async t => {
  const f = await fixture(t), auditing = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const runtime = await createOperatorRuntime({ ...f, origin, configuration: f.config, privatePhotos: false, transport: async () => response(f.snapshot.input) });
  let app: ReturnType<typeof createOperationalApp> | undefined;
  try {
    const cookie = await login(runtime.app), resources = await createFileResourceProvider({ root: f.resourcesRoot, caseStore: runtime.caseStore });
    app = createOperationalApp({ origin, caseStore: runtime.caseStore, localAuth: runtime.localAuth, resources, timeoutMs: 300,
      presentationMode: "synthetic", operations: { enabled: true, provider: "subscription", timeoutMs: 200, maxTurns: 1, maxOutputTokens: 128,
        configuration: async () => f.config.target, authorizeDispatch: runtime.journal.authorizeDispatch,
        record: async (event, signal) => { await runtime.journal.record(event, signal); if (event.phase === "finish") { auditing.resolve(); await release.promise; } },
        transport: runtime.journal.wrapTransport(async () => response(f.snapshot.input)) } });
    const pending = app.fetch(post(f.path + "/answers", cookie, { baseVersion: 1, patch: { massKg: f.snapshot.input.massKg } }));
    await auditing.promise; assert.ok([502, 504].includes((await pending).status));
    let settled = false; const drained = app.settled().then(() => { settled = true; });
    await new Promise<void>(done => setImmediate(done)); assert.equal(settled, false); runtime.runtime.assertReady();
    release.resolve(); await drained; assert.equal(settled, true);
    assert.deepEqual(runtime.caseStore.read(`actor:${f.actor.actorId}`, f.snapshot.input.caseId), f.snapshot);
  } finally { release.resolve(); try { if (app) { app.dispose(); await app.close(); } } finally { await runtime.close(); } }
  assert.equal(inspectOperationJournal(f.stateRoot)[0]?.state, "consumed");
});

test("cancelled in-flight transport still occupies the concurrent-run allowance until drained", async t => {
  const f = await fixture(t), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), controller = new AbortController();
  const config = parseOperationalConfiguration({ ...f.config, requestAllowance: 2 }); let calls = 0;
  const runtime = await createOperatorRuntime({ ...f, origin, configuration: config, privatePhotos: false, transport: async () => {
    if (++calls === 1) { entered.resolve(); await release.promise; } return response(f.snapshot.input);
  } });
  try {
    const cookie = await login(runtime.app), body = { baseVersion: 1, patch: { massKg: f.snapshot.input.massKg } };
    const pending = runtime.app.fetch(new Request(post(f.path + "/answers", cookie, body), { signal: controller.signal }));
    await entered.promise; controller.abort(); assert.equal((await pending).status, 408);
    assert.equal((await runtime.app.fetch(post(f.path + "/answers", cookie, body))).status, 502);
    assert.equal(calls, 1);
  } finally { release.resolve(); await runtime.close(); }
});

for (const mode of ["normal", "held"] as const) test(`operational HTTP launcher ${mode} SIGTERM ${mode === "held" ? "forces nonzero with recoverable uncertainty" : "drains audit before exit"}`, { timeout: 20000 }, async t => {
  const f = await fixture(t), path = join(f.root, "operations.json");
  const config = parseOperationalConfiguration({ ...f.config, runnerTimeoutMs: 1000, requestTimeoutMs: 1500, shutdownGraceMs: 1800 });
  await writeFile(path, JSON.stringify(config), { mode: 0o600 });
  const reservation = createServer(); await new Promise<void>((done, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", done); });
  const address = reservation.address(); assert.ok(address && typeof address !== "string");
  await new Promise<void>((done, reject) => reservation.close(error => error ? reject(error) : done()));
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("RESOURCE_") && !key.startsWith("AZURE_OPENAI_")));
  const child = spawn(process.execPath, [fileURLToPath(new URL("./o-launcher-child.ts", import.meta.url)), mode, JSON.stringify(f.snapshot.input)], { cwd: tmpdir(),
    env: { ...environment, PORT: String(address.port), RESOURCE_MODEL_RUNNER: "operational", RESOURCE_APP_AUTH: "local-operator", RESOURCE_STATE_DIR: f.stateRoot,
      RESOURCE_RESOURCES_DIR: f.resourcesRoot, RESOURCE_OPERATIONAL_CONFIG: path }, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit"), lines = createInterface({ input: child.stdout }); let diagnostic = "";
  child.stderr.on("data", bytes => { diagnostic += String(bytes); });
  const transported = Promise.withResolvers<void>();
  try {
    await Promise.race([new Promise<void>(done => lines.on("line", line => { if (line.startsWith("Re:Source app:")) done(); if (line === "transport") transported.resolve(); })), exited.then(() => { throw new Error(diagnostic); })]);
    const url = `http://localhost:${address.port}`;
    const started = performance.now();
    const signed = await fetch(url + "/login", { method: "POST", redirect: "manual", headers: { origin: url, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username: "operator", password: secret }) });
    const cookie = await loginCookie(signed, started);
    const pending = fetch(url + f.path + "/answers", { method: "POST", redirect: "manual", headers: { origin: url, cookie: cookie.split(";")[0] ?? "", "content-type": "application/json" },
      body: JSON.stringify({ baseVersion: 1, patch: { massKg: f.snapshot.input.massKg } }) });
    if (mode === "held") { await transported.promise; child.kill("SIGTERM"); await pending.catch(() => undefined); }
    else { assert.equal((await pending).status, 303); child.kill("SIGTERM"); }
    const [code] = await exited; assert.equal(code, mode === "held" ? 1 : 0, diagnostic);
    const row = inspectOperationJournal(f.stateRoot)[0]; assert.equal(row?.state, mode === "held" ? "unresolved" : "consumed");
    assert.ok(row?.terminal); assert.equal(JSON.parse(row.terminal).usage?.total ?? null, mode === "held" ? null : 0);
    assert.ok(row.payload);
  } finally { lines.close(); if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await exited; }
});
