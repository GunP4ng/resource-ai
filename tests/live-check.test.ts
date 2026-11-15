import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { ModelRuntime } from "@code-yeongyu/senpi";
import type { FetchFunction } from "@earendil-works/pi-ai";
import type { runLiveCheck } from "../scripts/live-check.ts";
import { safeUsage } from "../scripts/live-check-app.ts";

const secret = "private-owner@example.invalid TOKEN_SYNTHETIC_ONLY /private/auth/path";
type Mode = "normal" | "no-id" | "bad-id" | "no-usage" | "rate-limit" | "invalid" | "timeout" | "stream-timeout" | "oversize" | "rewrite";
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "live-check-owned-")), authPath = join(root, "auth.json");
  const runtime = await ModelRuntime.create({ authPath, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  assert.ok(runtime.authStorage);
  const payload = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "synthetic-account" } })).toString("base64url");
  runtime.authStorage.set("chatgpt-subscription", { type: "oauth", access: `synthetic.${payload}.signature`,
    refresh: "synthetic-refresh", expires: Date.now() + 3600000 });
  return { root, authPath, out: join(root, "results"), close: () => rmSync(root, { recursive: true, force: true }) };
}
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function wire(mode: Mode = "normal") {
  let calls = 0;
  const transport: FetchFunction = async (url, init) => {
    calls++;
    assert.equal(String(url), "https://chatgpt.com/backend-api/codex/responses");
    const request = new Request(url, init), bytes = Buffer.from(await request.arrayBuffer());
    const body: unknown = JSON.parse((request.headers.get("content-encoding") === "zstd" ? zstdDecompressSync(bytes) : bytes).toString());
    assert.ok(object(body)); assert.equal(body["model"], "gpt-6-sol");
    assert.doesNotMatch(JSON.stringify(body), /input_image|private:\/\//);
    assert.ok(Array.isArray(body["tools"]) && body["tools"].some(t => object(t) && t["name"] === "resource_assess_case"));
    if (mode === "rate-limit") return Response.json({ error: { message: secret } }, { status: 429, headers: { "x-oai-request-id": `req_${calls}` } });
    if (mode === "timeout") return new Promise<Response>((_yes, no) => {
      const abort = () => no(new Error(secret));
      if (init?.signal?.aborted) abort(); else init?.signal?.addEventListener("abort", abort, { once: true });
    });
    if (mode === "stream-timeout") return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      const abort = () => controller.error(new Error(secret));
      if (init?.signal?.aborted) abort(); else init?.signal?.addEventListener("abort", abort, { once: true });
    } }), { headers: { "content-type": "text/event-stream", "x-oai-request-id": "req_stream_timeout" } });
    assert.ok(Array.isArray(body["input"]));
    const tool = body["input"].findLast((v: unknown) => object(v) && v["type"] === "function_call_output");
    const toolOutput: unknown = object(tool) && typeof tool["output"] === "string" ? JSON.parse(tool["output"]) : null;
    const reference = object(toolOutput) ? toolOutput["decisionReference"] : null;
    const final = mode === "rewrite" ? { decisionReference: reference, humanApproval: "approved" } : { decisionReference: reference };
    const item = tool ? { type: "message", id: "msg_synthetic", role: "assistant", status: "completed",
      content: [{ type: "output_text", text: mode === "invalid" ? secret : mode === "oversize" ? "x".repeat(530000) : JSON.stringify(final), annotations: [] }] }
      : { type: "function_call", id: "fc_synthetic", call_id: "call_synthetic", name: "resource_assess_case", arguments: "{}", status: "completed" };
    const events = [{ type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response: { id: "resp_must_not_be_a_request_id", status: "completed", output: [item],
        ...(mode === "no-usage" ? {} : { usage: { input_tokens: 7, output_tokens: 11, total_tokens: 18 } }) } }];
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: {
      "content-type": "text/event-stream", ...(mode === "no-id" ? {} : { "x-oai-request-id": mode === "bad-id" ? secret : `req_${calls}` }) } });
  };
  return { transport, calls: () => calls };
}
function persisted(result: Awaited<ReturnType<typeof runLiveCheck>>) {
  const text = readFileSync(result.path, "utf8");
  assert.doesNotMatch(text, /private-owner|TOKEN_SYNTHETIC|\/private\/auth|synthetic-refresh|signature|authorization|resp_must_not|senpi:/i);
  assert.deepEqual(JSON.parse(text), result.report);
  assert.equal(statSync(result.path).mode & 0o777, 0o400);
}
async function withWire<T>(transport: FetchFunction, action: () => Promise<T>): Promise<T> {
  const previous = globalThis.fetch;
  globalThis.fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => transport(url, init),
    { preconnect() {} });
  try { return await action(); }
  finally { globalThis.fetch = previous; }
}

if (process.env["H48_SDK_WIRE_CHILD"] === "normal") {
  const fake = wire();
  globalThis.fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => fake.transport(url, init),
    { preconnect() {} });
} else {
const { liveCheckCommand, runLiveCheck } = await import("../scripts/live-check.ts");
test("offline command exercises SDK, app, revoked session, comparison and immutable result file", async () => {
  const f = await fixture(), fake = wire();
  const oldAuth = process.env["RESOURCE_AUTH_PATH"], oldRunner = process.env["RESOURCE_MODEL_RUNNER"];
  try {
    process.env["RESOURCE_AUTH_PATH"] = f.authPath; process.env["RESOURCE_MODEL_RUNNER"] = "subscription";
    const providerCredentials = readFileSync(f.authPath, "utf8");
    const result = await withWire(fake.transport, () => liveCheckCommand(["--out", resolve("artifacts/h48/offline"), "--timeout-ms", "60000"]));
    assert.ok("report" in result); persisted(result);
    console.log(`OFFLINE_QA_RESULT=${result.path}`);
    assert.equal(result.exitCode, 0, JSON.stringify(result.report));
    console.log("OFFLINE_QA live=false transport=owned-wire-substitution");
    assert.match(result.report.gitSha ?? "", /^[a-f0-9]{40}$/);
    assert.equal(fake.calls(), 4);
    assert.deepEqual(result.report.cases.map(c => c.state), ["compared", "needs-information", null]);
    for (const c of result.report.cases.slice(0, 2)) {
      assert.equal(c.reportVerified, true); assert.equal(c.dispatches, 2);
      assert.deepEqual(c.usage, { input: 14, output: 22, cacheRead: 0, cacheWrite: 0, total: 36 });
      assert.equal(c.traceId, `chatgpt-subscription:${c.requestIds.at(-1)}`);
    }
    const logout = result.report.cases[2];
    assert.equal(logout.passed, true); assert.equal(logout.httpStatus, 403);
    assert.equal(logout.dispatches, 0); assert.equal(logout.priorStatePreserved, true);
    assert.equal(readFileSync(f.authPath, "utf8"), providerCredentials);
    const again = await withWire(wire().transport, () => runLiveCheck(f));
    assert.notEqual(result.path, again.path); persisted(result); persisted(again);
  } finally {
    if (oldAuth === undefined) delete process.env["RESOURCE_AUTH_PATH"]; else process.env["RESOURCE_AUTH_PATH"] = oldAuth;
    if (oldRunner === undefined) delete process.env["RESOURCE_MODEL_RUNNER"]; else process.env["RESOURCE_MODEL_RUNNER"] = oldRunner;
    f.close();
  }
});

test("a later provider failure retains the normal result and still checks logout preservation", async () => {
  const f = await fixture(), good = wire();
  let calls = 0;
  try {
    const result = await withWire(async (...args) => ++calls <= 2 ? good.transport(...args)
      : Response.json({ error: { message: secret } }, { status: 500 }), () => runLiveCheck(f));
    persisted(result); assert.equal(result.exitCode, 1); assert.equal(calls, 3);
    assert.deepEqual(result.report.cases.map(c => c.passed), [true, false, true]);
    assert.equal(result.report.cases[1].failure, "provider");
    assert.equal(result.report.cases[2].priorStatePreserved, true);
  } finally { f.close(); }
});

for (const mode of ["no-id", "bad-id", "no-usage", "rate-limit", "invalid", "timeout", "stream-timeout", "oversize", "rewrite"] as const) {
  test(`SDK/app failure ${mode} persists all cases, stays secret-free, never retries`, async () => {
    const f = await fixture(), fake = wire(mode);
    try {
      const timeout = mode === "timeout" || mode === "stream-timeout";
      const result = await withWire(fake.transport, () => runLiveCheck({ ...f, timeoutMs: timeout ? 1500 : 10000 }));
      persisted(result); assert.equal(result.exitCode, 1); assert.equal(result.report.cases.length, 3);
      for (const c of result.report.cases.slice(0, 2)) {
        assert.equal(c.passed, false); assert.ok(c.failure);
        if (mode === "no-id" || mode === "bad-id") { assert.deepEqual(c.requestIds, []); assert.equal(c.traceId, null); }
        if (mode === "no-usage") assert.equal(c.usage, null);
        if (mode === "rate-limit") { assert.equal(c.failure, "rate-limit"); assert.equal(c.dispatches, 1); assert.equal(c.httpStatus, 429); }
        if (mode === "invalid" || mode === "rewrite") assert.equal(c.failure, "invalid-model-output");
        if (timeout) { assert.equal(c.failure, "timeout"); assert.equal(c.httpStatus, 504); assert.equal(c.usage, null); }
      }
      assert.equal(fake.calls(), timeout || mode === "rate-limit" ? 2 : 4);
      assert.equal(result.report.cases[2].dispatches, 0);
    } finally { f.close(); }
  });
}

test("usage accepts only bounded nonnegative integer scalars and strips untrusted extras", () => {
  assert.equal(safeUsage(null), null); assert.equal(safeUsage(secret), null);
  for (const total of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "18", null]) {
    assert.equal(safeUsage(JSON.stringify({ input: 7, output: 11, cacheRead: 0, cacheWrite: 0, total })), null);
  }
  assert.deepEqual(safeUsage(JSON.stringify({ input: 7, output: 11, cacheRead: 0, cacheWrite: 0, total: 18, secret })),
    { input: 7, output: 11, cacheRead: 0, cacheWrite: 0, total: 18 });
});

test("invalid limits persist an unverified result without opening provider auth or dispatching", async () => {
  const f = await fixture();
  try {
    const result = await withWire(async () => assert.fail("must not dispatch"),
      () => runLiveCheck({ ...f, authPath: "/never/open/provider-auth", timeoutMs: 60001 }));
    persisted(result); assert.equal(result.exitCode, 1); assert.equal(result.report.failure, "setup-or-execution");
    assert.equal(result.report.gitSha, null);
    assert.ok(result.report.cases.every(c => !c.passed && c.dispatches === 0));
  } finally { f.close(); }
});
}
