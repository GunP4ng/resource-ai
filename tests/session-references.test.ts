import assert from "node:assert/strict";
import { test } from "node:test";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { createAssessmentAdapter, createAzureRunner, openCaseSession, SessionFailure } from "../src/session.ts";
import { createResourceDomain } from "../src/domain.ts";
import { syntheticCase, syntheticReviewed } from "./h-fixtures.ts";
import { createDecisionReferences } from "../src/decision-references.ts";
import { providerRequestId } from "../src/session.ts";

const input = { ...syntheticCase, caseId: "synthetic-decision-reference" };
const env = { AZURE_OPENAI_API_KEY: "synthetic-only", AZURE_OPENAI_BASE_URL: "https://synthetic.openai.azure.com", AZURE_OPENAI_DEPLOYMENT_NAME_MAP: "gpt-4.1=synthetic" };
const signal = () => new AbortController().signal;
function mockedRunner(final: (reference: unknown) => unknown = reference => ({ decisionReference: reference }), onReference = (_value: unknown) => {}) {
  return createAzureRunner({ enabled: true, env }, async (facts, options) => {
    const owned = await openCaseSession(facts, options);
    let calls = 0;
    owned.session.agent.streamFunction = (_model, context, config) => {
      void config?.onResponse?.({ status: 200, headers: { "x-oai-request-id": "synthetic-oai-request" } }, _model);
      const tool = context.messages.findLast(message => message.role === "toolResult");
      const text = tool?.content.find(part => part.type === "text");
      const result = text?.type === "text" ? JSON.parse(text.text) : undefined;
      if (result) { assert.ok(result.decisionReference); onReference(result.decisionReference); }
      const message: AssistantMessage = { role: "assistant", api: "azure-openai-responses", provider: "azure-openai-responses", model: "gpt-4.1", timestamp: Date.now(),
        content: calls++ === 0 ? [{ type: "toolCall", id: "synthetic-reference-call", name: "resource_assess_case", arguments: {} }]
          : [{ type: "text", text: JSON.stringify(final(result.decisionReference)) }],
        stopReason: result ? "stop" : "toolUse", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const stream = createAssistantMessageEventStream(); stream.push({ type: "done", reason: result ? "stop" : "toolUse", message }); return stream;
    };
    return owned;
  });
}

test("a model can return an issued small reference without rewriting any host comparison fields", async () => {
  const resources = syntheticReviewed(input), expected = await createResourceDomain(input, resources).decide();
  const result = await mockedRunner()(input, signal(), resources);
  assert.deepEqual(result.proposal, expected);
  assert.equal(result.execution?.traceId, "azure:synthetic-oai-request");
});

test("changed receipt hash, case, token or extra fields are invalid model output", async () => {
  for (const change of [
    (ref: Record<string, unknown>) => ({ ...ref, sha256: "0".repeat(64) }),
    (ref: Record<string, unknown>) => ({ ...ref, caseId: "different-case" }),
    (ref: Record<string, unknown>) => ({ ...ref, token: "forged-token" }),
    (ref: Record<string, unknown>) => ({ ...ref, approved: true }),
  ]) {
    await assert.rejects(mockedRunner(ref => ({ decisionReference: change(ref as Record<string, unknown>) }))(input, signal(), syntheticReviewed(input)),
      (error: unknown) => error instanceof SessionFailure && error.code === "invalid-model-output");
  }
});

test("another session cannot borrow a closed session receipt even for identical input and resources", async () => {
  let previous: unknown;
  await mockedRunner(undefined, ref => { previous = structuredClone(ref); })(input, signal(), syntheticReviewed(input));
  await assert.rejects(mockedRunner(() => ({ decisionReference: previous }))(input, signal(), syntheticReviewed(input)),
    (error: unknown) => error instanceof SessionFailure && error.code === "invalid-model-output");
});

test("reference resolution retains missing facts and existing host gates", async () => {
  const { caseId: _case, ...fields } = { ...input, massKg: null };
  const adapter = createAssessmentAdapter({ runner: mockedRunner() });
  try {
    const result = await adapter.submit(fields, signal());
    assert.ok("decision" in result); assert.equal(result.decision.state, "needs-information");
    if (result.decision.state === "needs-information") assert.ok(result.decision.questions.some(question => question.includes("질량")));
  } finally { adapter.dispose(); }
});

test("receipts cannot carry an extra model decision or authorize a result after disposal", async () => {
  await assert.rejects(mockedRunner(ref => ({ decisionReference: ref, decision: { state: "compared" } }))(input, signal(), syntheticReviewed(input)),
    (error: unknown) => error instanceof SessionFailure && error.code === "invalid-model-output");
  const references = createDecisionReferences(input.caseId);
  const decision = await createResourceDomain(input, syntheticReviewed(input)).decide();
  const ref = references.issue(decision);
  const resolved = references.resolve({ decisionReference: ref });
  if (resolved.state === "compared") Reflect.set(resolved, "humanApproval", "approved");
  assert.deepEqual(references.resolve({ decisionReference: ref }), decision);
  references.close();
  assert.throws(() => references.resolve({ decisionReference: ref }), /invalid-decision-reference/);
  assert.throws(() => references.issue(decision), /invalid-decision-reference/);
});

test("photo-reference sessions keep their existing full observation decision contract", async () => {
  const owned = await openCaseSession({ ...input, photoRefs: ["synthetic-reference-only"] });
  try { assert.equal(owned.resolveDecisionReference, undefined); }
  finally { await owned.close(); }
});

test("request ID headers retain existing precedence and reject private or malformed values", () => {
  assert.equal(providerRequestId(new Headers({ "x-request-id": "existing", "x-oai-request-id": "new" })), "existing");
  assert.equal(providerRequestId({ "apim-request-id": "azure", "x-oai-request-id": "new" }), "azure");
  for (const value of ["someone@example.org", "Bearer secret", "a".repeat(101)]) assert.equal(providerRequestId({ "x-oai-request-id": value }), undefined);
});
