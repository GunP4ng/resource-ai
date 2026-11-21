import type { CaseInput, DecisionResult, RouteAssessment } from "./contracts.ts";
import { createResourceDomain } from "./domain.ts";
import type { CaseResearchAttachment } from "./o-case-research-schema.ts";
import type { PublicInputScenario } from "./o-input-public-scenario.ts";
import { buildScenarioGuidance } from "./o-scenario-guidance.ts";
import type { ScenarioGuidance } from "./o-scenario-guidance.ts";
import { isUnknownCaseText, revision, requireValid } from "./o-validation.ts";
import type { PhotoObservations } from "./photo-observations.ts";
import { canonicalMaterial } from "./material-context.ts";

export interface GuidanceComparison {
  readonly firstRouteId: string | null;
  readonly secondRouteId: string | null;
  readonly actualSecondAvailable: boolean;
  readonly summary: string;
  readonly costAdvantageKrw: number | null;
  readonly carbonAdvantageKgCo2e: number | null;
  readonly regulatoryConditions: readonly string[];
  readonly objective: string;
  readonly boundary: string | null;
  readonly assumptions: readonly string[];
  readonly stability: {
    readonly status: "sufficient" | "unavailable";
    /** Worst-case remaining margin to every other modeled route, in separate units. */
    readonly costMarginKrw: number | null;
    readonly carbonMarginKgCo2e: number | null;
    readonly condition: string;
    readonly comparedRouteIds: readonly string[];
  };
  readonly unavailableReasons: readonly string[];
}

export interface GuidanceStage {
  readonly stage: 1 | 2 | 3 | 4 | 5 | 6;
  readonly name: string;
  readonly status: "available" | "partial" | "missing";
  readonly outputs: readonly string[];
  readonly reasons: readonly string[];
}

export interface OneFactProbe {
  readonly id: string;
  readonly field: "polymer" | "contamination" | "hazardousContact";
  readonly originalValue: string | null;
  readonly hypotheticalValue: string;
  readonly hypothesis: string;
  readonly resultingState: DecisionResult["state"];
  readonly newlyRecommendedRouteIds: readonly string[];
  readonly newlySupportedRouteIds: readonly string[];
  readonly openedPathCount: number;
  readonly strictRoutes: readonly { readonly routeId: string; readonly state: RouteAssessment["eligibility"]["state"] }[];
  readonly remainingUnknowns: readonly string[];
}

export interface OneFactGuidance {
  readonly status: "evaluated" | "limited" | "not-held";
  readonly priorityFactId: string | null;
  readonly baselinePublicState: DecisionResult["state"] | null;
  readonly probes: readonly OneFactProbe[];
  readonly multipleFactsMayBeRequired: boolean;
  readonly limitations: readonly string[];
}

export interface CaseGuidanceOptions {
  readonly publicScenario?: PublicInputScenario;
  readonly research?: CaseResearchAttachment;
  readonly photoObservations?: PhotoObservations;
  readonly publicDirectoryCount?: number;
}

export interface CaseGuidance {
  readonly purpose: "presentation-only";
  readonly inputRevision: string;
  readonly actualComparison: GuidanceComparison;
  readonly stages: readonly GuidanceStage[];
  readonly scenario: ScenarioGuidance | null;
  readonly oneFactPriority: OneFactGuidance;
  readonly limitations: readonly string[];
}

function unresolved(decision: DecisionResult): readonly string[] {
  switch (decision.state) {
    case "compared": return decision.preExecutionChecks ?? decision.limitations;
    case "needs-information": return decision.questions;
    case "needs-review": return decision.reasons;
  }
}

function actualComparison(decision: DecisionResult): GuidanceComparison {
  const recommendations = decision.state === "compared" ? decision.recommendations ?? [] : [];
  const first = recommendations.find(route => route.rank === 1);
  const second = recommendations.find(route => route.rank === 2);
  const scenarios = decision.state === "compared" ? decision.scenarios : [];
  const firstScenario = scenarios.find(row => row.routeId === first?.routeId);
  const secondScenario = scenarios.find(row => row.routeId === second?.routeId);
  const conditions = decision.state === "compared" ? [
    ...decision.routes.filter(route => route.routeId === first?.routeId || route.routeId === second?.routeId)
      .flatMap(route => {
        switch (route.eligibility.state) {
          case "eligible":
          case "conditional": return route.eligibility.conditions;
          case "unknown": return route.eligibility.missingFacts;
          case "ineligible": return route.eligibility.reasons;
        }
      }),
    ...(decision.preExecutionChecks ?? []),
  ] : unresolved(decision);
  const sharedBoundary = firstScenario !== undefined && secondScenario !== undefined
    && firstScenario.boundary === secondScenario.boundary && firstScenario.functionalUnit === secondScenario.functionalUnit;
  const cost = sharedBoundary && firstScenario.netCost.state === "available" && secondScenario.netCost.state === "available"
    ? secondScenario.netCost.central - firstScenario.netCost.central : null;
  const carbon = sharedBoundary && firstScenario.netEmissions.state === "available" && secondScenario.netEmissions.state === "available"
    ? secondScenario.netEmissions.central - firstScenario.netEmissions.central : null;
  const reasons = [
    ...(first === undefined ? ["실제 추천 1순위가 없습니다."] : []),
    ...(second === undefined ? ["실제 추천 2순위가 없어 실제 1·2순위 수치 우위를 비교할 수 없습니다."] : []),
    ...(cost === null ? ["동일 기능단위·경계의 실제 1·2순위 비용 비교값이 없습니다."] : []),
    ...(carbon === null ? ["동일 기능단위·경계의 실제 1·2순위 탄소 비교값이 없습니다."] : []),
  ];
  let costMargin: number | null = null, carbonMargin: number | null = null;
  const others = scenarios.filter(row => row.routeId !== first?.routeId);
  const allModeled = firstScenario !== undefined && others.length > 0
    && recommendations.every(route => scenarios.some(row => row.routeId === route.routeId))
    && scenarios.every(row => row.boundary === firstScenario.boundary && row.functionalUnit === firstScenario.functionalUnit);
  if (allModeled && firstScenario.netCost.state === "available" && firstScenario.netEmissions.state === "available"
    && others.every(row => row.netCost.state === "available" && row.netEmissions.state === "available")) {
    const firstCostHigh = firstScenario.netCost.high, firstCarbonHigh = firstScenario.netEmissions.high;
    const margins = others.flatMap(row => row.netCost.state === "available" && row.netEmissions.state === "available"
      ? [{ cost: row.netCost.low - firstCostHigh, carbon: row.netEmissions.low - firstCarbonHigh }] : []);
    costMargin = Math.min(...margins.map(row => row.cost));
    carbonMargin = Math.min(...margins.map(row => row.carbon));
  }
  const sufficient = costMargin !== null && carbonMargin !== null && costMargin >= 0 && carbonMargin >= 0;
  if (!sufficient) reasons.push("모든 모델 경로의 비용·탄소 구간에서 약우월성을 보장하지 못합니다. 미확보값·상충에 가중치를 임의 부여하지 않습니다.");
  return {
    firstRouteId: first?.routeId ?? null, secondRouteId: second?.routeId ?? null,
    actualSecondAvailable: second !== undefined, costAdvantageKrw: cost, carbonAdvantageKgCo2e: carbon,
    summary: second === undefined
      ? `${first?.routeId ?? "추천 보류"}: 실제 2순위 없음; ${sufficient ? "명시된 모든 모델 경로의 구간·경계에서만 조건부 약우월" : "비용·탄소 우위와 조건부 최적성은 미확인"}, ${conditions[0] ?? "사례별 규정·허가 확인 필요"}`
      : `${first?.routeId ?? "1순위 없음"} 대비 실제 2순위 ${second.routeId}: 비용 우위 ${cost === null ? "미확인" : `${cost} KRW`}, 탄소 우위 ${carbon === null ? "미확인" : `${carbon} kgCO2e`}; ${sufficient ? "명시 구간·경계에서만 조건부 약우월" : "조건부 최적성 미확인"}; ${conditions[0] ?? "사례별 규정·허가 확인 필요"}`,
    regulatoryConditions: [...new Set(conditions)], objective: "모델 경로의 비용(KRW)·탄소(kgCO2e)를 각각 최소화",
    boundary: firstScenario === undefined ? null : `${firstScenario.functionalUnit}; ${firstScenario.boundary}`,
    assumptions: scenarios.flatMap(row => [
      ...(row.netCost.state === "available" ? row.netCost.assumptions : []),
      ...(row.netEmissions.state === "available" ? row.netEmissions.assumptions : []),
    ]),
    stability: { status: sufficient ? "sufficient" : "unavailable", costMarginKrw: costMargin,
      carbonMarginKgCo2e: carbonMargin, comparedRouteIds: scenarios.map(row => row.routeId),
      condition: "모든 다른 경로에 대해 first.cost.high <= other.cost.low 및 first.carbon.high <= other.carbon.low. 추가 불리한 변화의 합이 각 단위의 여유 이하여야 하며 경계·규정 조건은 고정입니다." },
    unavailableReasons: reasons,
  };
}

async function oneFactPriority(input: CaseInput, decision: DecisionResult, options: CaseGuidanceOptions): Promise<OneFactGuidance> {
  const limits = [
    "기존 공개 규칙만 격리된 가설 입력에 실행합니다. 실제 입력·결정·엄격 적격성·승인은 바꾸지 않습니다.",
    "열린 경로 수는 새 추천 또는 새 route-supported 안내의 합집합이며 허가·인수·실행 가능 경로 수가 아닙니다.",
    "가설은 검증된 사실이 아닙니다. 제시한 사실을 자료로 확인한 뒤 원래 평가 흐름에서 재평가해야 합니다.",
  ];
  if (decision.state === "compared") return { status: "not-held", priorityFactId: null, baselinePublicState: null,
    probes: [], multipleFactsMayBeRequired: false, limitations: limits };
  if (input.photoRefs.length > 0 || options.photoObservations !== undefined) return {
    status: "limited", priorityFactId: null, baselinePublicState: null, probes: [], multipleFactsMayBeRequired: true,
    limitations: [...limits, "사진·관찰은 원래 입력 revision에 묶여 있습니다. 사진 제거·관찰 재바인딩으로 충돌을 없애는 가설 평가는 하지 않았습니다."],
  };
  const original = structuredClone(input);
  const baseline = await createResourceDomain(original).decide();
  if (input.hazardousContact === "yes" || (baseline.state === "needs-review"
    && baseline.reasons.some(reason => /유해물질 접촉·지정폐기물|지정폐기물 의심 입력|유해물질 접촉 의심 입력/u.test(reason)))) {
    return { status: "limited", priorityFactId: null, baselinePublicState: baseline.state, probes: [],
      multipleFactsMayBeRequired: true,
      limitations: [...limits, "보고·의심된 유해 접촉을 no로 바꾸거나 오염 서술을 지워 경로를 열지 않습니다.", ...unresolved(baseline)] };
  }
  if (baseline.state === "compared") return { status: "limited", priorityFactId: null, baselinePublicState: baseline.state,
    probes: [], multipleFactsMayBeRequired: true,
    limitations: [...limits, "실제 보류 원인이 공개 입력 규칙만으로 재현되지 않습니다. 서버 검토·추가 근거의 보류를 해소했다고 추론할 수 없습니다.", ...unresolved(decision)] };
  const hypotheses: { readonly field: OneFactProbe["field"]; readonly value: string; readonly explanation: string }[] = [];
  const tokens = [...new Set((input.polymer ?? "").toUpperCase().match(/\b(?:PET|HDPE|LDPE|PP|PS|PVC|ABS|PE)\b/gu) ?? [])].sort();
  for (const token of tokens) if (input.polymer?.trim().toUpperCase() !== token) hypotheses.push({
    field: "polymer", value: token, explanation: `polymer에 명시된 ${token}이 단일 수지로 확인된다는 가설입니다. 혼합·층별 분리·라벨 문제는 확인 자료가 필요합니다.`,
  });
  if (!["없음", "오염 없음", "clean", "none"].includes(input.contamination?.trim().toLowerCase() ?? "")) hypotheses.push({
    field: "contamination", value: "없음", explanation: "오염이 없다는 확인 자료가 확보된다는 가설입니다. 세척 행위 자체를 확인 사실로 삼지 않습니다.",
  });
  if (input.hazardousContact === "unknown") hypotheses.push({
    field: "hazardousContact", value: "no", explanation: "현재 unknown인 유해 접촉 이력이 없다고 확인된다는 가설입니다. 보고된 yes는 바꾸지 않습니다.",
  });
  const baselineSupported = new Set((baseline.conditionalAlternatives ?? [])
    .filter(item => item.support.state === "route-supported").map(item => item.routeId));
  const probes: OneFactProbe[] = [];
  for (const hypothesis of hypotheses) {
    // Exactly one structured field changes. Narrative and photographs remain byte-identical.
    const hypothetical: CaseInput = hypothesis.field === "hazardousContact"
      ? { ...structuredClone(original), hazardousContact: "no" }
      : { ...structuredClone(original), [hypothesis.field]: hypothesis.value };
    const domain = createResourceDomain(hypothetical);
    const result = await domain.decide();
    const newlyRecommendedRouteIds = result.state === "compared" ? (result.recommendations ?? []).map(row => row.routeId) : [];
    const newlySupportedRouteIds = result.state === "compared" ? [] : (result.conditionalAlternatives ?? [])
      .filter(row => row.support.state === "route-supported" && !baselineSupported.has(row.routeId)).map(row => row.routeId);
    probes.push({
      id: `${hypothesis.field}:${hypothesis.value}`, field: hypothesis.field, originalValue: input[hypothesis.field],
      hypotheticalValue: hypothesis.value, hypothesis: hypothesis.explanation, resultingState: result.state,
      newlyRecommendedRouteIds, newlySupportedRouteIds,
      openedPathCount: new Set([...newlyRecommendedRouteIds, ...newlySupportedRouteIds]).size,
      strictRoutes: domain.assess().routes.map(row => ({ routeId: row.routeId, state: row.eligibility.state })),
      remainingUnknowns: [...unresolved(result), ...(result.state === "compared" ? [] :
        (result.conditionalAlternatives ?? []).flatMap(row => [...row.support.missingEvidence, ...row.nextChecks]))],
    });
  }
  probes.sort((a, b) => b.openedPathCount - a.openedPathCount
    || b.newlyRecommendedRouteIds.length - a.newlyRecommendedRouteIds.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const priority = probes.find(probe => probe.openedPathCount > 0);
  return { status: "evaluated", priorityFactId: priority?.id ?? null, baselinePublicState: baseline.state, probes,
    multipleFactsMayBeRequired: !probes.some(probe => probe.resultingState === "compared"),
    limitations: [...limits, ...(tokens.length === 0 ? ["polymer에 명시된 수지 토큰이 없어 재질 대안을 만들지 않았습니다."] : []),
      ...(priority === undefined ? ["한 가지 확인 가설만으로 새로 추천·지원되는 경로가 없습니다. 남은 사실·개별 적용 근거를 함께 확인해야 합니다.", ...unresolved(baseline)] : [])] };
}

/** Ephemeral host UI guidance; callers supply only the current evaluated input and optional authenticated research context. */
function caseGuidanceContent(input: CaseInput, decision: DecisionResult, options: CaseGuidanceOptions = {}): Omit<CaseGuidance, "oneFactPriority"> {
  requireValid(input.caseId === decision.caseId, "guidance-case-mismatch");
  const inputRevision = revision(input);
  const context = options.publicScenario ?? options.research;
  const limitations: string[] = ["단계 상태는 현재 출력의 충족도입니다. 사실·법률 적합성·허가·인수·승인을 확정하지 않습니다."];
  const bindingMatches = context !== undefined && context.binding.caseId === input.caseId
    && context.binding.inputRevision === inputRevision && context.binding.assessmentDate === input.assessmentDate;
  const material = canonicalMaterial(input.polymer);
  const canUseNumbers = decision.state === "compared" && input.hazardousContact === "no"
    && (material === "PET" || material === "HDPE") && input.massKg !== null && input.massKg > 0;
  let scenario: ScenarioGuidance | null = null;
  if (context !== undefined && bindingMatches && canUseNumbers) scenario = buildScenarioGuidance(context);
  else limitations.push(context === undefined ? "현재 입력에 연결된 공개 계산 문맥이 없어 수치 시나리오 guidance를 만들지 않았습니다."
    : !bindingMatches ? "공개 계산 문맥의 입력 revision·사례·평가일이 현재 입력과 달라 수치 guidance를 제외했습니다."
      : "보류·유해 접촉·미확인 또는 혼합 수지·질량 미확보 사례에는 수치 순위를 제시하지 않습니다. 가상 계산은 사례 적합성 근거가 아닙니다.");
  const comparison = actualComparison(decision);
  const held = decision.state !== "compared";
  const routes = decision.state === "compared" ? decision.routes : [];
  const recommendations = decision.state === "compared" ? decision.recommendations ?? [] : [];
  const alternatives = decision.state === "compared" ? [] : decision.conditionalAlternatives ?? [];
  const processors = decision.state === "compared" ? decision.processors : [];
  const directoryCount = (options.research?.processors.rows.length ?? 0) + (options.publicDirectoryCount ?? 0);
  const actualScenarios = decision.state === "compared" ? decision.scenarios : [];
  const identificationGaps = [
    ...(isUnknownCaseText(input.polymer) ? ["재질 확인 자료가 없습니다."] : []),
    ...(isUnknownCaseText(input.process) ? ["발생 공정이 미확보입니다."] : []),
    ...(isUnknownCaseText(input.region) ? ["발생 지역이 미확보입니다."] : []),
    ...(!input.contamination?.trim() ? ["오염 상태가 미확보입니다."] : []),
    ...(input.hazardousContact !== "no" ? ["접촉·유해성 분류 확인이 남았습니다."] : []),
    ...(held ? unresolved(decision) : []),
  ];
  const stages: readonly GuidanceStage[] = [
    { stage: 1, name: "폐기물·부산물 식별 및 분류",
      status: !isUnknownCaseText(input.polymer) ? identificationGaps.length ? "partial" : "available" : "missing",
      outputs: [
        !isUnknownCaseText(input.polymer) ? `신고 재질: ${input.polymer}` : "신고 재질 미확보",
        `발생 공정: ${isUnknownCaseText(input.process) ? "미확보" : input.process}`, `오염 상태: ${input.contamination ?? "미확보"}`,
        `유해 접촉 신고: ${input.hazardousContact}`,
        `질량: ${input.massKg === null ? "미입력(정성 검토에는 선택)" : `${input.massKg} kg`}`,
        `발생 지역: ${input.region ?? "미확보"}`, `평가 기준일: ${input.assessmentDate}`,
      ],
      reasons: [...identificationGaps, "신고된 입력과 분류 검토 출력만 표시합니다. 사진·서술로 새로운 재질이나 폐기물 종류를 제안하지 않습니다."] },
    { stage: 2, name: "재사용·재활용 가능성 판단",
      status: routes.some(route => route.eligibility.state === "eligible") ? "available"
        : recommendations.length || alternatives.length ? "partial" : "missing",
      outputs: [...recommendations.map(route => `조건부 추천: ${route.routeId}`),
        ...alternatives.map(route => `가정별 안내: ${route.routeId} (${route.support.state})`)],
      reasons: [...(held ? unresolved(decision) : []), "추천·가정별 안내는 엄격 적격성이나 처리 실행 승인과 다릅니다."] },
    { stage: 3, name: "관련 규정 검토",
      status: routes.some(route => route.eligibility.state === "eligible") ? "available" : decision.evidence.length ? "partial" : "missing",
      outputs: decision.evidence.map(record => record.sourceId),
      reasons: [...comparison.regulatoryConditions, "일반 인용과 가상 시나리오는 개별 적용 기준 충족·현행 허가의 증명이 아닙니다."] },
    { stage: 4, name: "활용 가능 업종·기업 탐색",
      status: processors.some(item => item.permitEvidenceIds.length > 0 && item.verifiedAt !== null && item.acceptance === "confirmed")
        ? "available" : processors.length || directoryCount ? "partial" : "missing",
      outputs: [...processors.map(item => item.name), ...(directoryCount ? [`공개 문의 목록 ${directoryCount}행(사례 적합성 미확인)`] : [])],
      reasons: ["공개 업체 목록은 문의 후보입니다. 현재 허가 범위·공정·지역 적합성·실제 인수 의사를 별도로 확인해야 합니다."] },
    { stage: 5, name: "비용·탄소절감 효과 비교",
      status: actualScenarios.length > 1 && actualScenarios.every(row => row.netCost.state === "available" && row.netEmissions.state === "available")
        ? "available" : actualScenarios.length || context !== undefined ? "partial" : "missing",
      outputs: [...actualScenarios.map(row => `실제 비교 출력: ${row.routeId}`),
        ...(context === undefined ? [] : ["가상 공개 계산 문맥이 있으나 실제 비용·탄소 효과의 증명은 아닙니다."])],
      reasons: [...comparison.unavailableReasons, ...(scenario?.unavailableReasons ?? []), ...(!canUseNumbers ? [limitations.at(-1) ?? "사례 수치 순위 제외"] : [])] },
    { stage: 6, name: "최적 처리방안 제안",
      status: comparison.stability.status === "sufficient" ? "available" : recommendations.length || alternatives.length ? "partial" : "missing",
      outputs: [comparison.summary, ...(scenario === null ? [] : [scenario.summary])],
      reasons: ["조건부 약우월성은 명시한 모델 경로·계산 경계·범위 안에서만 성립합니다. 실제 실행·반출·계약 승인은 별도입니다.",
        ...comparison.unavailableReasons] },
  ];
  return { purpose: "presentation-only", inputRevision, actualComparison: comparison, stages, scenario, limitations };
}

/** Public progress never receives research context or exposes outputs or numerical comparisons. */
export function buildPublicCaseProgress(input: CaseInput, decision: DecisionResult): readonly Pick<GuidanceStage, "stage" | "name" | "status" | "reasons">[] {
  return caseGuidanceContent(input, decision).stages.map(({ stage, name, status, reasons }) => ({ stage, name, status, reasons }));
}

export async function buildCaseGuidance(input: CaseInput, decision: DecisionResult, options: CaseGuidanceOptions = {}): Promise<CaseGuidance> {
  return { ...caseGuidanceContent(input, decision, options), oneFactPriority: await oneFactPriority(input, decision, options) };
}
