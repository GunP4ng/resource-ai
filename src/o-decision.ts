import { Type } from "typebox";
import { Value } from "typebox/value";
import type { DecisionResult } from "./contracts.ts";
import { CategorySchema, RouteKindSchema, StageSchema, EvidenceSchema, date, nullableText, requireValid, strings, text, timestamp, unique } from "./o-validation.ts";
export const CaseSchema = Type.Object({ caseId: text, description: text, photoRefs: strings, process: nullableText, polymer: nullableText,
  contamination: nullableText, hazardousContact: Type.Union([Type.Literal("yes"), Type.Literal("no"), Type.Literal("unknown")]), massKg: Type.Union([Type.Number({ exclusiveMinimum: 0 }), Type.Null()]), region: nullableText, assessmentDate: text });
export const RouteSchema = Type.Object({ routeId: text, route: RouteKindSchema, eligibility: Type.Union([
  Type.Object({ state: Type.Literal("eligible"), evidenceIds: strings, conditions: strings }), Type.Object({ state: Type.Literal("ineligible"), evidenceIds: strings, reasons: strings }), Type.Object({ state: Type.Literal("unknown"), missingFacts: strings })]) });
const EstimateSchema = <U extends "KRW" | "kgCO2e">(unit: U) => Type.Union([Type.Object({ state: Type.Literal("available"), low: Type.Number(), central: Type.Number(), high: Type.Number(), unit: Type.Literal(unit), evidenceIds: strings, assumptions: strings }), Type.Object({ state: Type.Literal("unavailable"), missingInputs: Type.Array(text, { minItems: 1 }) })]);
const Cost = EstimateSchema("KRW"), Carbon = EstimateSchema("kgCO2e");
const ScenarioSchema = Type.Object({ routeId: text, functionalUnit: text, boundary: text,
  costLines: Type.Array(Type.Object({ quoteId: text, category: CategorySchema, amount: Cost })),
  carbonLines: Type.Array(Type.Object({ activityId: text, stage: StageSchema, factorId: nullableText, factorVersion: nullableText, amount: Carbon })),
  netCost: Cost, grossEmissions: Carbon, materialCredit: Carbon, energyCredit: Carbon, netEmissions: Carbon,
  avoidedEmissions: Type.Union([Type.Object({ state: Type.Literal("no-baseline") }), Type.Object({ state: Type.Literal("baseline-provided"), baselineRouteId: text, amount: Carbon })]) });
const ProcessorSchema = Type.Object({ processorId: text, name: text, region: text, acceptedWasteCodes: strings, permitEvidenceIds: strings, verifiedAt: nullableText, acceptance: Type.Union([Type.Literal("confirmed"), Type.Literal("unconfirmed")]) });
export const DecisionSchema = Type.Union([
  Type.Object({ state: Type.Literal("needs-information"), caseId: text, questions: Type.Array(text, { minItems: 1 }), evidence: Type.Array(EvidenceSchema) }),
  Type.Object({ state: Type.Literal("needs-review"), caseId: text, reasons: Type.Array(text, { minItems: 1 }), evidence: Type.Array(EvidenceSchema) }),
  Type.Object({ state: Type.Literal("compared"), caseId: text, routes: Type.Array(RouteSchema), processors: Type.Array(ProcessorSchema), scenarios: Type.Array(ScenarioSchema), evidence: Type.Array(EvidenceSchema), limitations: strings, humanApproval: Type.Union([Type.Literal("pending"), Type.Literal("approved")]) }),
]);
export function parseDecision(raw: unknown): DecisionResult {
  requireValid(Value.Check(DecisionSchema, raw), "invalid-decision-result");
  unique(raw.evidence.map((e) => e.sourceId), "duplicate-source");
  for (const e of raw.evidence) {
    timestamp(e.retrievedAt); if (e.effectiveFrom !== null) date(e.effectiveFrom); if (e.effectiveTo !== null) date(e.effectiveTo);
    requireValid(e.effectiveFrom === null || e.effectiveTo === null || e.effectiveFrom <= e.effectiveTo, "reversed-period");
  }
  if (raw.state === "compared") {
    unique(raw.routes.map((r) => r.routeId)); unique(raw.processors.map((p) => p.processorId));
    const references = (ids: readonly string[]) => ids.length > 0 && ids.every((id) => raw.evidence.some((e) => e.sourceId === id));
    for (const r of raw.routes) if (r.eligibility.state !== "unknown") requireValid(references(r.eligibility.evidenceIds), "route-evidence-unresolved");
    for (const p of raw.processors) { requireValid(references(p.permitEvidenceIds), "permit-evidence-unresolved"); if (p.verifiedAt !== null) timestamp(p.verifiedAt); }
    for (const s of raw.scenarios) {
      requireValid(raw.routes.some((r) => r.routeId === s.routeId), "scenario-route-unresolved");
      const estimates = [s.netCost, s.grossEmissions, s.materialCredit, s.energyCredit, s.netEmissions, ...s.costLines.map((l) => l.amount), ...s.carbonLines.map((l) => l.amount), ...(s.avoidedEmissions.state === "baseline-provided" ? [s.avoidedEmissions.amount] : [])];
      for (const e of estimates) if (e.state === "available") requireValid(e.low <= e.central && e.central <= e.high && e.evidenceIds.length > 0 && e.evidenceIds.every((id) => raw.evidence.some((v) => v.sourceId === id)), "invalid-estimate-or-evidence");
    }
  }
  return raw;
}
