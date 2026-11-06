import type { CaseInput, ComparisonInput, DecisionResult, EvidenceRecord, ProcessorCandidate, ResourceDomain, RouteAssessment } from "./contracts.ts";
import { assessCase, AssessmentInputError, decideCase } from "./assessment.ts";
import type { AssessmentOptions, RouteReviewContext } from "./assessment.ts";
import { parseCaseInput } from "./input.ts";
import { createProcessorFinder } from "./processors.ts";
import type { ProcessorContext } from "./processors.ts";
import { createComparisonCalculator } from "./cost.ts";
import type { CalculationContext } from "./o-calculation.ts";
import { canonical, date, evidenceIssue, period, requireValid, revision, validateDocuments, ValidationError } from "./o-validation.ts";
import { parseDecision } from "./o-decision.ts";

/** Server-owned supplements only; never deserialize these from model/app input. */
export interface DomainResources {
  readonly assessmentOptions?: AssessmentOptions;
  readonly routeReviews?: RouteReviewContext;
  readonly processors?: ProcessorContext;
  readonly calculations?: CalculationContext;
  readonly comparison?: ComparisonInput;
  /** Binds {caseRevision, input: ComparisonInput without evidence} at comparison:<caseId>. */
  readonly comparisonEvidenceIds?: readonly string[];
}

/** SDK/UI-independent composition bound to one immutable case revision. */
export function createResourceDomain(input: CaseInput, resources: DomainResources = {}) {
  const parsed = parseCaseInput(input);
  if (!parsed.ok) throw new AssessmentInputError(parsed.issues);
  const facts = parsed.value;
  const owned = structuredClone(resources);
  const assess = () => assessCase(facts, owned.assessmentOptions, owned.routeReviews);
  const find = owned.processors === undefined ? undefined : createProcessorFinder(owned.processors);
  const calculate = owned.calculations === undefined ? undefined : createComparisonCalculator(owned.calculations);
  const assertCase = (value: CaseInput) => requireValid(revision(value) === revision(facts), "case-revision-mismatch");
  const assertRoutes = (routes: readonly RouteAssessment[]) => {
    const current = assess().routes;
    requireValid(new Set(routes.map((r) => r.routeId)).size === routes.length, "duplicate-route");
    requireValid(routes.every((route) => current.some((expected) => canonical(expected) === canonical(route))), "route-not-host-authorized");
  };
  const domain: ResourceDomain = {
    async assessRoutes(value) { assertCase(value); return assess().routes; },
    async findProcessors(value, route) {
      assertCase(value); assertRoutes([route]);
      return find === undefined ? [] : find(facts, route);
    },
    async compare(comparison, routes) {
      assertRoutes(routes);
      requireValid(comparison.caseId === facts.caseId && comparison.assessmentDate === facts.assessmentDate, "comparison-case-mismatch");
      requireValid(owned.comparison !== undefined && canonical(comparison) === canonical(owned.comparison), "comparison-not-host-authorized");
      requireValid(calculate !== undefined, "calculation-resources-unavailable");
      requireValid(comparison.routes.length > 0 && comparison.routes.every((r) => routes.some((a) => a.routeId === r.routeId && a.eligibility.state === "eligible")), "comparison-route-not-eligible");
      requireValid(owned.calculations !== undefined, "calculation-resources-unavailable");
      validateDocuments(owned.calculations);
      const { evidence: _evidence, ...boundInput } = comparison;
      const issue = evidenceIssue(owned.calculations, owned.comparisonEvidenceIds ?? [],
        { key: `comparison:${facts.caseId}`, value: { caseRevision: revision(facts), input: boundInput } }, facts.assessmentDate);
      requireValid(issue === null, `comparison-${issue ?? "unbound"}`);
      requireValid((owned.comparisonEvidenceIds ?? []).every((id) => comparison.evidence.some((record) => record.sourceId === id)), "comparison-evidence-missing");
      const mass = owned.calculations.caseMass;
      requireValid(mass == null || (mass.massKg === facts.massKg && mass.caseId === facts.caseId && mass.assessmentDate === facts.assessmentDate), "case-mass-mismatch");
      return calculate(comparison, routes);
    },
  };
  return {
    ...domain,
    assess,
    async decide(proposal?: unknown): Promise<DecisionResult> {
      const assessment = assess();
      const fallback = decideCase(facts, undefined, owned.assessmentOptions, owned.routeReviews);
      const hold = (reason: string): DecisionResult => ({ state: "needs-review", caseId: facts.caseId,
        evidence: fallback.evidence,
        reasons: [...new Set([...(fallback.state === "needs-review" ? fallback.reasons : assessment.questions), reason])] });
      let result: DecisionResult = fallback;
      try {
        if (owned.comparison !== undefined && calculate !== undefined) {
          requireValid(assessment.reviewIssues.length === 0, "route-review-conflict");
          const scenarios = await domain.compare(owned.comparison, assessment.routes);
          const processors = new Map<string, ProcessorCandidate>();
          for (const selected of owned.comparison.routes) {
            const route = assessment.routes.find((r) => r.routeId === selected.routeId)!;
            const candidates = await domain.findProcessors(facts, route);
            for (const candidate of candidates) {
              const previous = processors.get(candidate.processorId);
              requireValid(previous === undefined || canonical(previous) === canonical(candidate), "processor-conflict");
              processors.set(candidate.processorId, candidate);
            }
            // A quote cannot silently introduce a facility outside the verified route candidates.
            for (const quote of selected.quotes) {
              const review = owned.calculations?.quotes.find((r) => r.quoteId === quote.quoteId);
              if (review !== undefined) requireValid(candidates.some((p) => p.processorId === review.processorId), "quote-processor-unverified");
            }
          }
          const evidence = new Map<string, EvidenceRecord>();
          const add = (record: EvidenceRecord) => {
            const previous = evidence.get(record.sourceId);
            requireValid(previous === undefined || canonical(previous) === canonical(record), "evidence-record-conflict");
            requireValid(record.licenseVerified && !!record.license?.trim()
              && period(record.effectiveFrom ?? "0001-01-01", record.effectiveTo, facts.assessmentDate), "evidence-reuse-or-period-unverified");
            evidence.set(record.sourceId, structuredClone(record));
          };
          for (const record of [...assessment.legal.evidence, ...assessment.reviewEvidence, ...owned.comparison.evidence]) add(record);
          for (const context of [owned.calculations, owned.processors]) if (context !== undefined) {
            validateDocuments(context);
            for (const doc of context.documents) {
              // Include accepted permit/acceptance provenance as well as calculation provenance.
              const age = (date(facts.assessmentDate) - date(doc.observedOn)) / 86400000;
              requireValid(age >= 0 && age <= doc.maxAgeDays && doc.checkedAt.slice(0, 10) <= facts.assessmentDate, "review-source-stale");
              add(doc.record);
            }
          }
          result = parseDecision({ state: "compared", caseId: facts.caseId, routes: assessment.routes,
            processors: [...processors.values()], scenarios, evidence: [...evidence.values()], humanApproval: "pending",
            limitations: [
              "사례별 검토 자료와 서버 계산에 근거한 조건부 비교입니다. 반출·계약·처리는 현장 담당자의 별도 검토와 승인이 필요합니다.",
              "unknown·ineligible 경로는 비교 대상에서 제외했습니다. 비용·탄소의 unavailable 및 기준선 없음 상태를 그대로 보존합니다.",
              ...(processors.size === 0 ? ["검증된 업체 후보가 없습니다. 실제 처리·인수 가능성을 확인해야 합니다."] : []),
              ...[...processors.values()].filter((p) => p.acceptance !== "confirmed").map((p) => `인수 의사 미확인: ${p.processorId}`),
            ] });
        }
      } catch (error) { result = hold(error instanceof ValidationError ? error.reason : "host-comparison-invalid"); }
      if (proposal !== undefined) {
        try {
          const candidate = parseDecision(proposal);
          requireValid(candidate.caseId === facts.caseId, "proposal-case-mismatch");
          for (const record of candidate.evidence) {
            requireValid(record.licenseVerified && !!record.license?.trim(), "proposal-reuse-unverified");
            const trusted = result.evidence.find((item) => item.sourceId === record.sourceId);
            requireValid(trusted !== undefined && canonical(trusted) === canonical(record), "proposal-evidence-conflict");
          }
          if (candidate.state === "compared") {
            requireValid(candidate.humanApproval === "pending", "proposal-human-approval-forbidden");
            requireValid(result.state === "compared" && canonical(candidate) === canonical(result), "proposal-comparison-mismatch");
          }
        } catch (error) { return hold(error instanceof ValidationError ? error.reason : "proposal-invalid"); }
      }
      return structuredClone(result);
    },
    comparison: () => structuredClone(owned.comparison),
    readiness: () => ({ processors: find !== undefined, calculations: calculate !== undefined, comparison: owned.comparison !== undefined }),
  };
}
