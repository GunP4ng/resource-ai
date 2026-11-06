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

// All credentials, approval records and provider responses are synthetic. No network.
const input = { ...syntheticCase, description: "PRIVATE description" };
const config = { endpoint: "https://synthetic.openai.azure.com", deployment: "synthetic-deployment",
  modelId: "gpt-4.1", apiKey: "PRIVATE secret", apiVersion: "v1" };
const live = () => new AbortController().signal;
const failure = (code: string) => (error: unknown) => error instanceof SessionFailure && error.code === code;
function fixture() {
  const records: OperationalAudit[] = []; let calls = 0, authorizations = 0;
  const options: OperationalRunnerOptions = { enabled: true, timeoutMs: 10_000, maxTurns: 2, maxOutputTokens: 100,
    configuration: async () => config,
    authorizeDispatch: async (request) => { authorizations++; assert.equal(request.maxOutputTokens, 100); return { approvalId: "synthetic-approval", expiresAt: Date.now() + 5000 }; },
    record: async (event) => { records.push(structuredClone(event)); },
    transport: async (_url, init) => { calls++; assert.equal(init?.redirect, "error"); return new Response("PRIVATE provider body", { status: 401, headers: { "x-request-id": "synthetic-request" } }); } };
  return { options, records, calls: () => calls, authorizations: () => authorizations };
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
        const response = await settings!.fetch!("https://synthetic.openai.azure.com/openai/v1/responses", { method: "POST", body: JSON.stringify({ input: [{ content }] }) });
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
    let resume: (value: typeof config) => void = () => {};
    const runner = createOperationalRunner({ ...f.options, timeoutMs: code === "timeout" ? 20 : 1000,
      configuration: async () => new Promise((resolve) => { resume = resolve; }) });
    const result = runner(input, controller.signal);
    if (code === "cancelled") setTimeout(() => controller.abort(), 20);
    await assert.rejects(result, failure(code)); resume(config);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(f.calls(), 0); assert.equal(f.records.at(-1)?.outcome, code); assert.equal(f.records.at(-1)?.usage, null);
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
  const root = await mkdtemp(join(tmpdir(), "resource-h-dispatch-"));
  const photon = createRequire(import.meta.resolve("@code-yeongyu/senpi"))("@silvia-odwyer/photon-node") as typeof import("@silvia-odwyer/photon-node");
  const generated = new photon.PhotonImage(new Uint8Array([255,0,0,255]), 1, 1);
  let current = input;
  try {
    const store = await createPhotoStore({ root, retentionMs: 60_000, maxPhotos: 3,
      authorize: async () => ({ ownerId: "owner", caseRevision: revision(current), read: true, sendToModel: true }) });
    const receipt = await store.put("owner", input.caseId, generated.get_bytes_jpeg(90), "image/jpeg",
      { recordId: "synthetic-consent", store: true, model: true, visibleContentReviewed: true, expiresAt: Date.now() + 60_000 }, live());
    current = { ...input, photoRefs: [receipt.photoRef] };
    const expected = await store.resolver("owner")({ caseId: current.caseId, caseRevision: revision(current), photoRef: receipt.photoRef }, live());
    const f = fixture(); let calls = 0;
    const photos = { resolve: store.resolver("owner"), assertCanTransmit: (value: typeof input, signal: AbortSignal) => store.assertCanTransmit("owner", value, signal) };
    const runner = createOperationalRunner({ ...f.options, photos, transport: async (_url, init) => {
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
        fetch: (url, init) => config!.fetch!(url, { ...init, body: JSON.stringify({ input: [] }) }) });
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

test("default app remains local-only; explicit incomplete operations yield O4 503 and strict JSON stays 400", async () => {
  const f = fixture(); const local = createOperationalApp({ origin, operations: { ...f.options, enabled: false } });
  try {
    const b = await browser(local), ready = await (await b.get("/operations/readiness")).json();
    assert.equal(ready.mode, "local-only"); assert.equal(ready.authorization, "disabled"); assert.equal(ready.liveAzureVerified, false);
    assert.equal((await b.post("/cases", submission)).status, 303); assert.equal(f.calls(), 0); assert.equal(f.records.length, 0);
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
    const f = fixture(), controller = new AbortController();
    const app = createOperationalApp({ origin, operations: { ...f.options, timeoutMs: 30, configuration: async () => new Promise(() => {}) } });
    try {
      const b = await browser(app), result = b.post("/cases", submission, controller.signal);
      if (kind === "cancelled") setTimeout(() => controller.abort(), 5);
      assert.equal((await result).status, kind === "timeout" ? 504 : 408);
      // H's bounded runner completes its terminal audit after the outer HTTP abort resolves.
      await new Promise((resolve) => setTimeout(resolve, 35));
      assert.equal(f.records.at(-1)?.outcome, kind); assert.equal(f.calls(), 0);
    } finally { app.dispose(); }
  }
});

test("authenticated app submit/answer uses the photo store, preserves SHA and records changed H2 facts", async () => {
  const root = await mkdtemp(join(tmpdir(), "resource-h-app-"));
  const photon = createRequire(import.meta.resolve("@code-yeongyu/senpi"))("@silvia-odwyer/photon-node") as typeof import("@silvia-odwyer/photon-node");
  const image = new photon.PhotonImage(new Uint8Array([255,0,0,255]),1,1), f = fixture(); let current: CaseInput | undefined;
  const captured: Awaited<ReturnType<typeof prepareCaseRecord>>[] = [];
  const store = await createPhotoStore({ root, retentionMs: 60_000, maxPhotos: 2,
    authorize: async (actor, caseId) => current?.caseId === caseId && actor === "authenticated-owner"
      ? { ownerId: actor, caseRevision: revision(current), read: true, sendToModel: true } : null });
  const app = createOperationalApp({ origin, operations: { ...f.options, transport: async () => new Response("", { headers: { "x-request-id": "synthetic-app" } }) },
    photoStore: store, actorForRequest: async () => "authenticated-owner",
    resources: async (value, signal) => {
      current = value;
      captured.push(await prepareCaseRecord(value, { dataOrigin: { kind: "synthetic", reference: "HTTP fixture; no field data or Azure call" },
        codeRevision: "497fdb0144ddcbb36fd0974d616dfdb78e435750", signal, sources: createBundledSnapshotReader(process.cwd()), photos: store.resolver("authenticated-owner") }));
      return {};
    } }, syntheticOpen);
  try {
    const b = await browser(app), first = await b.post("/cases", submission); assert.equal(first.status, 303);
    const path = first.headers.get("location")!; assert.ok(current);
    const photo = await store.put("authenticated-owner", current.caseId, image.get_bytes(), "image/png",
      { recordId: "synthetic-consent", store: true, model: true, visibleContentReviewed: true, expiresAt: Date.now() + 60_000 }, live());
    for (const patch of [{ photoRefs: [photo.photoRef], process: null, contamination: null }, { process: "압출", contamination: "기름 오염", hazardousContact: "yes" }]) {
      assert.equal((await b.post(path + "/answers", patch)).status, 303);
      assert.equal(captured.at(-1)?.record.images[0]?.sha256, photo.sha256);
      assert.equal(f.records.at(-1)?.images[0]?.sha256, photo.sha256);
      assert.equal(f.records.at(-1)?.outcome, "success");
    }
    assert.ok(captured[1]!.record.assessment.questions.some((q) => q.includes("공정")));
    assert.ok(captured[2]!.record.assessment.reviewReasons.some((r) => r.includes("유해물질")));
    assert.equal(captured[2]!.record.decision.state, "needs-review");
    const before = await (await b.get(path)).text();
    await store.revoke("authenticated-owner", photo.photoRef, live());
    assert.equal((await b.post(path + "/answers", { massKg: 1000 })).status, 502);
    assert.equal(await (await b.get(path)).text(), before);
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
        assert.equal(result.status, cancel ? 408 : 503);
      } finally { clearTimeout(timer); }
    }
    assert.equal(f.calls(), 0);
  } finally { app.dispose(); await rm(root, { recursive: true, force: true }); }
});
