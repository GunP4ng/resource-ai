import type { ComparisonInput, Estimate, QuoteInput, ResourceDomain, RouteCalculationInput, ScenarioComparison } from "./contracts.ts";
import { calculateRouteCarbon, compatibleBaseline } from "./carbon.ts";
import { binding, overlaps, routeReview, validateCalculation } from "./o-calculation.ts";
import type { CalculationContext, QuoteReview } from "./o-calculation.ts";
import { date, period, point, quantity, requireValid, subtract, sum, unavailable, unique } from "./o-validation.ts";
export type { CalculationContext } from "./o-calculation.ts";

function validateInclusion(quotes: readonly QuoteInput[], reviews: readonly QuoteReview[]): void {
  // Detect structural cycles first, before interpreting commercial coverage.
  for (const q of quotes) {
    const seen = new Set([q.quoteId]);
    let parentId = q.includedInQuoteId;
    while (parentId !== null) {
      requireValid(!seen.has(parentId), "quote-inclusion-cycle");
      seen.add(parentId);
      const parent = quotes.find((v) => v.quoteId === parentId);
      requireValid(parent !== undefined, "quote-inclusion-dangling");
      parentId = parent.includedInQuoteId;
    }
  }
  for (const q of quotes) {
    const visited = new Set([q.quoteId]);
    let next = q.includedInQuoteId;
    while (next !== null) {
      requireValid(!visited.has(next), "quote-inclusion-cycle");
      visited.add(next);
      const parent = quotes.find((v) => v.quoteId === next);
      requireValid(parent !== undefined, "quote-inclusion-dangling");
      requireValid(parent.category !== "sales" && q.category !== "sales", "quote-inclusion-incompatible");
      const childReview = reviews.find((v) => v.quoteId === q.quoteId), parentReview = reviews.find((v) => v.quoteId === parent.quoteId);
      if (childReview && parentReview) requireValid(childReview.processorId === parentReview.processorId && childReview.components.every((c) => parentReview.components.includes(c)), "quote-inclusion-incompatible");
      next = parent.includedInQuoteId;
    }
    requireValid(q.category === "sales" ? q.revenueRecipient !== "not-applicable" : q.revenueRecipient === "not-applicable", "sales-recipient-inconsistent");
    if (q.validThrough !== null) date(q.validThrough);
  }
}
function quoteAmount(q: QuoteInput, review: QuoteReview, input: ComparisonInput, context: CalculationContext): Estimate<"KRW"> {
  const quantities = q.basis.kind === "total" ? [q.basis.amount] : [q.basis.rate, q.basis.amount];
  const values = quantities.map(quantity);
  if (quantities.some((q) => q.evidenceIds.length === 0)) return unavailable("quote-quantity-evidence-missing");
  const ids = [...review.evidenceIds, ...quantities.flatMap((v) => v.evidenceIds)];
  const issue = binding(context, input, { key: `quote:${q.quoteId}`, value: { quote: q, review }, evidenceIds: ids });
  if (issue !== null) return unavailable(issue);
  if (values.some((v) => v === null)) return unavailable("quote-quantity-missing");
  if (q.validThrough === null || !period(review.validFrom, q.validThrough, input.assessmentDate)) return unavailable("quote-out-of-period");
  if (review.kind !== "actual") return unavailable("actual-quotation-required");
  if (review.conditions.length > 0) return unavailable("quote-conditions-unresolved");
  if (review.caseMassKg < review.minMassKg || review.caseMassKg > review.maxMassKg) return unavailable("quote-mass-inapplicable");
  requireValid(q.category === "sales" ? review.salesOwner === q.revenueRecipient : review.salesOwner === "not-applicable" && review.saleableOutputKg === null, "sales-ownership-inconsistent");
  if (q.category === "sales") {
    if (review.saleableOutputKg === null) return unavailable("saleable-output-evidence-missing");
    if (q.basis.kind === "per-kg" && q.basis.amount.value !== review.saleableOutputKg) return unavailable("saleable-output-mismatch");
    if (q.basis.kind === "per-tonne" && q.basis.amount.value !== review.saleableOutputKg / 1000) return unavailable("saleable-output-mismatch");
  }
  if (q.basis.kind === "per-trip") requireValid(q.basis.amount.value !== null && Number.isInteger(q.basis.amount.value) && q.basis.amount.value % review.tripMultiple === 0, "trip-billing-rule");
  if (q.basis.kind === "per-kg" && q.category !== "sales" && q.basis.amount.value !== review.caseMassKg) return unavailable("quote-mass-mismatch");
  if (q.basis.kind === "per-tonne" && q.category !== "sales" && q.basis.amount.value !== review.caseMassKg / 1000) return unavailable("quote-mass-mismatch");
  let amount = q.basis.kind === "total" ? q.basis.amount.value : (q.basis.rate.value ?? 0) * (q.basis.amount.value ?? 0);
  requireValid(amount !== null && Number.isFinite(amount), "arithmetic-overflow");
  amount = Math.max(amount, review.minimumCharge);
  if (q.vat === "unknown") return unavailable("vat-unknown");
  if (q.vat !== context.vatBasis) {
    if (review.vatRate === null) return unavailable("vat-rate-missing");
    amount = context.vatBasis === "included" ? amount * (1 + review.vatRate) : amount / (1 + review.vatRate);
  }
  const estimate = point(amount, "KRW", ids);
  return estimate.state === "available" ? { ...estimate, assumptions: [...estimate.assumptions, context.vatBasis === "included" ? "VAT 포함" : "VAT 별도", `원문 위치: /facts/${`quote:${q.quoteId}`.replaceAll("~", "~0").replaceAll("/", "~1")}`] } : estimate;
}
export function calculateRouteCost(input: ComparisonInput, route: RouteCalculationInput, context: CalculationContext): Pick<ScenarioComparison, "costLines" | "netCost"> {
  validateCalculation(input, context);
  const boundary = routeReview(input, route, context);
  validateInclusion(route.quotes, context.quotes);
  const costLines = route.quotes.map((q) => {
    const review = context.quotes.find((v) => v.quoteId === q.quoteId && v.caseId === input.caseId && v.routeId === route.routeId);
    const amount = review === undefined || boundary === null ? unavailable("quote-or-boundary-review-missing")
      : review.material !== boundary.material || review.condition !== boundary.condition ? unavailable("quote-material-inapplicable") : quoteAmount(q, review, input, context);
    const exclusions: string[] = [];
    if (q.includedInQuoteId !== null) {
      exclusions.push(`상위 견적에 포함 · 합산 제외: ${q.includedInQuoteId}`);
    }
    if (q.category === "sales" && amount.state === "available") {
      if (q.revenueRecipient === "processor") {
        exclusions.push("처리업체 귀속 · 사업자 수입 합산 제외");
      }
      if (review?.revenueNettedIn != null) {
        exclusions.push(`견적 ${review.revenueNettedIn}에 이미 반영 · 추가 차감 제외`);
      }
    }
    return {
      quoteId: q.quoteId,
      category: q.category,
      amount: amount.state === "available"
        ? { ...amount, assumptions: [...amount.assumptions, ...exclusions] }
        : amount,
    };
  });
  if (boundary === null) return { costLines, netCost: unavailable("boundary-review-missing") };
  const roots = route.quotes.filter((q) => q.includedInQuoteId === null && q.category !== "sales");
  const rootsReviews = roots.map((q) => context.quotes.find((v) => v.quoteId === q.quoteId));
  for (const q of route.quotes) {
    const review = context.quotes.find((v) => v.quoteId === q.quoteId);
    if (review?.revenueNettedIn != null) {
      const parent = rootsReviews.find((v) => v?.quoteId === review.revenueNettedIn);
      requireValid(q.category === "sales" && parent !== undefined && parent.processorId === review.processorId, "revenue-netted-reference-invalid");
    }
  }
  const components = rootsReviews.map((v) => v?.components ?? []);
  requireValid(!overlaps(components), "quote-root-coverage-overlap");
  requireValid(!overlaps([components.flat(), boundary.costExclusions]), "cost-exclusion-overlap");
  const allSales = route.quotes.filter((q) => q.category === "sales");
  const salesComponents = allSales.flatMap((q) => context.quotes.find((v) => v.quoteId === q.quoteId)?.components ?? []);
  const covered = [...components.flat(), ...salesComponents];
  requireValid(covered.every((c) => boundary.costComponents.includes(c)), "cost-component-outside-boundary");
  requireValid(!overlaps([covered, boundary.costExclusions]), "cost-exclusion-overlap");
  const missing = boundary.costComponents.filter((c) => !covered.includes(c) && !boundary.costExclusions.includes(c));
  if (![...boundary.costComponents, ...boundary.costExclusions].includes("sales")) missing.push("sales-declaration");
  const creditQuotes = route.quotes.filter((q) => q.category === "sales" && q.revenueRecipient === "operator");
  const credits = creditQuotes.filter((q) => {
    const review = context.quotes.find((v) => v.quoteId === q.quoteId);
    if (review?.revenueNettedIn == null) return true;
    requireValid(roots.some((v) => v.quoteId === review.revenueNettedIn), "revenue-netted-reference-invalid");
    return false;
  });
  const salesReviews = creditQuotes.map((q) => context.quotes.find((v) => v.quoteId === q.quoteId)?.components ?? []);
  requireValid(!overlaps(salesReviews), "sales-coverage-overlap");
  // All audited lines must be sound, including included/revenue lines, before declaring a total.
  const lineMissing = costLines.flatMap((l) => l.amount.state === "unavailable" ? l.amount.missingInputs : []);
  const issues = [...missing.map((v) => `cost-coverage-missing:${v}`), ...route.missingInputs, ...lineMissing];
  const amounts = (ids: readonly string[]) => costLines.filter((l) => ids.includes(l.quoteId)).map((l) => l.amount);
  const expense = sum(amounts(roots.map((q) => q.quoteId)), "KRW");
  const total = issues.length ? unavailable(issues) : subtract(expense, amounts(credits.map((q) => q.quoteId)), "KRW");
  const netCost = total.state === "available" ? { ...total, assumptions: [...total.assumptions, "사업자 관점", context.vatBasis === "included" ? "VAT 포함" : "VAT 별도"] } : total;
  return { costLines, netCost };
}
export function createComparisonCalculator(context: CalculationContext): ResourceDomain["compare"] {
  const frozen = structuredClone(context);
  return async (input, assessments) => {
    validateCalculation(input, frozen); unique(assessments.map((a) => a.routeId), "duplicate-route-assessment");
    const scenarios: ScenarioComparison[] = input.routes.map((route) => {
      const assessment = assessments.find((a) => a.routeId === route.routeId);
      const eligible = assessment?.eligibility.state === "eligible" && binding(frozen, input, { key: `assessment:${input.caseId}:${route.routeId}`, value: assessment, evidenceIds: assessment.eligibility.evidenceIds }) === null;
      const cost = calculateRouteCost(input, route, frozen), carbon = calculateRouteCarbon(input, route, frozen);
      return { routeId: route.routeId, functionalUnit: input.functionalUnit, boundary: input.boundary, ...cost, ...carbon,
        ...(!eligible ? { netCost: unavailable("eligible-assessment-unverified"), netEmissions: unavailable("eligible-assessment-unverified") } : {}), avoidedEmissions: { state: "no-baseline" } };
    });
    if (input.baselineRouteId === null) return scenarios;
    const baselineId = input.baselineRouteId;
    const base = scenarios.find((s) => s.routeId === baselineId), baseRoute = input.routes.find((r) => r.routeId === baselineId);
    return scenarios.map((scenario) => {
      const r = input.routes.find((v) => v.routeId === scenario.routeId);
      const compatible = r !== undefined && baseRoute !== undefined && compatibleBaseline(routeReview(input, r, frozen), routeReview(input, baseRoute, frozen));
      const amount = base === undefined || !compatible ? unavailable("baseline-missing-or-incompatible") : subtract(base.netEmissions, [scenario.netEmissions], "kgCO2e");
      return { ...scenario, avoidedEmissions: { state: "baseline-provided", baselineRouteId: baselineId, amount } };
    });
  };
}
