import type { DecisionResult } from "./contracts.ts";
import { parseDecision } from "./o-decision.ts";
import type { CaseResearchReport } from "./o-case-research-schema.ts";
import type { PublicInputScenario } from "./o-input-public-scenario.ts";
import type { CaseGuidance, GuidanceStage } from "./o-case-guidance.ts";
import type { ModelHostAudit } from "./o-model-audit.ts";
import type { VerificationPlan } from "./o-verification-plan.ts";
import { renderVerificationPlan } from "./report-verification-plan.ts";
import { guidanceConclusion, guidanceScenarioConclusion, guidanceProgress, guidanceStability, guidanceOneFact, guidanceSensitivity, publicCaseProgress } from "./report-guidance.ts";
import { buildScenarioSensitivity } from "./o-scenario-sensitivity.ts";
import { escapeHtml, list, page } from "./report-html.ts";
import { evidenceSection, readableReason, readableReasons } from "./report-evidence.ts";
import { massQuestion } from "./input.ts";
import { isHostSafetyReason } from "./o-safety-reasons.ts";
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
  readonly caseRegion?: string | null;
  readonly publicScenarioMissing?: readonly string[];
  readonly notice?: string;
  readonly answerPrompt?: string;
  readonly progress?: readonly Pick<GuidanceStage, "stage" | "name" | "status" | "reasons">[];
  readonly actions?: string;
  readonly editing?: string;
  readonly answerTarget?: "#answer-fields" | "#answers";
  readonly inquiryTarget?: string;
  readonly researchFirst?: boolean;
}
export const routeNames = { reuse: "재사용", "mechanical-recycling": "기계적 재활용", "other-recovery": "기타 회수", disposal: "처분" } as const;
function recommendationSummary(result: Extract<DecisionResult, { state: "compared" }>, references: EvidenceReferences): string {
  if (result.recommendations === undefined) return "";
  const names = { reuse: "재사용", "mechanical-recycling": "기계적 재활용", "other-recovery": "기타 회수", disposal: "처분" } as const;
  const feeGuidance = result.recommendations.some(item => item.cost.value === null)
    ? `<section id="fee-delegation"><h2>처리비를 확인할 근거</h2>
      <p>공공시설 반입수수료는 조례가 금액 결정을 고시에 위임할 수 있습니다. 예를 들어 대전광역시 폐기물 관리 조례 제4조제2항은 다음과 같이 정합니다.</p>
      <blockquote cite="https://www.law.go.kr/LSW/ordinInfoP.do?ordinSeq=2165959">제1항에 따라 시장이 광역시설을 설치ㆍ운영하는 경우 폐기물을 반입하는 자로부터 다음 각 호의 비용을 고려하여 시장이 결정ㆍ고시하는 반입수수료를 징수할 수 있다.</blockquote>
      <p><a href="https://www.law.go.kr/LSW/ordinInfoP.do?ordinSeq=2165959" rel="noreferrer">대전광역시 폐기물 관리 조례 제4조제2항 원문</a> ·
      <a href="https://www.daejeon.go.kr/drh/drhGosiView.do?conifmenddt=2025-12-31&amp;conifmstdt=2025-01-01&amp;gosigbn=N&amp;menuSeq=1907&amp;pageIndex=1&amp;sno=53083&amp;title=" rel="noreferrer">폐기물 반입수수료 변경 고시 제2025-258호</a></p>
      <p>반입할 시설과 배출 지역의 조례·현재 고시·별표에서 대상 폐기물, 처리 방식, 적용 기간과 단위를 확인하세요. 대전 조례의 위임 사례를 다른 지역이나 사업장 소각 단가로 대입하지 않았습니다. 실제 반입 가능 여부, 소각 견적과 운송비는 별도로 확인해야 합니다.</p></section>`
    : "";
  return `<section aria-labelledby="recommendation-heading"><h2 id="recommendation-heading">추천 경로 순위</h2><ol>${result.recommendations.map(item => {
    const route = result.routes.find(route => route.routeId === item.routeId);
    const amount = (metric: typeof item.cost | typeof item.carbon) => metric.value === null
      ? `미산정 · ${escapeHtml(metric.reasons.join("; "))}`
      : `${escapeHtml(metric.value.toLocaleString("ko-KR", { maximumFractionDigits: metric.unit === "KRW" ? 0 : 2 }))} ${metric.unit} · ${metric.label === "assumption" ? "가정 포함 계산값" : "계산값"}${list(readableReasons(metric.reasons))}`;
    return `<li><h3>${item.rank}순위 · ${escapeHtml(route ? names[route.route] : item.routeId)}</h3>
      <p><strong>${item.grade === "public-conditional" ? "공개 근거상 가능(조건부)" : "사례별 자료 검토됨(실행 승인 아님)"}</strong></p>
      <p>${escapeHtml(item.basis)}</p><p>비용: ${amount(item.cost)}</p><p>탄소: ${amount(item.carbon)}</p>
      ${item.legalCitations.map(citation => `<p>${references([citation.sourceId])} ${escapeHtml(citation.locator)} · ${escapeHtml(citation.claim)}</p>`).join("")}</li>`;
  }).join("")}</ol></section>${feeGuidance}`;
}
function processorCandidates(result: Extract<DecisionResult, { state: "compared" }>, references: EvidenceReferences): string {
  if (result.processors.length === 0) {
    return "<p>검증된 후보 없음 · 적합 업체가 존재하지 않는다는 뜻은 아닙니다. 코드·허가·서비스 권역과 갱신 자료를 확보하세요.</p>";
  }
  return result.processors.map((processor) => `<h3>${escapeHtml(processor.name)}</h3>
    <p>${escapeHtml(processor.region)} · 인수 ${processor.acceptance === "confirmed" ? "확인" : "미확인"}</p>
    <p>허가 근거 ${references(processor.permitEvidenceIds)} · 확인 ${escapeHtml(processor.verifiedAt ?? "미확인")} · 코드 ${escapeHtml(processor.acceptedWasteCodes.join(", "))}</p>`).join("");
}

function conclusion(result: DecisionResult, explanation?: string): string {
  switch (result.state) {
    case "needs-information":
      return '<p class="state question">추가 정보 필요 · 실행 보류</p><h1>추가 정보 필요</h1><p id="decision-summary">입력 정보가 부족해 처리 경로를 확정하지 않았습니다.</p>';
    case "needs-review":
      return '<p class="state held">검토 필요 · 실행 보류</p><h1>검토 필요</h1><p id="decision-summary">확인되지 않은 조건이 있어 처리·반출·계약을 보류합니다.</p>';
    case "compared": {
      const recommendation = result.recommendations?.[0];
      const route = result.routes.find(item => item.routeId === recommendation?.routeId);
      return `<p class="state recommended">${recommendation ? "추천 · 공개 근거상 가능한 경로" : "조건부 비교 · 실행 전 확인 필요"}</p><h1>${route ? `${routeNames[route.route]} 추천` : "조건부 비교"}</h1>
        <p id="decision-summary"><strong>실제 판정:</strong> ${escapeHtml(explanation ?? (route ? `현재 자료에서는 ${routeNames[route.route]}을 우선 검토할 수 있습니다.` : "확인된 조건으로 처리 경로를 비교했습니다."))}</p>
        <p>판단 지원 추천 · 실행·반출·계약 승인 아님. ${result.humanApproval === "pending" ? "현장 담당자 승인 대기" : "인간 승인 기록 있음"}</p>`;
    }
  }
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
          ? "우열 불확실 · 동일 조건과 완전한 지표를 확인한 뒤 비교하세요. 음의 순배출은 탄소 제거를 뜻하지 않습니다."
          : "실제 추천은 공개 근거에 따른 검토 순서입니다. 사례별 검증된 비용·탄소 자료가 없어 실제 수치 우열은 비교하지 않았습니다."}</p>
        <h2>경로와 조건</h2>${routeConditions(result, references)}
        <h2>사례별 업체 근거</h2>${processorCandidates(result, references)}
        <h2>제약과 다음 확보 항목</h2>${list(readableReasons(result.limitations))}`;
    }
  }
}
function executionMetadata(presentation: ReportPresentation, calculation: {
  readonly verified: boolean;
  readonly publicModel: string | null;
  readonly publicSource: string | null;
}): string {
  const runtime = presentation.runtime;
  const missingExecution = runtime?.runner === "local" ? "로컬 실행 · 외부 모델 호출 없음"
    : `${runtime?.runner === "azure" ? "Azure" : runtime?.runner === "subscription" ? "구독 경로 모델 실행" : "실행"} 성공 미검증`;
  const execution = presentation.execution
    ? `<p>실행 추적 ${escapeHtml(presentation.execution.traceId)} · 사용량 ${escapeHtml(presentation.execution.usage ?? "미제공")}</p><p>실행기가 보고한 사용량입니다. 추적 식별자는 제공자 요청 ID를 보증하지 않습니다. 청구 비용 미제공.</p>`
    : presentation.mode === "live" ? `<p>모델 실행 정보 미제공 · ${missingExecution}</p>` : "<p>실행 사용량 미제공</p>";
  const identities = { anonymous: "익명 세션", trusted: "서버 인증 사용자", "local-operator": "로컬 운영자" } as const;
  const runners = { local: "로컬", subscription: "구독 경로 모델 실행", azure: "Azure 연결", unspecified: "미지정" } as const;
  return `<p>사례별 검증 계산: ${calculation.verified ? "판정 상세의 계산표 참조" : "없음"}. ${calculation.publicModel ? "가정 계산은 위 공개 비교표에 별도로 표시했습니다." : "연결된 공개 가정 계산도 없습니다."}</p>
    <p>평가 기록의 계산 버전 ${escapeHtml(presentation.calculationVersion ?? "미기록")} · 출처 버전 ${escapeHtml(presentation.sourceVersion ?? "미기록")}</p>
    ${calculation.publicModel ? `<p>공개 가정 계산 버전 ${escapeHtml(calculation.publicModel)} · 준비 데이터 ${escapeHtml(calculation.publicSource ?? "미확보")}</p>` : ""}
    ${runtime ? `<p>평가 당시: ${identities[runtime.identity]} · ${runtime.storage === "sqlite" ? "SQLite 보관" : "임시 보관"} · 구성된 실행기 ${runners[runtime.runner]} (실행 성공과 별개)</p>` : "<p>평가 당시 인증·저장·실행기 설정 미제공</p>"}
    ${execution}<p>사용량은 청구·비용 증빙이 아닙니다. 사진 실행은 설정이나 실행 식별자만으로 확인되지 않습니다.</p>`;
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
  const modes = { synthetic: presentation.execution ? "합성 응답 주입 · 실제 제공자 호출 없음" : "합성 데모 · 모델 호출 없음", offline: "오프라인 계산 · 모델 호출 없음", live: "저장된 실행 결과 · 제공자 성공은 실행 기록으로 별도 확인", recording: "사전 녹화 · 원평가 실행 증빙 별도 확인" } as const;
  const mode = presentation.runtime?.runner === "local" ? "로컬 실행 · 외부 모델 호출 없음" : modes[presentation.mode];
  const data = presentation.review
    ? `<p>${presentation.review.origin.kind === "synthetic" ? "합성 자료 · 현장 근거 아님" : "현장 자료로 선언된 검토 아티팩트 · 인간·법적 승인 아님"}</p>`
    : presentation.mode === "synthetic" ? "<p>합성 입력·계산 예시 · 현장 근거 아님</p>" : "<p>미검토 사용자 입력 · 입력에 결합된 검토 자료 없음 · 운영 자료 미제공</p>";
  const checks = "preExecutionChecks" in result ? (result.preExecutionChecks ?? []).map(readableReason) : [];
  // Native and legacy detail callers supply editing content, including expired cases.
  const commercialSummary = context.audience === "commercial" && !view.editing && !view.answerTarget && !view.inquiryTarget;
  const unavailable = result.state === "compared"
    ? (["cost", "carbon"] as const).map(metric => {
      const label = metric === "cost" ? "비용" : "탄소";
      const values = [...(result.recommendations ?? []).map(item => item[metric].value !== null),
        ...result.scenarios.map(item => (metric === "cost" ? item.netCost : item.netEmissions).state === "available")];
      const missing = values.filter(available => !available).length;
      return `${label}: ${values.length === 0 ? "비교값 미확보" : missing ? `${values.length}개 비교값 중 ${missing}개 미산정` : "판정 상세의 계산값 확인"}`;
    }) : ["비용·탄소: 비교 미수행 · 실행 보류"];
  const heldReasons = result.state === "needs-review" ? readableReasons(result.reasons.filter(reason => reason !== massQuestion))
    : result.state === "needs-information" ? readableReasons(result.questions.filter(question => question !== massQuestion)) : [];
  const supportingReasons = result.state === "needs-review" && result.reasons.some(isHostSafetyReason)
    ? heldReasons.filter(reason => reason.includes("인용 부족")) : [];
  const primaryReasons = heldReasons.filter(reason => !supportingReasons.includes(reason));
  const reasonItem = (reason: string): string => {
    const number = heldReasons.indexOf(reason) + 1;
    return `<li id="case-reason-${number}"><strong>사유 ${number}.</strong> ${escapeHtml(reason)}</li>`;
  };
  const answerAction = result.state !== "compared" ? view.answerTarget : undefined;
  const nextAction = result.state === "needs-information"
    ? answerAction
      ? "누락된 사례 정보를 확인해 답변란에 입력하세요."
      : "아래 보류 사유에서 누락된 정보를 확인하고 필요한 자료를 준비하세요."
    : result.state === "needs-review"
      ? result.conditionalAlternatives?.some(item => item.condition.code === "hazard-classification")
        ? "접촉 물질의 SDS와 시험 자료를 확보해 폐기물 분류를 확인하세요."
        : "재질·오염·접촉 이력의 확인 자료를 확보하세요."
      : "추천 경로의 실제 인수 가능 여부를 업체에 확인하세요.";
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
  return page("조건부 보고서", `${commercialSummary ? '<section id="commercial-summary" aria-label="상업용 보고서 요약">' : ""}${conclusion(result, guidance ? guidanceConclusion(guidance, names) : undefined)}${view.notice ?? ""}
    ${presentation.historical ? '<p class="notice">과거 평가: 현재 입력과 평가 당시 입력이 다릅니다. 명시적으로 다시 평가해 주세요.</p>' : ""}
    ${hypotheticalSummary ? `<p id="hypothetical-summary"><strong>가정 계산:</strong> ${escapeHtml(hypotheticalSummary)}</p>` : ""}
    <p id="next-action"><strong>다음 행동:</strong> ${escapeHtml(nextAction)}</p>
    <p class="screen-only"><a class="primary-action" href="${answerAction ?? "#checks"}">${answerAction ? result.state === "needs-information" ? "답변 입력하기" : "입력 다시 확인하기" : "실행 전 확인하기"}</a></p>
    ${commercialSummary ? `${data}
      ${heldReasons.length ? `<p><a href="#case-reasons">보류 사유와 필요한 확인 ${heldReasons.length}개</a> · 전체 사유는 다음 상세에 있습니다.</p>` : ""}
      <div id="summary-evidence"><h2>근거 위치</h2>${result.evidence.length ? `<ul>${result.evidence.slice(0, 3).map((item, index) => `<li><a href="#evidence-${index + 1}">[${index + 1}] ${escapeHtml(item.title)} · ${escapeHtml(item.locator)}</a></li>`).join("")}</ul>` : "<p>연결된 근거 없음</p>"}</div>
      <p><a href="#evidence">전체 ${result.evidence.length}개 출처와 원문 위치 확인하기</a></p>
      <div id="summary-unavailable"><h2>미확보값과 계산 상태</h2>${list(unavailable)}<p><a href="#decision-detail">미산정 사유와 계산 조건 확인하기</a></p></div>
      <p><a href="#checks">실행 전 확인 ${checks.length ? `${checks.length}개 전체` : "안내"} 보기</a> · 모든 확인과 별도 승인이 필요합니다.</p>
      </section>` : ""}
    ${result.state === "compared" ? view.answerPrompt ?? "" : ""}
    ${heldReasons.length ? `<section id="case-reasons"><h2>보류 사유와 필요한 확인</h2><ul>${primaryReasons.map(reasonItem).join("")}</ul>
      ${supportingReasons.length ? `<div class="supporting-reasons" role="group" aria-label="추가 근거 확인"><p class="muted">추가 근거 확인</p><ul>${supportingReasons.map(reasonItem).join("")}</ul></div>` : ""}</section>` : ""}
    ${result.state !== "compared" ? view.answerPrompt ?? "" : ""}
    ${guidance ? renderVerificationPlan(presentation.verificationPlan, result) : ""}
    <details id="result-context"><summary>판단 이유·자료 범위 확인하기</summary><p>${mode}</p>${commercialSummary ? "" : data}
    ${result.state === "compared" && result.confidence ? `<p><strong>확신도: ${result.confidence.level === "medium" ? "중간" : "낮음"}</strong></p>${list(readableReasons(result.confidence.reasons))}` : ""}
    <p><a class="primary-action secondary-action" href="#evidence">근거 확인하기</a> <a class="primary-action secondary-action" href="#checks">실행 전 확인하기</a></p>${view.actions ?? ""}</details>
    ${guidance ? `<details id="output-legend"><summary>범례: 추천 · 조건부 최적 · 가설 · 참고값 · 미확보</summary>
      <dl><dt>추천</dt><dd>현재 근거로 검토할 경로 순서이며 실행 승인이 아닙니다.</dd>
      <dt>조건부 최적</dt><dd>명시한 가정과 모델 경로 안에서 비용·탄소가 낮거나 같은 계산 결과입니다.</dd>
      <dt>가설</dt><dd>확인되지 않은 값을 별도로 바꿔 본 결과이며 원래 사실을 고치지 않습니다.</dd>
      <dt>참고값</dt><dd>출처·범위를 소개한 자료이며 이 사례의 계산값으로 대입하지 않습니다.</dd>
      <dt>미확보</dt><dd>지원하는 값이 없다는 뜻이며 0이 아닙니다.</dd></dl></details>` : ""}
    ${guidance ? guidanceProgress(guidance, presentation, names) + guidanceOneFact(guidance, names) : view.progress ? publicCaseProgress(view.progress) : ""}
    ${context.audience === "authenticated-research" && view.publicScenarioMissing?.length
      ? `<section id="public-scenario-unavailable"><h2>공개 비용·탄소 비교가 없는 이유</h2>${list(view.publicScenarioMissing)}<p>추천은 기존 공개 근거에 따른 검토 순서입니다. 비교 부재를 비용 0이나 재활용 불가로 해석하지 않습니다.</p></section>` : ""}
    ${publicScenario ? publicInputCalculations(publicScenario) : ""}${view.researchFirst ? researchSections : ""}
    ${guidance ? guidanceStability(guidance, names) : ""}
    ${sensitivity ? guidanceSensitivity(sensitivity, names) : ""}
    <details id="decision-detail"><summary>판정 상세·확인할 조건 펼치기</summary>${reasons(result, references, presentation)}</details>
    ${result.state !== "compared" && result.conditionalAlternatives?.length ? `<section id="alternatives" aria-label="조건별 대안 비교"><h2>조건별 대안 비교</h2><p>현재 실행 보류는 유지됩니다. 아래는 확인할 조건에 따른 검토 경로이며 처리·반출·계약 승인이 아닙니다.</p>${result.conditionalAlternatives.map(alternative => `<article data-conditional-alternative="${escapeHtml(alternative.routeId)}"><h3>${escapeHtml(alternative.title)}</h3><p><strong>이 조건이라면:</strong> ${escapeHtml(alternative.condition.description)}</p><p>${escapeHtml(alternative.rationale)}</p><p><strong>${alternative.support.state === "route-supported" ? "조건을 확인한 뒤 검토할 공개 근거가 있습니다." : "이 처리 경로의 적합성은 아직 확인하지 못했습니다."}</strong></p>${alternative.support.missingEvidence.length ? list(alternative.support.missingEvidence) : ""}<p><strong>먼저 확인할 것</strong></p>${list(alternative.nextChecks)}<details><summary>이 대안의 근거와 적용 범위</summary>${alternative.citations.map(citation => `<p>${references([citation.sourceId])} ${escapeHtml(citation.locator)} · ${citation.scope === "route-specific" ? "해당 경로의 조건부 근거" : "분류·검토를 위한 일반 기준"}</p><blockquote>${escapeHtml(citation.quote)}</blockquote><p>${escapeHtml(citation.claim)}</p>`).join("")}</details></article>`).join("")}</section>` : ""}
    ${view.researchFirst ? "" : researchSections}
    ${directories && result.state !== "compared" ? '<p class="notice">입력·분류 확인 전 문의입니다. 먼저 보류 사유를 확인하세요. 아래 문의서는 확인 질문 전달용이며 인수·반출·처리 승인이 아닙니다.</p>' : ""}
    ${directories}
    ${evidenceSection(result)}
    ${view.inquiryTarget ? `<p class="screen-only"><a class="primary-action secondary-action" href="${escapeHtml(view.inquiryTarget)}">업체 문의서 1장 준비</a></p>` : ""}
    <section id="checks"><h2>실행 전 확인사항</h2>${checks.length ? `<h3>지금 할 ${Math.min(3, checks.length)}개</h3>
      <p>기존 확인 순서입니다. 나머지를 포함한 모든 항목을 실행 전에 확인하세요.</p>${list(checks.slice(0, 3))}
      ${checks.length > 3 ? `<details id="remaining-checks"><summary>나머지 ${checks.length - 3}개 확인사항 펼치기</summary>${list(checks.slice(3))}</details>` : ""}` : "<p>질문에 답하고 실제 질량·물질·접촉 이력을 확인하세요. 반출·계약·처리는 현장 담당자의 별도 검토와 승인이 필요합니다.</p>"}</section>
    ${view.editing ?? ""}
    ${audit ? `<h2>비용·탄소 상세 감사</h2><details class="screen-only"><summary>계산 조건·비용 항목·탄소 활동과 계수 펼치기</summary>${audit}</details><div class="print-only">${audit}</div>` : ""}
    <details id="advanced"><summary>실행 기록·사례·자료 식별자 확인하기</summary><p>사례 ${escapeHtml(result.caseId)}</p>
    ${presentation.review ? `<p>자료 선언 ${escapeHtml(presentation.review.origin.reference)} · 아티팩트 SHA-256 ${escapeHtml(presentation.review.hash)} · 결합 입력 ${escapeHtml(presentation.review.caseRevision)}</p>` : ""}
    ${result.state === "needs-review" ? '<p><a href="#case-reasons">검증 보류 사유 보기</a></p>' : ""}${executionMetadata(presentation, {
      verified: result.state === "compared" && result.scenarios.length > 0,
      publicModel: calculationContext?.calculations.model_version ?? null,
      publicSource: calculationContext ? calculationContext.purpose === "research-display" ? calculationContext.calculations.fixtureSha256
        : calculationContext.provenance.derivedDatasetSha256 : null,
    })}</details>`);
}
