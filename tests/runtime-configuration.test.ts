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
  test(`${mode} home makes no success claim and an unavailable review creates no case`, async () => {
    const origin = "http://localhost:3000", cases = createCaseStore();
    let transportCalls = 0, evaluations = 0;
    const transport = Object.assign(async () => {
      transportCalls++;
      assert.fail("unavailable runner must not dispatch");
    }, { preconnect: () => {} });
    const disabledRunner = createSubscriptionRunner({ enabled: false, transport });
    const app = createOperationalApp({ origin, caseStore: cases, actorForRequest: async () => "runtime-owner",
      ...(mode === "model-runner" ? { runner: (...args: Parameters<typeof disabledRunner>) => {
        evaluations++;
        return disabledRunner(...args);
      } } : {}) });
    const { caseId: _id, photoRefs: _photos, ...fields } = syntheticCase;
    try {
      const home = await app.fetch(new Request(origin));
      assert.equal(home.status, 200);
      const html = await home.text();
      assert.doesNotMatch(html, /검토 준비 완료|검토할 준비가 됐습니다|입력을 받아 검토할 준비/);
      assert.match(html, /제출하면 검토 결과나 연결 상태를 알려드립니다/);
      assert.equal(html.includes("지금은 검토에 연결할 수 없습니다"), mode === "unconfigured");
      assert.equal(evaluations, 0);
      const response = await app.fetch(new Request(origin + "/cases", { method: "POST", headers: { origin },
        body: new URLSearchParams(Object.entries(fields).map(([name, value]) => [name, String(value ?? "")])) }));
      assert.equal(response.status, 503);
      assert.deepEqual(cases.list("actor:runtime-owner"), []);
      const readiness = await app.fetch(new Request(origin + "/operations/readiness"));
      assert.equal((await readiness.json()).mode, mode);
      assert.equal(transportCalls, 0);
      assert.equal(evaluations, mode === "model-runner" ? 1 : 0);
    } finally { app.dispose(); await app.close(); cases.dispose(); }
  });
}
