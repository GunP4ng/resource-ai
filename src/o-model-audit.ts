import { Value } from "typebox/value";
import type { CaseInput, DecisionResult } from "./contracts.ts";
import { DecisionSchema } from "./o-decision.ts";
import { requireValid, revision, RouteKindSchema } from "./o-validation.ts";
import { ModelHostAuditSchema, type ModelHostAudit, type ModelAuditField, type HostProposalObservation } from "./o-model-audit-schema.ts";
export type { ModelHostAudit, HostProposalObservation } from "./o-model-audit-schema.ts";

/** Only categorical fields and host-known identifiers: never model prose or numeric estimates. */
function selections(decision: DecisionResult | undefined, host: DecisionResult): ModelHostAudit["stages"][number]["proposed"][] {
  const known = new Set([...host.evidence.map(item => item.sourceId),
    ...(host.state === "compared" ? [...host.routes.map(item => item.routeId), ...host.processors.map(item => item.processorId)] : [])]);
  const id = (value: string) => ({ hostId: (known.has(value) || Value.Check(RouteKindSchema, value)) && value.length <= 160 ? value : null, sha256: revision(value) });
  const items: [ModelAuditField[], ModelAuditField[], ModelAuditField[], ModelAuditField[], ModelAuditField[], ModelAuditField[]] = [[], [], [], [], [], []];
  if (decision) {
    items[2] = decision.evidence.slice(0, 16).map(item => ({ kind: "evidence", sourceId: id(item.sourceId), recordSha256: revision(item) }));
    items[5] = [{ kind: "decision", state: decision.state, humanApproval: decision.state === "compared" ? decision.humanApproval : null,
      questionCount: decision.state === "needs-information" ? decision.questions.length : 0,
      reasonCount: decision.state === "needs-review" ? decision.reasons.length : 0 }];
    if (decision.state === "compared") {
      items[1] = decision.routes.slice(0, 16).map(item => ({ kind: "route", routeId: id(item.routeId), route: item.route, eligibility: item.eligibility.state }));
      items[3] = decision.processors.slice(0, 16).map(item => ({ kind: "processor", processorId: id(item.processorId), acceptance: item.acceptance }));
      items[4] = decision.scenarios.slice(0, 16).map(item => ({ kind: "scenario", routeId: id(item.routeId), cost: item.netCost.state, carbon: item.netEmissions.state }));
      items[5].push(...(decision.recommendations ?? []).slice(0, 15).map(item => ({ kind: "recommendation" as const,
        routeId: id(item.routeId), rank: Number.isSafeInteger(item.rank) ? item.rank : null, grade: item.grade })));
    } else {
      items[1] = (decision.conditionalAlternatives ?? []).slice(0, 16).map(item => ({ kind: "alternative",
        routeId: item.routeId, condition: item.condition.code, support: item.support.state }));
    }
  }
  const totals = !decision ? [0, 0, 0, 0, 0, 0] : [0,
    decision.state === "compared" ? decision.routes.length : (decision.conditionalAlternatives?.length ?? 0), decision.evidence.length,
    decision.state === "compared" ? decision.processors.length : 0, decision.state === "compared" ? decision.scenarios.length : 0,
    1 + (decision.state === "compared" ? (decision.recommendations?.length ?? 0) : 0)];
  return items.map((fields, index) => ({ items: fields, totalItems: totals[index] ?? 0 }));
}

function stageValidation(stage: Pick<ModelHostAudit["stages"][number], "stage" | "proposed">,
  audit: Pick<ModelHostAudit, "syntax" | "validation">): Pick<ModelHostAudit["stages"][number], "status" | "reason"> {
  const { validation, syntax } = audit;
  if (stage.stage === 1) return { status: "absent", reason: "not-in-proposal-contract" };
  if (syntax === "invalid") return { status: "syntax-invalid", reason: "invalid-proposal-shape" };
  if (!stage.proposed.totalItems) return { status: "absent", reason: "no-proposed-fields" };
  if (validation.status === "not-evaluated") return { status: "not-evaluated", reason: "early-host-guard" };
  const fieldCheck = stage.stage === 3 ? "evidence" : stage.stage === 2 && stage.proposed.items[0]?.kind === "alternative" ? "alternatives" : "comparison";
  if (validation.failedCheck === "syntax" || validation.failedCheck === "case-binding" || validation.failedCheck === fieldCheck) {
    return { status: "validation-rejected", reason: "proposal-check-rejected" };
  }
  if (validation.passedChecks.includes(fieldCheck)) return { status: "validation-passed", reason: "field-check-passed" };
  return { status: "not-evaluated", reason: "field-not-validated" };
}

export function createModelHostAudit(input: CaseInput, output: {
  readonly proposal: unknown;
  readonly decision: DecisionResult;
  readonly origin: ModelHostAudit["origin"];
  readonly observation: HostProposalObservation;
}): ModelHostAudit {
  const { proposal, decision, origin, observation } = output;
  const candidate = Value.Check(DecisionSchema, proposal) ? proposal : undefined;
  const proposed = selections(candidate, decision), selected = selections(decision, decision);
  const validation = { ...observation, passedChecks: [...observation.passedChecks],
    reasons: observation.reasons.slice(0, 16).map(reason => reason.slice(0, 512)),
    reasonsTruncated: observation.reasons.length > 16 || observation.reasons.some(reason => reason.length > 512) };
  const syntax = observation.status === "not-evaluated" ? "not-evaluated" : candidate ? "valid" : "invalid";
  const stages: ModelHostAudit["stages"] = proposed.map((fields, index) => {
    const stage = index + 1, hostSelected = selected[index] ?? { items: [], totalItems: 0 };
    const base = { stage, proposed: fields, hostSelected };
    return { ...base, ...stageValidation(base, { syntax, validation }) };
  });
  return { version: 1, caseId: input.caseId, inputRevision: revision(input), decisionRevision: revision(decision),
    origin, syntax, independentContribution: "not-established", validation, stages };
}

/** Closed, bounded storage boundary; the receipt is descriptive and never authorizes a decision. */
export function parseModelHostAudit(raw: unknown, decision: DecisionResult): ModelHostAudit {
  requireValid(Value.Check(ModelHostAuditSchema, raw), "invalid-model-audit");
  requireValid(Buffer.byteLength(JSON.stringify(raw)) <= 65536, "model-audit-byte-limit");
  requireValid(raw.caseId === decision.caseId && raw.decisionRevision === revision(decision), "model-audit-decision-mismatch");
  const kinds = [[], ["route", "alternative"], ["evidence"], ["processor"], ["scenario"], ["decision", "recommendation"]];
  for (const [index, stage] of raw.stages.entries()) {
    requireValid(stage.stage === index + 1, "invalid-model-audit-stages");
    requireValid(revision({ status: stage.status, reason: stage.reason }) === revision(stageValidation(stage, raw)), "invalid-model-audit-stage-status");
    for (const selection of [stage.proposed, stage.hostSelected]) requireValid(selection.totalItems >= selection.items.length
      && selection.items.length === Math.min(selection.totalItems, 16)
      && selection.items.every(item => kinds[index]?.includes(item.kind)), "invalid-model-audit-fields");
  }
  const selected = selections(decision, decision);
  requireValid(revision(raw.stages.map(stage => stage.hostSelected)) === revision(selected), "model-audit-host-mismatch");
  requireValid(raw.validation.failedCheck === null || !raw.validation.passedChecks.includes(raw.validation.failedCheck), "invalid-model-audit-receipt");
  requireValid((raw.validation.status === "validation-rejected" || raw.validation.status === "syntax-invalid")
    === (raw.validation.failedCheck !== null), "invalid-model-audit-receipt");
  requireValid(raw.validation.status !== "absent"
    && (raw.syntax === "not-evaluated") === (raw.validation.status === "not-evaluated")
    && (raw.validation.status !== "not-evaluated" || raw.validation.passedChecks.length === 0)
    && (raw.validation.status !== "validation-passed" || ["syntax", "case-binding", "evidence"].every(check => raw.validation.passedChecks.some(value => value === check)))
    && (raw.validation.status !== "syntax-invalid" || (raw.syntax === "invalid" && raw.validation.failedCheck === "syntax"))
    && (raw.validation.status === "validation-passed" ? raw.validation.reasons.length === 0 : raw.validation.reasons.length > 0), "invalid-model-audit-receipt");
  const known = new Set([...decision.evidence.map(item => item.sourceId),
    ...(decision.state === "compared" ? [...decision.routes.map(item => item.routeId), ...decision.processors.map(item => item.processorId)] : [])]);
  for (const stage of raw.stages) for (const item of stage.proposed.items) {
    const identifier = "sourceId" in item ? item.sourceId : "processorId" in item ? item.processorId
      : "routeId" in item && typeof item.routeId === "object" ? item.routeId : null;
    requireValid(identifier === null || identifier.hostId === null
      || ((known.has(identifier.hostId) || Value.Check(RouteKindSchema, identifier.hostId))
        && identifier.sha256 === revision(identifier.hostId)), "invalid-model-audit-identifier");
  }
  return structuredClone(raw);
}
