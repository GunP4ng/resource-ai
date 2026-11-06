import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOperationalApp } from "../src/operations.ts";
import type { OperationalRunnerOptions, OperationalAudit } from "../src/operations.ts";
import { createPhotoStore } from "../src/photos.ts";
import { syntheticCase } from "./h-fixtures.ts";
import { revision } from "../src/o-validation.ts";
import type { CaseInput } from "../src/contracts.ts";
import { getEventListeners } from "node:events";

// Synthetic identity/configuration only. Every transport is replaced; no Azure request.
const origin = "http://localhost";
const { caseId: _caseId, ...submission } = syntheticCase;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
class ManualClock {
  time = 0; next = 0;
  timers = new Map<number, { at: number; callback: () => void }>();
  now = () => this.time;
  schedule = (callback: () => void, delay: number) => { const id = ++this.next; this.timers.set(id, { at: this.time + delay, callback }); return () => { this.timers.delete(id); }; };
  advance(ms: number) {
    const end = this.time + ms;
    while (true) {
      const entry = [...this.timers].filter(([, timer]) => timer.at <= end).sort((a,b) => a[1].at - b[1].at)[0];
      if (!entry) break; this.time = Math.max(this.time, entry[1].at); this.timers.delete(entry[0]); entry[1].callback();
    }
    this.time = end;
  }
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "resource-h-deadline-"));
  const store = await createPhotoStore({ root, retentionMs: 1000, maxPhotos: 1, authorize: async () => null });
  let calls = 0;
  const operations: OperationalRunnerOptions = { enabled: true, timeoutMs: 20, maxTurns: 2, maxOutputTokens: 100,
    configuration: async () => null, authorizeDispatch: async () => null, record: async () => {},
    transport: async () => { calls++; throw new Error("unexpected synthetic dispatch"); } };
  return { store, operations, calls: () => calls, close: () => rm(root, { recursive: true, force: true }) };
}
async function cookie(app: ReturnType<typeof createOperationalApp>) {
  return (await app.fetch(new Request(origin))).headers.get("set-cookie")!.split(";")[0]!;
}
function post(token: string, value: unknown = submission, path = "/cases", signal?: AbortSignal) {
  return new Request(origin + path, { method: "POST", signal, headers: { cookie: token, origin, "content-type": "application/json" }, body: JSON.stringify(value) });
}

test("P2 real 150ms authentication plus resources shares the 200ms request deadline", async () => {
  const f = await setup(); let slow = false, resourceAborted = false;
  const app = createOperationalApp({ origin, timeoutMs: 200, operations: f.operations, photoStore: f.store,
    actorForRequest: async () => { if (slow) await new Promise((resolve) => setTimeout(resolve, 150)); return "synthetic-owner"; },
    resources: async (_input, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => { resourceAborted = true; reject(new Error("resource stopped")); }, { once: true });
    }) });
  try {
    const token = await cookie(app); slow = true; const start = performance.now();
    const response = await app.fetch(post(token)); const elapsed = performance.now() - start;
    console.log(`P2_WALL_MS=${elapsed.toFixed(2)} LIMIT=275`);
    assert.equal(response.status, 504); assert.equal(resourceAborted, true); assert.equal(f.calls(), 0);
    assert.ok(elapsed < 275, `200ms request exceeded the review's 275ms tolerance: ${elapsed.toFixed(2)}ms`);
  } finally { app.dispose(); await f.close(); }
});

test("authentication refusal, service failure, cancellation and deadline are distinct", async () => {
  const f = await setup(), clock = new ManualClock(); let lookups = 0, resources = 0;
  for (const kind of ["refused", "failed", "cancelled", "timeout", "pre-cancelled"] as const) {
    const controller = new AbortController(), auth = deferred<string>(); let authSignal: AbortSignal | undefined;
    const app = createOperationalApp({ origin, clock, timeoutMs: 200, operations: f.operations, photoStore: f.store,
      actorForRequest: async (_request, signal) => { lookups++; authSignal = signal;
        if (kind === "refused") return null; if (kind === "failed") throw new Error("PRIVATE auth error"); return auth.promise; },
      resources: async () => { resources++; return {}; } });
    try {
      const before = lookups;
      if (kind === "pre-cancelled") controller.abort();
      const pending = app.fetch(new Request(origin, { signal: controller.signal }));
      if (kind === "cancelled") controller.abort(); if (kind === "timeout") clock.advance(200);
      const response = await pending;
      assert.equal(response.status, kind === "refused" ? 403 : kind === "failed" ? 503 : kind === "timeout" ? 504 : 408);
      assert.equal((await response.text()).includes("PRIVATE"), false);
      if (kind === "pre-cancelled") assert.equal(lookups, before); else assert.equal(authSignal?.aborted, true);
      auth.resolve("synthetic-owner"); await tick(); assert.equal(resources, 0); assert.equal(f.calls(), 0); assert.equal(clock.timers.size, 0);
    } finally { app.dispose(); }
  }
  await f.close();
});

test("stalled JSON and form bodies consume only the post-authentication remainder", async () => {
  const f = await setup();
  try { for (const contentType of ["application/json", "application/x-www-form-urlencoded"]) {
    const clock = new ManualClock(), auth = deferred<string>(); let slow = false, resources = 0, bodyCancelled = false;
    const app = createOperationalApp({ origin, clock, timeoutMs: 200, operations: f.operations, photoStore: f.store,
      actorForRequest: async () => slow ? auth.promise : "synthetic-owner", resources: async () => { resources++; return {}; } });
    try {
      const token = await cookie(app); slow = true;
      const reading = deferred<void>();
      const body = new ReadableStream<Uint8Array>({ pull() { reading.resolve(); }, cancel() { bodyCancelled = true; } }, { highWaterMark: 0 });
      const request = new Request(origin + "/cases", { method: "POST", headers: { cookie: token, origin, "content-type": contentType }, body, duplex: "half" } as RequestInit & { duplex: "half" });
      const pending = app.fetch(request); clock.advance(150); auth.resolve("synthetic-owner"); await reading.promise; await tick();
      clock.advance(50); assert.equal((await pending).status, 504); await tick();
      assert.equal(bodyCancelled, true); assert.equal(resources, 0); assert.equal(f.calls(), 0); assert.equal(clock.timers.size, 0);
    } finally { app.dispose(); }
  } } finally { await f.close(); }
});

test("failed updates preserve the report and case revision even when resources ignore abort and finish late", async () => {
  const clock = new ManualClock(); let delayed = false, current: CaseInput | undefined;
  let resource = deferred<{}>(), entered = deferred<AbortSignal>();
  const app = createOperationalApp({ origin, clock, timeoutMs: 200, resources: async (input, signal) => {
    current = input; if (!delayed) return {}; entered.resolve(signal); return resource.promise;
  } });
  try {
    const token = await cookie(app), first = await app.fetch(post(token)); assert.equal(first.status, 303);
    const path = first.headers.get("location")!, committed = revision(current);
    const report = () => app.fetch(new Request(origin + path, { headers: { cookie: token } }));
    const before = await (await report()).text();
    for (const kind of ["timeout", "cancelled"] as const) {
      resource = deferred<{}>(); entered = deferred<AbortSignal>(); delayed = true; const controller = new AbortController();
      const pending = app.fetch(post(token, { massKg: 999 }, path + "/answers", controller.signal)); const signal = await entered.promise;
      if (kind === "timeout") clock.advance(200); else controller.abort();
      assert.equal((await pending).status, kind === "timeout" ? 504 : 408); assert.equal(signal.aborted, true);
      resource.resolve({}); await tick(); assert.equal(await (await report()).text(), before);
      delayed = false;
      assert.equal((await app.fetch(post(token, { process: syntheticCase.process }, path + "/answers"))).status, 303);
      assert.equal(revision(current), committed); assert.equal(clock.timers.size, 0);
    }
    const other = await cookie(app);
    assert.equal((await app.fetch(new Request(origin + path, { headers: { cookie: other } }))).status, 404);
  } finally { app.dispose(); }
});

test("started runner inherits the outer reason, aborts transport and finishes audit inside the original budget", async () => {
  const f = await setup();
  try { for (const kind of ["timeout", "cancelled"] as const) {
    const clock = new ManualClock(), started = deferred<AbortSignal>(), controller = new AbortController(), records: OperationalAudit[] = [];
    let requests = 0, transportAborted = false;
    // Give real SDK initialization room; advance the injected clock only after transport starts.
    const app = createOperationalApp({ origin, clock, timeoutMs: 5000, operations: { ...f.operations, timeoutMs: 10_000,
      configuration: async () => ({ endpoint: "https://synthetic.openai.azure.com", deployment: "synthetic", modelId: "gpt-4.1", apiVersion: "v1", apiKey: "synthetic" }),
      authorizeDispatch: async () => ({ approvalId: "synthetic-approval", expiresAt: Date.now() + 60_000 }),
      record: async (event) => { records.push(structuredClone(event)); },
      transport: async (_url, init) => {
        requests++; const signal = init!.signal!;
        const stream = new ReadableStream<Uint8Array>({ start(target) {
          signal.addEventListener("abort", () => { transportAborted = true; target.error(new Error("synthetic transport aborted")); }, { once: true });
        } });
        started.resolve(signal);
        return new Response(stream, { headers: { "content-type": "text/event-stream", "x-request-id": "synthetic-inflight" } });
      } } });
    try {
      const token = await cookie(app); const pending = app.fetch(post(token, submission, "/cases", controller.signal));
      await Promise.race([started.promise, pending.then((response) => { throw new Error(`HTTP ${response.status} before transport started`); })]); await tick();
      if (kind === "timeout") clock.advance(5000); else controller.abort();
      assert.equal((await pending).status, kind === "timeout" ? 504 : 408); await tick();
      assert.equal(transportAborted, true); assert.equal(requests, 1);
      const terminal = records.filter((r) => r.phase === "finish"); assert.equal(terminal.length, 1);
      assert.equal(terminal[0]?.outcome, kind); assert.equal(terminal[0]?.usage, null);
      assert.equal(terminal[0]?.requests[0]?.requestId, "synthetic-inflight");
      assert.equal(terminal[0]?.requests[0]?.transportStarted, true);
      clock.advance(1000); await tick(); assert.equal(requests, 1); assert.equal(clock.timers.size, 0);
    } finally { app.dispose(); }
  } } finally { await f.close(); }
});

test("late authorization cannot start transport; a stalled terminal audit has only the original remainder", async () => {
  const f = await setup(), clock = new ManualClock(), permit = deferred<{ approvalId: string; expiresAt: number }>(), entered = deferred<void>();
  const records: OperationalAudit[] = []; let auditSignal: AbortSignal | undefined;
  const app = createOperationalApp({ origin, clock, timeoutMs: 5000, operations: { ...f.operations, timeoutMs: 10_000,
    configuration: async () => ({ endpoint: "https://synthetic.openai.azure.com", deployment: "synthetic", modelId: "gpt-4.1", apiVersion: "v1", apiKey: "synthetic" }),
    authorizeDispatch: async () => { entered.resolve(); return permit.promise; },
    record: async (event, signal) => { records.push(structuredClone(event)); if (event.phase === "finish") { auditSignal = signal; await new Promise(() => {}); } },
  } });
  try {
    const token = await cookie(app); let completed = false;
    const request = post(token), listeners = getEventListeners(request.signal, "abort").length;
    const pending = app.fetch(request).then((response) => { completed = true; return response; });
    await Promise.race([entered.promise, pending.then((response) => { throw new Error(`HTTP ${response.status} before authorization started`); })]);
    clock.advance(4500); await tick(); assert.equal(records.at(-1)?.phase, "finish"); assert.equal(completed, false);
    clock.advance(499); await tick(); assert.equal(completed, false); assert.equal(auditSignal?.aborted, false);
    clock.advance(1); assert.equal((await pending).status, 504); await tick(); assert.equal(auditSignal?.aborted, true);
    assert.equal(records.at(-1)?.outcome, "timeout"); assert.equal(records.at(-1)?.usage, null);
    assert.deepEqual(records.at(-1)?.requests, []); assert.equal(f.calls(), 0);
    permit.resolve({ approvalId: "too-late", expiresAt: Date.now() + 60000 }); await tick();
    assert.equal(f.calls(), 0); assert.equal(clock.timers.size, 0);
    assert.equal(getEventListeners(request.signal, "abort").length, listeners);
  } finally { app.dispose(); await f.close(); }
});

test("transport ignoring abort cannot hold HTTP open or invent request ID and usage", async () => {
  const f = await setup(), clock = new ManualClock(), entered = deferred<AbortSignal>(), response = deferred<Response>();
  const records: OperationalAudit[] = []; let calls = 0;
  const app = createOperationalApp({ origin, clock, timeoutMs: 5000, operations: { ...f.operations, timeoutMs: 10_000,
    configuration: async () => ({ endpoint: "https://synthetic.openai.azure.com", deployment: "synthetic", modelId: "gpt-4.1", apiVersion: "v1", apiKey: "synthetic" }),
    authorizeDispatch: async () => ({ approvalId: "synthetic-approval", expiresAt: Date.now() + 60_000 }),
    record: async (event) => { records.push(structuredClone(event)); },
    transport: async (_url, init) => { calls++; entered.resolve(init!.signal!); return response.promise; },
  } });
  try {
    const token = await cookie(app), pending = app.fetch(post(token));
    const signal = await Promise.race([entered.promise, pending.then((result) => { throw new Error(`HTTP ${result.status} before transport started`); })]);
    clock.advance(4500); assert.equal((await pending).status, 504); assert.equal(signal.aborted, true);
    const terminal = records.at(-1)!; assert.equal(terminal.phase, "finish"); assert.equal(terminal.outcome, "timeout");
    assert.equal(terminal.usage, null); assert.equal(terminal.requests[0]?.transportStarted, true);
    assert.equal(terminal.requests[0]?.status, null); assert.equal(terminal.requests[0]?.requestId, null);
    response.resolve(new Response("", { status: 401, headers: { "x-request-id": "late-unconfirmed" } })); await tick();
    assert.equal(calls, 1); assert.equal(records.filter((event) => event.phase === "finish").length, 1);
    assert.equal(terminal.requests[0]?.requestId, null); assert.equal(clock.timers.size, 0);
  } finally { app.dispose(); await f.close(); }
});

test("monotonic commit guard prevents a late revision even if the event-loop timer has not fired", async () => {
  const clock = new ManualClock(); let expire = false, current: CaseInput | undefined;
  const app = createOperationalApp({ origin, clock, timeoutMs: 200, resources: async (input) => {
    current = input;
    return expire ? { get assessmentOptions() { clock.time += 201; return undefined; } } : {};
  } });
  try {
    const token = await cookie(app), first = await app.fetch(post(token)); const path = first.headers.get("location")!;
    const committed = revision(current), get = () => app.fetch(new Request(origin + path, { headers: { cookie: token } }));
    const before = await (await get()).text(); expire = true;
    assert.equal((await app.fetch(post(token, { massKg: 999 }, path + "/answers"))).status, 504);
    expire = false; assert.equal(await (await get()).text(), before);
    assert.equal((await app.fetch(post(token, { process: syntheticCase.process }, path + "/answers"))).status, 303);
    assert.equal(revision(current), committed); assert.equal(clock.timers.size, 0);
  } finally { app.dispose(); }
});

test("dispose cancels active authentication and releases the request timer/listener", async () => {
  const f = await setup(), clock = new ManualClock(), auth = deferred<string>();
  const app = createOperationalApp({ origin, clock, timeoutMs: 200, photoStore: f.store, operations: f.operations, actorForRequest: async () => auth.promise });
  try {
    const request = new Request(origin), listeners = getEventListeners(request.signal, "abort").length;
    const pending = app.fetch(request); app.dispose(); assert.equal((await pending).status, 408);
    auth.resolve("late"); await tick(); assert.equal(clock.timers.size, 0);
    assert.equal(getEventListeners(request.signal, "abort").length, listeners); assert.equal(f.calls(), 0);
  } finally { app.dispose(); await f.close(); }
});

test("P2 deterministic auth consumes 150 of 200ms, with no new resource budget", async () => {
  const f = await setup(), clock = new ManualClock(), auth = deferred<string>(), entered = deferred<AbortSignal>(); let slow = false;
  const options = { origin, timeoutMs: 200, clock, operations: f.operations, photoStore: f.store,
    actorForRequest: async () => slow ? auth.promise : "synthetic-owner",
    resources: async (_input: unknown, signal: AbortSignal) => { entered.resolve(signal); return new Promise<{}>(() => {}); } };
  const app = createOperationalApp(options);
  try {
    const token = await cookie(app); slow = true; let completed = false;
    const pending = app.fetch(post(token)).then((response) => { completed = true; return response; });
    clock.advance(150); auth.resolve("synthetic-owner"); const signal = await entered.promise;
    clock.advance(49); await tick(); assert.equal(completed, false); assert.equal(signal.aborted, false);
    clock.advance(1); await tick(); assert.equal(completed, true, "global deadline must finish HTTP at t=200");
    assert.equal((await pending).status, 504); assert.equal(signal.aborted, true); assert.equal(f.calls(), 0);
    assert.equal(clock.timers.size, 0);
  } finally { app.dispose(); await f.close(); }
});
