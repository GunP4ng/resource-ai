import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { ModelRuntime } from "@code-yeongyu/senpi";
import { createAssessmentAdapter, createSubscriptionRunner, openCaseSession, SessionFailure } from "../src/session.ts";
import { decideCase } from "../src/assessment.ts";
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
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "subscription-test-"));
  const authPath = join(root, "auth.json");
  // Fabricated OAuth credential; all inference below uses an injected HTTP transport.
  const payload = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "synthetic-account" } })).toString("base64url");
  const runtime = await ModelRuntime.create({ authPath, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  assert.ok(runtime.authStorage);
  runtime.authStorage.set("chatgpt-subscription", {
    type: "oauth", access: `synthetic.${payload}.signature`, refresh: "synthetic-refresh", expires: Date.now() + 3_600_000,
  });
  return { authPath, close: () => rm(root, { recursive: true, force: true }) };
}

test("subscription rejects disabled, unknown model and missing credentials without Azure configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "subscription-test-"));
  try {
    for (const options of [{ enabled: false }, { enabled: true, modelId: "not-a-model" }, { enabled: true }]) {
      const runner = createSubscriptionRunner({ ...options, authPath: join(root, "auth.json"),
        transport: async () => { assert.fail("Unconfigured runner must not dispatch"); } });
      await assert.rejects(runner(input, live()), failure("not-configured"));
    }
    const controller = new AbortController(); controller.abort();
    await assert.rejects(createSubscriptionRunner({ enabled: true })(input, controller.signal), failure("cancelled"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const [status, code] of [[200, null], [401, "authentication"], [403, "authentication"], [429, "rate-limit"], [500, "provider"]] as const) {
  test(`subscription HTTP ${status} returns usage or sanitized failure and closes session`, async () => {
    const auth = await fixture(); let closed = false, requests = 0;
    const runner = createSubscriptionRunner({ enabled: true, authPath: auth.authPath, maxOutputTokens: 128,
      transport: async () => {
        requests++;
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

test("default launcher uses subscription and returns clean 503 when SDK credentials are missing", { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "subscription-launcher-"));
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const address = reservation.address(); assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(address.port), RESOURCE_AUTH_PATH: join(root, "auth.json") };
  delete env["RESOURCE_MODEL_RUNNER"]; delete env["RESOURCE_MODEL_ID"];
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
    assert.match(await response.text(), /실행 연결이 구성되지 않았습니다/);
    const readiness = await fetch(origin + "/operations/readiness");
    const body: unknown = await readiness.json();
    assert.ok(typeof body === "object" && body !== null && "mode" in body);
    assert.equal(body.mode, "model-runner");
  } finally {
    child.kill("SIGTERM"); assert.equal(await exited, 0);
    await rm(root, { recursive: true, force: true });
  }
});
