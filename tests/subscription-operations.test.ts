import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { zstdDecompressSync, zstdCompressSync } from "node:zlib";
import { ModelRuntime } from "@code-yeongyu/senpi";
import { createSubscriptionPhotoExecutionAuthority, matchesPhotoConsent } from "../src/photo-execution.ts";
import { SUBSCRIPTION_ENDPOINT, subscriptionCredentials, SubscriptionConfigurationError, type SubscriptionConfiguration } from "../src/subscription-configuration.ts";
import { createOperationalApp, createOperationalRunner, type OperationalAudit, type DispatchRequest, type OperationalClock } from "../src/operations.ts";
import { createCaseStore } from "../src/o-case-store.ts";
import { createPhotoStore } from "../src/photos.ts";
import { decideCase } from "../src/assessment.ts";
import { syntheticCase } from "./h-fixtures.ts";
import { openCaseSession, SessionFailure } from "../src/session.ts";

const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const scope = { provider: "synthetic subscription operator", purpose: "synthetic photo assessment" };
const origin = "http://localhost:3000";
const signal = () => new AbortController().signal;
const post = (path: string, value: unknown) => new Request(origin + path, {
  method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(value),
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "h-subscription-guarded-")), authPath = join(root, "auth.json");
  const runtime = await ModelRuntime.create({ authPath, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const account = "synthetic-account";
  const payload = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: account } })).toString("base64url");
  const access = `synthetic.${payload}.signature`;
  runtime.authStorage!.set("chatgpt-subscription", { type: "oauth", access, refresh: "synthetic-refresh", expires: Date.now() + 3600000 });
  const config: SubscriptionConfiguration = { provider: "chatgpt-subscription", modelId: "gpt-6-sol", authPath, accountIdSha256: sha(account) };
  const target = { provider: config.provider, endpoint: SUBSCRIPTION_ENDPOINT, modelId: config.modelId, accountIdSha256: config.accountIdSha256 } as const;
  const authority = createSubscriptionPhotoExecutionAuthority();
  const publish = () => authority.publish(config, [{ target, scope }]);
  publish();
  return { root, runtime, access, config, target, authority, publish, close: () => rm(root, { recursive: true, force: true }) };
}
function response(input = syntheticCase) {
  const item = { type: "message", id: "msg_synthetic", role: "assistant", status: "completed",
    content: [{ type: "output_text", text: JSON.stringify(decideCase(input)), annotations: [] }] };
  return new Response([
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: { id: "resp_synthetic", status: "completed", output: [item], usage: { input_tokens: 7, output_tokens: 11, total_tokens: 18 } } },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream", "x-request-id": "synthetic-request" } });
}
function payload(init: RequestInit) {
  return JSON.parse(new Headers(init.headers).get("content-encoding") === "zstd"
    ? zstdDecompressSync(Buffer.from(init.body as ArrayBuffer)).toString() : String(init.body));
}

test("subscription authority binds an explicit account/model/scope, keeps credentials private and rejects stale/forged tickets", async () => {
  const f = await fixture();
  try {
    const first = f.authority.current()!;
    assert.ok(first); assert.equal(JSON.stringify(first).includes(f.config.authPath), false);
    assert.throws(() => f.authority.assertCurrent({ ...first }));
    f.publish(); assert.equal(f.authority.current()!.bindingId, first.bindingId);
    assert.throws(() => f.authority.configuration(first));
    const live = f.authority.current()!;
    assert.equal(matchesPhotoConsent({ model: true, visibleContentReviewed: true, modelBindingId: live.bindingId, modelScope: scope }, live), true);
    f.authority.publish({ ...f.config, modelId: "different" }, [{ target: { ...f.target, modelId: "different" }, scope }]);
    assert.notEqual(f.authority.current()!.bindingId, live.bindingId);
    for (const mappings of [[], [{ target: f.target, scope }, { target: f.target, scope }], [{ target: { ...f.target, accountIdSha256: sha("other") }, scope }]]) {
      f.authority.publish(f.config, mappings); assert.equal(f.authority.current(), null);
    }
  } finally { await f.close(); }
});

test("guarded subscription uses the existing SDK, approval and audit gates with honest output-limit and usage metadata", async () => {
  const f = await fixture(), events: OperationalAudit[] = [], permits: DispatchRequest[] = [];
  let sent = 0;
  try {
    const runner = createOperationalRunner({ provider: "subscription", enabled: true, timeoutMs: 5000, maxTurns: 1, maxOutputTokens: 128,
      configuration: async () => f.config, authorizeDispatch: async request => { permits.push(request); return { approvalId: "synthetic", expiresAt: Date.now() + 60000 }; },
      record: async event => { events.push(event); }, transport: async (url, init) => {
        sent++; assert.equal(String(url), SUBSCRIPTION_ENDPOINT);
        const headers = new Headers(init?.headers); assert.equal(headers.get("chatgpt-account-id"), "synthetic-account");
        const body = headers.get("content-encoding") === "zstd" ? zstdDecompressSync(Buffer.from(init!.body as ArrayBuffer)).toString() : String(init?.body);
        assert.equal(JSON.parse(body).model, "gpt-6-sol");
        assert.equal(JSON.parse(body).max_output_tokens, undefined);
        return response();
      } });
    await runner(syntheticCase, signal());
    assert.equal(sent, 1); assert.equal(permits[0]?.provider, "chatgpt-subscription");
    assert.equal(permits[0]?.outputLimitEnforced, false);
    assert.deepEqual(events.map(event => event.phase), ["start", "dispatch", "finish"]);
    assert.equal(events.at(-1)?.outcome, "success"); assert.equal(events.at(-1)?.usage?.total, 18);
    assert.equal(events.at(-1)?.requests[0]?.requestId, "synthetic-request");
    assert.equal(JSON.stringify(events).includes(f.access), false);
  } finally { await f.close(); }
});

test("a subscription ticket cannot resolve photos using a different account configuration", async () => {
  const f = await fixture(); let resolutions = 0;
  try {
    f.authority.publish({ ...f.config, accountIdSha256: sha("other-account") }, [{ target: { ...f.target, accountIdSha256: sha("other-account") }, scope }]);
    const runner = createOperationalRunner({ provider: "subscription", enabled: true, timeoutMs: 5000, maxTurns: 1, maxOutputTokens: 128,
      configuration: async () => assert.fail("photo configuration must come from the ticket"),
      photoExecution: { ...f.authority, configuration: () => f.config },
      photos: { resolve: async () => { resolutions++; return null; }, assertCanTransmit: async () => {} },
      authorizeDispatch: async () => assert.fail("must not authorize mismatched targets"), record: async () => {},
      transport: async () => assert.fail("must not transmit") });
    await assert.rejects(runner({ ...syntheticCase, photoRefs: ["synthetic-photo"] }, signal()),
      (error: unknown) => error instanceof SessionFailure && error.code === "not-configured");
    assert.equal(resolutions, 0);
  } finally { await f.close(); }
});

test("subscription approval refusal and a mismatched account prevent transmission", async () => {
  const f = await fixture();
  try {
    for (const mode of ["approval", "account"] as const) {
      let sent = 0; const events: OperationalAudit[] = [];
      const runner = createOperationalRunner({ provider: "subscription", enabled: true, timeoutMs: 5000, maxTurns: 1, maxOutputTokens: 128,
        configuration: async () => mode === "account" ? { ...f.config, accountIdSha256: sha("other-account") } : f.config,
        authorizeDispatch: async () => null, record: async event => { events.push(event); },
        transport: async () => { sent++; return response(); } });
      await assert.rejects(runner(syntheticCase, signal()), (error: unknown) => error instanceof SessionFailure && error.code === "not-configured");
      assert.equal(sent, 0); assert.equal(events.at(-1)?.usage, null);
    }
  } finally { await f.close(); }
});

test("guarded credentials cannot refresh, rotate accounts, write to disk or outlive request cancellation", async () => {
  const f = await fixture();
  try {
    const controller = new AbortController();
    const store = subscriptionCredentials(f.config, () => controller.signal.throwIfAborted());
    let refresh = 0;
    await assert.rejects(store.withRefreshLock!("chatgpt-subscription", "default", async () => { refresh++; }));
    assert.equal(refresh, 0);
    await assert.rejects(store.modify("chatgpt-subscription", async value => value));
    await assert.rejects(store.delete("chatgpt-subscription"));
    controller.abort(); await assert.rejects(store.read("chatgpt-subscription"));
    for (const patch of [{ expires: Date.now() + 60000 }, { accounts: [] }, { signedOut: true }]) {
      f.runtime.authStorage!.set("chatgpt-subscription", { type: "oauth", access: f.access, refresh: "synthetic-refresh", expires: Date.now() + 3600000, ...patch });
      assert.throws(() => subscriptionCredentials(f.config, () => {}), SubscriptionConfigurationError);
      let opens = 0, dispatches = 0;
      const runner = createOperationalRunner({ provider: "subscription", enabled: true, timeoutMs: 5000, maxTurns: 1, maxOutputTokens: 128,
        configuration: async () => f.config, authorizeDispatch: async () => { dispatches++; return null; }, record: async () => {},
        transport: async () => assert.fail("must not dispatch") }, async (...args) => { opens++; return openCaseSession(...args); });
      await assert.rejects(runner(syntheticCase, signal()), (error: unknown) => error instanceof SessionFailure && error.code === "not-configured");
      assert.equal(opens, 0); assert.equal(dispatches, 0);
    }
  } finally { await f.close(); }
});

test("SDK target or body changes are rejected before approval, and mutable compressed buffers are copied before awaiting approval", async () => {
  const f = await fixture();
  try {
    for (const mode of ["url", "model", "account", "encoding", "corrupt", "mutation"] as const) {
      let sent = 0, approved = 0, original: Uint8Array | undefined;
      const intercept: typeof openCaseSession = async (...args) => {
        const owned = await openCaseSession(...args), stream = owned.session.agent.streamFunction;
        owned.session.agent.streamFunction = (model, context, settings) => stream(model, context, { ...settings, fetch: async (url, init) => {
          const changed: RequestInit = { ...init, headers: new Headers(init?.headers) };
          if (mode === "model") { const value = payload(changed); value.model = "wrong-model"; changed.body = new Uint8Array(zstdCompressSync(JSON.stringify(value))).buffer; (changed.headers as Headers).set("content-encoding", "zstd"); }
          if (mode === "account") (changed.headers as Headers).set("chatgpt-account-id", "different-account");
          if (mode === "encoding") (changed.headers as Headers).set("content-encoding", "gzip");
          if (mode === "corrupt") changed.body = new Uint8Array([0, 1, 2]).buffer;
          if (mode === "mutation") { original = new Uint8Array(zstdCompressSync(JSON.stringify(payload(changed)))); changed.body = original.buffer as ArrayBuffer; (changed.headers as Headers).set("content-encoding", "zstd"); }
          return settings!.fetch!(mode === "url" ? SUBSCRIPTION_ENDPOINT + "?wrong=1" : url, changed);
        } });
        return owned;
      };
      const runner = createOperationalRunner({ provider: "subscription", enabled: true, timeoutMs: 5000, maxTurns: 1, maxOutputTokens: 128,
        configuration: async () => f.config, authorizeDispatch: async () => { approved++; original?.fill(0); return { approvalId: "synthetic", expiresAt: Date.now() + 60000 }; },
        record: async () => {}, transport: async (_url, init) => { sent++; assert.equal(payload(init!).model, f.config.modelId); return response(); } }, intercept);
      if (mode === "mutation") { await runner(syntheticCase, signal()); assert.equal(approved, 1); assert.equal(sent, 1); }
      else { await assert.rejects(runner(syntheticCase, signal())); assert.equal(approved, 0); assert.equal(sent, 0); }
    }
  } finally { await f.close(); }
});

test("subscription HTTP deadline/cancellation abort the transport and retain an honest terminal audit within the original budget", async () => {
  const f = await fixture();
  try {
    for (const mode of ["timeout", "cancelled"] as const) {
      let now = 0, aborted = false, sent = 0;
      const timers = new Map<() => void, number>();
      const clock: OperationalClock = { now: () => now, schedule(callback, delay) { timers.set(callback, now + delay); return () => { timers.delete(callback); }; } };
      const entered = Promise.withResolvers<void>(), events: OperationalAudit[] = [], controller = new AbortController();
      const app = createOperationalApp({ origin, timeoutMs: 1000, clock, actorForRequest: async () => "owner", operations: {
        provider: "subscription", enabled: true, timeoutMs: 1000, maxTurns: 1, maxOutputTokens: 128, configuration: async () => f.config,
        authorizeDispatch: async () => ({ approvalId: "synthetic", expiresAt: Date.now() + 60000 }), record: async event => { events.push(event); },
        transport: async (_url, init) => { sent++; return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("synthetic interruption")); }, { once: true }); entered.resolve();
        }); },
      } });
      try {
        const { caseId: _id, ...fields } = syntheticCase;
        const pending = app.fetch(new Request(post("/cases", fields), { signal: controller.signal }));
        await entered.promise;
        if (mode === "cancelled") controller.abort();
        else { now = 900; for (const [callback, at] of timers) if (at <= now) { timers.delete(callback); callback(); } }
        assert.equal((await pending).status, mode === "timeout" ? 504 : 408);
        // Parent cancellation may resolve HTTP before the bounded final audit continuation.
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(aborted, true); assert.equal(sent, 1);
        assert.equal(events.at(-1)?.phase, "finish"); assert.equal(events.at(-1)?.outcome, mode);
        assert.equal(events.at(-1)?.usage, null); assert.equal(events.at(-1)?.requests[0]?.transportStarted, true);
        assert.equal(events.at(-1)?.requests[0]?.requestId, null); assert.equal(timers.size, 0);
      } finally { app.dispose(); }
    }
  } finally { await f.close(); }
});

test("O4 upload, consent, selection and guarded subscription dispatch use one authority and actual image SHA", async () => {
  const f = await fixture(), cases = createCaseStore(Date.now, f.authority), events: OperationalAudit[] = [];
  const store = await createPhotoStore({ root: join(f.root, "photos"), authorize: cases.authorize, retentionMs: 60000, maxPhotos: 3, photoExecution: f.authority });
  let input = syntheticCase, sent = 0, changeDuringPermit = false, tamperImage = false;
  const app = createOperationalApp({ origin, actorForRequest: async () => "owner", caseStore: cases, photoStore: store,
    photoPolicy: { retentionMs: 60000 }, resources: value => { input = value; return {}; },
    operations: { provider: "subscription", enabled: true, timeoutMs: 5000, maxTurns: 1, maxOutputTokens: 128,
      configuration: async () => f.config, photoExecution: f.authority,
      authorizeDispatch: async () => { if (changeDuringPermit) f.publish(); return { approvalId: "synthetic", expiresAt: Date.now() + 60000 }; },
      record: async event => { events.push(event); }, transport: async (_url, init) => {
        sent++;
        if (input.photoRefs.length) {
          const images = payload(init!).input.flatMap((message: { content?: { type: string; image_url?: string }[] }) => message.content?.filter(part => part.type === "input_image") ?? []);
          assert.equal(images.length, 1);
          const bytes = Buffer.from(images[0].image_url.split(",")[1], "base64");
          assert.equal(sha(bytes), cases.read("actor:owner", input.caseId)!.photos[0]!.sha256);
        }
        return response(input);
      } } }, async (...args) => {
        const owned = await openCaseSession(...args), stream = owned.session.agent.streamFunction;
        owned.session.agent.streamFunction = (model, context, settings) => stream(model, context, { ...settings, fetch: async (url, init) => {
          if (!tamperImage) return settings!.fetch!(url, init);
          const body = payload(init!);
          for (const message of body.input) for (const part of message.content ?? []) {
            if (part.type === "input_image") part.image_url = "data:image/png;base64,Y2hhbmdlZA==";
          }
          const headers = new Headers(init?.headers); headers.set("content-encoding", "zstd");
          return settings!.fetch!(url, { ...init, headers, body: new Uint8Array(zstdCompressSync(JSON.stringify(body))).buffer });
        } });
        return owned;
      });
  try {
    const { caseId: _id, ...fields } = syntheticCase;
    const created = await app.fetch(post("/cases", fields)); assert.equal(created.status, 303);
    const path = created.headers.get("location")!, id = path.slice(7), ticket = f.authority.current()!;
    const photon = createRequire(import.meta.resolve("@code-yeongyu/senpi"))("@silvia-odwyer/photon-node") as typeof import("@silvia-odwyer/photon-node");
    const image = new photon.PhotonImage(new Uint8Array([255, 0, 0, 255]), 1, 1);
    const form = new FormData(); form.set("baseVersion", "1"); form.set("store", "yes"); form.set("model", "yes"); form.set("visible", "yes"); form.set("modelBindingId", ticket.bindingId);
    try { form.set("file", new File([new Uint8Array(image.get_bytes())], "synthetic.png", { type: "image/png" })); } finally { image.free(); }
    assert.equal((await app.fetch(new Request(origin + path + "/photos", { method: "POST", headers: { origin }, body: form }))).status, 303);
    const stored = cases.read("actor:owner", id)!.photos[0]!;
    assert.equal((await app.fetch(post(path + "/answers", { baseVersion: 2, patch: { photoRefs: [stored.photoRef] } }))).status, 303);
    assert.equal(sent, 2);
    assert.deepEqual(events.at(-1)?.images, [{ photoRefSha256: sha(stored.photoRef), sha256: stored.sha256, mimeType: "image/png" }]);
    const previous = cases.read("actor:owner", id)!, report = await (await app.fetch(new Request(origin + path + "/report"))).text();
    tamperImage = true;
    assert.equal((await app.fetch(post(path + "/answers", { baseVersion: 3, patch: { massKg: 888 } }))).status, 502);
    assert.equal(sent, 2); assert.deepEqual(cases.read("actor:owner", id), previous);
    assert.equal(events.at(-1)?.requests[0]?.transportStarted, false); assert.deepEqual(events.at(-1)?.images, []);
    tamperImage = false;
    changeDuringPermit = true;
    assert.equal((await app.fetch(post(path + "/answers", { baseVersion: 3, patch: { massKg: 999 } }))).status, 502);
    assert.equal(sent, 2); assert.deepEqual(cases.read("actor:owner", id), previous);
    assert.equal(await (await app.fetch(new Request(origin + path + "/report"))).text(), report);
    const readiness = await (await app.fetch(new Request(origin + "/operations/readiness"))).json();
    assert.equal(readiness.modelProvider, "chatgpt-subscription"); assert.equal(readiness.liveModelVerified, false);
  } finally { app.dispose(); await f.close(); }
});
