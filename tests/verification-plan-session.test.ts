import assert from "node:assert/strict";
import { test } from "node:test";
import { Value } from "typebox/value";
import type { CaseInput, DecisionResult } from "../src/contracts.ts";
import { createAssessmentAdapter, createAzureRunner, SessionFailure, type CaseRunner } from "../src/session.ts";
import { createResourceDomain } from "../src/domain.ts";
import { parseDecision } from "../src/o-decision.ts";
import { parseAssessment } from "../src/o-case-store.ts";
import { VerificationCandidatesSchema, type VerificationCandidates } from "../src/o-verification-plan-schema.ts";
import { createVerificationCandidates, presentAssessmentDecision } from "../src/o-verification-plan-candidates.ts";
import { revision } from "../src/o-validation.ts";
import { syntheticCase } from "./h-fixtures.ts";

const input = { ...syntheticCase, caseId: "verification-wire" };
const signal = () => new AbortController().signal;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
type ToolResult = { readonly decision: DecisionResult; readonly reference: unknown; readonly candidates: VerificationCandidates };
function sse(item: unknown) {
  const events = [{ type: "response.output_item.added", output_index: 0, item },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: { id: "resp_verification", status: "completed", output: [item],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }];
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream", "x-request-id": "synthetic-verification" } });
}
function wireRunner(final: (tool: ToolResult) => unknown): CaseRunner {
  return createAzureRunner({ enabled: true, env: { AZURE_OPENAI_API_KEY: "synthetic-only",
    AZURE_OPENAI_BASE_URL: "https://synthetic.openai.azure.com", AZURE_OPENAI_DEPLOYMENT_NAME_MAP: "gpt-4.1=synthetic" },
    transport: async (_url, init) => {
      const body: unknown = JSON.parse(String(init?.body));
      assert.ok(record(body) && Array.isArray(body["input"]));
      const output = body["input"].findLast((item: unknown) => record(item) && item["type"] === "function_call_output");
      if (!output) return sse({ type: "function_call", id: "fc_verification", call_id: "verification_call",
        name: "resource_assess_case", arguments: "{}", status: "completed" });
      assert.ok(record(output));
      const content = output["output"];
      const text = typeof content === "string" ? content : Array.isArray(content)
        ? content.filter(record).map(part => part["text"]).join("") : undefined;
      assert.equal(typeof text, "string");
      const raw: unknown = JSON.parse(String(text));
      assert.ok(record(raw) && Value.Check(VerificationCandidatesSchema, raw["verificationCandidates"]));
      const value = final({ decision: parseDecision(raw["decision"]), reference: raw["decisionReference"], candidates: raw["verificationCandidates"] });
      return sse({ type: "message", id: "msg_verification", role: "assistant", status: "completed",
        content: [{ type: "output_text", text: JSON.stringify(value), annotations: [] }] });
    } });
}
async function evaluate(runner?: CaseRunner, facts: CaseInput = input) {
  const adapter = createAssessmentAdapter({ runner });
  try { return await adapter.evaluate(facts, signal()); }
  finally { adapter.dispose(); }
}

for (const mode of ["reference", "direct", "held", "missing", "empty"] as const) {
  test(`real wire ${mode} selection preserves exact host safety and final revision`, async () => {
    const facts = mode === "held" ? { ...input, hazardousContact: "yes" as const }
      : mode === "missing" ? { ...input, polymer: null, process: null } : input;
    const host = await evaluate(undefined, facts);
    let expected: VerificationCandidates["items"] = [];
    const result = await evaluate(wireRunner(tool => {
      expected = mode === "empty" ? [] : tool.candidates.items.slice(0, 3).reverse();
      assert.equal(tool.candidates.decisionRevision, revision(host.decision));
      return { ...(mode === "direct" ? { decision: tool.decision } : { decisionReference: tool.reference }),
        verificationPlan: { selectedIds: expected.map(item => item.id) } };
    }), facts);
    assert.deepEqual(result.decision, host.decision);
    assert.deepEqual(result.verificationPlan?.selected, expected);
    assert.equal(result.verificationPlan?.status, "validated-selection");
    assert.equal(result.verificationPlan?.origin, mode === "direct" ? "model-output" : "host-decision-reference");
    assert.equal(result.verificationPlan?.decisionRevision, revision(result.decision));
    assert.equal(result.verificationPlan?.inputRevision, revision(facts));
    assert.deepEqual(parseAssessment(result), result);
    if (mode === "held") assert.equal(result.decision.state, "needs-review");
    if (mode === "missing") {
      assert.equal(result.decision.state, "needs-information");
      assert.deepEqual(expected.map(item => item.text).sort(), host.decision.state === "needs-information" ? host.decision.questions.slice(0, -1).sort() : []);
    }
  });
}

for (const mode of ["duplicate", "unknown", "cross-case", "old-input", "old-decision", "overbound", "rationale", "null"] as const) {
  test(`bad ${mode} advisory plan is rejected without changing the actual decision`, async () => {
    const host = await evaluate();
    const result = await evaluate(wireRunner(tool => {
      const ids = tool.candidates.items.map(item => item.id);
      assert.ok(ids[0]);
      const changed = mode === "cross-case" ? { ...host.decision, caseId: "other-case" }
        : mode === "old-decision" && host.decision.state === "compared" ? { ...host.decision, limitations: ["different decision"] } : host.decision;
      const other = createVerificationCandidates(mode === "old-input" ? "0".repeat(64) : revision(input), changed);
      const selectedIds = mode === "duplicate" ? [ids[0], ids[0]] : mode === "unknown" ? [`vp_${"0".repeat(64)}`]
        : mode === "overbound" ? [...ids, ...ids].slice(0, 4) : ["cross-case", "old-input", "old-decision"].includes(mode)
          ? other.items.slice(0, 1).map(item => item.id) : [ids[0]];
      return { decisionReference: tool.reference, verificationPlan: mode === "null" ? null
        : { selectedIds, ...(mode === "rationale" ? { rationale: "unknown-private-claim" } : {}) } };
    }));
    assert.deepEqual(result.decision, host.decision);
    assert.equal(result.verificationPlan?.status, "rejected");
    assert.equal(result.verificationPlan?.rejectionReason, ["unknown", "cross-case", "old-input", "old-decision"].includes(mode)
      ? "candidate-binding-mismatch" : "invalid-plan-shape");
    assert.deepEqual(result.verificationPlan?.selected, []);
    assert.equal(JSON.stringify(result.verificationPlan).includes("unknown-private-claim"), false);
    assert.deepEqual(parseAssessment(result), result);
  });
}

test("invalid base proposal keeps the existing hold even with a valid candidate selection", async () => {
  const result = await evaluate(wireRunner(tool => ({ decision: { ...tool.decision, caseId: "another-case" },
    verificationPlan: { selectedIds: tool.candidates.items.slice(0, 1).map(item => item.id) } })));
  const expected = await createResourceDomain(input).decide({ ...(await createResourceDomain(input).decide()), caseId: "another-case" });
  assert.deepEqual(result.decision, expected);
  assert.equal(result.verificationPlan?.rejectionReason, "base-proposal-mismatch");
  assert.equal(result.modelAudit?.validation.status, "validation-rejected");
});

test("tampered decision reference still fails the base runner contract", async () => {
  await assert.rejects(evaluate(wireRunner(tool => {
    assert.ok(record(tool.reference));
    return { decisionReference: { ...tool.reference, sha256: "0".repeat(64) }, verificationPlan: { selectedIds: [] } };
  })), error => error instanceof SessionFailure && error.code === "invalid-model-output");
});

test("reference-only, direct legacy and local outputs never manufacture a plan", async () => {
  for (const runner of [undefined, wireRunner(tool => ({ decisionReference: tool.reference })), wireRunner(tool => tool.decision)]) {
    const result = await evaluate(runner);
    assert.equal(result.verificationPlan, undefined);
    assert.equal(parseAssessment(result).verificationPlan, undefined);
  }
});

test("custom runner origin claims cannot impersonate privately attested model selection", async () => {
  const result = await evaluate(async facts => {
    const proposal = await createResourceDomain(facts).decide();
    const candidates = createVerificationCandidates(revision(facts), presentAssessmentDecision(proposal));
    return { proposal, verificationPlan: { selectedIds: candidates.items.slice(0, 1).map(item => item.id) },
      origin: "model-output", modelAudit: { origin: "host-decision-reference" } };
  });
  assert.equal(result.verificationPlan?.status, "validated-selection");
  assert.equal(result.verificationPlan?.origin, "runner-output");
});
