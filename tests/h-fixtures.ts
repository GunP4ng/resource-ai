import type { CaseInput, RouteAssessment } from "../src/contracts.ts";
import { assessCase } from "../src/assessment.ts";
import type { CaseRouteReview } from "../src/assessment.ts";
import { carbonFixture } from "../src/o-synthetic.ts";
import { documents, processorFixture, sourceId } from "../src/o-synthetic-evidence.ts";
import { revision } from "../src/o-validation.ts";

// Entirely synthetic case, permits, findings, quotes and factors. Never operational data.
export const syntheticCase: CaseInput = { caseId: "synthetic-h-reviewed", description: "합성 통합 시험 · 현장 적용 불가",
  photoRefs: [], process: "사출", polymer: "PP", contamination: "없음", hazardousContact: "no",
  massKg: 2000, region: "울산", assessmentDate: "2026-11-05" };

export function syntheticReviewed(input: CaseInput = syntheticCase, editReview = (r: CaseRouteReview): CaseRouteReview => r) {
  const current = assessCase(input), routeId = "mechanical-recycling";
  const review = editReview({ caseId: input.caseId, caseRevision: revision(input), route: routeId,
    legalEvidence: [...current.legal.evidence], conditions: ["합성 조건 · 현장 적용 불가"], evidenceIds: [sourceId],
    checks: current.requiredChecks[routeId].map((requirement) => ({ requirement, state: "met", explanation: "합성 검토 결과 · 실제 확인 아님" })) });
  const failed = review.checks.filter((check) => check.state === "not-met");
  const route: RouteAssessment = { routeId, route: routeId, eligibility: failed.length
    ? { state: "ineligible", reasons: failed.map((check) => `${check.requirement}: ${check.explanation}`), evidenceIds: [sourceId] }
    : { state: "eligible", conditions: [...review.conditions], evidenceIds: [sourceId] } };
  const c = carbonFixture(), p = processorFixture();
  const attributes = { material: input.polymer!, condition: input.contamination!, region: input.region!, process: input.process! };
  const calculation = { ...c.context,
    caseMass: { ...c.context.caseMass!, caseId: input.caseId, material: attributes.material, condition: attributes.condition },
    routes: c.context.routes.map((r) => ({ ...r, ...attributes, caseId: input.caseId, routeId })),
    quotes: c.context.quotes.map((q) => ({ ...q, material: attributes.material, condition: attributes.condition, caseId: input.caseId, routeId })),
    factors: c.context.factors.map((f) => ({ ...f, ...attributes })),
    activities: c.context.activities.map((a) => ({ ...a, caseId: input.caseId, routeId })),
  };
  const comparison = { ...c.input, caseId: input.caseId, routes: c.input.routes.map((r) => ({ ...r, routeId })),
    factors: c.input.factors.map((f) => ({ ...f, region: input.region! })) };
  const processors = { ...p, scopes: p.scopes.map((s) => ({ ...s, caseId: input.caseId, caseRevision: revision(input), routeId })),
    permits: p.permits.map((permit) => ({ ...permit, regions: [input.region!] })) };
  const { evidence: _evidence, ...boundInput } = comparison;
  const facts: Record<string, unknown> = {
    [`eligibility:${input.caseId}:${routeId}`]: review,
    [`route:${input.caseId}:${routeId}`]: { caseRevision: revision(input), route },
    [`assessment:${input.caseId}:${routeId}`]: route,
    [`comparison:${input.caseId}`]: { caseRevision: revision(input), input: boundInput },
    [`case-mass:${input.caseId}`]: calculation.caseMass,
    [`scope:${input.caseId}:${routeId}`]: processors.scopes[0],
    [`permit:synthetic-facility`]: processors.permits[0],
    [`boundary:${input.caseId}:${routeId}`]: calculation.routes[0],
  };
  for (const r of comparison.routes) {
    for (const quote of r.quotes) facts[`quote:${quote.quoteId}`] = { quote, review: calculation.quotes.find((q) => q.quoteId === quote.quoteId) };
    for (const activity of r.activities) facts[`activity:${activity.activityId}`] = { activity, review: calculation.activities.find((a) => a.activityId === activity.activityId) };
  }
  for (const factor of comparison.factors) facts[`factor:${factor.factorId}:${factor.version}`] = { factor, review: calculation.factors.find((f) => f.factorId === factor.factorId) };
  const docs = documents(facts);
  return { routeReviews: { ...docs, reviews: [review] }, processors: { ...processors, ...docs }, calculations: { ...calculation, ...docs },
    comparison: { ...comparison, evidence: docs.documents.map((doc) => doc.record) }, comparisonEvidenceIds: [sourceId] };
}
