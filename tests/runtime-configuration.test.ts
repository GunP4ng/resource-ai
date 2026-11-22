import assert from "node:assert/strict";
import { test } from "node:test";
import { createAssessmentAdapter, SessionFailure } from "../src/session.ts";
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

test("unconfigured application returns 503 and publishes no case", async () => {
  const origin = "http://localhost:3000", cases = createCaseStore();
  const app = createOperationalApp({ origin, caseStore: cases, actorForRequest: async () => "runtime-owner" });
  const { caseId: _id, ...fields } = syntheticCase;
  try {
    const response = await app.fetch(new Request(origin + "/cases", { method: "POST",
      headers: { origin, "content-type": "application/json" }, body: JSON.stringify(fields) }));
    assert.equal(response.status, 503);
    assert.deepEqual(cases.list("actor:runtime-owner"), []);
    const readiness = await app.fetch(new Request(origin + "/operations/readiness"));
    assert.equal((await readiness.json()).mode, "unconfigured");
  } finally { app.dispose(); await app.close(); cases.dispose(); }
});
