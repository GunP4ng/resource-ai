import type { CaseGuidance } from "./o-case-guidance.ts";
import { escapeHtml, list } from "./report-html.ts";

type Names = Readonly<Record<string, string>>;
const number = (value: number, digits: number) => value.toLocaleString("ko-KR", { maximumFractionDigits: digits });
const fieldNames = { polymer: "재질·분리 상태", contamination: "오염 상태", hazardousContact: "유해물질 접촉 이력" } as const;
const stageNames = ["식별·분류", "재활용 가능성", "규정 검토", "업체 탐색", "비용·탄소", "처리 방안"] as const;
const statusNames = { available: "자료 있음", partial: "일부 자료", missing: "미확보" } as const;

/** A scenario result never becomes an actual second recommendation or an execution permit. */
export function guidanceConclusion(guidance: CaseGuidance, names: Names): string | undefined {
  const scenario = guidance.scenario;
  if (scenario?.status === "conditionally-optimal" && scenario.firstRouteId && scenario.hypotheticalRunnerUpRouteId) {
    const difference = scenario.differences.find(row => row.routeId === scenario.hypotheticalRunnerUpRouteId);
    if (difference?.costAdvantageKrw !== null && difference?.costAdvantageKrw !== undefined
      && difference.carbonAdvantageKgCo2e !== null) {
      const condition = scenario.feeBound ? " 및 소각단가 0원/t 이상" : "";
      const first = (names[scenario.firstRouteId] ?? scenario.firstRouteId).replace(/ 시나리오$/u, "");
      const second = (names[scenario.hypotheticalRunnerUpRouteId] ?? scenario.hypotheticalRunnerUpRouteId).replace(/ 시나리오$/u, "");
      return `가정표의 ${first}은 ${second}보다 비용 약 ${number(difference.costAdvantageKrw, 0)}원·탄소 약 ${number(difference.carbonAdvantageKgCo2e, 2)}kgCO2e가 낮거나 같은 조건부 최적안입니다(규정·허가·인수${condition} 조건).`;
    }
  }
  const comparison = guidance.actualComparison;
  if (comparison.firstRouteId && !comparison.actualSecondAvailable) {
    return `현재 ${names[comparison.firstRouteId] ?? comparison.firstRouteId}만 추천 후보이며, 실제 2순위와 비용·탄소 우위를 비교할 근거는 미확보입니다.`;
  }
  return comparison.actualSecondAvailable ? comparison.summary : undefined;
}

export function guidanceProgress(guidance: CaseGuidance): string {
  return `<section id="case-progress"><h2>이 사례의 6단계</h2>
    <p>공식 주제자료 3쪽의 예시 흐름입니다. 산출물의 채움 상태이며 현장 확인·허가·승인을 뜻하지 않습니다.</p>
    <ol class="guidance-stages">${guidance.stages.map(stage => `<li data-guidance-stage="${stage.stage}" data-state="${stage.status}">
      <strong>${stage.stage}. ${stageNames[stage.stage - 1]}</strong><span>${statusNames[stage.status]}</span></li>`).join("")}</ol>
    <details><summary>단계별 근거와 빈 단계의 사유</summary>${guidance.stages.map(stage => `<section><h3>${stage.stage}. ${escapeHtml(stage.name)} · ${statusNames[stage.status]}</h3>
      ${stage.outputs.length ? list(stage.outputs) : "<p>현재 연결된 산출물이 없습니다.</p>"}${list(stage.reasons)}</section>`).join("")}</details></section>`;
}

export function guidanceStability(guidance: CaseGuidance, names: Names): string {
  const scenario = guidance.scenario;
  if (!scenario) return "";
  const bound = scenario.feeBound;
  return `<section id="rank-stability"><h2>모르는 값이 있어도 유지되는 결론</h2>
    ${scenario.status === "conditionally-optimal"
      ? `<p><strong>${bound?.sufficientUnderAssumption ? "소각 처리단가가 0원/t 이상이면 " : "현재 가정표의 비교 범위에서 "}${escapeHtml(names[scenario.firstRouteId ?? ""] ?? "선두 대안")}의 비용·탄소가 다른 대안보다 낮거나 같습니다.</strong> 나머지 가정과 계산 경계는 고정한 조건입니다.</p>`
      : `<p>현재 자료로는 모든 대안에 대한 비용·탄소 순위 불변을 확정하지 못했습니다.</p>${list(scenario.unavailableReasons)}`}
    <p>${bound ? "실제 소각단가는 여전히 미확보입니다. 0원은 관측값이 아니라 조건을 검사한 가설입니다. " : ""}실제 추천 2순위·허가·인수 확약이 아닙니다.</p>
    <details><summary>기존 계산으로 확인한 범위·가정</summary>
      <p>목적: ${escapeHtml(scenario.objective)} · 경계: ${escapeHtml(scenario.boundary ?? "미확보")}</p>
      ${bound ? `<p>소각대안과 비용이 같아지는 계산상 단가: ${escapeHtml(String(bound.sufficientMinimum))} KRW/t. 식: (선두 비용 − 소각단가 0 가설의 기존 엔진 계산값) ÷ 질량(t). 수집·운송비는 0으로 바꾸지 않았습니다.</p>` : ""}
      ${list(scenario.assumptions)}
      <p>다른 수율·가격·운송·계수까지 바뀔 때의 보장은 아닙니다. 실제 2순위가 없으면 완전한 값이 있는 비교행만 차선 비교대안으로 사용합니다.</p>
      <p>원본 ${escapeHtml(scenario.provenance.parentFixtureSha256)} · 준비 데이터 ${escapeHtml(scenario.provenance.preparedDatasetSha256)}
      · 가설 데이터 ${escapeHtml(scenario.provenance.probeDatasetSha256 ?? "없음")} · 가설 전제 ${escapeHtml(scenario.provenance.probeProvenanceSha256 ?? "없음")}</p></details></section>`;
}

export function guidanceOneFact(guidance: CaseGuidance, names: Names): string {
  const value = guidance.oneFactPriority;
  if (value.status === "not-held") return "";
  const first = value.probes.find(probe => probe.id === value.priorityFactId);
  return `<section id="one-fact-priority"><h2>먼저 확인할 한 가지</h2>
    <p>현재 보류와 원본 입력은 유지합니다. 아래는 확인 가정 한 항목만 바꿔 기존 공개 규칙으로 계산한 반응이며 실행 허용이 아닙니다.</p>
    ${first ? `<article data-priority-fact="${escapeHtml(first.id)}"><h3>${fieldNames[first.field]}</h3>
      <p>현재 입력(유지): ${escapeHtml(first.originalValue ?? "미확인")}</p>
      <p><strong>${escapeHtml(first.hypothesis)}</strong></p>
      <p>확인 가정에서 추가로 검토되는 경로: ${escapeHtml([...new Set([...first.newlyRecommendedRouteIds, ...first.newlySupportedRouteIds])].map(id => names[id] ?? id).join(", "))}.</p>
      <p>실제 경로 자격·허가·인수는 별도 확인이 필요합니다. 이 값을 확인한 사실로 자동 입력하지 않습니다.</p>
      <details><summary>그 뒤에도 확인할 사항</summary>${list(first.remainingUnknowns)}</details></article>`
      : "<p><strong>한 항목 확인만으로 새로 열리는 경로를 확인하지 못했습니다.</strong> 여러 사실이나 별도 검토 자료가 필요할 수 있습니다.</p>"}
    ${list(value.limitations)}
    ${value.probes.length ? `<details><summary>검토한 다른 확인 가정과 반응</summary><ol>${value.probes.map(probe => `<li>
      ${escapeHtml(probe.hypothesis)} · 추가 검토 경로 ${probe.openedPathCount}개 · 공개 규칙 상태 ${escapeHtml(probe.resultingState)}
      ${probe.remainingUnknowns.length ? list(probe.remainingUnknowns) : ""}</li>`).join("")}</ol></details>` : ""}
    </section>`;
}
