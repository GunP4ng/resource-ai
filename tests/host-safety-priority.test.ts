import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaseInput, DecisionResult } from "../src/contracts.ts";
import { createResourceDomain } from "../src/domain.ts";
import { createVerificationCandidates, presentAssessmentDecision } from "../src/o-verification-plan-candidates.ts";
import { createVerificationPlan, hostVerificationOrder } from "../src/o-verification-plan.ts";
import { safetyReasons } from "../src/o-safety-reasons.ts";
import { canonical, revision } from "../src/o-validation.ts";
import { buildCaseGuidance } from "../src/o-case-guidance.ts";
import { renderReport } from "../src/report.ts";
import { syntheticCase } from "./h-fixtures.ts";

test("host pins reported hazard before a contrary model order and preserves its raw selection", async () => {
  const input = { ...syntheticCase, hazardousContact: "yes" as const };
  const decision = presentAssessmentDecision(await createResourceDomain(input).decide());
  const candidates = createVerificationCandidates(revision(input), decision);
  const safety = candidates.items.find(item => item.text === safetyReasons.contactClassification);
  const other = candidates.items.find(item => item.text !== safetyReasons.contactClassification);
  assert.ok(safety && other);
  const plan = createVerificationPlan(input, decision, { raw: { selectedIds: [other.id, safety.id] },
    origin: "model-output", baseMatches: true });
  const before = canonical({ decision, plan });
  const order = hostVerificationOrder(decision, plan);
  assert.ok(order.safety.includes(safetyReasons.contactClassification));
  assert.deepEqual(order.following.map(item => item.id), [other.id]);
  assert.deepEqual(plan.selected.map(item => item.id), [other.id, safety.id]);
  assert.equal(canonical({ decision, plan }), before);
});

test("safety omitted by the model or the offered-candidate limit is still pinned", () => {
  const input: CaseInput = { ...syntheticCase, hazardousContact: "unknown" };
  const decision: DecisionResult = { state: "needs-information", caseId: input.caseId, evidence: [],
    questions: [...Array.from({ length: 13 }, (_, i) => `일반 확인 ${i + 1}`), safetyReasons.contactUnknown] };
  const candidates = createVerificationCandidates(revision(input), decision);
  assert.equal(candidates.items.some(item => item.text === safetyReasons.contactUnknown), false);
  const first = candidates.items[0];
  assert.ok(first);
  const plan = createVerificationPlan(input, decision, { raw: { selectedIds: [first.id] },
    origin: "model-output", baseMatches: true });
  assert.deepEqual(hostVerificationOrder(decision, plan).safety, [safetyReasons.contactUnknown]);
  assert.deepEqual(hostVerificationOrder(decision, plan).following.map(item => item.id), [first.id]);
});

test("reported hazardous contact keeps host safety first when contamination is 미상", async () => {
  const input = { ...syntheticCase, assessmentDate: "2026-11-25", massKg: 100,
    hazardousContact: "yes", contamination: " 미상 " } as const;
  const decision = presentAssessmentDecision(await createResourceDomain(input).decide());
  assert.equal(decision.state, "needs-review");
  const order = hostVerificationOrder(decision);
  assert.equal(order.safety[0], safetyReasons.contactClassification);
  assert.ok(order.safety.includes(safetyReasons.contaminationUnknown));
});

test("multiple host safety reasons form the first group even without a model plan", async () => {
  const input: CaseInput = { ...syntheticCase, hazardousContact: "unknown", contamination: "이전 내용물 미확인",
    description: "지정폐기물 의심 입력의 합성 사례" };
  const decision = presentAssessmentDecision(await createResourceDomain(input).decide());
  const order = hostVerificationOrder(decision);
  assert.ok(order.safety.includes(safetyReasons.designatedSuspected));
  assert.ok(order.safety.includes(safetyReasons.contactUnknown));
  assert.ok(order.safety.includes(safetyReasons.contaminationUnknown));
  assert.deepEqual(order.following, []);
  const guidance = await buildCaseGuidance(input, decision);
  let firstKind: string | null = null, marker = 0, modelItems = 0, markerText = "";
  await new HTMLRewriter().on("[data-effective-verification-order] > li:first-child", {
    element(node) { firstKind = node.getAttribute("data-plan-source"); },
  }).on("[data-host-safety-priority]", { element() { marker++; }, text(chunk) { markerText += chunk.text; } })
    .on('[data-plan-source="model"]', { element() { modelItems++; } })
    .transform(new Response(renderReport(decision, { mode: "offline" }, {
      audience: "authenticated-research", research: null, guidance,
    }))).text();
  assert.equal(firstKind, "host-safety");
  assert.equal(marker, 1);
  assert.ok(markerText.includes("안전 사유를 1번에 둠"));
  assert.equal(modelItems, 0);
});

test("an ordinary current result does not acquire a fabricated safety reason", async () => {
  const input = { ...syntheticCase, description: "합성 PET. 유해물질 접촉 없음. 지정폐기물 해당 없음." };
  const decision = await createResourceDomain(input).decide();
  assert.equal(decision.state, "compared");
  assert.deepEqual(hostVerificationOrder(decision), { safety: [], following: [] });
  const candidates = createVerificationCandidates(revision(input), decision);
  const selected = candidates.items.slice(0, 2).reverse();
  const plan = createVerificationPlan(input, decision, { raw: { selectedIds: selected.map(item => item.id) },
    origin: "model-output", baseMatches: true });
  assert.deepEqual(hostVerificationOrder(decision, plan), { safety: [], following: selected });
});

test("existing host exclusion and prohibition blockers remain safety-first", () => {
  const reasons = ["일반 자료 확인", "지정폐기물 제외: 미충족",
    "처리 기준: 법령상 명백히 금지", "법령 근거 확인 필요: hazardous-contact-unconfirmed (registered-source)"];
  const decision: DecisionResult = { state: "needs-review", caseId: syntheticCase.caseId, evidence: [], reasons };
  assert.deepEqual(hostVerificationOrder(decision).safety, reasons.slice(1));
});
