import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { createOperatorRuntime } from "../src/o-operational-runtime.ts";
import { parseHOperationalConfiguration } from "../src/o-operations-config.ts";
import { requestBridge, startApp } from "../scripts/app.ts";
import { fixture, login, loginCookie, secret, post, origin, response } from "./o-operational-fixtures.ts";
import { hConfiguration, supplierFixture } from "./o-supplier-fixture.ts";
import { registerSupplierPhotoCases } from "./o-supplier-photo-cases.ts";
import { registerSupplierPolicyCases } from "./o-supplier-policy-cases.ts";
import { registerSupplierLauncherCases } from "./o-supplier-launcher-cases.ts";

registerSupplierPhotoCases();
registerSupplierPolicyCases();
registerSupplierLauncherCases();

const tick = () => new Promise<void>(done => setImmediate(done));
const answers = (f: Awaited<ReturnType<typeof fixture>>, cookie: string, signal?: AbortSignal) => new Request(post(f.path + "/answers", cookie,
  { baseVersion: 1, patch: { massKg: f.snapshot.input.massKg } }), { signal });

test("H native configuration requires explicit budget and rejects journal capacity", async t => {
  // Given the old journal configuration, when selecting H, then only the H budget contract is accepted.
  const f = await fixture(t), h = hConfiguration(f.config);
  assert.throws(() => parseHOperationalConfiguration(f.config));
  assert.throws(() => parseHOperationalConfiguration({ ...h, budget: undefined }));
  assert.throws(() => parseHOperationalConfiguration({ ...h, journalCapacity: 100 }));
  assert.throws(() => parseHOperationalConfiguration({ ...h, budget: { ...h.budget, mode: "implicit" } }));
  assert.equal(h.budget.mode, "test-only");
});

for (const existing of [false, true]) test(`H selects one real disk audit store and leaves ${existing ? "existing" : "absent"} O journal untouched`, async t => {
  // Given native private account/case state and a test-only durable supplier.
  const f = await fixture(t), h = await supplierFixture(f.root); t.after(() => h.dispose());
  const journal = join(f.stateRoot, "operations"), sentinel = join(journal, "journal.sqlite");
  if (existing) { await mkdir(journal, { mode: 0o700 }); await writeFile(sentinel, "untouched-unopened", { mode: 0o600 }); }
  let calls = 0;
  const runtime = await createOperatorRuntime({ ...f, origin, configuration: hConfiguration(f.config), privatePhotos: false,
    backend: { kind: "h-suppliers", open: h.open }, transport: async () => { calls++; return response(f.snapshot.input); } });
  try {
    // When unchanged input is explicitly reassessed through native login and SDK serialization.
    const cookie = await login(runtime.app), result = await runtime.app.fetch(answers(f, cookie)); await runtime.settled();
    // Then only H performs reservation, one start/dispatch/finish audit and aggregate settlement.
    assert.equal(result.status, 303); assert.equal(calls, 1); assert.equal(h.opens, 1); assert.equal("journal" in runtime, false);
    assert.equal(h.count("reservations"), 1); assert.equal(h.count("settlements"), 1);
    assert.deepEqual(h.calls, { reserve: 1, release: 0, reconcile: 1, start: 1, dispatch: 1, finish: 1 });
    const row = h.ledger.query<{ id: string; run: string; binding: string; state: string }, []>("SELECT * FROM reservations").get(); assert.ok(row);
    assert.notEqual(row.id, f.config.approvalId); assert.equal(row.state, "consumed");
    const bound = JSON.parse(row.binding); assert.equal(bound.approvalId, f.config.approvalId);
    assert.equal(bound.actorId, f.actor.actorId); assert.equal(bound.caseId, f.snapshot.input.caseId); assert.ok(bound.leaseToken);
    const events = h.store.readAudit(row.run); assert.deepEqual(events.map(e => e.phase), ["start", "dispatch", "finish"]);
    assert.equal(events.at(-1)?.usage?.total, 0); assert.equal(events.at(-1)?.requests[0]?.approvalId, row.id);
    assert.equal(runtime.caseStore.read(`actor:${f.actor.actorId}`, f.snapshot.input.caseId)?.presentation?.mode, "synthetic");
    assert.equal(existsSync(journal), existing);
    if (existing) assert.equal(await readFile(sentinel, "utf8"), "untouched-unopened");
  } finally { await runtime.close(); await runtime.close(); }
  assert.equal(h.closes, 1);
});

for (const missing of ["ledger", "privateFileGuard", "recoverySupervisor", "retention", "activatePolicy", "settled", "close"] as const) test(`missing ${missing} fails H startup before use`, async t => {
  const f = await fixture(t), h = await supplierFixture(f.root); t.after(() => h.dispose()); let calls = 0;
  // Given a malformed trusted integration, when opened, then fail closed before reserve or transport.
  await assert.rejects(createOperatorRuntime({ ...f, origin, configuration: hConfiguration(f.config), privatePhotos: false,
    backend: { kind: "h-suppliers", open: async context => {
      const bundle = await h.open(context); Reflect.deleteProperty(bundle, missing); return bundle;
    } }, transport: async () => { calls++; return response(f.snapshot.input); } }));
  assert.equal(calls, 0); assert.equal(existsSync(join(f.stateRoot, "operations")), false);
});

for (const guard of ["revision", "case", "artifact", "actor", "account", "auth-inode", "private-store"] as const) test(`H ${guard} guard sends zero underlying requests and preserves report`, async t => {
  const f = await fixture(t); let runtime: Awaited<ReturnType<typeof createOperatorRuntime>> | undefined;
  const h = await supplierFixture(f.root, { audit: async event => {
    if (event.phase !== "dispatch") return;
    if (guard === "account") await runtime?.localAuth.disable("operator");
    if (guard === "auth-inode") { await rename(f.config.target.authPath, f.config.target.authPath + ".old"); await writeFile(f.config.target.authPath, await readFile(f.config.target.authPath + ".old"), { mode: 0o600 }); }
    if (guard === "private-store") await chmod(h.paths.ledger, 0o644);
  } }); t.after(() => h.dispose());
  let config = hConfiguration(f.config), calls = 0;
  if (["revision", "case", "artifact", "actor"].includes(guard)) config = parseHOperationalConfiguration({ ...config, grants: config.grants.map(g => ({ ...g,
    ...(guard === "revision" ? { inputRevision: "c".repeat(64) } : guard === "case" ? { caseId: "wrong-case" } : guard === "artifact" ? { artifactSha256: "c".repeat(64) } : { actorId: "wrong-actor" }) })) });
  // Invalid live actors fail at startup; all other mismatches fail before transmission.
  if (guard === "actor") {
    await assert.rejects(createOperatorRuntime({ ...f, origin, configuration: config, privatePhotos: false, backend: { kind: "h-suppliers", open: h.open }, transport: async () => { calls++; return response(f.snapshot.input); } })); return;
  }
  runtime = await createOperatorRuntime({ ...f, origin, configuration: config, privatePhotos: false,
    backend: { kind: "h-suppliers", open: h.open }, transport: async () => { calls++; return response(f.snapshot.input); } });
  try {
    const cookie = await login(runtime.app), result = await runtime.app.fetch(answers(f, cookie)); await runtime.settled();
    assert.ok([403, 502].includes(result.status)); assert.equal(calls, 0);
    assert.deepEqual(runtime.caseStore.read(`actor:${f.actor.actorId}`, f.snapshot.input.caseId), f.snapshot);
    if (["revision", "case", "artifact"].includes(guard)) assert.equal(h.count("reservations"), 0);
  } finally { await chmod(h.paths.ledger, 0o600); await runtime.close(); }
});

for (const interruption of ["cancel", "deadline"] as const) test(`H late reserve after ${interruption} retains binding, recovery and close ownership`, async t => {
  const f = await fixture(t), entered = Promise.withResolvers<string>(), unblock = Promise.withResolvers<void>();
  const h = await supplierFixture(f.root, { reserve: async request => { entered.resolve(request.runId); await unblock.promise; } }); t.after(() => h.dispose());
  const c = parseHOperationalConfiguration({ ...hConfiguration(f.config), runnerTimeoutMs: 250, requestTimeoutMs: 10000, shutdownGraceMs: 12000 }); let calls = 0;
  const runtime = await createOperatorRuntime({ ...f, origin, configuration: c, privatePhotos: false,
    backend: { kind: "h-suppliers", open: h.open }, transport: async () => { calls++; return response(f.snapshot.input); } });
  const controller = new AbortController();
  try {
    const cookie = await login(runtime.app), pending = runtime.app.fetch(answers(f, cookie, controller.signal)), runId = await entered.promise;
    if (interruption === "cancel") controller.abort();
    assert.equal((await pending).status, interruption === "cancel" ? 408 : 504);
    let closed = false; const closing = runtime.close().then(() => { closed = true; }); await tick();
    assert.equal(closed, false); assert.equal(h.closes, 0); assert.ok(h.binding(runId));
    unblock.resolve(); await closing;
    assert.equal(calls, 0); assert.equal(h.closes, 1);
    // Supervisor reopens independent recovery storage after application connections close.
    assert.equal((await h.recover()).state, "completed");
    assert.equal((await h.recover()).state, "empty");
  } finally { unblock.resolve(); await runtime.close(); }
});

for (const stage of ["audit", "release", "reconcile", "transport", "bundle"] as const) test(`H close drains actual ${stage} work after bounded HTTP`, async t => {
  const f = await fixture(t), entered = Promise.withResolvers<void>(), unblock = Promise.withResolvers<void>();
  const interrupted = Promise.withResolvers<void>();
  let holdBundle = false;
  const hold = async (signal?: AbortSignal) => {
    entered.resolve(); if (signal?.aborted) interrupted.resolve(); else signal?.addEventListener("abort", () => interrupted.resolve(), { once: true });
    await unblock.promise;
  };
  const h = await supplierFixture(f.root, {
    audit: async (e, signal) => { if (stage === "audit" && e.phase === "finish") await hold(signal); if (stage === "release" && e.phase === "dispatch") throw new Error("test-dispatch-audit-failure"); },
    release: async (_row, signal) => { if (stage === "release") await hold(signal); },
    reconcile: async (_event, signal) => { if (stage === "reconcile") await hold(signal); },
    settled: async () => { if (stage === "bundle" && holdBundle) await hold(); },
  }); t.after(() => h.dispose());
  const c = parseHOperationalConfiguration({ ...hConfiguration(f.config), runnerTimeoutMs: 250, requestTimeoutMs: 10000, shutdownGraceMs: 12000 });
  const runtime = await createOperatorRuntime({ ...f, origin, configuration: c, privatePhotos: false,
    backend: { kind: "h-suppliers", open: h.open }, transport: async () => { if (stage === "transport") await hold(); return response(f.snapshot.input); } });
  try {
    const cookie = await login(runtime.app), pending = runtime.app.fetch(answers(f, cookie));
    if (stage === "bundle") { assert.equal((await pending).status, 303); holdBundle = true; } else { await entered.promise; assert.ok([502, 504].includes((await pending).status)); }
    if (["audit", "release", "reconcile"].includes(stage)) await interrupted.promise;
    let closed = false; const closing = runtime.close().then(() => { closed = true; });
    await entered.promise; await tick(); assert.equal(closed, false); assert.equal(h.closes, 0); runtime.runtime.assertReady();
    unblock.resolve(); await closing; assert.equal(h.closes, 1);
    const ledger = new Database(h.paths.ledger, { readonly: true });
    try {
      const count = ledger.query<{ n: number }, []>("SELECT count(*) AS n FROM settlements").get()?.n;
      assert.equal(count, ["reconcile", "transport", "bundle"].includes(stage) ? 1 : 0);
    } finally { ledger.close(); }
  } finally { unblock.resolve(); await runtime.close(); }
});

test("H audit contention retains independent recovery acknowledgement and unknown usage", async t => {
  const f = await fixture(t), h = await supplierFixture(f.root); t.after(() => h.dispose());
  const writer = new Database(h.paths.audit); let held = false;
  const runtime = await createOperatorRuntime({ ...f, origin, configuration: hConfiguration(f.config), privatePhotos: false,
    backend: { kind: "h-suppliers", open: h.open }, transport: async () => { writer.exec("BEGIN IMMEDIATE"); held = true; return response(f.snapshot.input); } });
  try {
    const cookie = await login(runtime.app); assert.equal((await runtime.app.fetch(answers(f, cookie))).status, 502); await runtime.settled();
    assert.equal(h.recovery.query<{ n: number }, []>("SELECT count(*) AS n FROM recovery_tasks").get()?.n, 1);
    assert.equal((await h.recover()).state, "completed");
    assert.equal(h.ledger.query<{ state: string }, []>("SELECT state FROM reservations").get()?.state, "unknown");
    assert.equal(h.count("settlements"), 0); assert.deepEqual(runtime.caseStore.read(`actor:${f.actor.actorId}`, f.snapshot.input.caseId), f.snapshot);
  } finally { if (held) writer.exec("ROLLBACK"); writer.close(); await runtime.close(); }
});

test("H reload retains consumed quota, fails stopped on reused changed approval, and never opens journal", async t => {
  const f = await fixture(t), h = await supplierFixture(f.root); t.after(() => h.dispose()); let calls = 0;
  const c = hConfiguration(f.config), runtime = await createOperatorRuntime({ ...f, origin, configuration: c, privatePhotos: false,
    backend: { kind: "h-suppliers", open: h.open }, transport: async () => { calls++; return response(f.snapshot.input); } });
  try {
    const cookie = await login(runtime.app); assert.equal((await runtime.app.fetch(answers(f, cookie))).status, 303);
    const authority = runtime.authority, ticket = authority.current();
    await runtime.reloadConfiguration(c); assert.equal(runtime.authority, authority); assert.equal(runtime.authority.current(), ticket);
    assert.equal(h.count("reservations"), 1); assert.equal(h.count("policy"), 1);
    const next = post(f.path + "/answers", cookie, { baseVersion: 2, patch: { massKg: f.snapshot.input.massKg } });
    assert.equal((await runtime.app.fetch(next)).status, 503); assert.equal(calls, 1);
    await assert.rejects(runtime.reloadConfiguration({ ...c, validUntil: c.validUntil + 1 }));
    assert.equal((await runtime.app.fetch(new Request(origin))).status, 503);
    await assert.rejects(runtime.reloadConfiguration(c));
  } finally { await runtime.close(); }
});

for (const shutdown of ["close", "dispose"] as const) test(`H reload completion cannot reopen admissions during concurrent ${shutdown}`, async t => {
  const f = await fixture(t), entered = Promise.withResolvers<void>(), unblock = Promise.withResolvers<void>(); let activate = 0;
  const h = await supplierFixture(f.root, { activate: async () => { if (++activate > 1) { entered.resolve(); await unblock.promise; } } }); t.after(() => h.dispose());
  const c = hConfiguration(f.config), runtime = await createOperatorRuntime({ ...f, origin, configuration: c, privatePhotos: false,
    backend: { kind: "h-suppliers", open: h.open }, transport: async () => response(f.snapshot.input) });
  try {
    const reloading = runtime.reloadConfiguration(c); await entered.promise;
    if (shutdown === "dispose") runtime.app.dispose();
    const closing = shutdown === "close" ? runtime.close() : undefined;
    assert.equal((await runtime.app.fetch(new Request(origin))).status, 503);
    unblock.resolve(); await reloading;
    assert.equal((await runtime.app.fetch(new Request(origin))).status, 503);
    await closing; await runtime.close();
    assert.equal((await runtime.app.fetch(new Request(origin))).status, 503); assert.equal(h.closes, 1);
  } finally { unblock.resolve(); await runtime.close(); }
});

for (const failure of ["throw", "false"] as const) test(`failed late recovery acknowledgement (${failure}) stops further admissions`, async t => {
  const f = await fixture(t), entered = Promise.withResolvers<void>(), unblock = Promise.withResolvers<void>();
  const h = await supplierFixture(f.root, { reserve: async () => { entered.resolve(); await unblock.promise; } }); t.after(() => h.dispose());
  const runtime = await createOperatorRuntime({ ...f, origin, configuration: hConfiguration(f.config), privatePhotos: false,
    backend: { kind: "h-suppliers", open: async context => {
      const bundle = await h.open(context);
      Reflect.set(bundle.store, "enqueueRecovery", () => { if (failure === "throw") throw new Error("test-outbox-unavailable"); return false; });
      return bundle;
    } }, transport: async () => response(f.snapshot.input) });
  try {
    const cookie = await login(runtime.app), controller = new AbortController(), pending = runtime.app.fetch(answers(f, cookie, controller.signal));
    await entered.promise; controller.abort(); assert.equal((await pending).status, 408);
    unblock.resolve(); await runtime.settled();
    assert.equal((await runtime.app.fetch(new Request(origin))).status, 503);
  } finally { unblock.resolve(); await runtime.close(); }
});

test("H HTTP bridge uses real loopback and native login", async t => {
  const f = await fixture(t), h = await supplierFixture(f.root); t.after(() => h.dispose());
  const runtime = await createOperatorRuntime({ ...f, origin, configuration: hConfiguration(f.config), privatePhotos: false,
    backend: { kind: "h-suppliers", open: h.open }, transport: async () => response(f.snapshot.input) });
  const server = createServer((incoming, outgoing) => { void requestBridge(origin, runtime.app.fetch)(incoming, outgoing); });
  try {
    await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}`, started = performance.now();
    const signed = await fetch(url + "/login", { method: "POST", redirect: "manual", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username: "operator", password: secret }) });
    const cookie = await loginCookie(signed, started), request = answers(f, cookie);
    const result = await fetch(`http://127.0.0.1:${address.port}${new URL(request.url).pathname}`, { method: "POST", redirect: "manual", headers: request.headers, body: await request.text() });
    assert.equal(result.status, 303); assert.equal(h.count("settlements"), 1);
  } finally { await new Promise<void>(done => server.close(() => done())); await runtime.close(); }
});

test("typed H launcher injection rejects environment journal configuration and implicit model mode", async t => {
  // Given invalid launch combinations, when invoked, then no supplier may open.
  const previous = { mode: process.env["RESOURCE_MODEL_RUNNER"], config: process.env["RESOURCE_OPERATIONAL_CONFIG"] };
  const f = await fixture(t), h = await supplierFixture(f.root); t.after(() => h.dispose());
  try {
    process.env["RESOURCE_MODEL_RUNNER"] = "local";
    await assert.rejects(startApp({ suppliers: { configuration: hConfiguration(f.config), open: h.open } }));
    process.env["RESOURCE_MODEL_RUNNER"] = "operational"; process.env["RESOURCE_OPERATIONAL_CONFIG"] = "/unopened-config";
    await assert.rejects(startApp({ suppliers: { configuration: hConfiguration(f.config), open: h.open } }));
    assert.equal(h.opens, 0);
  } finally {
    if (previous.mode === undefined) delete process.env["RESOURCE_MODEL_RUNNER"]; else process.env["RESOURCE_MODEL_RUNNER"] = previous.mode;
    if (previous.config === undefined) delete process.env["RESOURCE_OPERATIONAL_CONFIG"]; else process.env["RESOURCE_OPERATIONAL_CONFIG"] = previous.config;
  }
});
