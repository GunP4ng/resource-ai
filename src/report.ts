import type { CaseInput, DecisionResult } from "./contracts.ts";
import { parseDecision } from "./o-decision.ts";
import type { CaseResearchReport } from "./o-case-research-schema.ts";
import type { PublicInputScenario } from "./o-input-public-scenario.ts";
import type { CaseGuidance, GuidanceStage } from "./o-case-guidance.ts";
import type { ModelHostAudit } from "./o-model-audit.ts";
import type { VerificationPlan } from "./o-verification-plan.ts";
import { renderVerificationPlan } from "./report-verification-plan.ts";
import { resultConclusion, resultMetrics, guidanceScenarioConclusion, guidanceProgress, guidanceStability, guidanceOneFact, guidanceSensitivity, publicCaseProgress } from "./report-guidance.ts";
import { buildScenarioSensitivity } from "./o-scenario-sensitivity.ts";
import { escapeHtml, list, page, reportFooter } from "./report-html.ts";
import { koreanSourceDate } from "./report-date.ts";
import { displayLawTitle, displayLocator, displayUnit } from "./report-copy.ts";
import { evidenceSection, rawReasons, readableReason, readableReasons } from "./report-evidence.ts";
import { massQuestion } from "./input.ts";
import { isHostSafetyReason, safetyReasons } from "./o-safety-reasons.ts";
import { materialHazardTerms } from "./material-context.ts";
import { researchCalculations, researchDirectory, publicInputCalculations, publicRecyclingDirectory, publicScenarioNames } from "./report-research.ts";
import { comparisonSummary, comparisonConditions, prioritySummary, routeConditions, scenarioAudit } from "./report-comparison.ts";
import type { EvidenceReferences } from "./report-comparison.ts";
export interface ReportPresentation {
  readonly modelAudit?: ModelHostAudit;
  readonly verificationPlan?: VerificationPlan;
  readonly mode: "synthetic" | "offline" | "live" | "recording";
  readonly scenarioLabels?: readonly string[];
  readonly execution?: { readonly traceId: string; readonly usage: string | null };
  readonly calculationVersion?: string;
  readonly sourceVersion?: string;
  readonly runtime?: { readonly identity: "anonymous" | "trusted" | "local-operator"; readonly storage: "ephemeral" | "sqlite"; readonly runner: "local" | "subscription" | "azure" | "unspecified" };
  readonly review?: { readonly hash: string; readonly origin: { readonly kind: "synthetic" | "field"; readonly reference: string }; readonly caseRevision: string } | null;
  readonly historical?: boolean;
}
export { escapeHtml, safeLink, list, page } from "./report-html.ts";

export type ReportContext =
  | { readonly audience: "commercial" }
  | { readonly audience: "authenticated-research"; readonly research: CaseResearchReport | null; readonly publicScenario?: PublicInputScenario | null; readonly guidance?: CaseGuidance | null };
/** Trusted server view fragments; never taken from model output or input metadata. */
export interface ReportView {
  readonly evaluatedInput?: CaseInput;
  readonly caseRegion?: string | null;
  readonly publicScenarioMissing?: readonly string[];
  readonly notice?: string;
  readonly answerPrompt?: string;
  readonly progress?: readonly Pick<GuidanceStage, "stage" | "name" | "status" | "reasons">[];
  readonly actions?: string;
  readonly editing?: string;
  readonly inputSummary?: string;
  readonly answerTarget?: "#answer-fields" | "#answers";
  readonly caseReturnTarget?: string;
  readonly inquiryTarget?: string;
  readonly researchFirst?: boolean;
  readonly researchNavigation?: boolean;
}
export const routeNames = { reuse: "재사용", "mechanical-recycling": "기계적 재활용", "other-recovery": "기타 회수", disposal: "처분" } as const;
function recommendationSummary(result: Extract<DecisionResult, { state: "compared" }>, references: EvidenceReferences): string {
  if (result.recommendations === undefined) return "";
  const names = { reuse: "재사용", "mechanical-recycling": "기계적 재활용", "other-recovery": "기타 회수", disposal: "처분" } as const;
  const feeGuidance = result.recommendations.some(item => item.cost.value === null)
    ? `<section id="fee-delegation"><h2>처리비 확인 방법</h2>
      <p>공공시설 반입수수료는 조례가 금액 결정을 고시에 맡길 수 있습니다. 예로 대전광역시 폐기물 관리 조례 제4조제2항은 다음과 같이 정합니다.</p>
      <blockquote cite="https://www.law.go.kr/LSW/ordinInfoP.do?ordinSeq=2165959">제1항에 따라 시장이 광역시설을 설치ㆍ운영하는 경우 폐기물을 반입하는 자로부터 다음 각 호의 비용을 고려하여 시장이 결정ㆍ고시하는 반입수수료를 징수할 수 있다.</blockquote>
      <p><a href="https://www.law.go.kr/LSW/ordinInfoP.do?ordinSeq=2165959" rel="noreferrer">대전광역시 폐기물 관리 조례 제4조제2항 원문</a> ·
      <a href="https://www.daejeon.go.kr/drh/drhGosiView.do?conifmenddt=2025-12-31&amp;conifmstdt=2025-01-01&amp;gosigbn=N&amp;menuSeq=1907&amp;pageIndex=1&amp;sno=53083&amp;title=" rel="noreferrer">폐기물 반입수수료 변경 고시 제2025-258호</a></p>
      <p>반입할 시설과 배출 지역의 조례·현재 고시·별표에서 대상 폐기물, 처리 방식, 적용 기간과 단위를 확인하세요. 대전 사례는 찾는 방법을 보여 주는 예시입니다. 반입 가능 여부, 소각 견적, 운송비는 시설에 문의하세요.</p></section>`
    : "";
  return `<section aria-labelledby="recommendation-heading"><h2 id="recommendation-heading">추천 경로 순위</h2><ol>${result.recommendations.map(item => {
    const route = result.routes.find(route => route.routeId === item.routeId);
    const amount = (metric: typeof item.cost | typeof item.carbon) => metric.value === null
      ? `미산정 · ${escapeHtml(metric.reasons.map(readableReason).join("; "))}`
      : `${escapeHtml(metric.value.toLocaleString("ko-KR", { maximumFractionDigits: metric.unit === "KRW" ? 0 : 2 }))} ${escapeHtml(displayUnit(metric.unit))} · ${metric.label === "assumption" ? "가정 포함 계산값" : "계산값"}${list(readableReasons(metric.reasons))}`;
    return `<li><h3>${item.rank}순위 · ${escapeHtml(route ? names[route.route] : item.routeId)}</h3>
      <p><strong>${item.grade === "public-conditional" ? "공개 근거상 가능(조건부)" : "사례 자료 검토됨 · 실행은 승인 후"}</strong></p>
      <p>${escapeHtml(item.basis)}</p><p>비용: ${amount(item.cost)}</p><p>탄소: ${amount(item.carbon)}</p>
      ${item.legalCitations.map(citation => `<p>${references([citation.sourceId])} ${escapeHtml(citation.locator)} · ${escapeHtml(citation.claim)}</p>`).join("")}</li>`;
  }).join("")}</ol></section>${feeGuidance}`;
}
function processorCandidates(result: Extract<DecisionResult, { state: "compared" }>, references: EvidenceReferences): string {
  if (result.processors.length === 0) {
    return "<p>검증된 후보 없음 · 적합 업체가 없다는 뜻은 아닙니다. 폐기물 코드·허가·서비스 권역과 갱신 자료를 확보하세요.</p>";
  }
  return result.processors.map((processor) => `<h3>${escapeHtml(processor.name)}</h3>
    <p>${escapeHtml(processor.region)} · 인수 ${processor.acceptance === "confirmed" ? "확인" : "확인 필요"}</p>
    <p>허가 근거 ${references(processor.permitEvidenceIds)} · 확인 ${escapeHtml(koreanSourceDate(processor.verifiedAt ?? "확인 필요"))} · 코드 ${escapeHtml(processor.acceptedWasteCodes.join(", "))}</p>`).join("");
}

function reasons(result: DecisionResult, references: EvidenceReferences, presentation: ReportPresentation): string {
  switch (result.state) {
    case "needs-information":
    case "needs-review":
      return '<p><a href="#case-reasons">보류 사유와 필요한 확인 보기</a></p>';
    case "compared": {
      const labels = result.scenarios.map((_, index) => presentation.scenarioLabels?.[index] ?? `대안 ${index + 1}`);
      return `${recommendationSummary(result, references)}
        ${result.scenarios.length ? comparisonSummary(result.scenarios, labels, references) : ""}
        ${comparisonConditions(result.scenarios, labels)}
        ${result.scenarios.length ? prioritySummary(result, labels, references) : ""}
        <p>${result.scenarios.length
          ? "우열 미정 · 같은 조건과 완전한 지표를 갖춘 뒤 비교하세요. 음의 순배출은 대체 크레딧이 배출보다 큰 경우입니다."
          : "실제 추천은 공개 근거에 따른 검토 순서입니다. 사례별로 검증된 비용·탄소 자료가 없어 수치 우열은 비교하지 않았습니다."}</p>
        <h2>경로와 조건</h2>${routeConditions(result, references)}
        <h2>사례별 업체 근거</h2>${processorCandidates(result, references)}
        <h2>다음에 확보할 자료</h2>${list(readableReasons(result.limitations))}`;
    }
  }
}
function executionMetadata(presentation: ReportPresentation, calculation: {
  readonly verified: boolean;
  readonly publicModel: string | null;
  readonly publicSource: string | null;
}): string {
  const runtime = presentation.runtime;
  const missingExecution = runtime?.runner === "local" ? "외부 모델 호출 없음"
    : `${runtime?.runner === "azure" ? "Azure" : runtime?.runner === "subscription" ? "구독 모델" : "실행"} 성공 미검증`;
  const execution = presentation.execution
    ? `<p>실행 추적 ${escapeHtml(presentation.execution.traceId)} · 사용량 ${escapeHtml(presentation.execution.usage ?? "기록 없음")}</p><p>실행기가 보고한 사용량입니다. 추적 식별자가 제공자 요청 ID라는 보장은 없습니다. 청구 비용은 제공하지 않습니다.</p>`
    : presentation.mode === "live" ? `<p>모델 실행 기록 없음 · ${missingExecution}</p>` : "<p>실행 사용량 기록 없음</p>";
  const identities = { anonymous: "익명 세션", trusted: "로그인 사용자", "local-operator": "운영자" } as const;
  const runners = { local: null, subscription: "구독 모델", azure: "Azure", unspecified: "미지정" } as const;
  return `<p>사례 계산: ${calculation.verified ? "판정 상세의 계산표 참조" : "없음"}. ${calculation.publicModel ? "가정 계산은 위 공개 비교표에 있습니다." : "연결된 공개 가정 계산은 없습니다."}</p>
    <p class="print-only">계산 버전 ${escapeHtml(presentation.calculationVersion ?? "미기록")} · 출처 버전 ${escapeHtml(presentation.sourceVersion ?? "미기록")}</p>
    ${calculation.publicModel ? `<p class="print-only">공개 가정 계산 버전 ${escapeHtml(calculation.publicModel)} · 준비 데이터 ${escapeHtml(calculation.publicSource ?? "미확보")}</p>` : ""}
    ${runtime ? `<p>평가 당시: ${identities[runtime.identity]} · ${runtime.storage === "sqlite" ? "저장소 보관" : "임시 보관"}${runners[runtime.runner] ? ` · 검토 방식 ${runners[runtime.runner]} (설정값)` : ""}</p>` : "<p>평가 당시 설정 기록 없음</p>"}
    ${execution}<p>사용량은 청구·비용 증빙이 아닙니다. 사진 실행 여부는 설정이나 실행 식별자로 확인할 수 없습니다.</p>`;
}
export function renderReport(result: DecisionResult, presentation: ReportPresentation, context: ReportContext = { audience: "commercial" }, view: ReportView = {}): string {
  parseDecision(result);
  const references: EvidenceReferences = ids => ids.map(id => {
    const index = result.evidence.findIndex(evidence => evidence.sourceId === id);
    return index < 0 ? escapeHtml(id) : `<a href="#evidence-${index + 1}">[${index + 1}]</a>`;
  }).join(", ");
  let research: CaseResearchReport | null;
  switch (context.audience) {
    case "commercial":
      research = null;
      break;
    case "authenticated-research":
      research = context.research;
      break;
  }
  const modes = { synthetic: presentation.execution ? "합성 응답 예시 · 모델 호출 없음" : "합성 예시 · 모델 호출 없음", offline: "오프라인 계산 · 모델 호출 없음", live: "저장된 실행 결과 · 제공자 성공은 실행 기록으로 별도 확인", recording: "녹화 결과 · 원래 실행 기록은 해당 평가에서 확인" } as const;
  const mode = presentation.runtime?.runner === "local" ? "외부 모델 호출 없음" : modes[presentation.mode];
  const data = presentation.review
    ? `<p>${presentation.review.origin.kind === "synthetic" ? "예시용 자료입니다." : "현장 자료로 등록된 검토 자료입니다. 실행은 현장 담당자의 승인을 받은 뒤 진행하세요."}</p>`
    : presentation.mode === "synthetic" ? "<p>예시 입력으로 검토하고 계산한 결과입니다.</p>" : "<p>사용자가 입력한 정보로 검토했습니다. 연결된 검토 자료는 없습니다.</p>";
  const checks = "preExecutionChecks" in result ? (result.preExecutionChecks ?? []).map(readableReason) : [];
  // Native and legacy detail callers supply editing content, including expired cases.
  const commercialSummary = context.audience === "commercial" && !view.editing && !view.answerTarget && !view.inquiryTarget;
  const unavailable = result.state === "compared"
    ? (["cost", "carbon"] as const).map(metric => {
      const label = metric === "cost" ? "비용" : "탄소";
      const values = [...(result.recommendations ?? []).map(item => item[metric].value !== null),
        ...result.scenarios.map(item => (metric === "cost" ? item.netCost : item.netEmissions).state === "available")];
      const missing = values.filter(available => !available).length;
      return `${label}: ${values.length === 0 ? "비교값 없음" : missing ? `${values.length}개 비교값 중 ${missing}개 미산정` : "판정 상세에 계산값 있음"}`;
    }) : ["비용·탄소: 실행 보류로 비교하지 않음"];
  const heldReasons = result.state === "needs-review" ? rawReasons(result.reasons.filter(reason => reason !== massQuestion))
    : result.state === "needs-information" ? rawReasons(result.questions.filter(question => question !== massQuestion)) : [];
  const supportingReasons = result.state === "needs-review" && result.reasons.some(isHostSafetyReason)
    ? heldReasons.filter(reason => reason.includes("인용 부족")) : [];
  const primaryReasons = heldReasons.filter(reason => !supportingReasons.includes(reason));
  const hazardTerms = view.evaluatedInput && !presentation.historical
    ? materialHazardTerms(view.evaluatedInput) : [];
  const reasonItem = (reason: string): string => {
    const number = heldReasons.indexOf(reason) + 1;
    return `<li id="case-reason-${number}"><strong>사유 ${number}.</strong> ${escapeHtml(readableReason(reason))}${reason === safetyReasons.materialTreatment && hazardTerms.length
      ? `<p class="detected-hazard-terms">입력에서 찾은 표현: ${escapeHtml(hazardTerms.join(" · "))}. 이 물질과 처리 이력의 확인 자료를 준비하세요.</p>` : ""}</li>`;
  };
  const answerAction = result.state !== "compared" ? view.answerTarget : undefined;
  const nextAction = result.state === "needs-information"
    ? answerAction
      ? "빠진 정보를 확인해 답변란에 입력하세요."
      : "아래 보류 사유를 보고 필요한 자료를 준비하세요."
    : result.state === "needs-review"
      ? result.conditionalAlternatives?.some(item => item.condition.code === "hazard-classification")
        ? "접촉 물질의 SDS와 시험 자료를 확보해 폐기물 분류를 확인하세요."
        : "재질·오염·접촉 이력의 확인 자료를 확보하세요."
      : "추천 경로의 인수 가능 여부를 업체에 확인하세요.";
  const audit = result.state === "compared" ? result.scenarios.map((scenario, index) => scenarioAudit(scenario, presentation.scenarioLabels?.[index] ?? `대안 ${index + 1}`, references)).join("") : "";
  const researchSections = research ? researchCalculations(research) : "";
  const publicScenario = context.audience === "authenticated-research" ? context.publicScenario : null;
  const guidance = context.audience === "authenticated-research" ? context.guidance : null;
  const calculationContext = publicScenario ?? research?.attachment;
  const sensitivity = guidance?.scenario && calculationContext
    ? buildScenarioSensitivity(calculationContext, guidance.scenario) : null;
  const names = { ...routeNames, ...publicScenarioNames };
  const hypotheticalSummary = guidance ? guidanceScenarioConclusion(guidance, names) : undefined;
  const directories = context.audience === "authenticated-research"
    ? research ? researchDirectory(research, view.inquiryTarget, view.caseRegion) : publicRecyclingDirectory(view.inquiryTarget, view.caseRegion) : "";
  const progress = guidance ? guidanceProgress(guidance, presentation, names) : view.progress ? publicCaseProgress(view.progress) : "";
  const sidebar = !!view.editing || !!view.inputSummary;
  return page("검토 결과", `${sidebar ? '<div class="report-workspace"><div class="report-results" id="report-results" tabindex="-1">' : ""}${commercialSummary ? '<section id="commercial-summary" aria-label="상업용 보고서 요약">' : ""}<header class="result-overview">${resultConclusion(result)}${view.notice ?? ""}
    ${presentation.historical ? '<p class="notice">과거 평가입니다. 입력이 바뀌었으니 다시 평가해 주세요.</p>' : ""}
    <p id="next-action"><strong>다음 할 일:</strong> ${escapeHtml(nextAction)}</p>
    <p class="result-actions screen-only"><a class="primary-action" href="${answerAction ?? (result.state === "compared" ? "#checks" : "#case-reasons")}">${answerAction ? result.state === "needs-information" ? "답변 수정" : "항목 확인·수정" : result.state === "compared" ? "실행 전 확인하기" : "보류 사유 확인하기"}</a>${result.state === "compared" && view.answerTarget ? ` <a class="mobile-edit-shortcut" href="${view.answerTarget}">입력 수정하기</a>` : ""}${view.caseReturnTarget ? ` <a href="${escapeHtml(view.caseReturnTarget)}">사례로 돌아가기</a>` : ""}</p>
    <p class="result-classification screen-only">폐기물 분류: 확인된 분류 코드 없음</p></header>
    ${progress ? `<div class="screen-only">${progress}</div>` : ""}
    ${resultMetrics(result, context)}
    ${commercialSummary ? `<details class="result-disclosure"><summary>요약 근거와 계산 상태</summary>${data}
      ${heldReasons.length ? `<p><a href="#case-reasons">보류 사유와 필요한 확인 ${heldReasons.length}개</a> · 전체 사유는 아래에 있습니다.</p>` : ""}
      <div class="commercial-summary-cards"><div id="summary-evidence"><h2>근거 위치</h2>${result.evidence.length ? `<ul>${result.evidence.slice(0, 3).map((item, index) => {
        const title = displayLawTitle(item.title);
        const locator = displayLocator(item.locator);
        return `<li><a href="#evidence-${index + 1}">[${index + 1}] ${escapeHtml(title === locator ? title : title + " · " + locator)}</a></li>`;
      }).join("")}</ul>` : "<p>연결된 근거 없음</p>"}
      <p><a href="#evidence">전체 ${result.evidence.length}개 출처와 원문 위치 보기</a></p></div>
      <div id="summary-unavailable"><h2>빈 값과 계산 상태</h2>${list(unavailable)}<p><a href="#decision-detail">미산정 사유와 계산 조건 보기</a></p></div></div>
      <p><a href="#checks">실행 전 확인 ${checks.length ? `${checks.length}개 전체` : "안내"} 보기</a> · 모든 항목을 확인하고 현장 담당자 승인을 받으세요.</p>
      </details></section>` : ""}
    ${result.state === "compared" ? view.answerPrompt ?? "" : ""}
    ${heldReasons.length ? `<section id="case-reasons"><h2>보류 사유와 필요한 확인</h2><ul>${primaryReasons.map(reasonItem).join("")}</ul>
      ${supportingReasons.length ? `<div class="supporting-reasons" role="group" aria-label="추가 근거 확인"><p class="muted">추가 근거 확인</p><ul>${supportingReasons.map(reasonItem).join("")}</ul></div>` : ""}</section>` : ""}
    ${result.state !== "compared" ? view.answerPrompt ?? "" : ""}
    <div class="result-content">
    ${guidance ? renderVerificationPlan(presentation.verificationPlan, result) : ""}
    <details id="result-context"><summary>판단 이유와 자료 범위 보기</summary><p>${mode}</p>${commercialSummary ? "" : data}
    ${result.state === "compared" && result.confidence ? `<p><strong>확신도: ${result.confidence.level === "medium" ? "중간" : "낮음"}</strong></p>${list(readableReasons(result.confidence.reasons))}` : ""}
    <p><a class="primary-action secondary-action" href="#evidence">근거 보기</a> <a class="primary-action secondary-action" href="#checks">실행 전 확인하기</a></p></details>
    ${guidance ? `<details id="output-legend"><summary>범례: 추천 · 조건부 최적 · 가정 · 참고값 · 미확보</summary>
      <dl><dt>추천</dt><dd>현재 근거로 먼저 검토할 경로 순서입니다.</dd>
      <dt>조건부 최적</dt><dd>명시한 가정과 모델 경로 안에서 비용·탄소가 낮거나 같은 경로입니다.</dd>
      <dt>가정</dt><dd>확인되지 않은 값을 바꿔 계산한 결과입니다. 입력은 그대로입니다.</dd>
      <dt>참고값</dt><dd>출처와 범위를 보여 주는 자료입니다. 사례 계산에는 들어가지 않습니다.</dd>
      <dt>미확보</dt><dd>값이 없는 상태입니다. 0과 다릅니다.</dd></dl></details>` : ""}
    ${progress ? `<div class="print-only">${progress.replace(/ id="[^"]*"/gu, "")}</div>` : ""}
    ${guidance ? guidanceOneFact(guidance, names) : ""}
    ${hypotheticalSummary ? `<details><summary>연구용 가정 계산 요약</summary><p id="hypothetical-summary"><strong>가정 계산:</strong> ${escapeHtml(hypotheticalSummary)}</p></details>` : ""}
    ${context.audience === "authenticated-research" && view.publicScenarioMissing?.length
      ? `<section id="public-scenario-unavailable"><h2>공개 비용·탄소 비교가 없는 이유</h2>${list(view.publicScenarioMissing)}<p>추천은 공개 근거에 따른 검토 순서입니다. 비교값이 없다는 것은 자료가 부족하다는 뜻입니다.</p></section>` : ""}
    ${context.audience === "authenticated-research" && view.researchNavigation ? `<nav class="screen-only" aria-label="연구 자료"><a href="/demo/normal?purpose=research">비교 예시</a><a href="/demo/held">추가 정보 예시</a><a href="/demo/review">보류 예시</a><a href="/reference">실자료 현황</a></nav>
    <p class="screen-only"><a href="/reference#material-purchase-prices">철스크랩·폐지의 공식 참고 매입가격 보기</a> · 전국 참고 통계입니다. 견적은 업체에서 받으세요.</p>` : ""}
    ${publicScenario ? publicInputCalculations(publicScenario) : ""}${view.researchFirst ? researchSections : ""}
    ${guidance ? guidanceStability(guidance, names) : ""}
    ${sensitivity ? guidanceSensitivity(sensitivity, names) : ""}
    <details id="decision-detail"><summary>판정 상세와 확인할 조건 보기</summary>${reasons(result, references, presentation)}</details>
    ${result.state !== "compared" && result.conditionalAlternatives?.length ? `<section id="alternatives" aria-label="조건별 대안 비교"><h2>조건별 대안 비교</h2><p>실행 보류는 그대로입니다. 아래는 조건을 확인하면 검토할 수 있는 경로이며 처리·반출·계약 승인은 아닙니다.</p>${result.conditionalAlternatives.map(alternative => `<article data-conditional-alternative="${escapeHtml(alternative.routeId)}"><h3>${escapeHtml(alternative.title)}</h3><p><strong>이 조건이라면:</strong> ${escapeHtml(alternative.condition.description)}</p><p>${escapeHtml(alternative.rationale)}</p><p><strong>${alternative.support.state === "route-supported" ? "조건을 확인하면 검토할 공개 근거가 있습니다." : "이 처리 경로의 근거를 더 확보해야 합니다."}</strong></p>${alternative.support.missingEvidence.length ? list(alternative.support.missingEvidence) : ""}<p><strong>먼저 확인할 것</strong></p>${list(alternative.nextChecks)}<details><summary>이 대안의 근거와 적용 범위</summary>${alternative.citations.map(citation => `<p>${references([citation.sourceId])} ${escapeHtml(citation.locator)} · ${citation.scope === "route-specific" ? "해당 경로의 조건부 근거" : "분류·검토를 위한 일반 기준"}</p><blockquote>${escapeHtml(citation.quote)}</blockquote><p>${escapeHtml(citation.claim)}</p>`).join("")}</details></article>`).join("")}</section>` : ""}
    ${view.researchFirst ? "" : researchSections}
    <div class="result-followup">
    ${directories && result.state !== "compared" ? '<p class="notice">보류 사유를 먼저 확인하세요. 아래 문의서는 업체에 확인 질문을 보내는 용도이며 인수·반출·처리 승인은 아닙니다.</p>' : ""}
    ${directories ? `<details class="result-disclosure" id="result-processors"><summary class="screen-only">업체 후보와 문의 조건</summary>${directories}</details>` : '<p class="screen-only"><a href="#decision-detail">처리 경로와 업체 근거 보기</a></p>'}
    <div class="result-report-actions screen-only">${view.actions ?? ""}
    ${view.inquiryTarget ? `<p><a class="primary-action secondary-action" href="${escapeHtml(view.inquiryTarget)}">업체 문의서 1장 만들기</a></p>` : ""}</div></div>
    <details class="result-disclosure" id="result-sources"><summary class="screen-only">출처와 원문 위치 ${result.evidence.length}개</summary>${evidenceSection(result)}</details>
    <details class="result-disclosure" id="result-checks"><summary class="screen-only">실행 전 확인사항${checks.length ? ` ${checks.length}개` : ""}</summary><section id="checks"><h2>실행 전 확인사항</h2>${checks.length ? `<h3>지금 할 ${Math.min(3, checks.length)}개</h3>
      <p>먼저 할 항목입니다. 나머지도 모두 실행 전에 확인하세요.</p>${list(checks.slice(0, 3))}
      ${checks.length > 3 ? `<details id="remaining-checks"><summary>나머지 ${checks.length - 3}개 확인사항 보기</summary>${list(checks.slice(3))}</details>` : ""}` : "<p>질문에 답하고 질량·물질·접촉 이력을 확인하세요. 반출·계약·처리는 현장 담당자 검토와 승인 후 진행하세요.</p>"}</section></details>
    </div>
    ${sidebar ? `</div><aside class="case-editor" id="case-editor" aria-label="현재 사례 입력과 수정" tabindex="-1"><div class="case-editor-body">${view.inputSummary ?? ""}${view.editing ?? ""}</div></aside><div class="report-records">` : ""}
    ${audit ? `<h2>비용·탄소 상세</h2><details class="screen-only"><summary>계산 조건·비용 항목·탄소 계수 보기</summary>${audit}</details><div class="print-only">${audit}</div>` : ""}
    <details id="advanced"><summary>실행 기록과 식별자 보기</summary><p>사례 ${escapeHtml(result.caseId)}</p>
    ${presentation.review ? `<p>자료 등록 ${escapeHtml(presentation.review.origin.reference)} · 자료 SHA-256 ${escapeHtml(presentation.review.hash)} · 연결 입력 ${escapeHtml(presentation.review.caseRevision)}</p>` : ""}
    ${result.state === "needs-review" ? '<p><a href="#case-reasons">보류 사유 보기</a></p>' : ""}${executionMetadata(presentation, {
      verified: result.state === "compared" && result.scenarios.length > 0,
      publicModel: calculationContext?.calculations.model_version ?? null,
      publicSource: calculationContext ? calculationContext.purpose === "research-display" ? calculationContext.calculations.fixtureSha256
        : calculationContext.provenance.derivedDatasetSha256 : null,
    })}</details>${sidebar ? `${reportFooter}</div></div>` : ""}`, commercialSummary ? "commercial" : "workspace", sidebar ? "" : reportFooter);
}
