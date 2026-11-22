import assert from "node:assert/strict";
import { test } from "node:test";
import { createAssessmentAdapter, createSubscriptionRunner, SessionFailure } from "../src/session.ts";
import { createOperationalApp } from "../src/operations.ts";
import { createCaseStore } from "../src/o-case-store.ts";
import { syntheticCase } from "./h-fixtures.ts";
import { startApp } from "../scripts/app.ts";

test("launcher rejects the removed local runner before opening runtime storage", async () => {
  const before = process.env["RESOURCE_MODEL_RUNNER"];
  process.env["RESOURCE_MODEL_RUNNER"] = "local";
  try { await assert.rejects(startApp(), { name: "RangeError", message: "Invalid RESOURCE_MODEL_RUNNER" }); }
  finally {
    if (before === undefined) delete process.env["RESOURCE_MODEL_RUNNER"];
    else process.env["RESOURCE_MODEL_RUNNER"] = before;
  }
});

test("missing runner rejects evaluation without manufacturing a host-only successful result", async () => {
  const adapter = createAssessmentAdapter();
  try {
    await assert.rejects(adapter.evaluate(syntheticCase, new AbortController().signal),
      error => error instanceof SessionFailure && error.code === "not-configured");
  } finally { adapter.dispose(); await adapter.settled(); }
});

for (const mode of ["unconfigured", "model-runner"] as const) {
  test(`${mode} home describes the submission outcome and preserves 503`, async () => {
    const origin = "http://localhost:3000", cases = createCaseStore();
    let dispatches = 0, evaluations = 0;
    const subscription = createSubscriptionRunner({ enabled: false, transport: async () => {
      dispatches++;
      assert.fail("unexpected subscription transport");
    } });
    const app = createOperationalApp({
      origin, caseStore: cases, actorForRequest: async () => "runtime-owner",
      ...(mode === "model-runner" ? {
        runtime: { identity: "trusted", storage: "ephemeral", runner: "subscription" },
        runner: (...args) => { evaluations++; return subscription(...args); },
      } : {}),
    });
    const { caseId: _id, photoRefs: _photos, ...fields } = syntheticCase;
    try {
      const home = await app.fetch(new Request(origin));
      assert.equal(home.status, 200);
      const html = await home.text();
      assert.equal(evaluations, 0);
      const response = await app.fetch(new Request(origin + "/cases", { method: "POST", headers: { origin },
        body: new URLSearchParams(Object.entries(fields).map(([name, value]) => [name, String(value ?? "")])) }));
      assert.equal(response.status, 503);
      assert.deepEqual(cases.list("actor:runtime-owner"), []);
      const readiness = await app.fetch(new Request(origin + "/operations/readiness"));
      assert.equal((await readiness.json()).mode, mode);
      assert.equal(dispatches, 0);
      if (mode === "model-runner") {
        assert.equal(evaluations, 1);
        assert.ok(html.includes("구성된 실행기 구독 경로 모델 실행 · 실행 성공은 평가 후 확인하세요."));
      }
      assert.ok(html.includes('<p class="notice">사례 정보를 입력하세요. 제출하면 검토 결과 또는 실행 연결 상태를 안내합니다.</p>'));
      assert.ok(!html.includes("입력을 받아 검토할 준비가 됐습니다."));
    } finally { app.dispose(); await app.close(); cases.dispose(); }
  });
}
