import { Value } from "typebox/value";
import type { CaseInput, DecisionResult } from "./contracts.ts";
import { requireValid, revision } from "./o-validation.ts";
import { createVerificationCandidates } from "./o-verification-plan-candidates.ts";
import { VerificationPlanProposalSchema, VerificationPlanSchema, type VerificationPlan } from "./o-verification-plan-schema.ts";
import { isHostSafetyReason } from "./o-safety-reasons.ts";
export type { VerificationPlan, VerificationPlanProposal, VerificationCandidates } from "./o-verification-plan-schema.ts";

/** Effective server order. Never rewrite the model's stored selection or the decision. */
export function hostVerificationOrder(decision: DecisionResult, plan?: VerificationPlan) {
  const held = decision.state === "needs-review" ? decision.reasons
    : decision.state === "needs-information" ? decision.questions : [];
  const safety = [...new Set(held.filter(isHostSafetyReason))];
  const following = plan?.status === "validated-selection"
    ? plan.selected.filter(item => !safety.includes(item.text)) : [];
  return { safety, following };
}

/** The caller obtains origin from the private runner WeakMap, never from proposal fields. */
export function createVerificationPlan(input: CaseInput, decision: DecisionResult, submission: {
  readonly raw: unknown;
  readonly origin: VerificationPlan["origin"];
  readonly baseMatches: boolean;
}): VerificationPlan {
  const { items, ...binding } = createVerificationCandidates(revision(input), decision);
  const raw = submission.raw;
  const validShape = Value.Check(VerificationPlanProposalSchema, raw);
  const selected = validShape ? raw.selectedIds.flatMap(id => items.filter(item => item.id === id)) : [];
  const rejectionReason = !submission.baseMatches ? "base-proposal-mismatch"
    : !validShape ? "invalid-plan-shape"
    : selected.length !== raw.selectedIds.length ? "candidate-binding-mismatch" : null;
  return { version: 1, ...binding, origin: submission.origin,
    status: rejectionReason === null ? "validated-selection" : "rejected", rejectionReason,
    validationScope: "current-candidate-selection-only", selected: rejectionReason === null ? selected : [],
    proposalSha256: revision(raw) };
}

/** Closed private storage contract; reconstruct known text and IDs from the bound host decision. */
export function parseVerificationPlan(raw: unknown, decision: DecisionResult): VerificationPlan {
  requireValid(Value.Check(VerificationPlanSchema, raw), "invalid-verification-plan");
  const { items, ...binding } = createVerificationCandidates(raw.inputRevision, decision);
  const { caseId, inputRevision, decisionRevision, candidateCount, offeredCount, omittedCount, candidateLimit, textLimit, selectionLimit } = raw;
  requireValid(revision(binding) === revision({ caseId, inputRevision, decisionRevision, candidateCount, offeredCount,
    omittedCount, candidateLimit, textLimit, selectionLimit }), "verification-plan-binding-mismatch");
  requireValid(new Set(raw.selected.map(item => item.id)).size === raw.selected.length
    && raw.selected.every(item => items.some(known => revision(known) === revision(item))), "verification-plan-selection-mismatch");
  requireValid(raw.status === "validated-selection"
    ? raw.rejectionReason === null && raw.proposalSha256 === revision({ selectedIds: raw.selected.map(item => item.id) })
    : raw.rejectionReason !== null && raw.selected.length === 0, "verification-plan-status-mismatch");
  return structuredClone(raw);
}
