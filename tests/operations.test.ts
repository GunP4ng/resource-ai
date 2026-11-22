import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { createOperationalRunner, createOperationalApp } from "../src/operations.ts";
import type { OperationalAudit, OperationalRunnerOptions } from "../src/operations.ts";
import { openCaseSession, SessionFailure } from "../src/session.ts";
import { decideCase } from "../src/assessment.ts";
import { syntheticCase } from "./h-fixtures.ts";
import { createPhotoStore } from "../src/photos.ts";
import { revision } from "../src/o-validation.ts";
import { createHash } from "node:crypto";
import { prepareCaseRecord, createBundledSnapshotReader } from "../src/case-record.ts";
import type { CaseInput } from "../src/contracts.ts";
import { createCaseStore } from "../src/o-case-store.ts";
import { createPhotoExecutionAuthority } from "../src/photo-execution.ts";

// All credentials, approval records and provider responses are synthetic. No network.
const input = { ...syntheticCase, description: "PRIVATE description" };
const config = { endpoint: "https://synthetic.openai.azure.com", deployment: "synthetic-deployment",
  modelId: "gpt-4.1", apiKey: "PRIVATE secret", apiVersion: "v1" };
const live = () => new AbortController().signal;
const failure = (code: string) => (error: unknown) => error instanceof SessionFailure && error.code === code;
function fixture() {
  const photoExecution = createPhotoExecutionAuthority();
  photoExecution.publish(config, [{ target: config, scope: { provider: "synthetic provider", purpose: "synthetic purpose" } }]);
  const records: OperationalAudit[] = []; let calls = 0, authorizations = 0;
  const options: OperationalRunnerOptions = { enabled: true, timeoutMs: 10_000, maxTurns: 2, maxOutputTokens: 100,
    photoExecution,
    configuration: async () => config,
    authorizeDispatch: async (request) => { authorizations++; assert.equal(request.maxOutputTokens, 100); return { approvalId: "synthetic-approval", expiresAt: Date.now() + 5000 }; },
    record: async (event) => { records.push(structuredClone(event)); },
    transport: async (_url, init) => { calls++; assert.equal(init?.redirect, "error"); return new Response("PRIVATE provider body", { status: 401, headers: { "x-request-id": "synthetic-request" } }); } };
  return { options, photoExecution, ticket: photoExecution.current()!, records, calls: () => calls, authorizations: () => authorizations };
}
const syntheticOpen: typeof openCaseSession = async (facts, options) => {
  const owned = await openCaseSession(facts, options);
  owned.session.agent.streamFunction = (model, _context, settings) => {
    const stream = createAssistantMessageEventStream();
    void (async () => {
      const message: AssistantMessage = { role: "assistant", api: "azure-openai-responses", provider: "azure-openai-responses",
        model: "gpt-4.1", timestamp: Date.now(), content: [{ type: "text", text: JSON.stringify(decideCase(facts)) }], stopReason: "stop",
        usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      try {
        const content = _context.messages.flatMap((message) => Array.isArray(message.content) ? message.content.flatMap((part) =>
          part.type === "image" ? [{ type: "input_image", image_url: `data:${part.mimeType};base64,${part.data}` }] : []) : []);
        const response = await settings!.fetch!("https://synthetic.openai.azure.com/openai/v1/responses?api-version=v1", { method: "POST", body: JSON.stringify({ model: config.deployment, input: [{ content }] }) });
        await settings?.onResponse?.({ status: response.status, headers: { "x-request-id": "synthetic-request" } }, model);
        stream.push({ type: "done", reason: "stop", message });
      } catch {
        stream.push({ type: "error", reason: "error", error: { ...message, content: [], stopReason: "error", errorMessage: "PRIVATE diagnostic" } });
      }
    })();
    return stream;
  };
  return owned;
};

test("operational gate refuses disabled, absent credentials and absent/expired approvals with zero dispatch", async () => {
  for (const override of [
    { enabled: false }, { configuration: async () => null },
    { configuration: async () => ({ ...config, apiKey: "" }) },
    { configuration: async () => ({ ...config, endpoint: "https://example.invalid" }) },
    { authorizeDispatch: async () => null },
    { authorizeDispatch: async () => ({ approvalId: "synthetic", expiresAt: 1 }) },
  ]) {
    const f = fixture();
    await assert.rejects(createOperationalRunner({ ...f.options, ...override })(input, live()), failure("not-configured"));
    assert.equal(f.calls(), 0); assert.equal(f.records.at(-1)?.outcome, "not-configured");
  }
});

test("real SDK rejection records status/request ID without case text, key or provider body", async () => {
  const f = fixture();
  await assert.rejects(createOperationalRunner(f.options)(input, live()), failure("authentication"));
  assert.equal(f.calls(), 1); assert.equal(f.authorizations(), 1);
  assert.deepEqual(f.records.map((r) => r.phase), ["start", "dispatch", "finish"]);
  const end = f.records.at(-1)!;
  assert.equal(end.requests[0]?.status, 401); assert.equal(end.requests[0]?.requestId, "synthetic-request"); assert.equal(end.usage, null);
  assert.equal(JSON.stringify(f.records).includes("PRIVATE"), false);
  assert.equal(JSON.stringify(f.records).includes(config.endpoint), false);
});

test("successful synthetic SDK execution records exact token usage", async () => {
  const f = fixture(); const runner = createOperationalRunner({ ...f.options, transport: async () => new Response("", { headers: { "apim-request-id": "synthetic-ok" } }) }, syntheticOpen);
  const result = await runner(input, live());
  assert.deepEqual(result.proposal, decideCase(input));
  assert.equal(f.records.at(-1)?.outcome, "success"); assert.equal(f.records.at(-1)?.requests[0]?.requestId, "synthetic-ok");
  assert.deepEqual(f.records.at(-1)?.usage, { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, total: 30 });
});

test("rate limiting and invalid request IDs are safely recorded", async () => {
  const f = fixture();
  await assert.rejects(createOperationalRunner({ ...f.options, transport: async () => new Response("", { status: 429, headers: { "x-request-id": "PRIVATE /invalid" } }) })(input, live()), failure("rate-limit"));
  assert.equal(f.records.at(-1)?.requests[0]?.status, 429); assert.equal(f.records.at(-1)?.requests[0]?.requestId, null);
});

test("deadline and caller cancellation terminate pending configuration, without later dispatch", async () => {
  for (const code of ["timeout", "cancelled"] as const) {
    const f = fixture(), controller = new AbortController();
    let now = 0;
    const timers = new Map<() => void, number>();
    const clock = { now: () => now, schedule(callback: () => void, delay: number) {
      timers.set(callback, now + delay); return () => { timers.delete(callback); };
    } };
    const entered = Promise.withResolvers<void>();
    let resume: (value: typeof config) => void = () => {};
    const runner = createOperationalRunner({ ...f.options, clock, timeoutMs: code === "timeout" ? 20 : 1000,
      configuration: async () => new Promise((resolve) => { resume = resolve; entered.resolve(); }) });
    const result = runner(input, controller.signal);
    await entered.promise;
    if (code === "cancelled") controller.abort();
    else {
      // Keep the original 20ms budget: work expires at 18ms with 2ms reserved
      // for audit. OS scheduling cannot accidentally spend that reserve here.
      now = 18;
      for (const [callback, at] of timers) if (at <= now) { timers.delete(callback); callback(); }
    }
    await assert.rejects(result, failure(code)); resume(config);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(f.calls(), 0); assert.equal(f.records.at(-1)?.outcome, code); assert.equal(f.records.at(-1)?.usage, null);
    assert.equal(timers.size, 0);
  }
});

test("terminal audit completion before or at the absolute deadline distinguishes timeout from audit failure", async () => {
  for (const scenario of ["before-end", "completes-at-end", "ignores-abort"] as const) {
    const f = fixture(), configured = Promise.withResolvers<void>(), auditing = Promise.withResolvers<AbortSignal>();
    const finish = Promise.withResolvers<void>(), timers = new Map<() => void, number>();
    let now = 0, resume: (value: typeof config) => void = () => {};
    const clock = { now: () => now, schedule(callback: () => void, delay: number) {
      timers.set(callback, now + delay); return () => { timers.delete(callback); };
    } };
    const tick = (at: number) => {
      now = at;
      for (const [callback, due] of timers) if (due <= now) { timers.delete(callback); callback(); }
    };
    const runner = createOperationalRunner({ ...f.options, clock, timeoutMs: 20,
      configuration: async () => new Promise((resolve) => { resume = resolve; configured.resolve(); }),
      record: async (event, signal) => {
        await f.options.record(event, signal);
        if (event.phase === "finish") { assert.ok(signal); auditing.resolve(signal); await finish.promise; }
      } });
    const rejected = assert.rejects(runner(input, live()), failure(scenario === "before-end" ? "timeout" : "provider"), scenario);
    await configured.promise;
    tick(18); // Same 20ms request: 18ms work, 2ms terminal audit reserve.
    const auditSignal = await auditing.promise;
    assert.deepEqual([...timers.values()], [20]);
    if (scenario === "ignores-abort") tick(20);
    else {
      // A callback completing at the deadline cannot win even if its timer has not run.
      now = scenario === "before-end" ? 19 : 20;
      finish.resolve();
    }
    await rejected;
    assert.equal(auditSignal.aborted, true);
    assert.equal(timers.size, 0);
    assert.equal(f.records.at(-1)?.outcome, "timeout");
    assert.equal(f.records.at(-1)?.usage, null);
    assert.deepEqual(f.records.at(-1)?.requests, []);
    assert.equal(f.calls(), 0); assert.equal(f.authorizations(), 0);
    finish.resolve(); resume(config); // Late callbacks must not authorize or send a request.
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(f.calls(), 0); assert.equal(f.authorizations(), 0);
    assert.equal(timers.size, 0);
  }
});

test("timeout aborts an in-flight HTTP transport and leaves unknown usage explicit", async () => {
  const f = fixture(); let dispatched = false, aborted = false;
  const runner = createOperationalRunner({ ...f.options, timeoutMs: 500,
    transport: async (_url, init) => new Promise((_resolve, reject) => {
      dispatched = true;
      init?.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("PRIVATE transport error")); }, { once: true });
    }) });
  await assert.rejects(runner(input, live()), failure("timeout"));
  assert.equal(dispatched, true); assert.equal(aborted, true); assert.equal(f.records.at(-1)?.outcome, "timeout");
  assert.equal(f.records.at(-1)?.usage, null);
});

test("failed durable start/dispatch writes prevent HTTP requests", async () => {
  for (const phase of ["start", "dispatch"]) {
    const f = fixture();
    await assert.rejects(createOperationalRunner({ ...f.options, record: async (event) => { if (event.phase === phase) throw new Error("private sink error"); } })(input, live()), failure("provider"));
    assert.equal(f.calls(), 0);
  }
});

test("real photo store hands sanitized pixels to the SDK and blocks revocation just before dispatch", async () => {
  const f = fixture();
  const root = await mkdtemp(join(tmpdir(), "resource-h-dispatch-"));
  const photon = createRequire(import.meta.resolve("@code-yeongyu/senpi"))("@silvia-odwyer/photon-node") as typeof import("@silvia-odwyer/photon-node");
  const generated = new photon.PhotonImage(new Uint8Array([255,0,0,255]), 1, 1);
  let current = input;
  try {
    const store = await createPhotoStore({ root, photoExecution: f.photoExecution, retentionMs: 60_000, maxPhotos: 3,
      authorize: async () => ({ ownerId: "owner", caseRevision: revision(current), read: true, sendToModel: true }) });
    const receipt = await store.put("owner", input.caseId, generated.get_bytes_jpeg(90), "image/jpeg",
      { recordId: "synthetic-consent", store: true, model: true, modelScope: f.ticket.scope, modelBindingId: f.ticket.bindingId, visibleContentReviewed: true, expiresAt: Date.now() + 60_000 }, live());
    current = { ...input, photoRefs: [receipt.photoRef] };
    const expected = await store.resolver("owner", f.ticket)({ caseId: current.caseId, caseRevision: revision(current), photoRef: receipt.photoRef }, live());
    let calls = 0;
    const photos = { resolve: store.resolver("owner", f.ticket), assertCanTransmit: (value: typeof input, signal: AbortSignal) => store.assertCanTransmit("owner", value, signal, undefined, f.ticket) };
    const runner = createOperationalRunner({ ...f.options, photos, transport: async (_url, init) => {
      const url = new URL(String(_url));
      assert.equal(url.pathname, "/openai/v1/responses"); assert.equal(url.search, "?api-version=v1");
      assert.equal(JSON.parse(String(init?.body)).model, config.deployment);
      calls++; const body = String(init?.body);
      assert.ok(body.includes(`data:image/png;base64,${Buffer.from(expected!.data).toString("base64")}`));
      assert.equal(body.includes("data:image/jpeg"), false);
      return new Response("", { status: 401 });
    } });
    await assert.rejects(runner(current, live()), failure("authentication")); assert.equal(calls, 1);
    assert.deepEqual(f.records.at(-1)?.images, [{ photoRefSha256: createHash("sha256").update(receipt.photoRef).digest("hex"), sha256: receipt.sha256, mimeType: "image/png" }]);
    const substituted = createOperationalRunner({ ...f.options, photos }, async (value, settings) => {
      const owned = await syntheticOpen(value, settings), original = owned.session.agent.streamFunction;
      owned.session.agent.streamFunction = (model, context, config) => original(model, context, { ...config,
        fetch: (url, init) => config!.fetch!(url, { ...init, body: JSON.stringify({ model: "synthetic-deployment", input: [] }) }) });
      return owned;
    });
    await assert.rejects(substituted(current, live()), failure("provider")); assert.equal(f.calls(), 0);
    // Change both bytes and stored hash after resolution, before dispatch authorization.
    const file = join(root, `${receipt.photoRef}.json`), old = await readFile(file, "utf8");
    const changed = new photon.PhotonImage(new Uint8Array([0,255,0,255]), 1, 1);
    const replacement = changed.get_bytes(); changed.free();
    const swapped = createOperationalRunner({ ...f.options, photos, record: async (event) => {
      if (event.phase === "dispatch") await writeFile(file, JSON.stringify({ ...JSON.parse(old), png: Buffer.from(replacement).toString("base64"), sha256: createHash("sha256").update(replacement).digest("hex") }));
    } });
    await assert.rejects(swapped(current, live()), failure("provider")); assert.equal(f.calls(), 0);
    await writeFile(file, old);
    const revoked = createOperationalRunner({ ...f.options, photos, record: async (event) => {
      if (event.phase === "dispatch") await store.revoke("owner", receipt.photoRef, live());
    } });
    await assert.rejects(revoked(current, live()), failure("provider")); assert.equal(f.calls(), 0);
  } finally { generated.free(); await rm(root, { recursive: true, force: true }); }
});

test("a stalled terminal audit sink cannot defeat the operation deadline", async () => {
  const f = fixture();
  const runner = createOperationalRunner({ ...f.options, enabled: false, timeoutMs: 20,
    record: async (event) => { if (event.phase === "finish") await new Promise(() => {}); } });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const bounded = Promise.race([runner(input, live()), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("audit-hung")), 300); })]);
    await assert.rejects(bounded, failure("provider")); assert.equal(f.calls(), 0);
  } finally { clearTimeout(timer); }
});

function scopedRunFixture() {
  const f = fixture(), facts = { ...input, photoRefs: ["synthetic-photo"] };
  const photon = createRequire(import.meta.resolve("@code-yeongyu/senpi"))("@silvia-odwyer/photon-node") as typeof import("@silvia-odwyer/photon-node");
  const image = new photon.PhotonImage(new Uint8Array([255, 0, 0, 255]), 1, 1);
  const data = Buffer.from(image.get_bytes()); image.free();
  const sha256 = createHash("sha256").update(data).digest("hex");
  const photos: NonNullable<OperationalRunnerOptions["photos"]> = {
    resolve: async (request, _signal, ticket) => {
      assert.equal(ticket, f.ticket); f.photoExecution.assertCurrent(ticket!);
      return { ...request, approvedForModel: true, data, mimeType: "image/png", sha256 };
    },
    assertCanTransmit: async (_facts, _signal, _expected, ticket) => { assert.equal(ticket, f.ticket); f.photoExecution.assertCurrent(ticket!); },
  };
  const change = () => f.photoExecution.publish({ ...config, deployment: "synthetic-b" }, [{ target: { ...config, deployment: "synthetic-b" }, scope: f.ticket.scope }]);
  const options = { ...f.options, photos, configuration: async () => { throw new Error("independent configuration must never run for photos"); } };
  return { ...f, facts, photos, options, change };
}

test("issued scope reaches guarded dispatch using only authority configuration; actual installed SDK serialization succeeds", async () => {
  const f = scopedRunFixture(); let calls = 0;
  const result = await createOperationalRunner({ ...f.options, transport: async (request, init) => {
    calls++;
    const url = new URL(String(request)), body = JSON.parse(String(init?.body));
    assert.equal(url.href, "https://synthetic.openai.azure.com/openai/v1/responses?api-version=v1");
    assert.equal(body.model, config.deployment);
    assert.ok(JSON.stringify(body.input).includes("data:image/png;base64,"));
    const text = JSON.stringify(decideCase(f.facts));
    const item = { id: "synthetic-message", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] };
    const events = [
      { type: "response.created", response: { id: "synthetic-response" } },
      { type: "response.output_item.added", output_index: 0, item: { ...item, content: [] } },
      { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: text },
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response: { id: "synthetic-response", status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } } },
    ];
    return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream", "x-request-id": "synthetic-sdk" } });
  } })(f.facts, live());
  assert.equal(calls, 1); assert.deepEqual(result.proposal, decideCase(f.facts));
});

test("authority changes during authorization, audit or final async photo checks prevent transport", async () => {
  for (const phase of ["authorization", "audit", "photo", "aba"] as const) {
    const f = scopedRunFixture();
    const runner = createOperationalRunner({ ...f.options,
      authorizeDispatch: async (...args) => {
        const permit = await f.options.authorizeDispatch(...args);
        if (phase === "authorization" || phase === "aba") {
          f.change();
          if (phase === "aba") f.photoExecution.publish(config, [{ target: config, scope: f.ticket.scope }]);
        }
        return permit;
      },
      record: async (...args) => { await f.options.record(...args); if (phase === "audit" && args[0].phase === "dispatch") f.change(); },
      photos: { ...f.photos, assertCanTransmit: async (...args) => {
        await f.photos.assertCanTransmit(...args); if (phase === "photo") f.change();
      } },
    }, syntheticOpen);
    await assert.rejects(runner(f.facts, live()), failure("provider"));
    assert.equal(f.calls(), 0);
    assert.equal(f.authorizations(), 1);
    assert.equal(f.records.at(-1)?.requests.some(request => request.transportStarted), false);
  }
});

test("an authority configuration cannot redirect a photo ticket to a different Azure deployment", async () => {
  const f = scopedRunFixture(), changed = { ...config, deployment: "synthetic-other" };
  const open: typeof openCaseSession = async (facts, settings) => {
    const owned = await syntheticOpen(facts, settings), stream = owned.session.agent.streamFunction;
    owned.session.agent.streamFunction = (model, context, settings) => stream(model, context, { ...settings, fetch: (url, init) => {
      const body = JSON.parse(String(init?.body)); body.model = changed.deployment;
      return settings!.fetch!(url, { ...init, body: JSON.stringify(body) });
    } });
    return owned;
  };
  const runner = createOperationalRunner({ ...f.options,
    photoExecution: { ...f.photoExecution, configuration: () => changed } }, open);
  await assert.rejects(runner(f.facts, live()), failure("not-configured"));
  assert.equal(f.authorizations(), 0); assert.equal(f.calls(), 0);
});

test("no or ambiguous scope mapping refuses photo runs before resolution/configuration/dispatch", async () => {
  for (const ambiguous of [false, true]) {
    const f = scopedRunFixture(), row = { target: config, scope: f.ticket.scope };
    f.photoExecution.publish(config, ambiguous ? [row, row] : []);
    let resolved = false;
    const runner = createOperationalRunner({ ...f.options, photos: { ...f.photos, resolve: async () => { resolved = true; return null; } } }, syntheticOpen);
    await assert.rejects(runner(f.facts, live()), failure("not-configured"));
    assert.equal(resolved, false); assert.equal(f.authorizations(), 0); assert.equal(f.calls(), 0);
  }
});

test("forged/different-authority tickets and same-origin wrong deployment/path/version fail before outbound calls", async () => {
  for (const mismatch of ["forged", "authority", "deployment", "path", "version"] as const) {
    const f = scopedRunFixture();
    const other = fixture();
    const open: typeof openCaseSession = async (facts, settings) => {
      const owned = await syntheticOpen(facts, settings), original = owned.session.agent.streamFunction;
      owned.session.agent.streamFunction = (model, context, config) => original(model, context, { ...config, fetch: (url, init) => {
        const actual = new URL(String(url));
        if (mismatch === "path") actual.pathname = "/openai/v1/deployments/wrong/responses";
        if (mismatch === "version") actual.searchParams.set("api-version", "wrong");
        const body = JSON.parse(String(init?.body)); if (mismatch === "deployment") body.model = "wrong";
        return config!.fetch!(actual.href, { ...init, body: JSON.stringify(body) });
      } });
      return owned;
    };
    const runner = createOperationalRunner({ ...f.options, photoTicket: () => mismatch === "forged" ? { ...f.ticket } : mismatch === "authority" ? other.ticket : f.ticket }, open);
    await assert.rejects(runner(f.facts, live())); assert.equal(f.calls(), 0);
  }
});

test("change after one dispatched request prevents the next dispatch and stale successful result", async () => {
  for (const phase of ["next-dispatch", "finish"] as const) {
    const f = scopedRunFixture(); let calls = 0;
    const open: typeof openCaseSession = async (facts, settings) => {
      const owned = await syntheticOpen(facts, settings), original = owned.session.agent.streamFunction;
      owned.session.agent.streamFunction = (model, context, config) => original(model, context, { ...config, fetch: async (...args) => {
        const response = await config!.fetch!(...args);
        return phase === "next-dispatch" ? config!.fetch!(...args) : response;
      } });
      return owned;
    };
    const runner = createOperationalRunner({ ...f.options,
      transport: async () => { calls++; if (phase === "next-dispatch") f.change(); return new Response(""); },
      record: async (...args) => { await f.options.record(...args); if (phase === "finish" && args[0].phase === "finish") f.change(); },
    }, open);
    await assert.rejects(runner(f.facts, live()), failure("provider"));
    assert.equal(calls, 1); assert.equal(f.records.at(-1)?.requests.filter(request => request.transportStarted).length, 1);
  }
});

const origin = "http://localhost";
const { caseId: _syntheticClientId, ...submission } = input; // App IDs are generated by the host.
async function browser(app: ReturnType<typeof createOperationalApp>) {
  const home = await app.fetch(new Request(origin));
  const cookie = home.headers.get("set-cookie")!.split(";")[0]!;
  return {
    post: (path: string, value: unknown, signal?: AbortSignal) => app.fetch(new Request(origin + path, { method: "POST", signal,
      headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify(value) })),
    get: (path: string) => app.fetch(new Request(origin + path, { headers: { cookie } })),
  };
}

test("disabled and incomplete operations yield O4 503 and strict JSON stays 400", async () => {
  const f = fixture(); const local = createOperationalApp({ origin, operations: { ...f.options, enabled: false } });
  try {
    const b = await browser(local), ready = await (await b.get("/operations/readiness")).json();
    assert.equal(ready.mode, "unconfigured"); assert.equal(ready.authorization, "disabled"); assert.equal(ready.liveAzureVerified, false);
    assert.equal((await b.post("/cases", submission)).status, 503); assert.equal(f.calls(), 0); assert.equal(f.records.length, 0);
    assert.equal((await b.post("/cases", { ...submission, massKg: "2000" })).status, 400);
  } finally { local.dispose(); }
  const gated = createOperationalApp({ origin, operations: { ...f.options, configuration: async () => null } });
  try {
    const b = await browser(gated);
    assert.equal((await (await b.get("/operations/readiness")).json()).mode, "request-gated");
    assert.equal((await b.post("/cases", submission)).status, 503); assert.equal(f.calls(), 0);
  } finally { gated.dispose(); }
});

test("operational errors reach the existing O4 mapping for authentication, rate-limit, timeout and cancellation", async () => {
  for (const [status, expected] of [[401, 502], [429, 429]] as const) {
    const f = fixture(), app = createOperationalApp({ origin, operations: { ...f.options,
      transport: async () => new Response("PRIVATE diagnostic", { status }) } });
    try { const b = await browser(app), result = await b.post("/cases", submission); assert.equal(result.status, expected); assert.equal((await result.text()).includes("PRIVATE"), false); }
    finally { app.dispose(); }
  }
  for (const kind of ["timeout", "cancelled"] as const) {
    const f = fixture(), controller = new AbortController(), configured = Promise.withResolvers<void>();
    const app = createOperationalApp({ origin, operations: { ...f.options, timeoutMs: 30,
      configuration: async () => { configured.resolve(); return new Promise<null>(() => {}); } } });
    try {
      const b = await browser(app), result = b.post("/cases", submission, controller.signal);
      await configured.promise;
      if (kind === "cancelled") controller.abort();
      assert.equal((await result).status, kind === "timeout" ? 504 : 408);
      // H's bounded runner completes its terminal audit after the outer HTTP abort resolves.
      await app.settled();
      assert.equal(f.records.at(-1)?.outcome, kind); assert.equal(f.calls(), 0);
    } finally { app.dispose(); }
  }
});

test("authenticated app submit/answer uses the photo store, preserves SHA and records changed H2 facts", async () => {
  const root = await mkdtemp(join(tmpdir(), "resource-h-app-"));
  const photon = createRequire(import.meta.resolve("@code-yeongyu/senpi"))("@silvia-odwyer/photon-node") as typeof import("@silvia-odwyer/photon-node");
  const image = new photon.PhotonImage(new Uint8Array([255,0,0,255]),1,1), f = fixture(); let current: CaseInput | undefined;
  const captured: Awaited<ReturnType<typeof prepareCaseRecord>>[] = [];
  const cases = createCaseStore(Date.now, f.photoExecution);
  const store = await createPhotoStore({ root, photoExecution: f.photoExecution, retentionMs: 60_000, maxPhotos: 2,
    authorize: cases.authorize });
  let identity = "authenticated-owner";
  const app = createOperationalApp({ origin, operations: { ...f.options, transport: async () => new Response("", { headers: { "x-request-id": "synthetic-app" } }) },
    caseStore: cases, photoStore: store, actorForRequest: async () => identity,
    photoPolicy: { retentionMs: 60_000, guardedModel: { provider: "synthetic Azure", purpose: "synthetic test" } },
    resources: async (value, signal) => {
      current = value;
      captured.push(await prepareCaseRecord(value, { dataOrigin: { kind: "synthetic", reference: "HTTP fixture; no field data or Azure call" },
        codeRevision: "497fdb0144ddcbb36fd0974d616dfdb78e435750", signal, sources: createBundledSnapshotReader(process.cwd()), photos: value.photoRefs.length ? store.resolver("authenticated-owner", cases.currentPhotoTicket()) : undefined }));
      return {};
    } }, syntheticOpen);
  try {
    const b = await browser(app), first = await b.post("/cases", submission); assert.equal(first.status, 303);
    const path = first.headers.get("location")!; assert.ok(current);
    const upload = new FormData(); upload.set("baseVersion", "1"); upload.set("store", "yes"); upload.set("model", "yes"); upload.set("visible", "yes");
    upload.set("modelBindingId", f.ticket.bindingId);
    upload.set("file", new File([new Uint8Array(image.get_bytes())], "synthetic.png", { type: "image/png" }));
    assert.equal((await app.fetch(new Request(origin + path + "/photos", { method: "POST", headers: { origin }, body: upload }))).status, 303);
    const photo = cases.read("actor:authenticated-owner", current.caseId)?.photos[0]; assert.ok(photo);
    let baseVersion = 2;
    for (const patch of [{ photoRefs: [photo.photoRef], process: null, contamination: null }, { process: "압출", contamination: "기름 오염", hazardousContact: "yes" }]) {
      assert.equal((await b.post(path + "/answers", { baseVersion: baseVersion++, patch })).status, 303);
      assert.equal(captured.at(-1)?.record.images[0]?.sha256, photo.sha256);
      assert.equal(f.records.at(-1)?.images[0]?.sha256, photo.sha256);
      assert.equal(f.records.at(-1)?.outcome, "success");
    }
    assert.ok(captured[1]!.record.assessment.questions.some((q) => q.includes("공정")));
    assert.ok(captured[2]!.record.assessment.reviewReasons.some((r) => r.includes("유해물질")));
    assert.equal(captured[2]!.record.decision.state, "needs-review");
    const before = await (await b.get(path)).text();
    await store.revoke("authenticated-owner", photo.photoRef, live());
    assert.equal((await b.post(path + "/answers", { baseVersion, patch: { massKg: 1000 } })).status, 502);
    assert.equal(await (await b.get(path)).text(), before);
    identity = "other-owner";
    const other = await browser(app); assert.equal((await other.get(path)).status, 404);
  } finally { app.dispose(); image.free(); await rm(root, { recursive: true, force: true }); }
});

test("authentication lookup honors request cancellation and the app deadline", async () => {
  const root = await mkdtemp(join(tmpdir(), "resource-h-auth-"));
  const store = await createPhotoStore({ root, retentionMs: 1000, maxPhotos: 1, authorize: async () => null });
  const f = fixture(), app = createOperationalApp({ origin, operations: { ...f.options, timeoutMs: 20 }, timeoutMs: 80,
    photoStore: store, actorForRequest: async () => new Promise(() => {}) });
  try {
    for (const cancel of [false, true]) {
      const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
      const pending = app.fetch(new Request(origin, { signal: controller.signal }));
      if (cancel) controller.abort();
      try {
        const result = await Promise.race([pending, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("auth-hung")), 200); })]);
        // Exhausting the whole request budget is 504; an actual auth service error remains 503.
        assert.equal(result.status, cancel ? 408 : 504);
      } finally { clearTimeout(timer); }
    }
    assert.equal(f.calls(), 0);
  } finally { app.dispose(); await rm(root, { recursive: true, force: true }); }
});

test("terminal audit failure after transport is not reported as success and preserves the previous report", async () => {
  const f = fixture(); let failAudit = false, sent = 0;
  const app = createOperationalApp({ origin, operations: { ...f.options,
    transport: async () => { sent++; return new Response("", { headers: { "x-request-id": "synthetic-sent" } }); },
    record: async (event) => { if (event.phase === "finish" && failAudit) throw new Error("PRIVATE audit storage failure"); await f.options.record(event); },
  } }, syntheticOpen);
  try {
    const b = await browser(app), first = await b.post("/cases", submission); assert.equal(first.status, 303);
    const path = first.headers.get("location")!, before = await (await b.get(path)).text(); failAudit = true;
    const response = await b.post(path + "/answers", { massKg: 999 });
    assert.equal(response.status, 502); assert.equal((await response.text()).includes("PRIVATE"), false);
    assert.equal(sent, 2); assert.equal(await (await b.get(path)).text(), before);
  } finally { app.dispose(); }
});
