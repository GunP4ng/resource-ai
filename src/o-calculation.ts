import { Type } from "typebox";
import { Value } from "typebox/value";
import type { ComparisonInput, Estimate, RouteCalculationInput } from "./contracts.ts";
import { CategorySchema, StageSchema as Stage, UnitSchema as Unit, EvidenceSchema, canonical, date, dateSchema, evidenceIssue, nullableText, quantity, requireValid, strings, text, unavailable, unique, validateDocuments } from "./o-validation.ts";
import type { EvidenceContext } from "./o-validation.ts";
const Q = <U extends string>(unit: U) => Type.Object({ value: Type.Union([Type.Number(), Type.Null()]), unit: Type.Literal(unit), evidenceIds: strings, missingReason: nullableText }, { additionalProperties: false });
const Quote = Type.Object({ quoteId: text, category: CategorySchema,
  basis: Type.Union([Type.Object({ kind: Type.Literal("total"), amount: Q("KRW") }), Type.Object({ kind: Type.Literal("per-kg"), rate: Q("KRW/kg"), amount: Q("kg") }), Type.Object({ kind: Type.Literal("per-tonne"), rate: Q("KRW/t"), amount: Q("t") }), Type.Object({ kind: Type.Literal("per-trip"), rate: Q("KRW/trip"), amount: Q("trip") })]),
  validThrough: nullableText, vat: Type.Union([Type.Literal("included"), Type.Literal("excluded"), Type.Literal("unknown")]), includedInQuoteId: nullableText,
  revenueRecipient: Type.Union([Type.Literal("operator"), Type.Literal("processor"), Type.Literal("not-applicable")]) });
const Activity = Type.Object({ activityId: text, stage: Stage, amount: Type.Object({ value: Type.Union([Type.Number(), Type.Null()]), unit: Unit, evidenceIds: strings, missingReason: nullableText }, { additionalProperties: false }), factorId: nullableText, factorVersion: nullableText });
const Factor = Type.Object({ factorId: text, version: text, kgCo2ePerUnit: Q("kgCO2e"), denominatorUnit: Unit, boundary: text, period: text, region: text, gwpMethod: text, includedStages: Type.Array(Stage), reusePermission: Type.Union([Type.Literal("verified"), Type.Literal("unverified")]) });
const Input = Type.Object({ caseId: text, assessmentDate: dateSchema, functionalUnit: text, boundary: text, baselineRouteId: nullableText, factorRegistryVersion: text,
  routes: Type.Array(Type.Object({ routeId: text, quotes: Type.Array(Quote), activities: Type.Array(Activity), missingInputs: strings })), factors: Type.Array(Factor), evidence: Type.Array(EvidenceSchema) });
export const CaseMassReviewSchema = Type.Object({ caseId: text, assessmentDate: dateSchema, functionalUnit: text, boundary: text,
  material: text, condition: text, moistureBasis: text, massKg: Type.Number({ exclusiveMinimum: 0 }), evidenceIds: strings }, { additionalProperties: false });
/** Independently reviewed whole-case incoming waste represented by the functional unit. */
export interface CaseMassReview {
  readonly caseId: string;
  readonly assessmentDate: string;
  readonly functionalUnit: string;
  readonly boundary: string;
  readonly material: string;
  readonly condition: string;
  readonly moistureBasis: string;
  readonly massKg: number;
  readonly evidenceIds: readonly string[];
}
export const RouteReviewSchema = Type.Object({ caseId: text, routeId: text, functionalUnit: text, boundary: text,
  material: text, condition: text, region: text, process: text, massBasis: text, moistureBasis: text, gasCoverage: text, gwpMethod: text,
  costComponents: strings, carbonComponents: strings, costExclusions: strings, carbonExclusions: strings,
  materialCreditExcluded: Type.Boolean(), energyCreditExcluded: Type.Boolean(), evidenceIds: strings });
export const QuoteReviewSchema = Type.Object({ quoteId: text, caseId: text, routeId: text, processorId: text, material: text, condition: text,
  kind: Type.Union([Type.Literal("actual"), Type.Literal("reference"), Type.Literal("statutory")]), issuedOn: dateSchema, validFrom: dateSchema,
  minMassKg: Type.Number({ minimum: 0 }), maxMassKg: Type.Number({ minimum: 0 }), caseMassKg: Type.Number({ minimum: 0 }),
  components: strings, minimumCharge: Type.Number({ minimum: 0 }), tripMultiple: Type.Integer({ minimum: 1 }), conditions: strings,
  vatRate: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]), revenueNettedIn: nullableText,
  salesOwner: Type.Union([Type.Literal("operator"), Type.Literal("processor"), Type.Literal("not-applicable")]),
  saleableOutputKg: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]), evidenceIds: strings });
export const FactorReviewSchema = Type.Object({ factorId: text, version: text, registryVersion: text, validFrom: dateSchema, validTo: dateSchema,
  material: text, condition: text, region: text, process: text, massBasis: text, moistureBasis: text, gasCoverage: text, gwpMethod: text,
  components: strings, allocation: text, substitution: text, embeddedCredits: Type.Boolean(), evidenceIds: strings });
export const ActivityReviewSchema = Type.Object({ activityId: text, caseId: text, routeId: text, components: strings, massBasis: text,
  moistureBasis: text, allocation: text, substitution: nullableText, outputQuantity: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
  substitutionRatio: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]), displaced: nullableText, evidenceIds: strings });
export type RouteReview = Readonly<Type.Static<typeof RouteReviewSchema>>;
export type QuoteReview = Readonly<Type.Static<typeof QuoteReviewSchema>>;
export type FactorReview = Readonly<Type.Static<typeof FactorReviewSchema>>;
export type ActivityReview = Readonly<Type.Static<typeof ActivityReviewSchema>>;
export interface CalculationContext extends EvidenceContext {
  readonly version: string;
  readonly vatBasis: "included" | "excluded";
  /** Legacy missing/null supplements make whole-case totals unavailable. Never inferred from quotes or text. */
  readonly caseMass?: CaseMassReview | null;
  readonly routes: readonly RouteReview[];
  readonly quotes: readonly QuoteReview[];
  readonly factors: readonly FactorReview[];
  readonly activities: readonly ActivityReview[];
}
export function validateCalculation(input: ComparisonInput, context: CalculationContext): void {
  requireValid(Value.Check(Input, input), "invalid-comparison-input"); date(input.assessmentDate); validateDocuments(context);
  requireValid(context.version.trim().length > 0 && ["included", "excluded"].includes(context.vatBasis), "invalid-calculation-context");
  if (context.caseMass !== undefined && context.caseMass !== null) {
    requireValid(Value.Check(CaseMassReviewSchema, context.caseMass) && Number.isFinite(context.caseMass.massKg), "invalid-case-mass-review");
    date(context.caseMass.assessmentDate);
  }
  requireValid(Value.Check(Type.Array(RouteReviewSchema), context.routes) && Value.Check(Type.Array(QuoteReviewSchema), context.quotes)
    && Value.Check(Type.Array(FactorReviewSchema), context.factors) && Value.Check(Type.Array(ActivityReviewSchema), context.activities), "invalid-calculation-metadata");
  unique(input.evidence.map((v) => v.sourceId), "duplicate-source"); unique(input.routes.map((v) => v.routeId), "duplicate-route");
  unique(input.factors.map((v) => `${v.factorId}:${v.version}`), "duplicate-factor-version");
  unique(context.routes.map((v) => `${v.caseId}:${v.routeId}`)); unique(context.quotes.map((v) => v.quoteId));
  unique(context.activities.map((v) => v.activityId)); unique(context.factors.map((v) => `${v.factorId}:${v.version}`));
  unique(input.routes.flatMap((r) => r.quotes.map((q) => q.quoteId)), "duplicate-quote");
  unique(input.routes.flatMap((r) => r.activities.map((a) => a.activityId)), "duplicate-activity");
  for (const r of input.routes) {
    for (const q of r.quotes) {
      quantity(q.basis.amount); if (q.basis.kind !== "total") quantity(q.basis.rate);
      if (q.validThrough !== null) date(q.validThrough);
    }
    for (const a of r.activities) quantity(a.amount);
  }
  for (const f of input.factors) quantity(f.kgCo2ePerUnit);
  for (const e of input.evidence) {
    const source = context.documents.find((d) => d.record.sourceId === e.sourceId);
    requireValid(source !== undefined && canonical(source.record) === canonical(e), "evidence-record-conflict");
  }
  for (const q of context.quotes) { date(q.issuedOn); date(q.validFrom); requireValid(q.issuedOn <= q.validFrom && q.minMassKg <= q.maxMassKg, "invalid-quote-period-or-mass"); }
  for (const f of context.factors) requireValid(date(f.validFrom) <= date(f.validTo), "reversed-period");
}
export function routeReview(input: ComparisonInput, route: RouteCalculationInput, context: CalculationContext): RouteReview | null {
  requireValid(input.routes.some((r) => canonical(r) === canonical(route)), "route-input-conflict");
  const review = context.routes.find((r) => r.caseId === input.caseId && r.routeId === route.routeId);
  if (review === undefined || review.functionalUnit !== input.functionalUnit || review.boundary !== input.boundary) return null;
  return binding(context, input, { evidenceIds: review.evidenceIds, key: `boundary:${input.caseId}:${route.routeId}`, value: review }) === null ? review : null;
}
type ReviewedCaseMass = { readonly review: CaseMassReview; readonly issue: null } | { readonly review: null; readonly issue: string };
export function caseMassReview(input: ComparisonInput, boundary: RouteReview | null, context: CalculationContext): ReviewedCaseMass {
  const review = context.caseMass;
  if (review === undefined || review === null) return { review: null, issue: "case-mass-review-missing" };
  if (boundary === null || review.caseId !== input.caseId || review.assessmentDate !== input.assessmentDate
    || review.functionalUnit !== input.functionalUnit || review.boundary !== input.boundary
    || review.material !== boundary.material || review.condition !== boundary.condition || review.moistureBasis !== boundary.moistureBasis) {
    return { review: null, issue: "case-mass-review-inapplicable" };
  }
  const issue = binding(context, input, { key: `case-mass:${input.caseId}`, value: review, evidenceIds: review.evidenceIds });
  return issue === null ? { review, issue: null } : { review: null, issue };
}
/** Attach whole-case applicability only to totals; stage/output quantities keep their own meaning. */
export function caseMassTotal<U extends "KRW" | "kgCO2e">(value: Estimate<U>, mass: ReviewedCaseMass): Estimate<U> {
  if (mass.issue !== null) return unavailable([mass.issue, ...(value.state === "unavailable" ? value.missingInputs : [])]);
  if (value.state === "unavailable") return value;
  return { ...value, evidenceIds: [...new Set([...value.evidenceIds, ...mass.review.evidenceIds])],
    assumptions: [...value.assumptions, `검토된 사례 전체 유입 폐기물 질량: ${mass.review.massKg} kg`] };
}
export function binding(context: CalculationContext, input: ComparisonInput, fact: { readonly key: string; readonly value: unknown; readonly evidenceIds: readonly string[] }): string | null {
  if (fact.evidenceIds.some((id) => !input.evidence.some((e) => e.sourceId === id))) return "input-evidence-missing";
  return evidenceIssue(context, fact.evidenceIds, fact, input.assessmentDate);
}
export function overlaps(components: readonly (readonly string[])[]): boolean {
  const flat = components.flat(); return new Set(flat).size !== flat.length;
}
