import type { CaseGuidance } from "./o-case-guidance.ts";
import type { ReportPresentation } from "./report.ts";
import type { ScenarioSensitivity } from "./o-scenario-sensitivity.ts";
import { escapeHtml, list } from "./report-html.ts";
import { readableReason } from "./report-evidence.ts";
import { renderModelHostAudit } from "./report-model-audit.ts";

type Names = Readonly<Record<string, string>>;
const number = (value: number, digits: number) => value.toLocaleString("ko-KR", { maximumFractionDigits: digits });
const fieldNames = { polymer: "재질·분리 상태", contamination: "오염 상태", hazardousContact: "유해물질 접촉 이력" } as const;
const stageNames = ["식별·분류", "재활용 가능성", "규정 검토", "업체 탐색", "비용·탄소", "처리 방안"] as const;
const statusNames = { available: "자료 있음", partial: "일부 자료", missing: "미확보" } as const;
const stageMethods = {
  1: "입력 필드와 기존 판정 연결", 2: "기존 경로 조건 정리", 3: "기존 규정 근거 정리",
  4: "공개 명부 대조", 5: "호스트 계산기", 6: "기존 판정과 가정 비교 정리",
} as const;

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

export function guidanceProgress(guidance: CaseGuidance, presentation: ReportPresentation): string {
  let executionState: "no-model" | "recording" | "trace" | "none";
  let executionLabel: string;
  switch (presentation.mode) {
    case "synthetic":
      executionState = "no-model";
      executionLabel = "합성 평가 · 외부 모델 호출 없음";
      break;
    case "offline":
      executionState = "no-model";
      executionLabel = "오프라인 평가 · 외부 모델 호출 없음";
      break;
    case "recording":
      executionState = "recording";
      executionLabel = "녹화 결과 · 원평가의 실행 증빙은 별도 확인";
      break;
    case "live":
      executionState = presentation.runtime?.runner === "local" ? "no-model" : presentation.execution ? "trace" : "none";
      executionLabel = executionState === "no-model" ? "로컬 평가 · 외부 모델 호출 없음"
        : executionState === "trace" ? "저장된 평가의 실행 추적 기록 있음" : "모델 실행 기록 없음";
      break;
  }
  return `<section id="case-progress"><h2>이 사례의 6단계</h2>
    <p>공식 주제자료 3쪽의 예시 흐름입니다. 산출물의 채움 상태이며 현장 확인·허가·승인을 뜻하지 않습니다.</p>
    <ol class="guidance-stages">${guidance.stages.map(stage => `<li data-guidance-stage="${stage.stage}" data-state="${stage.status}">
      <strong>${stage.stage}. ${stageNames[stage.stage - 1]}</strong><span>${statusNames[stage.status]}</span></li>`).join("")}</ol>
    <details><summary>단계별 생성 방식·근거·빈 단계의 사유</summary>
      <p data-model-execution="${executionState}">${executionLabel}. ${presentation.modelAudit ? "아래에 이 평가의 제안·호스트 검사 기록을 표시합니다." : "단계별 모델 기여·성공·실패 기록은 없습니다."} 설정이나 추적 식별자만으로 제공자 실행 성공을 확정하지 않습니다.</p>
      <p>모델 사용 경로에서는 제안을 받은 뒤 호스트 규칙으로 검증합니다. 아래 안내와 비용·탄소는 호스트가 정리·계산합니다.</p>
      ${presentation.modelAudit ? renderModelHostAudit(presentation.modelAudit) : ""}
      ${guidance.stages.map(stage => `<section data-stage-method="${stage.stage}"><h3>${stage.stage}. ${escapeHtml(stage.name)} · ${statusNames[stage.status]}</h3>
      <p>생성 방식: ${stageMethods[stage.stage]}${presentation.modelAudit ? "" : " · 단계별 모델 기록 없음"}</p>
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
  const remaining = guidance.actualComparison.regulatoryConditions
    .filter(reason => !reason.startsWith("추가 답변은 필드별 JSON")).map(readableReason);
  return `<section id="one-fact-priority"><h2>먼저 확인할 한 가지</h2>
    <p>현재 보류와 원본 입력은 유지합니다. 아래는 확인 가정 한 항목만 바꿔 기존 공개 규칙으로 계산한 반응이며 실행 허용이 아닙니다.</p>
    ${first ? `<article data-priority-fact="${escapeHtml(first.id)}"><h3>${fieldNames[first.field]}</h3>
      <p>현재 입력(유지): ${escapeHtml(first.originalValue ?? "미확인")}</p>
      <p><strong>${escapeHtml(first.hypothesis)}</strong></p>
      <p>확인 가정에서 추가로 검토되는 경로: ${escapeHtml([...new Set([...first.newlyRecommendedRouteIds, ...first.newlySupportedRouteIds])].map(id => names[id] ?? id).join(", "))}.</p>
      <p>실제 경로 자격·허가·인수는 별도 확인이 필요합니다. 이 값을 확인한 사실로 자동 입력하지 않습니다.</p>
      <details><summary>그 뒤에도 확인할 사항</summary>${list(first.remainingUnknowns)}</details></article>`
      : `<article data-priority-unavailable="${value.status}">
        <p><strong>${value.status === "limited"
          ? "사진·유해 접촉·서버 검토 등 추가 근거가 필요한 보류를 가정값으로 없애지 않았습니다."
          : value.probes.length === 0 ? "현재 입력에서 임의로 바꿀 확인 가정을 만들지 않았습니다."
            : `검토한 단일 확인 가정 ${value.probes.length}개에서는 새로 열리는 경로가 없었습니다.`}</strong></p>
        <p>모든 가능한 확인이 무효라는 뜻은 아닙니다. 자료로 확인되지 않은 재질이나 위험 정보를 추정하지 않습니다.</p>
        <h3>이 사례에서 먼저 확보할 자료</h3>${list(remaining)}</article>`}
    <details><summary>확인 가정의 범위·제한</summary>${list(value.limitations)}</details>
    ${value.probes.length ? `<details><summary>검토한 다른 확인 가정과 반응</summary><ol>${value.probes.map(probe => `<li>
      ${escapeHtml(probe.hypothesis)} · 추가 검토 경로 ${probe.openedPathCount}개 · 공개 규칙 상태 ${escapeHtml(probe.resultingState)}
      ${probe.remainingUnknowns.length ? list(probe.remainingUnknowns) : ""}</li>`).join("")}</ol></details>` : ""}
    </section>`;
}

export function guidanceSensitivity(value: ScenarioSensitivity, names: Names): string {
  const retained = value.samples.filter(sample => sample.retained).length;
  return `<section id="price-allocation-sensitivity"><h2>가격·배분이 달라질 때</h2>
    <p>기준 가격 ${number(value.basePrice, 0)} ${escapeHtml(value.priceUnit)}의 80%·100%·120%와 모델 배분 0.6·0.8·1을 조합했습니다.
      <strong>9개 가정 중 ${retained}개에서 ${escapeHtml(names[value.baselineRouteId] ?? value.baselineRouteId)}의 조건부 우위가 유지됩니다.</strong></p>
    <p>소각비는 여전히 미확보이며 각 칸은 소각단가 0원/t 이상을 가정합니다. 모델 배분은 실제 회수율·대체율 검증이 아닙니다.
      표시한 9개 점만 확인했으며 중간값·범위 밖의 보장이나 실제 추천·승인이 아닙니다.</p>
    <div class="table-wrap" role="region" aria-label="가격과 모델 배분 민감도" tabindex="0"><table>
      <thead><tr><th scope="col">모델 배분</th><th scope="col">가격 80%</th><th scope="col">가격 100%</th><th scope="col">가격 120%</th></tr></thead>
      <tbody>${[0.6, 0.8, 1].map(allocation => `<tr><th scope="row">${allocation}</th>${value.samples.filter(sample => sample.allocation === allocation)
        .map(sample => `<td data-sensitivity-cell="${sample.allocation}:${sample.priceMultiplier}" data-retained="${sample.retained}">${sample.retained ? "조건부 유지" : "미확정"}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <h3>판매단가 교차점 (소각단가 0 가정)</h3>
    <ul>${value.priceCrossovers.map(row => `<li data-price-crossover="${row.allocation}">배분 ${row.allocation}:
      ${row.minimumPrice === null ? "미확정" : `약 ${number(row.minimumPrice, 2)} ${escapeHtml(value.priceUnit === "KRW/metric_tonne" ? "원/t (1,000kg)" : value.priceUnit)}`}</li>`).join("")}</ul>
    <p><strong>소각단가 0원/t 가정에서 판매단가가 이 값 아래에서는 결론이 바뀜:</strong> 재활용의 비용·탄소 약우월성을 유지하지 못합니다.
      교차점에서는 제한 경로와 비용이 같습니다. 실제 소각단가가 더 높으면 경계도 달라지므로 실제 경로 전환·승인을 뜻하지 않습니다.
      음수 교차점이면 판매단가 0 이상 범위에는 이 경계가 없습니다.</p>
    <details><summary>교차 단가의 계산식·정밀값</summary>
      <p>기존 엔진의 판매단가 0 계산에서 (재활용 순비용 − 각 비교 경로 순비용) ÷ 재활용 배분 질량(t)의 최댓값입니다.
        배분별 탄소가 모든 비교 경로 이하인 경우에만 표시합니다. 나머지 단가·거리·계수는 고정하고 실제 소각단가는 null로 남깁니다.</p>
      <ul>${value.priceCrossovers.map(row => `<li>배분 ${row.allocation}: ${row.minimumPrice === null
        ? escapeHtml(row.unavailableReason ?? "미확보") : `${escapeHtml(String(row.minimumPrice))} ${escapeHtml(value.priceUnit)} · 제한 경로 ${escapeHtml(row.limitingRouteIds.map(id => names[id] ?? id).join(", "))}`}</li>`).join("")}</ul>
      <p>9점 표의 중간값 일반 보장과는 별개인, 고정된 선형 비용식의 가격 경계입니다.</p></details>
    <details><summary>각 가정의 단가·소각비 조건</summary><ul>${value.samples.map(sample => `<li>배분 ${sample.allocation} · 가격 ${number(sample.price, 0)} ${escapeHtml(value.priceUnit)}:
      ${sample.feeMinimum === null ? "충분한 소각비 경계 미확보" : `계산상 소각비 충분 하한 ${number(sample.feeMinimum, 2)} KRW/t`}
      ${list(sample.reasons)}</li>`).join("")}</ul>
      <p>나머지 거리·처리비·미국 WARM 경계와 원본 입력은 고정했습니다. 확인 전 가격을 실제 견적으로 바꾸지 않습니다.
        기준 준비 데이터 ${escapeHtml(value.preparedDatasetSha256)}</p></details></section>`;
}
