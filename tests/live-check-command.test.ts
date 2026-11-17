import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ModelRuntime } from "@code-yeongyu/senpi";
import { createHash } from "node:crypto";

const marker = "PRIVATE_DIAGNOSTIC_synthetic@example.invalid_synthetic-refresh";
if (process.env["H48_OWNED_WIRE_CHILD"] === "1") {
  // Preload affects only this owned subprocess. The shipped entry point is unchanged.
  if (process.env["H48_SDK_WIRE_CHILD"] === "historical") {
    const { mock } = await import("bun:test");
    const recommendation = await import("../src/recommendation.ts");
    const recommend = recommendation.recommend;
    mock.module("../src/recommendation.ts", () => ({ ...recommendation,
      recommend(...args: Parameters<typeof recommend>) {
        const { recommendations: _recommendations, ...historical } = recommend(...args);
        return historical;
      } }));
    process.env["H48_SDK_WIRE_CHILD"] = "normal";
    await import("./live-check.test.ts");
  } else {
  globalThis.fetch = Object.assign(async () => Response.json({ error: { message: marker } },
    { status: 429, headers: { "x-oai-request-id": "req_cli_owned" } }), { preconnect() {} });
  }
} else {
  for (const mode of ["normal", "siwc", "historical", "rate-limit"] as const) {
  test(`shipped CLI ${mode} writes one secret-free result through the SDK and app`, async () => {
    const root = mkdtempSync(join(tmpdir(), "live-check-command-owned-")), authPath = join(root, "auth.json");
    try {
      const runtime = await ModelRuntime.create({ authPath, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
      const identity = { issuer: "https://auth.openai.com", subject: "synthetic-verified-subject", clientId: "synthetic-client-A" };
      const payload = Buffer.from(JSON.stringify(mode === "siwc"
        ? { iss: identity.issuer, sub: identity.subject, client_id: identity.clientId,
          "https://api.openai.com/auth": { per_user_salt: "synthetic", encrypted_auth_metadata: "synthetic" } }
        : { "https://api.openai.com/auth": { chatgpt_account_id: "synthetic-account" } })).toString("base64url");
      assert.ok(runtime.authStorage);
      runtime.authStorage.set("chatgpt-subscription", { type: "oauth", access: `synthetic.${payload}.signature`,
        refresh: "synthetic-refresh", expires: Date.now() + 3600000, route: "siwc", planUsageEnabled: true, scopes: ["chatgpt.tokens.use.direct"],
        ...(mode === "siwc" ? identity : {}) });
      const success = mode === "normal" || mode === "siwc";
      const preload = success ? join(dirname(import.meta.filename), "live-check.test.ts") : import.meta.filename;
      const result = spawnSync(process.execPath, mode === "siwc"
        ? ["run", "--preload", preload, "live-check", "--subscription-route", "siwc", "--account-id-sha256", createHash("sha256").update(JSON.stringify([identity.issuer, identity.subject, identity.clientId])).digest("hex"), "--out", join(root, "results")]
        : ["--preload", preload, "scripts/live-check.ts", "--out", join(root, "results")], {
        env: { ...process.env, H48_OWNED_WIRE_CHILD: "1", H48_SDK_WIRE_CHILD: mode,
          ...(mode === "siwc" ? { BUN_OPTIONS: `${process.env["BUN_OPTIONS"] ?? ""} --preload=${preload}` } : {}),
          RESOURCE_AUTH_PATH: authPath, RESOURCE_MODEL_RUNNER: "subscription" },
        encoding: "utf8", timeout: 20000 });
      assert.equal(result.error, undefined); assert.equal(result.status, success ? 0 : 1, result.stdout + result.stderr);
      if (mode !== "siwc") assert.equal(result.stderr, "");
      assert.deepEqual(JSON.parse(result.stdout), { passed: success, live: true, exitCode: success ? 0 : 1 });
      const directories = readdirSync(join(root, "results")); assert.equal(directories.length, 1);
      const directory = directories[0]; assert.ok(directory);
      const report = readFileSync(join(root, "results", directory, "result.json"), "utf8");
      assert.doesNotMatch(report + result.stderr + result.stdout, /PRIVATE_DIAGNOSTIC|synthetic@example|synthetic-refresh|signature/);
      assert.ok(!report.includes(root));
      const parsed: unknown = JSON.parse(report); assert.ok(typeof parsed === "object" && parsed !== null && "cases" in parsed);
      assert.ok(Array.isArray(parsed.cases)); assert.equal(parsed.cases.length, 3);
      for (const item of parsed.cases.slice(0, 2)) {
        assert.equal(item.dispatches, mode === "rate-limit" ? 1 : 2);
        assert.equal(item.httpStatus, mode === "rate-limit" ? 429 : 303);
        if (success) {
          assert.equal(item.passed, true); assert.equal(item.reportVerified, true); assert.equal(item.failure, null);
        } else if (mode === "rate-limit") {
          assert.equal(item.failure, "rate-limit"); assert.deepEqual(item.requestIds, ["req_cli_owned"]);
        }
      }
      if (mode === "historical") {
        // Both host execution and committed result lack recommendations: equality
        // and report rendering alone cannot prove current live-check acceptance.
        assert.equal(parsed.cases[0].state, "compared");
        assert.equal(parsed.cases[0].reportVerified, true);
        assert.equal(parsed.cases[0].recommendationCount, 0);
        assert.equal(parsed.cases[0].preExecutionChecksPresent, true);
        assert.equal(parsed.cases[0].passed, false);
        assert.equal(parsed.cases[0].failure, "required-result-unverified");
        assert.equal(parsed.cases[1].state, "needs-information"); assert.equal(parsed.cases[1].passed, true);
        assert.equal(parsed.cases[2].passed, true); assert.equal(parsed.cases[2].priorStatePreserved, true);
      }
      assert.equal(parsed.cases[2].dispatches, 0); assert.equal(parsed.cases[2].httpStatus, 403);
      console.log(`OFFLINE_CLI_REPORT live=false mode=${mode} ${report.trim()}`);
      // External wire substitution cannot be detected by the production CLI. This is offline QA, never live evidence.
      console.log(`OFFLINE_CLI_QA live=false mode=${mode} exit=${result.status} stderr=${mode === "siwc" ? "package-script-echo" : "empty"} owned-auth-removed-in-finally`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  }
}
