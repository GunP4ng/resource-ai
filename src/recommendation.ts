import type { CaseInput, DecisionResult, Estimate, RecommendationMetric, RouteAssessment, RouteRecommendation } from "./contracts.ts";
import type { CaseAssessment, RouteReviewContext } from "./assessment.ts";
import { isProhibitedReviewExplanation, safetyReasons } from "./o-safety-reasons.ts";
import { parseDecision } from "./o-decision.ts";
import { massQuestion } from "./input.ts";

const executionChecks = [
  "현행 허가의 유효기간·허가 범위와 해당 수지·오염 상태의 처리 가능 여부를 관할기관·업체에 확인하세요.",
  "업체의 실제 인수 의사·계약 조건을 확인하세요.",
  "실측 질량·수율·운송 거리와 실제 견적·세금·운송 조건을 확인하세요.",
  "탄소 계수의 수지·지역·기간·계산 경계와 크레딧 적용 가능성을 확인하세요.",
  "반출·계약·처리 전 현장 책임자의 별도 검토와 승인을 받으세요.",
] as const;

export function executionChecksFor(assessment: CaseAssessment): readonly string[] {
  return [...new Set([...executionChecks, ...assessment.legal.reviewRequirements, ...Object.values(assessment.requiredChecks).flat(),
    ...assessment.legal.issues.filter(({ kind }) => kind === "unrelated" || kind === "context-ambiguous")
      .map(({ sourceId }) => `공개 인용과 이 사례의 관련성이 약합니다. 적용 행·수지·처리 공정의 관련성을 실행 전에 확인하세요 (${sourceId}).`),
    ...assessment.legal.issues.filter(({ kind }) => kind !== "unrelated" && kind !== "context-ambiguous")
      .map(({ kind, sourceId }) => `근거 확인 상태: ${kind} (${sourceId ?? "unknown"}). 채택한 인용과 별도로 확인하세요.`),
    ...assessment.pendingLegal.issues.map(({ kind }) => `법령 시행본 확인 상태: ${kind}`),
    ...assessment.pendingLegal.pending.map(({ sourceId }) => `법령 원문 확인 대기: ${sourceId}`),
    ...assessment.routes.flatMap(route => route.eligibility.state === "ineligible" ? route.eligibility.reasons : [])])];
}

function publicRecyclingEvidence(assessment: CaseAssessment): readonly string[] {
  const citations = assessment.legal.citations;
  const required = ["-annex4-code", "-annex4-2-r3-3", "-annex4-3-types", "-annex5-3-common"] as const;
  if (!required.every(suffix => citations.some(citation => citation.sourceId.endsWith(suffix)))) return [];
  return citations.filter(citation => required.some(suffix => citation.sourceId.endsWith(suffix))).map(citation => citation.sourceId);
}

/** Lookup excludes unusable citations; one rejected source does not veto other routes. */
export function recommendationBlockers(facts: CaseInput, assessment: CaseAssessment, reviews?: RouteReviewContext): readonly string[] {
  return [
    ...(facts.hazardousContact === "yes" ? [safetyReasons.contactClassification] : []),
    ...(/지정폐기물\s*(?:의심|해당(?!\s*(?:없|아님|하지\s*않))|가능)|(?:suspected|confirmed)\s+hazardous\s+waste/iu.test(
      [facts.description, facts.process, facts.contamination].join(" ")) ? [safetyReasons.designatedSuspected] : []),
    ...(/유해물질\s*접촉\s*(?:있음|의심)|(?:suspected|confirmed)\s+hazardous\s+contact/iu.test(
      [facts.description, facts.contamination].join(" ")) ? [safetyReasons.contactSuspected] : []),
    ...assessment.reviewIssues,
    ...(assessment.legal.evidence.length === 0 || assessment.legal.citations.length === 0 ? ["검증된 법령 인용 없음"] : []),
    ...(assessment.questions.every(question => question === massQuestion) && publicRecyclingEvidence(assessment).length === 0
      && assessment.routes.every(route => route.eligibility.state !== "eligible") ? ["경로별 판단에 필요한 공개 법령 인용 부족"] : []),
    ...(/불일치|상충|일치하지|labels?\s*(?:conflict|mismatch)|conflicting\s+labels?/iu.test(
      [facts.polymer, facts.process, facts.description].join(" "))
      || /사출\s*아님|압출\s*아님/u.test(facts.process ?? "") ? ["입력 자체 모순 확인 필요"] : []),
    ...(reviews?.reviews.flatMap(review => review.checks.filter(check => check.state === "not-met"
      && (check.requirement.includes("지정폐기물 제외")
        || isProhibitedReviewExplanation(check.explanation)))
      .map(check => `${check.requirement}: ${check.explanation}`)) ?? []),
    ...assessment.questions.filter(question => /혼합·다층 또는 라벨 불일치가 보고/u.test(question)),
  ];
}

function metric<Unit extends "KRW" | "kgCO2e">(estimate: Estimate<Unit> | undefined, unit: Unit, massMissing: boolean): RecommendationMetric<Unit> {
  if (massMissing) return { value: null, unit, label: "unavailable",
    reasons: [unit === "KRW" ? "질량을 몰라 비용을 계산하지 않았어요. 질량과 견적·운송·처리 비용 자료가 필요해요."
      : "질량을 몰라 탄소량을 계산하지 않았어요. 질량과 같은 계산 범위의 탄소 계수 자료가 필요해요."] };
  if (estimate === undefined) return { value: null, unit, label: "unavailable",
    reasons: [unit === "KRW" ? "사례별 검증된 견적·운송·처리 비용 자료 없음" : "동일 계산 경계의 활동량·적용 가능한 탄소 계수 없음"] };
  switch (estimate.state) {
    case "available":
      return { value: estimate.central, unit, label: estimate.assumptions.length ? "assumption" : "calculated",
        reasons: [...estimate.assumptions] };
    case "unavailable":
      return { value: null, unit, label: "unavailable", reasons: [...estimate.missingInputs] };
  }
}

/** Enrich both calculation-backed comparisons and recommendations with no field resources. */
export function recommend(facts: CaseInput, assessment: CaseAssessment,
  compared?: Extract<DecisionResult, { state: "compared" }>): Extract<DecisionResult, { state: "compared" }> {
  const scenarios = compared?.scenarios ?? [];
  const publicEvidence = publicRecyclingEvidence(assessment);
  const routes: readonly RouteAssessment[] = assessment.routes.map(route => {
    if (route.eligibility.state === "eligible") return route;
    return { ...route, eligibility: route.route === "mechanical-recycling" && publicEvidence.length > 0
      ? { state: "conditional", evidenceIds: publicEvidence, conditions: ["공개 근거상 가능(조건부): 51-03-01의 R-3-3 원료물질 제조 유형 후보"] }
      : { state: "unknown", missingFacts: ["이 경로의 용도·처리 방식에 맞는 개별 공개 근거가 부족합니다."] } };
  });
  const priority = ["mechanical-recycling", "reuse", "other-recovery", "disposal"] as const;
  const recommendations: readonly RouteRecommendation[] = priority.flatMap((kind) => {
    const route = routes.find(item => item.route === kind);
    if (route === undefined || (route.eligibility.state !== "eligible" && route.eligibility.state !== "conditional")) return [];
    const scenario = scenarios.find(item => item.routeId === route.routeId);
    return [{ routeId: route.routeId, rank: priority.indexOf(kind) + 1,
      grade: route.eligibility.state === "conditional" ? "public-conditional" : "reviewed",
      basis: "공개 법령의 폐합성수지류 분류·허용 유형·R-3-3 정의·공통기준을 연결한 원료물질 제조 후보입니다. 실제 발생 공정을 처리 공정으로 간주하지 않으며 비용·탄소 우월성을 뜻하지 않습니다.",
      legalCitations: assessment.legal.citations.filter(citation => publicEvidence.includes(citation.sourceId))
        .map(({ sourceId, locator, claim }) => ({ sourceId, locator, claim })),
      cost: metric(scenario?.netCost, "KRW", facts.massKg === null), carbon: metric(scenario?.netEmissions, "kgCO2e", facts.massKg === null) }];
  });
  const result = {
    ...(compared ?? { state: "compared", caseId: facts.caseId, processors: [], scenarios: [],
      evidence: [...assessment.legal.evidence, ...assessment.reviewEvidence], humanApproval: "pending", limitations: [] }),
    routes,
    recommendations,
    confidence: { level: scenarios.length && !assessment.legal.issues.length ? "medium" : "low", reasons: [
      "입력은 신고된 정보이며 현장 조건의 충족이나 법적 적합성을 확정하지 않았습니다.",
      ...(assessment.legal.issues.some(({ kind }) => kind === "unrelated" || kind === "context-ambiguous")
        ? ["검증된 공개 인용과 이 사례의 관련성이 약해 확신도를 낮췄습니다. 개별 적용 여부는 추가 확인이 필요합니다."] : []),
      ...(scenarios.length ? ["검증된 자료의 계산값에도 적용 조건이 있습니다."] : ["비용·탄소 비교값이 없어 검토 순서만 제시합니다."]),
    ] },
    preExecutionChecks: executionChecksFor(assessment),
    limitations: [...(compared?.limitations ?? []), "추천 후보, 실행 전 확인 필요. 실행·반출·계약의 승인 결과가 아닙니다.",
      "추천 순위는 검토 순서입니다. 검증되지 않은 수치·폐기물 코드·업체 허가를 추정하지 않습니다."],
  } satisfies Extract<DecisionResult, { state: "compared" }>;
  parseDecision(result);
  return result;
}
