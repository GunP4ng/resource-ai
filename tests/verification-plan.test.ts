import assert from "node:assert/strict";
import { test } from "node:test";
import type { DecisionResult } from "../src/contracts.ts";
import { createVerificationCandidates, presentAssessmentDecision } from "../src/o-verification-plan-candidates.ts";
import { createVerificationPlan, parseVerificationPlan } from "../src/o-verification-plan.ts";
import { revision } from "../src/o-validation.ts";
import { syntheticCase } from "./h-fixtures.ts";

test("candidate extraction deduplicates host fields and reports every omitted bounded item", () => {
  const reasons = ["same check", "x".repeat(2049), ...Array.from({ length: 14 }, (_, i) => `check ${i}`)];
  const decision: DecisionResult = { state: "needs-review", caseId: syntheticCase.caseId, evidence: [],
    reasons, preExecutionChecks: ["same check", "last check"] };
  const candidates = createVerificationCandidates(revision(syntheticCase), decision);
  assert.deepEqual(candidates.items.map(item => item.text), ["same check", ...reasons.slice(2, 13)]);
  assert.equal(candidates.candidateCount, 17);
  assert.equal(candidates.offeredCount, 12);
  assert.equal(candidates.omittedCount, 5);
  assert.equal(candidates.textLimit, 2048);
  assert.equal(new Set(candidates.items.map(item => item.id)).size, 12);
});

test("internal answer syntax is excluded while IDs bind the final presented decision", () => {
  const decision: DecisionResult = { state: "needs-information", caseId: syntheticCase.caseId, evidence: [], questions: ["host question"] };
  const final = presentAssessmentDecision(decision);
  const candidates = createVerificationCandidates(revision(syntheticCase), final);
  assert.deepEqual(candidates.items.map(item => item.text), ["host question"]);
  assert.equal(candidates.decisionRevision, revision(final));
  assert.notEqual(candidates.decisionRevision, revision(decision));
  const changed = createVerificationCandidates(revision({ ...syntheticCase, massKg: 1 }), final);
  assert.notEqual(candidates.items[0]?.id, changed.items[0]?.id);
  assert.deepEqual(createVerificationCandidates(revision(syntheticCase), final), candidates);
});

test("stored selections cannot rewrite host text, source, order binding, status or bounds", () => {
  const decision: DecisionResult = { state: "needs-review", caseId: syntheticCase.caseId, evidence: [],
    reasons: ["first", "second"], preExecutionChecks: ["third"] };
  const candidates = createVerificationCandidates(revision(syntheticCase), decision);
  const selectedIds = candidates.items.map(item => item.id).reverse();
  const plan = createVerificationPlan(syntheticCase, decision, { raw: { selectedIds }, origin: "runner-output", baseMatches: true });
  assert.deepEqual(plan.selected.map(item => item.text), ["third", "second", "first"]);
  assert.deepEqual(parseVerificationPlan(plan, decision), plan);
  const first = plan.selected[0];
  assert.ok(first);
  for (const changed of [
    { ...plan, selected: [{ ...first, text: "invented permit" }] },
    { ...plan, selected: [{ ...first, source: "question" }] },
    { ...plan, selected: [...plan.selected].reverse() },
    { ...plan, selected: [first, first] },
    { ...plan, candidateCount: 999 },
    { ...plan, decisionRevision: "0".repeat(64) },
    { ...plan, inputRevision: "0".repeat(64) },
    { ...plan, status: "rejected" },
    { ...plan, rejectionReason: "invalid-plan-shape" },
    { ...plan, rawReasoning: "untrusted" },
  ]) assert.throws(() => parseVerificationPlan(changed, decision));
});
