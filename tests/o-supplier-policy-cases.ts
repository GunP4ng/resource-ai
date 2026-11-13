import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "bun:sqlite";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createOperatorRuntime } from "../src/o-operational-runtime.ts";
import { parseHOperationalConfiguration } from "../src/o-operations-config.ts";
import { createBundledSnapshotReader, prepareCaseRecord } from "../src/case-record.ts";
import { revision } from "../src/o-validation.ts";
import { fixture, login, post, origin, response, signal } from "./o-operational-fixtures.ts";
import { hConfiguration, supplierFixture } from "./o-supplier-fixture.ts";

export function registerSupplierPolicyCases() {
  test("H pins supplier callbacks while preserving supplier-owned mutable lifecycle state", async t => {
    const f = await fixture(t), h = await supplierFixture(f.root); t.after(() => h.dispose());
    let supplier: Awaited<ReturnType<typeof h.open>> | undefined, closed = false;
    const runtime = await createOperatorRuntime({ ...f, origin, configuration: hConfiguration(f.config), privatePhotos: false,
      backend: { kind: "h-suppliers", open: async context => {
        const bundle = await h.open(context);
        const managed = { ...bundle, resourceOpen: true, async close() { this.resourceOpen = false; closed = true; await bundle.close(); } };
        supplier = managed; return managed;
      } }, transport: async () => response(f.snapshot.input) });
    try {
      assert.ok(supplier);
      Reflect.set(supplier.ledger, "reserve", async () => { throw new Error("test-retargeted-supplier"); });
      const cookie = await login(runtime.app);
      assert.equal((await runtime.app.fetch(post(f.path + "/answers", cookie, { baseVersion: 1, patch: { massKg: f.snapshot.input.massKg } }))).status, 303);
    } finally { await runtime.close(); }
    assert.equal(closed, true); assert.equal(h.closes, 1);
  });

  test("unchanged input uses a new immutable source/attempt binding on each lease with exact artifact origin", async t => {
    const f = await fixture(t), h = await supplierFixture(f.root); t.after(() => h.dispose());
    const artifact = await prepareCaseRecord(f.snapshot.input, { dataOrigin: { kind: "synthetic", reference: "test-only H source binding" },
      codeRevision: "ceb9e48b6db3e1a16b1eb69a65a35da8482b0dc4", signal: signal(), sources: createBundledSnapshotReader(new URL("../", import.meta.url).pathname) });
    const folder = join(f.resourcesRoot, f.actor.actorId, f.snapshot.input.caseId); await mkdir(folder, { recursive: true, mode: 0o700 });
    await writeFile(join(folder, revision(f.snapshot.input) + ".json"), JSON.stringify(artifact), { mode: 0o600 });
    const config = parseHOperationalConfiguration({ ...hConfiguration(f.config), requestAllowance: 2,
      grants: f.config.grants.map(g => ({ ...g, artifactSha256: artifact.sha256 })) });
    let calls = 0, immutable = false;
    const runtime = await createOperatorRuntime({ ...f, origin, configuration: config, privatePhotos: false,
      backend: { kind: "h-suppliers", open: async context => {
        const bundle = await h.open(context);
        return { ...bundle, ledger: { ...bundle.ledger, reserve: async (request, signal) => {
          const binding = context.binding(request.runId);
          immutable = Object.isFrozen(binding) && Object.isFrozen(binding.policy) && Object.isFrozen(binding.policy.grants) && Object.isFrozen(binding.artifact);
          assert.equal(Reflect.set(binding, "leaseToken", "borrowed-lease"), false);
          return bundle.ledger.reserve(request, signal);
        } } };
      } }, transport: async () => { calls++; return response(f.snapshot.input); } });
    try {
      const cookie = await login(runtime.app);
      for (const baseVersion of [1, 2]) assert.equal((await runtime.app.fetch(post(f.path + "/answers", cookie, { baseVersion, patch: { massKg: f.snapshot.input.massKg } }))).status, 303);
      await runtime.settled(); assert.equal(calls, 2); assert.equal(immutable, true);
      const rows = h.ledger.query<{ id: string; run: string; binding: string }, []>("SELECT * FROM reservations ORDER BY rowid").all();
      assert.equal(rows.length, 2); const first = rows[0], second = rows[1]; assert.ok(first && second);
      const a = JSON.parse(first.binding), b = JSON.parse(second.binding);
      assert.notEqual(first.run, second.run); assert.notEqual(first.id, second.id); assert.notEqual(a.leaseToken, b.leaseToken);
      assert.equal(a.inputRevision, b.inputRevision); assert.deepEqual(a.artifact, { hash: artifact.sha256, origin: "synthetic" });
      assert.throws(() => h.binding(first.run));
      assert.equal(runtime.caseStore.read(`actor:${f.actor.actorId}`, f.snapshot.input.caseId)?.review?.hash, artifact.sha256);
    } finally { await runtime.close(); }
  });

  test("H restart durably pins approval and preserves spent technical quota and synthetic report", async t => {
    const f = await fixture(t), h = await supplierFixture(f.root); t.after(() => h.dispose()); const c = hConfiguration(f.config); let calls = 0;
    const transport = async () => { calls++; return response(f.snapshot.input); };
    const runtime = await createOperatorRuntime({ ...f, origin, configuration: c, privatePhotos: false, backend: { kind: "h-suppliers", open: h.open }, transport });
    try {
      const cookie = await login(runtime.app);
      assert.equal((await runtime.app.fetch(post(f.path + "/answers", cookie, { baseVersion: 1, patch: { massKg: f.snapshot.input.massKg } }))).status, 303);
    } finally { await runtime.close(); }
    const reopened = await supplierFixture(f.root); t.after(() => reopened.dispose());
    const second = await createOperatorRuntime({ ...f, origin, configuration: c, privatePhotos: false, backend: { kind: "h-suppliers", open: reopened.open }, transport });
    try {
      assert.equal(second.caseStore.read(`actor:${f.actor.actorId}`, f.snapshot.input.caseId)?.presentation?.mode, "synthetic");
      const cookie = await login(second.app);
      assert.equal((await second.app.fetch(post(f.path + "/answers", cookie, { baseVersion: 2, patch: { massKg: f.snapshot.input.massKg } }))).status, 503);
      assert.equal(calls, 1); assert.equal(reopened.count("policy"), 1); assert.equal(reopened.count("reservations"), 1);
    } finally { await second.close(); }
    const conflicting = await supplierFixture(f.root); t.after(() => conflicting.dispose());
    await assert.rejects(createOperatorRuntime({ ...f, origin, configuration: { ...c, validUntil: c.validUntil + 1 }, privatePhotos: false,
      backend: { kind: "h-suppliers", open: conflicting.open }, transport }));
  });

  test("H reload drains late authorization without resetting unresolved quota or admitting a new lease", async t => {
    const f = await fixture(t), entered = Promise.withResolvers<string>(), unblock = Promise.withResolvers<void>();
    const h = await supplierFixture(f.root, { reserve: async r => { entered.resolve(r.runId); await unblock.promise; } }); t.after(() => h.dispose());
    const c = hConfiguration(f.config); let calls = 0;
    const runtime = await createOperatorRuntime({ ...f, origin, configuration: c, privatePhotos: false, backend: { kind: "h-suppliers", open: h.open },
      transport: async () => { calls++; return response(f.snapshot.input); } });
    try {
      const cookie = await login(runtime.app), controller = new AbortController();
      const pending = runtime.app.fetch(new Request(post(f.path + "/answers", cookie, { baseVersion: 1, patch: { massKg: f.snapshot.input.massKg } }), { signal: controller.signal }));
      const id = await entered.promise; controller.abort(); assert.equal((await pending).status, 408);
      let loaded = false; const reloading = runtime.reloadConfiguration(c).then(() => { loaded = true; });
      await new Promise<void>(done => setImmediate(done)); assert.equal(loaded, false); assert.ok(h.binding(id));
      assert.equal((await runtime.app.fetch(new Request(origin))).status, 503);
      unblock.resolve(); await reloading; assert.throws(() => h.binding(id));
      assert.equal((await runtime.app.fetch(post(f.path + "/answers", cookie, { baseVersion: 1, patch: { massKg: f.snapshot.input.massKg } }))).status, 503);
      assert.equal(calls, 0); assert.equal(h.count("reservations"), 1); assert.equal((await h.recover()).state, "completed");
    } finally { unblock.resolve(); await runtime.close(); await h.recoverySettled(); }
  });

  test("queued H reloads keep admissions stopped until the final activation completes", async t => {
    const f = await fixture(t), entered = Promise.withResolvers<void>(), queued = Promise.withResolvers<void>();
    const first = Promise.withResolvers<void>(), second = Promise.withResolvers<void>(); let activations = 0;
    const h = await supplierFixture(f.root, { activate: async () => {
      if (++activations === 2) { entered.resolve(); await first.promise; }
      else if (activations === 3) { queued.resolve(); await second.promise; }
    } }); t.after(() => h.dispose());
    const c = hConfiguration(f.config), runtime = await createOperatorRuntime({ ...f, origin, configuration: c, privatePhotos: false,
      backend: { kind: "h-suppliers", open: h.open }, transport: async () => response(f.snapshot.input) });
    try {
      const reloading = runtime.reloadConfiguration(c); await entered.promise;
      const next = runtime.reloadConfiguration(c); first.resolve(); await queued.promise;
      assert.equal((await runtime.app.fetch(new Request(origin))).status, 503);
      second.resolve(); await reloading; await next;
      assert.equal((await runtime.app.fetch(new Request(origin + "/operations/readiness"))).status, 200);
    } finally { first.resolve(); second.resolve(); await runtime.close(); }
  });

  for (const problem of ["test-live", "shared-store", "memory-store", "readiness", "supervisor", "retention", "mixed", "unknown"] as const) test(`H rejects ${problem} integration without reservation or fallback`, async t => {
    const f = await fixture(t), h = await supplierFixture(f.root); t.after(() => h.dispose());
    const selection = { kind: "h-suppliers" as const, open: async (context: Parameters<typeof h.open>[0]) => {
      const bundle = await h.open(context);
      if (problem === "shared-store") Reflect.set(bundle.identity, "recoveryDatabase", bundle.identity.auditDatabase);
      if (problem === "memory-store") Reflect.set(bundle.identity, "auditDatabase", ":memory:");
      if (problem === "readiness") Reflect.set(bundle, "assertReady", async () => { throw new Error("test-not-ready"); });
      if (problem === "supervisor") Reflect.set(bundle.recoverySupervisor, "assertReady", async () => { throw new Error("test-supervisor-unavailable"); });
      if (problem === "retention") Reflect.set(bundle.retention, "assertReady", async () => { throw new Error("test-retention-unapproved"); });
      return bundle;
    } };
    if (problem === "mixed") Reflect.set(selection, "journal", true);
    if (problem === "unknown") Reflect.set(selection, "kind", "unknown");
    await assert.rejects(createOperatorRuntime({ ...f, origin, configuration: hConfiguration(f.config), privatePhotos: false, backend: selection,
      ...(problem === "test-live" ? {} : { transport: async () => response(f.snapshot.input) }) }));
    const ledger = new Database(h.paths.ledger, { readonly: true });
    try { assert.equal(ledger.query<{ n: number }, []>("SELECT count(*) AS n FROM reservations").get()?.n, 0); } finally { ledger.close(); }
    if (["mixed", "unknown"].includes(problem)) assert.equal(h.opens, 0);
  });

  test("independent supervisor inspects expired ledger reservations without an outbox acknowledgement", async t => {
    const f = await fixture(t), h = await supplierFixture(f.root); t.after(() => h.dispose());
    h.ledger.query("INSERT INTO reservations VALUES(?,?,?,?,?,'reserved',?)").run("lost-response", "crashed-run", 1, f.config.approvalId, "{}", Date.now() - 1);
    assert.equal((await h.recover()).state, "empty");
    const state = () => h.ledger.query<{ state: string }, []>("SELECT state FROM reservations").get()?.state;
    assert.equal(state(), "unknown"); await h.recover(); assert.equal(state(), "unknown");
    assert.equal(h.count("settlements"), 0);
    const db = new Database(h.paths.recovery); try { assert.equal(db.query<{ n: number }, []>("SELECT count(*) AS n FROM recovery_tasks").get()?.n, 0); } finally { db.close(); }
  });

  test("independent recovery supervisor drains raw handlers after bounded cancellation and deduplicates retries", async t => {
    const f = await fixture(t), entered = Promise.withResolvers<void>(), unblock = Promise.withResolvers<void>();
    let attempts = 0;
    const h = await supplierFixture(f.root, { recovery: async () => { if (++attempts === 1) { entered.resolve(); await unblock.promise; } } }); t.after(() => h.dispose());
    const task = { reason: "late-reservation" as const, event: null, reservations: [{ approvalId: "lost-response", runId: "crashed-run", caseRevision: "a".repeat(64), attempt: 1, expiresAt: Date.now() + 60000 }] };
    h.ledger.query("INSERT INTO reservations VALUES(?,?,?,?,?,'reserved',?)").run("lost-response", "crashed-run", 1, f.config.approvalId, "{}", Date.now() + 60000);
    h.store.enqueueRecovery(task);
    const controller = new AbortController(), pending = h.recover({ signal: controller.signal });
    try {
      await entered.promise; controller.abort(); assert.equal((await pending).state, "retry-pending");
      let drained = false; const settling = h.recoverySettled().then(() => { drained = true; });
      await new Promise<void>(done => setImmediate(done)); assert.equal(drained, false);
      assert.equal((await h.recover()).state, "completed");
      unblock.resolve(); await settling; await h.recoverySettled();
      assert.equal(h.count("recovery_effects"), 1); assert.equal(h.count("settlements"), 0);
      assert.equal(h.ledger.query<{ state: string }, []>("SELECT state FROM reservations").get()?.state, "unknown");
    } finally { unblock.resolve(); await h.recoverySettled(); }
  });
}
