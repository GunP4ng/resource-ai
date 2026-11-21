import { Type, type Static } from "typebox";

const digest = Type.String({ pattern: "^[a-f0-9]{64}$" });
const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const identifier = Type.Object({
  // Only identifiers already in the host result are retained verbatim.
  hostId: Type.Union([Type.String({ minLength: 1, maxLength: 160 }), Type.Null()]),
  sha256: digest,
}, { additionalProperties: false });
const route = Type.Union([Type.Literal("reuse"), Type.Literal("mechanical-recycling"), Type.Literal("other-recovery"), Type.Literal("disposal")]);
const state = Type.Union([Type.Literal("needs-information"), Type.Literal("needs-review"), Type.Literal("compared")]);
const available = Type.Union([Type.Literal("available"), Type.Literal("unavailable")]);
const field = Type.Union([
  Type.Object({ kind: Type.Literal("route"), routeId: identifier, route,
    eligibility: Type.Union([Type.Literal("eligible"), Type.Literal("conditional"), Type.Literal("ineligible"), Type.Literal("unknown")]) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("alternative"), routeId: route,
    condition: Type.Union([Type.Literal("clean-separated"), Type.Literal("contaminated-or-inseparable"), Type.Literal("hazard-classification"), Type.Literal("reuse-purpose")]),
    support: Type.Union([Type.Literal("route-supported"), Type.Literal("unavailable")]) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("evidence"), sourceId: identifier, recordSha256: digest }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("processor"), processorId: identifier,
    acceptance: Type.Union([Type.Literal("confirmed"), Type.Literal("unconfirmed")]) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("scenario"), routeId: identifier, cost: available, carbon: available }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("decision"), state,
    humanApproval: Type.Union([Type.Literal("pending"), Type.Literal("approved"), Type.Null()]),
    questionCount: count, reasonCount: count }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("recommendation"), routeId: identifier,
    rank: Type.Union([Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }), Type.Null()]),
    grade: Type.Union([Type.Literal("public-conditional"), Type.Literal("reviewed")]) }, { additionalProperties: false }),
]);
const selection = Type.Object({ items: Type.Array(field, { maxItems: 16 }), totalItems: count }, { additionalProperties: false });
const check = Type.Union([Type.Literal("syntax"), Type.Literal("alternatives"), Type.Literal("case-binding"), Type.Literal("evidence"), Type.Literal("comparison")]);
const status = Type.Union([Type.Literal("absent"), Type.Literal("not-evaluated"), Type.Literal("syntax-invalid"), Type.Literal("validation-rejected"), Type.Literal("validation-passed")]);
const receipt = Type.Object({
  status,
  passedChecks: Type.Array(check, { maxItems: 5, uniqueItems: true }),
  failedCheck: Type.Union([check, Type.Null()]),
  reasons: Type.Array(Type.String({ minLength: 1, maxLength: 512 }), { maxItems: 16 }),
  reasonsTruncated: Type.Boolean(),
}, { additionalProperties: false });
export const ModelHostAuditSchema = Type.Object({
  version: Type.Literal(1), caseId: Type.String({ minLength: 1, maxLength: 100 }),
  inputRevision: digest, decisionRevision: digest,
  origin: Type.Union([Type.Literal("model-output"), Type.Literal("host-decision-reference"), Type.Literal("runner-output")]),
  syntax: Type.Union([Type.Literal("valid"), Type.Literal("invalid"), Type.Literal("not-evaluated")]),
  independentContribution: Type.Literal("not-established"),
  validation: receipt,
  stages: Type.Array(Type.Object({
    stage: Type.Integer({ minimum: 1, maximum: 6 }),
    proposed: selection, hostSelected: selection,
    status,
    reason: Type.Union([Type.Literal("not-in-proposal-contract"), Type.Literal("no-proposed-fields"), Type.Literal("invalid-proposal-shape"), Type.Literal("early-host-guard"),
      Type.Literal("proposal-check-rejected"), Type.Literal("field-check-passed"), Type.Literal("field-not-validated")]),
  }, { additionalProperties: false }), { minItems: 6, maxItems: 6 }),
}, { additionalProperties: false });
export type ModelHostAudit = Static<typeof ModelHostAuditSchema>;
export type ModelAuditField = Static<typeof field>;
export type ModelAuditCheck = Static<typeof check>;
/** Internal observation only. The domain owns these receipts, never the runner. */
export interface HostProposalObservation {
  readonly status: ModelHostAudit["validation"]["status"];
  readonly passedChecks: readonly ModelAuditCheck[];
  readonly failedCheck: ModelAuditCheck | null;
  readonly reasons: readonly string[];
}
