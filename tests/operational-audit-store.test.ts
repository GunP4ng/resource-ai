import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createOperationalAuditStore, OperationalStorageError, processOperationalRecovery } from "../src/operational-audit-store.ts";
import { createOperationalHandoff } from "../src/operational-handoff.ts";
import { createOperationalRunner, type OperationalAudit } from "../src/operations.ts";
import { syntheticCase } from "./h-fixtures.ts";
import { SessionFailure } from "../src/session.ts";
import type { RecoveryTask } from "../src/operational-handoff.ts";
import { revision } from "../src/o-validation.ts";
import { spawnSync } from "node:child_process";

// All records/actors/usage below are synthetic, never model or billing evidence.
const live = () => new AbortController().signal;
const event = (phase: OperationalAudit["phase"]): OperationalAudit => ({ phase, runId: "synthetic-run", caseRevision: "a".repeat(64),
  at: "2026-11-10T00:00:00.000Z", elapsedMs: 1, ...(phase === "finish" ? { outcome: "provider" as const } : {}),
  requests: phase === "start" ? [] : [{ approvalId: "synthetic-approval", attempt: 1, transportStarted: phase === "finish", requestId: null, status: null }], usage: null,
  images: [] });
const task = (): RecoveryTask => ({ reason: "terminal-failure", event: event("finish"), reservations: [{ runId: "synthetic-run", caseRevision: "a".repeat(64), approvalId: "synthetic-approval", attempt: 1, expiresAt: 10000 }] });
const failure = (code: string) => (error: unknown) => error instanceof OperationalStorageError && error.code === code;
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "h-audit-store-")), auditPath = join(root, "audit.sqlite"), recoveryPath = join(root, "recovery.sqlite");
  const connections = new Set<Database>(); let now = 1000, deny = false;
  const connect = () => { const audit = new Database(auditPath, { strict: true }), recovery = new Database(recoveryPath, { strict: true }); connections.add(audit); connections.add(recovery); return { audit, recovery }; };
  const guard = (path: string) => {
    // Fixture guard tests path identity/link checks; actual owner/ACL provisioning is operator-owned.
    if (deny || dirname(path) !== root || ![auditPath, recoveryPath].includes(path) || !lstatSync(path).isFile() || lstatSync(path).nlink !== 1) throw new Error("synthetic guard rejection");
    return true as const;
  };
  const open = (initialize = false, max = 100) => {
    const { audit, recovery } = connect();
    const store = createOperationalAuditStore({ auditDatabase: audit, recoveryDatabase: recovery, assertPrivateDatabase: guard,
      initialize, maxAuditEntries: max, maxRecoveryEntries: max, now: () => now });
    return { store, audit, recovery, close() { store.dispose(); for (const db of [audit, recovery]) if (connections.delete(db)) db.close(); } };
  };
  return { root, auditPath, recoveryPath, open, guard, connect, disconnect: (db: Database) => { if (connections.delete(db)) db.close(); }, at: (time: number) => { now = time; }, deny: () => { deny = true; },
    close: async () => { for (const db of connections) db.close(); connections.clear(); await rm(root, { recursive: true, force: true }); } };
}

test("file audit/outbox survive reopening, preserve unknown usage and deduplicate exact writes", async () => {
  const f = await fixture();
  try {
    const first = f.open(true);
    for (const phase of ["start", "dispatch", "finish"] as const) await first.store.appendAudit(event(phase));
    await first.store.appendAudit(event("finish")); first.store.enqueueRecovery(task()); first.store.enqueueRecovery(task());
    first.close();
    const next = f.open();
    assert.deepEqual(next.store.readAudit("synthetic-run"), [event("start"), event("dispatch"), event("finish")]);
    assert.equal(next.store.readAudit("synthetic-run")[2]!.usage, null);
    const lease = next.store.claimRecovery(100); assert.ok(lease); assert.deepEqual(lease.task, task());
    assert.equal(next.store.claimRecovery(100), null);
    assert.equal(next.store.completeRecovery(lease.id, lease.token), true);
    next.store.enqueueRecovery(task()); assert.equal(next.store.claimRecovery(100), null);
  } finally { await f.close(); }
});

test("separate connections serialize claims and stale acknowledgements cannot erase reclaimed work", async () => {
  const f = await fixture();
  try {
    const a = f.open(true), b = f.open(); a.store.enqueueRecovery(task());
    const old = a.store.claimRecovery(100)!; assert.equal(b.store.claimRecovery(100), null);
    f.at(1100); const current = b.store.claimRecovery(100)!; assert.ok(current); assert.notEqual(old.token, current.token); assert.equal(current.attempts, 2);
    assert.equal(a.store.completeRecovery(old.id, old.token), false); assert.equal(a.store.retryRecovery(old.id, old.token, 0), false);
    assert.equal(b.store.completeRecovery(current.id, current.token), true);
  } finally { await f.close(); }
});

test("lost process lease recovers after close/reopen; completion stays idempotent", async () => {
  const f = await fixture();
  try {
    const a = f.open(true); a.store.enqueueRecovery(task()); const lost = a.store.claimRecovery(50)!;
    a.close(); f.at(1050);
    const b = f.open(), recovered = b.store.claimRecovery(50)!;
    assert.ok(recovered); assert.equal(b.store.completeRecovery(lost.id, lost.token), false);
    assert.equal(b.store.completeRecovery(recovered.id, recovered.token), true);
    assert.equal(b.store.completeRecovery(recovered.id, recovered.token), false);
  } finally { await f.close(); }
});

test("a child process exits after durable claim and another connection reclaims its expired lease", async () => {
  const f = await fixture();
  try {
    const a = f.open(true); a.store.enqueueRecovery(task());
    const code = `const {Database}=await import('bun:sqlite');
      const {createOperationalAuditStore}=await import(${JSON.stringify(new URL("../src/operational-audit-store.ts", import.meta.url).href)});
      const audit=new Database(${JSON.stringify(f.auditPath)}), recovery=new Database(${JSON.stringify(f.recoveryPath)});
      const store=createOperationalAuditStore({auditDatabase:audit,recoveryDatabase:recovery,assertPrivateDatabase:()=>true,maxAuditEntries:100,maxRecoveryEntries:100,now:()=>1000});
      const lease=store.claimRecovery(100);console.log(JSON.stringify({id:lease.id,token:lease.token}));process.exit(0);`;
    const child = spawnSync(process.execPath, ["--eval", code], { encoding: "utf8", timeout: 10000 });
    assert.equal(child.status, 0, child.stderr); const old = JSON.parse(child.stdout) as { id: string; token: string };
    assert.equal(a.store.claimRecovery(100), null); f.at(1100);
    const recovered = a.store.claimRecovery(100)!; assert.ok(recovered); assert.notEqual(recovered.token, old.token);
    assert.equal(a.store.completeRecovery(old.id, old.token), false); assert.equal(a.store.completeRecovery(recovered.id, recovered.token), true);
  } finally { await f.close(); }
});

test("audit writer contention cannot block the independent recovery acknowledgement; recovery contention stays visible", async () => {
  const f = await fixture();
  try {
    const a = f.open(true), b = f.open();
    a.audit.exec("BEGIN IMMEDIATE");
    try { await assert.rejects(b.store.appendAudit(event("start")), failure("unavailable")); assert.equal(b.store.enqueueRecovery(task()), true); }
    finally { a.audit.exec("ROLLBACK"); }
    const second = { ...task(), reason: "late-reservation" as const };
    a.recovery.exec("BEGIN IMMEDIATE");
    try { assert.throws(() => b.store.enqueueRecovery(second), failure("unavailable")); }
    finally { a.recovery.exec("ROLLBACK"); }
    assert.equal(b.store.enqueueRecovery(second), true);
  } finally { await f.close(); }
});

test("audit failure uses independent durable outbox through the H handoff", async () => {
  const f = await fixture();
  try {
    const a = f.open(true), hooks = createOperationalHandoff({ reserve: async () => ({ approvalId: "synthetic-approval", expiresAt: Date.now() + 60000 }),
      appendAudit: a.store.appendAudit, enqueueRecovery: a.store.enqueueRecovery, release: async () => {}, reconcile: async () => {} });
    await hooks.record(event("start")); await hooks.authorizeDispatch({ runId: "synthetic-run", caseRevision: "a".repeat(64), attempt: 1,
      endpoint: "https://example.invalid", modelId: "gpt-6-sol", deployment: "", maxOutputTokens: 128 }, live());
    a.audit.exec("PRAGMA query_only=ON");
    await assert.rejects(hooks.record(event("finish")), failure("unavailable"));
    const queued = a.store.claimRecovery(100); assert.ok(queued); assert.equal(queued.task.event!.usage, null);
    assert.equal(queued.task.reservations.length, 1);
  } finally { await f.close(); }
});

test("actual SDK runner persists transport evidence and queues terminal failure instead of reporting success", async () => {
  for (const failFinish of [false, true]) {
    const f = await fixture();
    try {
      const a = f.open(true); let runId = "", reconciled = 0, sent = 0;
      const hooks = createOperationalHandoff({ reserve: async () => ({ approvalId: "synthetic-approval", expiresAt: Date.now() + 60000 }),
        appendAudit: async (e, signal) => { runId = e.runId; await a.store.appendAudit(e, signal); }, enqueueRecovery: a.store.enqueueRecovery,
        release: async () => assert.fail("transmitted requests cannot be blindly released"), reconcile: async () => { reconciled++; } });
      const runner = createOperationalRunner({ enabled: true, timeoutMs: 5000, maxTurns: 1, maxOutputTokens: 128, ...hooks,
        configuration: async () => ({ endpoint: "https://synthetic.openai.azure.com", deployment: "synthetic", modelId: "gpt-4.1", apiKey: "synthetic-key", apiVersion: "v1" }),
        transport: async () => { sent++; if (failFinish) a.audit.exec("PRAGMA query_only=ON");
          return new Response("synthetic private diagnostic", { status: 401, headers: { "x-request-id": "synthetic-request" } }); } });
      await assert.rejects(runner(syntheticCase, live()), (error: unknown) => error instanceof SessionFailure && error.code === (failFinish ? "provider" : "authentication"));
      assert.equal(sent, 1);
      const records = a.store.readAudit(runId); assert.equal(records.length, failFinish ? 2 : 3);
      assert.equal(JSON.stringify(records).includes("synthetic private diagnostic"), false);
      if (failFinish) {
        const queued = a.store.claimRecovery(100)!; assert.ok(queued);
        assert.equal(queued.task.event!.requests[0]!.transportStarted, true); assert.equal(queued.task.event!.usage, null);
        assert.equal(queued.task.event!.requests[0]!.requestId, "synthetic-request"); assert.equal(reconciled, 0);
      } else {
        assert.equal(records.at(-1)!.requests[0]!.requestId, "synthetic-request"); assert.equal(records.at(-1)!.usage, null);
        assert.equal(a.store.claimRecovery(100), null); assert.equal(reconciled, 1);
      }
    } finally { await f.close(); }
  }
});

test("audit connection loss or weakened durability cannot disable the healthy independent recovery outbox", async () => {
  const f = await fixture();
  try {
    const a = f.open(true); a.audit.exec("PRAGMA synchronous=OFF");
    await assert.rejects(a.store.appendAudit(event("start")), failure("durability-required"));
    assert.equal(a.store.enqueueRecovery(task()), true);
    f.disconnect(a.audit);
    await assert.rejects(a.store.appendAudit(event("start")), failure("unavailable"));
    assert.ok(a.store.claimRecovery(100));
    a.recovery.exec("PRAGMA synchronous=OFF");
    assert.throws(() => a.store.enqueueRecovery({ ...task(), reason: "late-reservation" }), failure("durability-required"));
  } finally { await f.close(); }
});

test("dedicated recovery worker restarts without opening a corrupted audit schema", async () => {
  const f = await fixture();
  try {
    const a = f.open(true); a.store.enqueueRecovery(task()); a.audit.exec("CREATE TABLE unexpected(value TEXT)");
    assert.throws(() => f.open(), failure("schema-unverified"));
    const connection = f.connect();
    const worker = createOperationalAuditStore({ recoveryOnly: true, recoveryDatabase: connection.recovery,
      assertPrivateDatabase: f.guard, maxAuditEntries: 100, maxRecoveryEntries: 100, now: () => 1000 });
    assert.throws(() => worker.readAudit("synthetic-run"), failure("audit-disabled"));
    await assert.rejects(worker.appendAudit(event("start")), failure("audit-disabled"));
    const result = await processOperationalRecovery(worker, async value => { assert.deepEqual(value, task()); }, { leaseMs: 1000, retryDelayMs: 0, signal: live() });
    assert.equal(result.state, "completed"); worker.dispose();
    assert.ok(a.audit.query("SELECT name FROM sqlite_master WHERE name='unexpected'").get());
  } finally { await f.close(); }
});

test("audit conflicts, missing start and payload-routing corruption fail closed", async () => {
  const f = await fixture();
  try {
    const a = f.open(true);
    await assert.rejects(a.store.appendAudit(event("finish")), failure("start-required"));
    await a.store.appendAudit(event("start"));
    await assert.rejects(a.store.appendAudit({ ...event("start"), elapsedMs: 2 }), failure("audit-conflict"));
    a.audit.query("UPDATE audit_events SET run_id=?").run("wrong-run");
    assert.throws(() => a.store.readAudit("wrong-run"), failure("audit-routing-mismatch"));
  } finally { await f.close(); }
});

test("raw case fields, forged recovery hashes, capacity and guard failures are visible", async () => {
  const f = await fixture();
  try {
    const a = f.open(true, 1);
    await assert.rejects(a.store.appendAudit({ ...event("start"), description: "must never persist case text" } as OperationalAudit), failure("invalid-audit"));
    await a.store.appendAudit(event("start")); await assert.rejects(a.store.appendAudit(event("finish")), failure("capacity"));
    a.store.enqueueRecovery(task());
    assert.throws(() => a.store.enqueueRecovery({ ...task(), reason: "late-reservation" }), failure("capacity"));
    a.recovery.query("UPDATE recovery_tasks SET payload=?").run(JSON.stringify({ ...task(), reason: "late-reservation" }));
    assert.throws(() => a.store.claimRecovery(100), failure("hash-mismatch"));
    f.deny(); assert.throws(() => a.store.readAudit("synthetic-run"), failure("unavailable"));
  } finally { await f.close(); }
});

test("memory/shared databases and unknown schema are rejected instead of silently resetting", async () => {
  const f = await fixture(), memory = new Database(":memory:");
  try {
    const c = f.connect(), options = { auditDatabase: c.audit, recoveryDatabase: c.recovery, assertPrivateDatabase: f.guard, maxAuditEntries: 10, maxRecoveryEntries: 10, initialize: true };
    assert.throws(() => createOperationalAuditStore({ ...options, assertPrivateDatabase: () => false as unknown as true }), failure("private-store-unverified"));
    assert.throws(() => createOperationalAuditStore({ ...options, auditDatabase: memory }), failure("file-database-required"));
    assert.throws(() => createOperationalAuditStore({ ...options, recoveryDatabase: c.audit }), failure("independent-recovery-required"));
    c.audit.exec("CREATE TABLE other(value TEXT)");
    assert.throws(() => createOperationalAuditStore(options), failure("schema-unverified"));
    assert.ok(c.audit.query("SELECT name FROM sqlite_master WHERE name='other'").get());
  } finally { memory.close(); await f.close(); }
});

test("temporary tables cannot shadow durable audit tables", async () => {
  const f = await fixture();
  try {
    const a = f.open(true); a.audit.exec("CREATE TEMP TABLE audit_events(secret TEXT)");
    await assert.rejects(a.store.appendAudit(event("start")), failure("temporary-schema-unverified"));
  } finally { await f.close(); }
});

test("worker cancellation interrupts an ignored-signal handler, queues retry and refuses late acknowledgement", async () => {
  const f = await fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  try {
    const a = f.open(true); a.store.enqueueRecovery(task()); const controller = new AbortController();
    const pending = processOperationalRecovery(a.store, async (_task, signal) => { entered.resolve(); await release.promise; assert.equal(signal.aborted, true); },
      { leaseMs: 1000, retryDelayMs: 0, signal: controller.signal });
    await entered.promise; controller.abort(); const result = await pending;
    assert.equal(result.state, "retry-pending"); assert.equal(result.reason, "cancelled");
    const next = a.store.claimRecovery(100)!; assert.ok(next); release.resolve(); await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(a.store.claimRecovery(100), null); assert.equal(a.store.completeRecovery(next.id, next.token), true);
  } finally { release.resolve(); await f.close(); }
});

test("worker retries failures and only acknowledges a successful idempotent handler", async () => {
  const f = await fixture();
  try {
    const a = f.open(true); a.store.enqueueRecovery(task());
    const failed = await processOperationalRecovery(a.store, async () => { throw new Error("private provider body"); }, { leaseMs: 1000, retryDelayMs: 10, signal: live() });
    assert.equal(failed.state, "retry-pending"); assert.equal(JSON.stringify(failed).includes("private"), false);
    assert.equal(a.store.claimRecovery(100), null); f.at(1010);
    const result = await processOperationalRecovery(a.store, async value => { assert.equal(revision(value), revision(task())); }, { leaseMs: 1000, retryDelayMs: 10, signal: live() });
    assert.equal(result.state, "completed"); assert.equal(a.store.claimRecovery(100), null);
  } finally { await f.close(); }
});

test("worker lease deadline bounds a stuck handler and leaves expired work available to another worker", async () => {
  const f = await fixture(), entered = Promise.withResolvers<void>();
  try {
    const a = f.open(true); a.store.enqueueRecovery(task());
    const pending = processOperationalRecovery(a.store, async () => { entered.resolve(); await new Promise(() => {}); },
      { leaseMs: 20, retryDelayMs: 0, signal: live() });
    await entered.promise; f.at(1020);
    const result = await pending; assert.equal(result.reason, "lease-expired"); assert.equal(result.state, "lease-lost");
    assert.ok(a.store.claimRecovery(100));
  } finally { await f.close(); }
});
