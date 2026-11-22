import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { ModelRuntime } from "@code-yeongyu/senpi";
import { appendLoginSlot, listSlots, managedSentinelMaterial, pinSlot } from "@earendil-works/pi-ai/auth/pool/slots";
import { createAssessmentAdapter, createSubscriptionRunner, openCaseSession, SessionFailure } from "../src/session.ts";
import { decideCase } from "../src/assessment.ts";
import { createResourceDomain } from "../src/domain.ts";
import { presentAssessmentDecision } from "../src/o-verification-plan-candidates.ts";
import { openRuntimeDatabase } from "../src/o-runtime-db.ts";
import { createLocalAuth } from "../src/o-auth.ts";
import type { CaseInput } from "../src/contracts.ts";

const input: CaseInput = { caseId: "subscription-synthetic", description: "Synthetic subscription case",
  photoRefs: [], process: "사출", polymer: "PP", contamination: "없음", hazardousContact: "no",
  massKg: null, region: "울산", assessmentDate: "2026-11-05" };
const live = () => new AbortController().signal;
const failure = (code: string) => (error: unknown) => {
  assert.ok(error instanceof SessionFailure);
  assert.equal(error.code, code);
  assert.doesNotMatch(error.message, /private/);
  return true;
};
type AuthShape = "flat" | "pool" | "stale-flat-pool" | "managed-pool" | "signed-out-pool";
async function fixture(shape: AuthShape = "flat") {
  const root = await mkdtemp(join(tmpdir(), "subscription-test-"));
  const authPath = join(root, "auth.json");
  // Fabricated OAuth credential; all inference below uses an injected HTTP transport.
  const expires = Date.now() + 3_600_000;
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(expires / 1000),
    "https://api.openai.com/auth": { chatgpt_account_id: "synthetic-account", chatgpt_account_user_id: "synthetic-first-user" } })).toString("base64url");
  const runtime = await ModelRuntime.create({ authPath, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  assert.ok(runtime.authStorage);
  const flat = { type: "oauth", access: `synthetic.${payload}.signature`, refresh: "synthetic-refresh", expires } as const;
  const secondPayload = Buffer.from(JSON.stringify({ exp: Math.floor(expires / 1000),
    "https://api.openai.com/auth": { chatgpt_account_id: "synthetic-second-account", chatgpt_account_user_id: "synthetic-second-user" } })).toString("base64url");
  const pool = appendLoginSlot(shape === "stale-flat-pool" ? { ...flat, expires: 0 } : flat,
    { ...flat, access: `synthetic.${secondPayload}.signature` });
  assert.ok(pool.type === "oauth");
  const second = listSlots(pool).find(slot => slot.name !== "default"); assert.ok(second);
  const marker = managedSentinelMaterial("chatgpt-subscription");
  switch (shape) {
    case "flat": runtime.authStorage.set("chatgpt-subscription", flat); break;
    case "pool": runtime.authStorage.set("chatgpt-subscription", pool); break;
    case "signed-out-pool": runtime.authStorage.set("chatgpt-subscription", { ...pool, signedOut: true }); break;
    case "stale-flat-pool": runtime.authStorage.set("chatgpt-subscription", pinSlot(pool, second.name)); break;
    case "managed-pool": runtime.authStorage.set("chatgpt-subscription", appendLoginSlot(undefined,
      { type: "oauth", access: marker, refresh: marker, expires: 0, accounts: listSlots(pool) })); break;
    default: assert.fail(shape satisfies never);
  }
  return { authPath, close: () => rm(root, { recursive: true, force: true }) };
}

test("subscription rejects disabled, unknown model, missing and signed-out credentials without Azure configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "subscription-test-"));
  try {
    for (const options of [{ enabled: false }, { enabled: true, modelId: "not-a-model" }, { enabled: true }]) {
      const runner = createSubscriptionRunner({ ...options, authPath: join(root, "auth.json"),
        transport: async () => { assert.fail("Unconfigured runner must not dispatch"); } });
      await assert.rejects(runner(input, live()), failure("not-configured"));
    }
    const controller = new AbortController(); controller.abort();
    await assert.rejects(createSubscriptionRunner({ enabled: true })(input, controller.signal), failure("cancelled"));
    const signedOut = await fixture("signed-out-pool");
    try {
      await assert.rejects(createSubscriptionRunner({ enabled: true, authPath: signedOut.authPath,
        transport: async () => { assert.fail("Signed-out pool must not dispatch"); } })(input, live()), failure("authentication"));
    } finally { await signedOut.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const [status, code, shape] of [[200, null, "flat"], [200, null, "pool"], [200, null, "stale-flat-pool"], [200, null, "managed-pool"],
  [401, "authentication", "flat"], [403, "authentication", "flat"], [429, "rate-limit", "flat"], [500, "provider", "flat"]] as const) {
  test(`subscription HTTP ${status} with ${shape} returns usage or sanitized failure and closes session`, async () => {
    const auth = await fixture(shape); let closed = false, requests = 0;
    const runner = createSubscriptionRunner({ enabled: true, authPath: auth.authPath, maxOutputTokens: 128,
      transport: async (_url, init) => {
        requests++;
        const account = new Headers(init?.headers).get("chatgpt-account-id");
        assert.ok(shape === "stale-flat-pool" ? account === "synthetic-second-account"
          : account === "synthetic-account" || account === "synthetic-second-account");
        if (status !== 200) return Response.json({ error: { message: "private diagnostic" } }, { status });
        const item = { type: "message", id: "msg_synthetic", role: "assistant", status: "completed",
          content: [{ type: "output_text", text: JSON.stringify(decideCase(input)), annotations: [] }] };
        const events = [
          { type: "response.output_item.done", output_index: 0, item },
          { type: "response.completed", response: { id: "resp_synthetic", status: "completed", output: [item],
            usage: { input_tokens: 7, output_tokens: 11, total_tokens: 18 } } },
        ];
        return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
          { headers: { "content-type": "text/event-stream", "x-request-id": "subscription-synthetic" } });
      },
    }, async (value, options) => {
      const owned = await openCaseSession(value, options);
      return { ...owned, close: async () => { closed = true; await owned.close(); } };
    });
    try {
      if (code) await assert.rejects(runner(input, live()), failure(code));
      else {
        const result = await runner(input, live());
        assert.equal(decideCase(input, result.proposal).state, "needs-information");
        const usage: unknown = JSON.parse(result.execution?.usage ?? "{}");
        assert.ok(typeof usage === "object" && usage !== null && "total" in usage && "provider" in usage);
        assert.equal(usage.total, 18); assert.equal(usage.provider, "chatgpt-subscription");
        assert.equal(result.execution?.traceId, "chatgpt-subscription:subscription-synthetic");
      }
      assert.equal(requests, 1); assert.equal(closed, true);
    } finally { await auth.close(); }
  });
}

for (const mode of ["cancelled", "timeout"] as const) {
  test(`subscription ${mode} aborts HTTP work and releases its session`, async () => {
    const auth = await fixture(); let closed = false, aborted = false;
    const entered = Promise.withResolvers<void>(), released = Promise.withResolvers<void>();
    const runner = createSubscriptionRunner({ enabled: true, authPath: auth.authPath,
      transport: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("private interruption")); }, { once: true });
        entered.resolve();
      }),
    }, async (value, options) => {
      const owned = await openCaseSession(value, options);
      return { ...owned, close: async () => { await owned.close(); closed = true; released.resolve(); } };
    });
    const adapter = createAssessmentAdapter({ runner, timeoutMs: mode === "timeout" ? 500 : 5000 });
    const { caseId: _caseId, ...fields } = input;
    const controller = new AbortController();
    try {
      const rejected = assert.rejects(adapter.submit(fields, controller.signal), failure(mode));
      if (mode === "cancelled") { await entered.promise; controller.abort(); }
      await rejected; await released.promise;
      assert.equal(aborted, true); assert.equal(closed, true);
    } finally { adapter.dispose(); await auth.close(); }
  });
}

test("host-only safety holds preserve the rendered decision without dispatching to subscription transport", async () => {
  const auth = await fixture();
  let dispatches = 0;
  const runner = createSubscriptionRunner({ enabled: true, authPath: auth.authPath, modelId: "gpt-6-sol",
    transport: Object.assign(async () => { dispatches++; return new Response(null, { status: 503 }); }, { preconnect: () => {} }) });
  const adapter = createAssessmentAdapter({ runner });
  try {
    for (const fields of [
      { hazardousContact: "yes" as const },
      { polymer: "구리", description: "구리 스크랩, 납으로 오염" },
    ]) {
      const hazard = { ...input, ...fields };
      const baseline = await createResourceDomain(hazard).decide();
      assert.equal(baseline.state, "needs-review");
      const result = await adapter.evaluate(hazard, live());
      assert.deepEqual(result.decision, presentAssessmentDecision(baseline));
      assert.equal(result.execution, undefined);
      assert.equal(result.modelAudit, undefined);
    }
    assert.equal(dispatches, 0);
  } finally { adapter.dispose(); await adapter.settled(); await auth.close(); }
});

test("default launcher uses subscription and returns clean 503 when SDK credentials are missing", { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "subscription-launcher-"));
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const address = reservation.address(); assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(address.port), RESOURCE_AUTH_PATH: join(root, "auth.json") };
  delete env["RESOURCE_MODEL_RUNNER"]; delete env["RESOURCE_MODEL_ID"]; delete env["RESOURCE_PUBLIC_ORIGIN"];
  const child = spawn(process.execPath, [fileURLToPath(new URL("../scripts/app.ts", import.meta.url))],
    { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  const exited = new Promise<number | null>((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
  let output = "";
  const ready = new Promise<void>((resolve) => child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString(); if (output.includes("Re:Source app:")) resolve();
  }));
  try {
    await Promise.race([ready, exited.then(() => { throw new Error("launcher exited before readiness"); })]);
    const origin = `http://localhost:${address.port}`;
    const home = await fetch(origin);
    const cookie = home.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie);
    const { caseId: _id, ...fields } = input;
    const response = await fetch(origin + "/cases", { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(fields) });
    assert.equal(response.status, 503);
    assert.match(await response.text(), /모델 연결이 설정되지 않았습니다/);
    const readiness = await fetch(origin + "/operations/readiness");
    const body: unknown = await readiness.json();
    assert.ok(typeof body === "object" && body !== null && "mode" in body);
    assert.equal(body.mode, "model-runner");
  } finally {
    child.kill("SIGTERM"); assert.equal(await exited, 0);
    await rm(root, { recursive: true, force: true });
  }
});

test("launcher behind an HTTPS proxy uses the configured browser origin for operator login, logout and secure cookies", { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "subscription-public-origin-"));
  const proxyOrigin = "https://resource.example.test";
  const credentials = { username: "operator", password: "local synthetic public origin fixture" };
  const db = await openRuntimeDatabase(root);
  try { await createLocalAuth(db, { origin: proxyOrigin }).create(credentials.username, credentials.password); }
  finally { db.close(); }
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, "127.0.0.1", resolve));
  const address = reservation.address(); assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const loopback = `http://localhost:${address.port}`;
  const child = spawn(process.execPath, [fileURLToPath(new URL("../scripts/app.ts", import.meta.url))], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"], env: {
      PATH: process.env["PATH"], HOME: root, PORT: String(address.port), RESOURCE_PUBLIC_ORIGIN: proxyOrigin,
      RESOURCE_APP_AUTH: "local-operator", RESOURCE_STATE_DIR: root, RESOURCE_AUTH_PATH: join(root, "missing-auth.json"),
    },
  });
  const exited = new Promise<number | null>((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
  let output = "";
  const ready = new Promise<void>(resolve => child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString(); if (output.includes("Re:Source app:")) resolve();
  }));
  try {
    await Promise.race([ready, exited.then(() => { throw new Error("launcher exited before readiness"); })]);
    const login = (origin: string) => fetch(loopback + "/login", { method: "POST", redirect: "manual",
      headers: { origin, "content-type": "application/json" }, body: JSON.stringify(credentials) });
    assert.equal((await login(loopback)).status, 403);
    const logged = await login(proxyOrigin);
    assert.equal(logged.status, 303);
    const setCookie = logged.headers.get("set-cookie");
    assert.ok(setCookie);
    assert.match(setCookie, /^__Host-resource_operator=[a-f0-9]{64}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=3600; Secure$/);
    const cookie = setCookie.split(";", 1)[0]; assert.ok(cookie);
    assert.equal((await fetch(loopback + "/cases", { headers: { cookie } })).status, 200);
    const health = await fetch(loopback + "/health");
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { app: "ready" });
    const logout = await fetch(loopback + "/logout", { method: "POST", redirect: "manual", headers: { origin: proxyOrigin, cookie } });
    assert.equal(logout.status, 303);
    assert.equal(logout.headers.get("set-cookie"), "__Host-resource_operator=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Secure");
    assert.equal((await fetch(loopback + "/cases", { headers: { cookie } })).status, 403);
  } finally {
    child.kill("SIGTERM");
    try { assert.equal(await exited, 0); } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("direct subscription launcher uses the injected transport for a stored browser result", { timeout: 15000 }, async () => {
  const auth = await fixture();
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, "127.0.0.1", resolve));
  const address = reservation.address(); assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(address.port),
    RESOURCE_MODEL_RUNNER: "subscription", RESOURCE_MODEL_ID: "gpt-6-sol",
    RESOURCE_AUTH_PATH: auth.authPath, RESOURCE_APP_AUTH: "anonymous", RESOURCE_PRIVATE_PHOTOS: "off" };
  for (const key of ["RESOURCE_OPERATIONAL_CONFIG", "RESOURCE_STATE_DIR", "RESOURCE_RESOURCES_DIR",
    "RESOURCE_SUBSCRIPTION_ROUTE"]) delete env[key];
  const child = spawn(process.execPath, [fileURLToPath(new URL("./o-launcher-child.ts", import.meta.url)),
    "direct", JSON.stringify(input)], { cwd: fileURLToPath(new URL("..", import.meta.url)), env, stdio: ["ignore", "pipe", "pipe"] });
  const exited = new Promise<number | null>((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
  let output = "";
  const ready = new Promise<void>(resolve => child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString(); if (output.includes("Re:Source app:")) resolve();
  }));
  try {
    await Promise.race([ready, exited.then(() => { throw new Error("launcher exited before readiness"); })]);
    const origin = `http://localhost:${address.port}`;
    const home = await fetch(origin);
    const cookie = home.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie);
    const { caseId: _id, ...fields } = input;
    const response = await fetch(origin + "/cases", { method: "POST", redirect: "manual",
      headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(fields) });
    assert.equal(response.status, 303);
    const location = response.headers.get("location"); assert.ok(location);
    const result = await fetch(origin + location, { headers: { cookie } });
    assert.equal(result.status, 200);
    const html = await result.text();
    assert.match(html, /synthetic-http/);
    // The synthetic provider supplies only the assessment proposal, without
    // verified route evidence; the host must retain its review state.
    assert.match(html, /<h1>검토 필요<\/h1>/);
    assert.doesNotMatch(html, /aria-label="추천 경로 순위"/);
    assert.match(output, /transport/);
  } finally {
    child.kill("SIGTERM"); assert.equal(await exited, 0);
    await auth.close();
  }
});
