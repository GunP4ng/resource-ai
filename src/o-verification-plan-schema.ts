import { Type, type Static } from "typebox";

export const verificationLimits = { candidates: 12, text: 2048, selections: 3 } as const;
const digest = Type.String({ pattern: "^[a-f0-9]{64}$" });
const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const candidateId = Type.String({ pattern: "^vp_[a-f0-9]{64}$" });
const candidate = Type.Object({
  id: candidateId,
  source: Type.Union([Type.Literal("question"), Type.Literal("reason"), Type.Literal("pre-execution-check")]),
  text: Type.String({ minLength: 1, maxLength: verificationLimits.text }),
}, { additionalProperties: false });
const binding = {
  caseId: Type.String({ minLength: 1, maxLength: 100 }),
  inputRevision: digest,
  decisionRevision: digest,
};
const bounds = {
  candidateCount: count, offeredCount: count, omittedCount: count,
  candidateLimit: Type.Literal(verificationLimits.candidates),
  textLimit: Type.Literal(verificationLimits.text),
  selectionLimit: Type.Literal(verificationLimits.selections),
};
export const VerificationCandidatesSchema = Type.Object({
  ...binding, ...bounds,
  items: Type.Array(candidate, { maxItems: verificationLimits.candidates }),
}, { additionalProperties: false });
export const VerificationPlanProposalSchema = Type.Object({
  selectedIds: Type.Array(candidateId, { maxItems: verificationLimits.selections, uniqueItems: true }),
}, { additionalProperties: false });
export const VerificationPlanSchema = Type.Object({
  version: Type.Literal(1), ...binding, ...bounds,
  origin: Type.Union([Type.Literal("model-output"), Type.Literal("host-decision-reference"), Type.Literal("runner-output")]),
  status: Type.Union([Type.Literal("validated-selection"), Type.Literal("rejected")]),
  rejectionReason: Type.Union([Type.Null(), Type.Literal("invalid-plan-shape"), Type.Literal("candidate-binding-mismatch"),
    Type.Literal("base-proposal-mismatch")]),
  validationScope: Type.Literal("current-candidate-selection-only"),
  selected: Type.Array(candidate, { maxItems: verificationLimits.selections }),
  proposalSha256: digest,
}, { additionalProperties: false });
export type VerificationCandidates = Static<typeof VerificationCandidatesSchema>;
export type VerificationPlanProposal = Static<typeof VerificationPlanProposalSchema>;
/** Host wording; proposed order only. Validation establishes neither priority nor full coverage. */
export type VerificationPlan = Static<typeof VerificationPlanSchema>;
