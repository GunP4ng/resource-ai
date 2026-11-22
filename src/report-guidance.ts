import { displayGuidanceOutput } from "./report-copy.ts";
import type { CaseGuidance, GuidanceStage } from "./o-case-guidance.ts";
import type { ReportContext, ReportPresentation } from "./report.ts";
import type { DecisionResult } from "./contracts.ts";
import type { ScenarioSensitivity } from "./o-scenario-sensitivity.ts";
import { escapeHtml, list, safeLink } from "./report-html.ts";
import { rawReasons, readableReason, readableReasons } from "./report-evidence.ts";
import { renderModelHostAudit } from "./report-model-audit.ts";
import { koreanSourceDate } from "./report-date.ts";

type Names = Readonly<Record<string, string>>;
const number = (value: number, digits: number) => value.toLocaleString("ko-KR", { maximumFractionDigits: digits });
const fieldNames = { polymer: "재질·분리 상태", contamination: "오염 상태", hazardousContact: "유해물질 접촉 이력" } as const;
const stageNames = ["식별·분류", "재활용 가능성", "규정 검토", "업체 탐색", "비용·탄소", "처리 방안"] as const;
const statusNames = { available: "자료 있음", partial: "일부 자료", missing: "자료 필요" } as const;
const stageMethods = {
  1: "입력 항목과 판정 연결", 2: "경로 조건 정리", 3: "규정 근거 정리",
  4: "공개 명부 대조", 5: "앱 계산기", 6: "판정과 가정 비교 정리",
} as const;
const stageIcons = [
  '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h5M8 17h3"/>',
  '<path d="m16 3 4 4-4 4M20 7H9a5 5 0 0 0-5 5m4 9-4-4 4-4M4 17h11a5 5 0 0 0 5-5"/>',
  '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  '<path d="M3 21V8l6 3V7l6 4V3h6v18ZM7 16h2m4 0h2m3 0h1"/>',
  '<path d="M4 20h16M7 16v-4m5 4V8m5 8V4"/>',
  '<path d="M5 4v17M5 4h14l-3 5 3 5H5"/>',
] as const;
function stageStrip(stages: readonly Pick<GuidanceStage, "stage" | "status">[]): string {
  return `<ol class="guidance-stages">${stages.map(stage => `<li data-guidance-stage="${stage.stage}" data-state="${stage.status}"><svg class="stage-icon screen-only" width="20" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${stageIcons[stage.stage - 1]}</svg><strong>${stage.stage}. ${stageNames[stage.stage - 1]}</strong><span>${statusNames[stage.status]}</span></li>`).join("")}</ol>`;
}

export function resultConclusion(result: DecisionResult): string {
  switch (result.state) {
    case "needs-information":
      return '<p class="state question">추가 정보 필요 · 실행 보류</p><h1>추가 정보 필요</h1><p id="decision-summary">입력 정보가 부족하므로 아래 질문에 답하면 처리 경로를 검토합니다.</p>';
    case "needs-review":
      return '<p class="state held">검토 필요 · 실행 보류</p><h1>검토 필요</h1><p id="decision-summary">확인할 조건이 남아 처리·반출·계약을 보류합니다.</p>';
    case "compared": {
      const recommendation = result.recommendations?.find(item => item.rank === 1);
      const route = result.routes.find(item => item.routeId === recommendation?.routeId);
      const labels = { reuse: "재사용", "mechanical-recycling": "기계적 재활용", "other-recovery": "기타 회수", disposal: "처분" } as const;
      return `<p class="state recommended">${recommendation ? "추천 · 조건부" : "조건부 비교"}</p><h1>${route ? `${labels[route.route]} 추천` : "조건부 비교"}</h1>
        <p id="decision-summary">${escapeHtml(route ? `현재 자료로는 ${labels[route.route]}을 먼저 검토하세요.` : "확인된 조건으로 처리 경로를 비교했습니다.")}</p>
        <p class="result-condition">${result.humanApproval === "pending" ? "실행·반출·계약은 현장 담당자의 승인을 받은 뒤 진행하세요." : "현장 담당자의 승인 기록이 있습니다."}</p>`;
    }
  }
}

/** Display existing host results only; research values stay behind the report audience. */
export function resultMetrics(result: DecisionResult, context: ReportContext): string {
  const guidance = context.audience === "authenticated-research" && result.state === "compared" ? context.guidance : null;
  const comparison = guidance?.actualComparison;
  const calculation = context.audience === "authenticated-research" ? context.publicScenario ?? context.research?.attachment : null;
  const material = calculation?.calculations.cases[0]?.material;
  const reference = calculation?.binding.caseId === result.caseId && calculation.binding.inputRevision === guidance?.inputRevision
    ? calculation.calculations.inputs.find(input => input.input_id === `price.${material}` && input.kind !== "assumed" && input.boundary === "reference_price") : undefined;
  const source = calculation?.calculations.sources.find(item => item.source_id === reference?.source_id);
  const href = source ? safeLink(source.url) : null;
  const canCompare = comparison?.actualSecondAvailable && comparison.firstRouteId !== null && comparison.secondRouteId !== null;
  const rows = [
    { key: "cost", name: "실제 비용 차이", value: canCompare ? comparison.costAdvantageKrw : null, unit: "원",
      missing: "비교할 견적이 부족해요. 두 처리 경로의 업체 견적을 같은 조건으로 받아 주세요." },
    { key: "carbon", name: "실제 탄소 차이", value: canCompare ? comparison.carbonAdvantageKgCo2e : null, unit: "kgCO2e",
      missing: "두 경로를 비교할 배출 자료가 부족해요. 처리량과 공정별 배출계수를 확인해 주세요." },
  ];
  return `<section class="result-metrics screen-only" aria-label="비용·탄소와 참고가격">${rows.map(row => `<article data-result-metric="${row.key}"><h2>${row.name}</h2><p class="metric-value">${row.value == null ? "비교 자료 필요" : `${number(row.value, row.key === "cost" ? 0 : 2)} <span>${row.unit}</span>`}</p>
    <p>${row.value == null ? result.state === "compared" ? row.missing : "검토가 보류돼 아직 비교할 수 없어요. 아래 질문과 보류 사유를 먼저 확인해 주세요." : "실제 2순위 − 1순위 · 양수이면 1순위가 낮습니다."}</p>
    <a href="${row.value == null ? result.state === "compared" ? "#decision-detail" : "#case-reasons" : "#guidance-stage-5"}">${row.value == null ? "필요한 자료 보기" : "비교 조건 보기"}</a></article>`).join("")}
    <article data-result-metric="price"><h2>참고 매각가격</h2><p class="metric-value">${reference?.source_value != null && source && href ? `${number(reference.source_value, 3)} <span>${escapeHtml(reference.source_unit ?? reference.unit)}</span>` : "참고 단가 없음"}</p>
    ${reference?.source_value != null && source && href ? `<p>${escapeHtml(material ?? "")} · ${escapeHtml(reference.geography)} · ${escapeHtml(koreanSourceDate(reference.period))}<br>공개 참고값 · 사례 견적은 업체에 확인하세요.</p><details><summary>가격 출처와 적용 범위</summary><a href="${href}" rel="noreferrer">${escapeHtml(source.title)}</a><p>${escapeHtml(source.locator)} · ${escapeHtml(reference.quality_grade)} · VAT ${escapeHtml(reference.tax_basis)}</p></details>` : '<p>이 사례에 표시할 공개 단가가 없어요. 실제 매각가는 재질과 등급을 알려 주고 업체에 문의해 주세요.</p><a href="#decision-detail">산정 조건 보기</a>'}</article></section>`;
}

export function publicCaseProgress(stages: readonly Pick<GuidanceStage, "stage" | "name" | "status" | "reasons">[] = ([1, 2, 3, 4, 5, 6] as const).map(stage => ({ stage, name: stageNames[stage - 1] ?? "", status: "missing", reasons: ["단계별 자료를 연결하면 진행 상태를 확인할 수 있습니다."] }))): string {
  return `<section id="case-progress" data-progress-audience="public"><h2>검토 단계</h2>
    ${stageStrip(stages)}
    <details><summary>단계별 상태와 빠진 자료</summary><p>단계마다 산출물이 얼마나 채워졌는지 보여 줍니다. 현장 확인·허가·인수·실행 승인은 따로 받으세요. 연구용 가정 계산은 넣지 않았습니다.</p>${stages.map(stage => `<section id="guidance-stage-${stage.stage}">
      <h3>${stage.stage}. ${escapeHtml(stage.name)} · ${statusNames[stage.status]}</h3>${list(readableReasons(stage.reasons))}</section>`).join("")}</details></section>`;
}

/** A scenario result never becomes an actual second recommendation or an execution permit. */
export function guidanceScenarioConclusion(guidance: CaseGuidance, names: Names): string | undefined {
  const scenario = guidance.scenario;
  if (scenario?.status === "conditionally-optimal" && scenario.firstRouteId && scenario.hypotheticalRunnerUpRouteId) {
    const difference = scenario.differences.find(row => row.routeId === scenario.hypotheticalRunnerUpRouteId);
    if (difference?.costAdvantageKrw !== null && difference?.costAdvantageKrw !== undefined
      && difference.carbonAdvantageKgCo2e !== null) {
      const condition = scenario.feeBound ? " 및 소각단가 0원/t 이상" : "";
      const first = (names[scenario.firstRouteId] ?? scenario.firstRouteId).replace(/ 시나리오$/u, "");
      const second = (names[scenario.hypotheticalRunnerUpRouteId] ?? scenario.hypotheticalRunnerUpRouteId).replace(/ 시나리오$/u, "");
      return `가정표에서 ${first}은 ${second}보다 비용 약 ${number(difference.costAdvantageKrw, 0)}원·탄소 약 ${number(difference.carbonAdvantageKgCo2e, 2)}kgCO2e가 낮거나 같아 조건부 최적안입니다(규정·허가·인수${condition} 조건).`;
    }
  }
  return undefined;
}

export function guidanceConclusion(guidance: CaseGuidance, names: Names): string | undefined {
  const comparison = guidance.actualComparison;
  if (comparison.firstRouteId && !comparison.actualSecondAvailable) {
    return `현재 ${names[comparison.firstRouteId] ?? comparison.firstRouteId}만 추천 후보입니다. 실제 2순위와 비용·탄소를 비교할 근거는 아직 없습니다.`;
  }
  if (!comparison.firstRouteId || !comparison.secondRouteId) return undefined;
  return `${names[comparison.firstRouteId] ?? comparison.firstRouteId}과 2순위 ${names[comparison.secondRouteId] ?? comparison.secondRouteId}의 차이(2순위 − 1순위): 비용 ${comparison.costAdvantageKrw === null ? "자료 필요" : `${number(comparison.costAdvantageKrw, 0)}원`}, 탄소 ${comparison.carbonAdvantageKgCo2e === null ? "자료 필요" : `${number(comparison.carbonAdvantageKgCo2e, 2)}kgCO2e`}. 규정·허가·인수 조건은 따로 확인하세요.`;
}

export function guidanceProgress(guidance: CaseGuidance, presentation: ReportPresentation, names: Names): string {
  const sharedReasons = rawReasons(guidance.actualComparison.regulatoryConditions);
  const reasonTarget = guidance.oneFactPriority.status === "not-held" ? "#checks" : "#case-reasons";
  const showReasons = (items: readonly string[]) => {
    const unique = rawReasons(items);
    return list(unique.filter(item => !sharedReasons.includes(item)).map(readableReason))
      + (unique.some(item => sharedReasons.includes(item)) ? `<p><a href="${reasonTarget}">보류 사유와 필요한 확인 보기</a></p>` : "");
  };
  const output = (text: string) => readableReason(displayGuidanceOutput(text)).replace(/\b(mechanical-recycling|other-recovery|energy_recovery|recycling|landfill|disposal|reuse|route-supported|unavailable)\b/gu,
    id => names[id] ?? (id === "route-supported" ? "조건별 경로 근거 있음" : "근거 필요"));
  let executionState: "no-model" | "recording" | "trace" | "none";
  let executionLabel: string;
  switch (presentation.mode) {
    case "synthetic":
      executionState = "no-model";
      executionLabel = "합성 예시 · 모델 호출 없음";
      break;
    case "offline":
      executionState = "no-model";
      executionLabel = "오프라인 평가 · 모델 호출 없음";
      break;
    case "recording":
      executionState = "recording";
      executionLabel = "녹화 결과 · 원래 실행 기록은 해당 평가에서 확인";
      break;
    case "live":
      executionState = presentation.runtime?.runner === "local" ? "no-model" : presentation.execution ? "trace" : "none";
      executionLabel = executionState === "no-model" ? "외부 모델 호출 없음"
        : executionState === "trace" ? "실행 추적 기록 있음" : "모델 실행 기록 없음";
      break;
  }
  return `<section id="case-progress"><h2>검토 단계</h2>
    ${stageStrip(guidance.stages)}
    <details><summary>단계별 생성 방식·근거·빈 단계 사유</summary>
      <p>공식 주제자료 3쪽의 예시 흐름에 맞춘 산출물 채움 상태입니다. 현장 확인·허가·승인은 따로 받으세요.</p>
      <p data-model-execution="${executionState}">${executionLabel}. ${presentation.modelAudit ? "아래에 모델 제안과 앱 검사 기록이 있습니다." : "단계별 모델 기록은 없습니다."} 설정이나 추적 식별자만으로는 제공자 실행 성공을 판단할 수 없습니다.</p>
      <p>모델 제안은 앱 규칙으로 검증합니다. 안내와 비용·탄소는 앱이 계산합니다.</p>
      ${presentation.modelAudit ? renderModelHostAudit(presentation.modelAudit, sharedReasons) : ""}
      ${guidance.stages.map(stage => `<section id="guidance-stage-${stage.stage}" data-stage-method="${stage.stage}"><h3>${stage.stage}. ${escapeHtml(stage.name)} · ${statusNames[stage.status]}</h3>
      <p>생성 방식: ${stageMethods[stage.stage]}${presentation.modelAudit ? "" : " · 단계별 모델 기록 없음"}</p>
      ${stage.stage === 6 ? `<p><strong>판정:</strong> ${escapeHtml(guidanceConclusion(guidance, names) ?? "추천 보류 · 필요한 사실과 근거를 확인하세요.")}</p>
        ${guidance.scenario ? `<p><strong>가정 계산:</strong> ${escapeHtml(guidanceScenarioConclusion(guidance, names) ?? "명시한 가정 안에서도 최적안이 정해지지 않았습니다.")}</p>` : ""}
        <p>판정은 사례 자료로, 가정 계산은 공개 가정표로 따로 산출합니다.</p>`
        : stage.stage === 3 ? `<p>연결된 근거 ${stage.outputs.length}건 · <a href="#evidence">출처와 원문 위치 보기</a></p>`
          : stage.outputs.length ? list(stage.stage === 1 || stage.stage === 4 ? stage.outputs : stage.outputs.map(output))
            : "<p>이 단계의 산출물이 아직 없습니다.</p>"}
      ${stage.stage === 6 ? `${showReasons(stage.reasons.filter(reason => !guidance.actualComparison.unavailableReasons.includes(reason)))}
        <p><a href="#guidance-stage-5">비용·탄소 비교 범위와 빠진 자료는 5단계에 있습니다.</a></p>`
        : stage.stage === 5 ? `<p><strong>사례 비교에 필요한 자료:</strong></p>${showReasons(guidance.actualComparison.unavailableReasons)}
          ${guidance.scenario?.unavailableReasons.length ? `<p><strong>가정 계산에 필요한 자료:</strong></p>${list(readableReasons(guidance.scenario.unavailableReasons))}` : ""}
          ${showReasons(stage.reasons.filter(reason => !guidance.actualComparison.unavailableReasons.includes(reason)
            && !guidance.scenario?.unavailableReasons.includes(reason)))}`
          : showReasons(stage.reasons)}</section>`).join("")}</details></section>`;
}

export function guidanceStability(guidance: CaseGuidance, names: Names): string {
  const scenario = guidance.scenario;
  if (!scenario) return "";
  const bound = scenario.feeBound;
  return `<section id="rank-stability"><h2>빈 값이 있어도 유지되는 결론</h2>
    ${scenario.status === "conditionally-optimal"
      ? `<p><strong>${bound?.sufficientUnderAssumption ? "소각 처리단가가 0원/t 이상이면 " : "현재 가정표 범위에서 "}${escapeHtml(names[scenario.firstRouteId ?? ""] ?? "선두 대안")}의 비용·탄소가 다른 대안보다 낮거나 같습니다.</strong> 나머지 가정과 계산 경계는 고정했습니다.</p>`
      : `<p>현재 자료로는 모든 대안에서 비용·탄소 순위가 유지되는지 확인하지 못했습니다.</p>${list(readableReasons(scenario.unavailableReasons))}`}
    <p>${bound ? "소각단가 0원은 조건 검사를 위한 가정입니다. 실제 단가는 견적으로 확인하세요. " : ""}실제 추천 2순위가 아닙니다. 허가·인수는 업체에 확인하세요.</p>
    <details><summary>계산 범위와 가정</summary>
      <p>목적: ${escapeHtml(readableReason(scenario.objective))} · 경계: ${escapeHtml(scenario.boundary ?? "자료 필요")}</p>
      ${bound ? `<p>소각과 비용이 같아지는 단가: ${escapeHtml(String(bound.sufficientMinimum))} KRW/t. 식: (선두 비용 − 소각단가 0 가정의 계산값) ÷ 질량(t). 수집·운송비는 원래 값을 씁니다.</p>` : ""}
      ${list(readableReasons(scenario.assumptions))}
      <p>수율·가격·운송·계수는 고정했습니다. 2순위가 없으면 값이 모두 있는 경로를 비교 대상으로 씁니다.</p>
      <p>원본 ${escapeHtml(scenario.provenance.parentFixtureSha256)} · 준비 데이터 ${escapeHtml(scenario.provenance.preparedDatasetSha256)}
      · 가정 데이터 ${escapeHtml(scenario.provenance.probeDatasetSha256 ?? "없음")} · 가정 전제 ${escapeHtml(scenario.provenance.probeProvenanceSha256 ?? "없음")}</p></details></section>`;
}

export function guidanceOneFact(guidance: CaseGuidance, names: Names): string {
  const value = guidance.oneFactPriority;
  if (value.status === "not-held") return "";
  const first = value.probes.find(probe => probe.id === value.priorityFactId);
  const remaining = rawReasons(guidance.actualComparison.regulatoryConditions);
  const limitations = rawReasons(value.limitations).filter(reason => !remaining.includes(reason));
  const unknowns = (items: readonly string[]) => {
    const unique = rawReasons(items);
    return unique.length ? `<ul>${unique.map(reason => {
      const shared = remaining.indexOf(reason);
      return `<li>${shared < 0 ? escapeHtml(readableReason(reason)) : `<a href="#case-reason-${shared + 1}">위 보류 사유 ${shared + 1} 확인</a>`}</li>`;
    }).join("")}</ul>` : "";
  };
  return `<section id="one-fact-priority"><h2>먼저 확인할 한 가지</h2>
    <p>한 항목이 확인된다고 가정하고 공개 규칙으로 다시 계산한 결과입니다. 현재 보류와 입력은 그대로입니다.</p>
    ${first ? `<article data-priority-fact="${escapeHtml(first.id)}"><h3>${fieldNames[first.field]}</h3>
      <p>현재 입력: ${escapeHtml(first.originalValue ?? "미확인")}</p>
      <p><strong>${escapeHtml(displayGuidanceOutput(first.hypothesis))}</strong></p>
      <p>확인되면 검토할 수 있는 경로: ${escapeHtml([...new Set([...first.newlyRecommendedRouteIds, ...first.newlySupportedRouteIds])].map(id => names[id] ?? id).join(", "))}.</p>
      <p>자료로 확인한 뒤 답변란에 직접 입력하세요. 경로 자격·허가·인수도 함께 확인하세요.</p>
      <details><summary>이어서 확인할 사항</summary>${unknowns(first.remainingUnknowns)}</details></article>`
      : `<article data-priority-unavailable="${value.status}">
        <p><strong>${value.status === "limited"
          ? "사진·유해 접촉·서버 검토 보류는 추가 근거로 해소해야 합니다."
          : value.probes.length === 0 ? "현재 입력에서 가정으로 바꿔 볼 항목이 없습니다."
            : `검토한 단일 확인 가정 ${value.probes.length}개 모두 새 경로를 열지 않았습니다.`}</strong></p>
        <p>여러 항목을 함께 확인하면 경로가 열릴 수 있습니다.</p>
        <p><a href="#case-reasons">확보할 자료와 보류 사유 보기</a></p></article>`}
    <details><summary>확인 가정의 범위</summary>${list(limitations.map(readableReason))}</details>
    ${value.probes.length ? `<details><summary>다른 확인 가정과 결과</summary><ol>${value.probes.map(probe => `<li>
      ${escapeHtml(displayGuidanceOutput(probe.hypothesis))} · 추가 검토 경로 ${probe.openedPathCount}개 · 공개 규칙 결과 ${{ compared: "조건부 비교", "needs-information": "추가 정보 필요", "needs-review": "검토 필요" }[probe.resultingState]}
      ${unknowns(probe.remainingUnknowns)}</li>`).join("")}</ol></details>` : ""}
    </section>`;
}

export function guidanceSensitivity(value: ScenarioSensitivity, names: Names): string {
  const retained = value.samples.filter(sample => sample.retained).length;
  return `<section id="price-allocation-sensitivity"><h2>가격·배분이 달라질 때</h2>
    <p>기준 가격 ${number(value.basePrice, 0)} ${escapeHtml(value.priceUnit)}의 80%·100%·120%와 모델 배분 0.6·0.8·1을 조합했습니다.
      <strong>9개 가정 중 ${retained}개에서 ${escapeHtml(names[value.baselineRouteId] ?? value.baselineRouteId)}의 조건부 우위가 유지됩니다.</strong></p>
    <p>소각비는 아직 확보하지 못했고, 각 칸은 소각단가 0원/t 이상을 가정합니다. 배분 비율은 모델 가정이며 실측 회수율·대체율이 아닙니다.
      표의 9개 점만 계산했습니다. 점 사이 값과 범위 밖은 보장하지 않으며 실제 추천·승인도 아닙니다.</p>
    <div class="table-wrap" role="region" aria-label="가격과 모델 배분 민감도" tabindex="0"><table>
      <thead><tr><th scope="col">모델 배분</th><th scope="col">가격 80%</th><th scope="col">가격 100%</th><th scope="col">가격 120%</th></tr></thead>
      <tbody>${[0.6, 0.8, 1].map(allocation => `<tr><th scope="row">${allocation}</th>${value.samples.filter(sample => sample.allocation === allocation)
        .map(sample => `<td data-sensitivity-cell="${sample.allocation}:${sample.priceMultiplier}" data-retained="${sample.retained}">${sample.retained ? "우위 유지" : "미확정"}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <h3>판매단가 교차점 (소각단가 0 가정)</h3>
    <ul>${value.priceCrossovers.map(row => `<li data-price-crossover="${row.allocation}">배분 ${row.allocation}:
      ${row.minimumPrice === null ? "미확정" : `약 ${number(row.minimumPrice, 2)} ${escapeHtml(value.priceUnit === "KRW/metric_tonne" ? "원/t (1,000kg)" : value.priceUnit)}`}</li>`).join("")}</ul>
    <p><strong>소각단가 0원/t일 때 판매단가가 이 값보다 낮으면 결론이 바뀝니다:</strong> 재활용이 비용·탄소 모두 앞서는 조건이 깨집니다.
      교차점에서 제한 경로와 비용이 같습니다. 실제 소각단가가 더 높으면 경계도 달라집니다. 경로 전환은 현장 승인 후 결정하세요.
      교차점이 음수면 판매단가 0 이상 범위에는 이 경계가 없습니다.</p>
    <details><summary>교차 단가의 계산식·정밀값</summary>
      <p>판매단가 0으로 계산한 (재활용 순비용 − 각 비교 경로 순비용) ÷ 재활용 배분 질량(t)의 최댓값입니다.
        배분별 탄소가 모든 비교 경로 이하일 때 표시합니다. 나머지 단가·거리·계수는 고정했고 실제 소각단가는 null로 남깁니다.</p>
      <ul>${value.priceCrossovers.map(row => `<li>배분 ${row.allocation}: ${row.minimumPrice === null
        ? escapeHtml(row.unavailableReason ?? "자료 필요") : `${escapeHtml(String(row.minimumPrice))} ${escapeHtml(value.priceUnit)} · 제한 경로 ${escapeHtml(row.limitingRouteIds.map(id => names[id] ?? id).join(", "))}`}</li>`).join("")}</ul>
      <p>고정된 선형 비용식에서 구한 가격 경계입니다.</p></details>
    <details><summary>각 가정의 단가·소각비 조건</summary><ul>${value.samples.map(sample => `<li>배분 ${sample.allocation} · 가격 ${number(sample.price, 0)} ${escapeHtml(value.priceUnit)}:
      ${sample.feeMinimum === null ? "충분한 소각비 경계 미확보" : `계산상 소각비 충분 하한 ${number(sample.feeMinimum, 2)} KRW/t`}
      ${list(readableReasons(sample.reasons))}</li>`).join("")}</ul>
      <p>거리·처리비·미국 WARM 경계와 원본 입력은 고정했습니다. 가격은 참고값이며 견적은 업체에서 받으세요.
        기준 준비 데이터 ${escapeHtml(value.preparedDatasetSha256)}</p></details></section>`;
}
