import assert from "node:assert/strict";
import { test } from "node:test";
import { createOperationalHandoff, type RecoveryTask, type Reservation } from "../src/operational-handoff.ts";
import { createOperationalRunner, type OperationalAudit, type DispatchRequest } from "../src/operations.ts";
import { syntheticCase } from "./h-fixtures.ts";
import { SessionFailure } from "../src/session.ts";

// All approvals/usage are synthetic; these suppliers do not claim durable storage.
const signal = () => new AbortController().signal;
const request = (attempt = 1): DispatchRequest => ({ runId: "synthetic-run", caseRevision: "a".repeat(64),
  endpoint: "https://synthetic.openai.azure.com", deployment: "synthetic", modelId: "gpt-4.1", attempt, maxOutputTokens: 128 });
const event = (phase: OperationalAudit["phase"], sent: number[] = []): OperationalAudit => ({ phase, runId: "synthetic-run", caseRevision: "a".repeat(64),
  at: new Date().toISOString(), elapsedMs: 1, ...(phase === "finish" ? { outcome: "cancelled" as const } : {}),
  requests: sent.map(attempt => ({ attempt, approvalId: `synthetic-${attempt}`, transportStarted: true, status: null, requestId: null })), usage: null, images: [] });
function fixture() {
  const released: Reservation[] = [], reconciled: { event: OperationalAudit; rows: readonly Reservation[] }[] = [], recovery: RecoveryTask[] = [];
  const suppliers = { reserve: async (r: DispatchRequest) => ({ approvalId: `synthetic-${r.attempt}`, expiresAt: Date.now() + 60000 }),
    appendAudit: async (_e: OperationalAudit) => {}, release: async (r: Reservation) => { released.push(r); },
    reconcile: async (e: OperationalAudit, rows: readonly Reservation[]) => { reconciled.push({ event: e, rows }); },
    enqueueRecovery: (task: RecoveryTask) => { recovery.push(task); return true as const; } };
  return { suppliers, released, reconciled, recovery };
}

test("release reserved but undispatched attempts; reconcile aggregate unknown usage once for all started attempts", async () => {
  const f = fixture(), hooks = createOperationalHandoff(f.suppliers);
  await hooks.record(event("start"));
  for (const attempt of [1, 2, 3]) await hooks.authorizeDispatch(request(attempt), signal());
  await hooks.record(event("finish", [1, 2]));
  assert.deepEqual(f.released.map(r => r.attempt), [3]);
  assert.equal(f.reconciled.length, 1); assert.deepEqual(f.reconciled[0]!.rows.map(r => r.attempt), [1, 2]);
  assert.equal(f.reconciled[0]!.event.usage, null); assert.equal(f.reconciled[0]!.event.requests[0]!.requestId, null);
  await assert.rejects(hooks.authorizeDispatch(request(), signal()));
});

test("a reservation returning after terminal cleanup is queued for recovery and cannot authorize dispatch", async () => {
  const f = fixture(), pending = Promise.withResolvers<{ approvalId: string; expiresAt: number }>();
  const hooks = createOperationalHandoff({ ...f.suppliers, reserve: () => pending.promise });
  await hooks.record(event("start")); const late = hooks.authorizeDispatch(request(), signal());
  await hooks.record(event("finish")); pending.resolve({ approvalId: "synthetic-1", expiresAt: Date.now() + 60000 });
  await assert.rejects(late, /late-reservation/);
  assert.equal(f.recovery[0]?.reason, "late-reservation"); assert.equal(f.recovery[0]?.reservations[0]?.approvalId, "synthetic-1");
});

for (const phase of ["audit", "release", "reconcile", "recovery"] as const) test(`terminal ${phase} failure remains visible and preserves recovery data`, async () => {
  const f = fixture();
  const hooks = createOperationalHandoff({ ...f.suppliers,
    appendAudit: async e => { if ((phase === "audit" || phase === "recovery") && e.phase === "finish") throw new Error("synthetic audit failure"); },
    release: async r => { if (phase === "release") throw new Error("synthetic release failure"); await f.suppliers.release(r); },
    reconcile: async (e, rows) => { if (phase === "reconcile") throw new Error("synthetic reconciliation failure"); await f.suppliers.reconcile(e, rows); },
    enqueueRecovery: task => { if (phase === "recovery") throw new Error("synthetic recovery failure"); return f.suppliers.enqueueRecovery(task); },
  });
  await hooks.record(event("start")); await hooks.authorizeDispatch(request(), signal());
  await assert.rejects(hooks.record(event("finish", phase === "reconcile" ? [1] : [])), phase === "recovery" ? AggregateError : Error);
  if (phase !== "recovery") assert.equal(f.recovery[0]?.reservations.length, 1);
  await assert.rejects(hooks.authorizeDispatch(request(), signal()));
});

test("existing runner releases an approval when dispatch audit fails before the injected transport", async () => {
  const f = fixture(); let sent = 0;
  const hooks = createOperationalHandoff({ ...f.suppliers, appendAudit: async e => { if (e.phase === "dispatch") throw new Error("synthetic sink failure"); } });
  const runner = createOperationalRunner({ enabled: true, timeoutMs: 5000, maxTurns: 1, maxOutputTokens: 128,
    configuration: async () => ({ endpoint: "https://synthetic.openai.azure.com", deployment: "synthetic", modelId: "gpt-4.1", apiKey: "synthetic-key", apiVersion: "v1" }),
    ...hooks, transport: async () => { sent++; return new Response("", { status: 401 }); } });
  await assert.rejects(runner(syntheticCase, signal()), (error: unknown) => error instanceof SessionFailure && error.code === "provider");
  assert.equal(sent, 0); assert.equal(f.released.length, 1); assert.equal(f.reconciled.length, 0);
});

test("existing runner keeps transmitted authentication failures for reconciliation with unknown usage", async () => {
  const f = fixture(), hooks = createOperationalHandoff(f.suppliers); let sent = 0;
  const runner = createOperationalRunner({ enabled: true, timeoutMs: 5000, maxTurns: 1, maxOutputTokens: 128,
    configuration: async () => ({ endpoint: "https://synthetic.openai.azure.com", deployment: "synthetic", modelId: "gpt-4.1", apiKey: "synthetic-key", apiVersion: "v1" }),
    ...hooks, transport: async () => { sent++; return new Response("", { status: 401, headers: { "x-request-id": "synthetic-request" } }); } });
  await assert.rejects(runner(syntheticCase, signal()), (error: unknown) => error instanceof SessionFailure && error.code === "authentication");
  assert.equal(sent, 1); assert.equal(f.released.length, 0); assert.equal(f.reconciled.length, 1);
  assert.equal(f.reconciled[0]!.event.usage, null); assert.equal(f.reconciled[0]!.event.requests[0]!.requestId, "synthetic-request");
});

test("audit cancellation bounds ignored-signal suppliers and blocks late release or reconciliation", async () => {
  const f = fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const hooks = createOperationalHandoff({ ...f.suppliers, appendAudit: async e => { if (e.phase === "finish") { entered.resolve(); await release.promise; } } });
  await hooks.record(event("start")); await hooks.authorizeDispatch(request(), signal());
  const controller = new AbortController(), finished = hooks.record(event("finish"), controller.signal);
  await entered.promise; controller.abort(); await assert.rejects(finished, /interrupted/);
  assert.equal(f.recovery.length, 1); release.resolve(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(f.released.length, 0); assert.equal(f.reconciled.length, 0);
  await assert.rejects(hooks.authorizeDispatch(request(), signal()));
});
