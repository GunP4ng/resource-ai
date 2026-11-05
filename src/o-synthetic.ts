import type { ActivityInput, ComparisonInput, FactorRecord, QuoteInput, RouteCalculationInput } from "./contracts.ts";
import type { ActivityReview, CalculationContext, FactorReview, QuoteReview, RouteReview } from "./o-calculation.ts";
import { documents, route as assessment, sourceId } from "./o-synthetic-evidence.ts";
export const sq = <U extends string>(value: number | null, unit: U) => ({ value, unit, evidenceIds: [sourceId], missingReason: value === null ? "synthetic-missing" : null });
export const treatment: QuoteInput = {
  quoteId: "synthetic-treatment",
  category: "treatment",
  basis: { kind: "per-tonne", rate: sq(100000, "KRW/t"), amount: sq(2, "t") },
  validThrough: "2026-12-31",
  vat: "included",
  includedInQuoteId: null,
  revenueRecipient: "not-applicable"
};
export const transport: QuoteInput = {
  ...treatment,
  quoteId: "synthetic-transport",
  category: "transport",
  basis: { kind: "per-trip", rate: sq(30000, "KRW/trip"), amount: sq(2, "trip") }
};
export const sales: QuoteInput = {
  ...treatment,
  quoteId: "synthetic-sales",
  category: "sales",
  basis: { kind: "per-kg", rate: sq(200, "KRW/kg"), amount: sq(100, "kg") },
  revenueRecipient: "operator"
};
export const child: QuoteInput = {
  ...treatment,
  quoteId: "synthetic-child",
  category: "preprocessing",
  basis: { kind: "total", amount: sq(10000, "KRW") },
  includedInQuoteId: treatment.quoteId
};
export function calculationFixture(quotes: readonly QuoteInput[] = [treatment, transport, sales], changes: Partial<QuoteReview> = {}): { input: ComparisonInput; route: RouteCalculationInput; context: CalculationContext } {
  const route: RouteCalculationInput = { routeId: "synthetic-route", quotes, activities: [], missingInputs: [] };
  const boundary: RouteReview = {
    caseId: "synthetic-case",
    routeId: route.routeId,
    functionalUnit: "synthetic-2000kg",
    boundary: "synthetic-full-boundary",
    material: "synthetic-polymer",
    condition: "synthetic-dry",
    region: "synthetic-region",
    process: "synthetic-process",
    massBasis: "input",
    moistureBasis: "dry",
    gasCoverage: "synthetic-all",
    gwpMethod: "synthetic-GWP100",
    costComponents: ["treatment", "preprocessing", "transport", "sales"],
    carbonComponents: [],
    costExclusions: [],
    carbonExclusions: [],
    materialCreditExcluded: false,
    energyCreditExcluded: false,
    evidenceIds: [sourceId]
  };
  const reviews: QuoteReview[] = quotes.map((q) => ({
    quoteId: q.quoteId,
    caseId: "synthetic-case",
    routeId: route.routeId,
    processorId: "synthetic-facility",
    material: boundary.material,
    condition: boundary.condition,
    kind: "actual",
    issuedOn: "2026-11-01",
    validFrom: "2026-11-01",
    minMassKg: 2000,
    maxMassKg: 2000,
    caseMassKg: 2000,
    components: q.category === "treatment" ? ["treatment", "preprocessing"] : [q.category],
    minimumCharge: 0,
    tripMultiple: 1,
    conditions: [],
    vatRate: null,
    revenueNettedIn: null,
    salesOwner: q.revenueRecipient,
    saleableOutputKg: q.category === "sales" ? 100 : null,
    evidenceIds: [sourceId],
    ...changes,
    ...(q.category === "sales" ? { components: ["sales"] } : {})
  }));
  const facts: Record<string, unknown> = { [`boundary:synthetic-case:${route.routeId}`]: boundary };
  for (const q of quotes) facts[`quote:${q.quoteId}`] = { quote: q, review: reviews.find((v) => v.quoteId === q.quoteId) };
  const evidence = documents(facts);
  const input: ComparisonInput = {
    caseId: "synthetic-case",
    assessmentDate: "2026-11-05",
    functionalUnit: boundary.functionalUnit,
    boundary: boundary.boundary,
    baselineRouteId: null,
    routes: [route],
    factorRegistryVersion: "synthetic-registry-v1",
    factors: [],
    evidence: evidence.documents.map((d) => d.record)
  };
  return { route, input, context: { ...evidence, version: "synthetic-calculation-v1", vatBasis: "included", routes: [boundary], quotes: reviews, factors: [], activities: [] } };
}
/** Rebuild actual synthetic snapshot bytes after an explicitly authored fixture edit. */
export function bindSynthetic(input: ComparisonInput, context: CalculationContext): { input: ComparisonInput; context: CalculationContext } {
  const facts: Record<string, unknown> = {};
  for (const r of context.routes) {
    facts[`boundary:${input.caseId}:${r.routeId}`] = r;
    facts[`assessment:${input.caseId}:${r.routeId}`] = { ...assessment, routeId: r.routeId };
  }
  for (const r of input.routes) {
    for (const quote of r.quotes) facts[`quote:${quote.quoteId}`] = { quote, review: context.quotes.find((q) => q.quoteId === quote.quoteId) };
    for (const activity of r.activities) facts[`activity:${activity.activityId}`] = { activity, review: context.activities.find((a) => a.activityId === activity.activityId) };
  }
  for (const factor of input.factors) facts[`factor:${factor.factorId}:${factor.version}`] = { factor, review: context.factors.find((f) => f.factorId === factor.factorId && f.version === factor.version) };
  const evidence = documents(facts);
  return { input: { ...input, evidence: evidence.documents.map((d) => d.record) }, context: { ...context, ...evidence } };
}
export function carbonFixture(): ReturnType<typeof calculationFixture> {
  const f = calculationFixture();
  const boundary = f.context.routes[0];
  if (boundary === undefined) throw new Error("synthetic boundary missing");
  const specifications = [
    ["transport", 100, "t-km", 0.1], ["preprocessing", 20, "kWh", 0.5], ["treatment", 2, "t", 30],
    ["residue", 100, "kg", 0.2], ["material-credit", 50, "kg", 1], ["energy-credit", 10, "kWh", 0.5],
  ] as const;
  const activities: ActivityInput[] = specifications.map(([stage, amount, unit]) => ({ activityId: `synthetic-${stage}`, stage, amount: sq(amount, unit), factorId: `synthetic-factor-${stage}`, factorVersion: "synthetic-v1" }));
  const factors: FactorRecord[] = specifications.map(([stage, , unit, rate]) => ({
    factorId: `synthetic-factor-${stage}`,
    version: "synthetic-v1",
    kgCo2ePerUnit: sq(rate, "kgCO2e"),
    denominatorUnit: unit,
    boundary: boundary.boundary,
    period: "2026-01-01/2026-12-31",
    region: boundary.region,
    gwpMethod: boundary.gwpMethod,
    includedStages: [stage],
    reusePermission: "verified"
  }));
  const factorReviews: FactorReview[] = factors.map((v, i) => ({
    ...boundary,
    massBasis: specifications[i]?.[0].endsWith("credit") ? "substituted-output" : boundary.massBasis,
    factorId: v.factorId,
    version: v.version,
    registryVersion: f.input.factorRegistryVersion,
    validFrom: "2026-01-01",
    validTo: "2026-12-31",
    components: [specifications[i]?.[0] ?? "missing"],
    allocation: "synthetic-allocation",
    substitution: "synthetic-documented-substitution",
    embeddedCredits: false
  }));
  const activityReviews: ActivityReview[] = activities.map((a) => ({
    activityId: a.activityId,
    caseId: f.input.caseId,
    routeId: f.route.routeId,
    components: [a.stage],
    massBasis: a.stage.endsWith("credit") ? "substituted-output" : boundary.massBasis,
    moistureBasis: boundary.moistureBasis,
    allocation: "synthetic-allocation",
    substitution: "synthetic-documented-substitution",
    outputQuantity: a.stage === "material-credit" ? 100 : a.stage === "energy-credit" ? 20 : null,
    substitutionRatio: a.stage.endsWith("credit") ? 0.5 : null,
    displaced: a.stage.endsWith("credit") ? "synthetic-displaced-output" : null,
    evidenceIds: [sourceId]
  }));
  const route = { ...f.route, activities };
  const bound = bindSynthetic({ ...f.input, routes: [route], factors }, {
    ...f.context,
    routes: [{ ...boundary, carbonComponents: ["transport", "preprocessing", "treatment", "residue"] }],
    factors: factorReviews,
    activities: activityReviews
  });
  return { ...bound, route };
}
