import type { DecisionResult } from "./contracts.ts";
import { parseDecision } from "./o-decision.ts";
import type { CaseResearchReport } from "./o-case-research-schema.ts";
import { escapeHtml, list, page } from "./report-html.ts";
import { evidenceSection, readableReason } from "./report-evidence.ts";
import { researchCalculations, researchDirectory } from "./report-research.ts";
import { comparisonSummary, comparisonConditions, prioritySummary, routeConditions, scenarioAudit } from "./report-comparison.ts";
import type { EvidenceReferences } from "./report-comparison.ts";
export interface ReportPresentation {
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
  | { readonly audience: "authenticated-research"; readonly research: CaseResearchReport | null };
/** Trusted server view fragments; never taken from model output or input metadata. */
export interface ReportView {
  readonly actions?: string;
  readonly editing?: string;
  readonly answerTarget?: "#answer-fields" | "#answers";
}
export const routeNames = { reuse: "재사용", "mechanical-recycling": "기계적 재활용", "other-recovery": "기타 회수", disposal: "처분" } as const;
function recommendationSummary(result: Extract<DecisionResult, { state: "compared" }>, references: EvidenceReferences): string {
  if (result.recommendations === undefined) return "";
  const names = { reuse: "재사용", "mechanical-recycling": "기계적 재활용", "other-recovery": "기타 회수", disposal: "처분" } as const;
  return `<section aria-labelledby="recommendation-heading"><h2 id="recommendation-heading">추천 경로 순위</h2><ol>${result.recommendations.map(item => {
    const route = result.routes.find(route => route.routeId === item.routeId);
    const amount = (metric: typeof item.cost | typeof item.carbon) => metric.value === null
      ? `미산정 (null) · ${escapeHtml(metric.reasons.join("; "))}`
      : `${escapeHtml(metric.value.toLocaleString("ko-KR"))} ${metric.unit} · ${metric.label === "assumption" ? "가정 포함 계산값" : "계산값"}${list(metric.reasons)}`;
    return `<li><h3>${item.rank}순위 · ${escapeHtml(route ? names[route.route] : item.routeId)}</h3>
      <p><strong>${item.grade === "public-conditional" ? "공개 근거상 가능(조건부)" : "사례별 자료 검토됨(실행 승인 아님)"}</strong></p>
      <p>${escapeHtml(item.basis)}</p><p>비용: ${amount(item.cost)}</p><p>탄소: ${amount(item.carbon)}</p>
      ${item.legalCitations.map(citation => `<p>${references([citation.sourceId])} ${escapeHtml(citation.locator)} · ${escapeHtml(citation.claim)}</p>`).join("")}</li>`;
  }).join("")}</ol></section>`;
}
function processorCandidates(result: Extract<DecisionResult, { state: "compared" }>, references: EvidenceReferences): string {
  if (result.processors.length === 0) {
    return "<p>검증된 후보 없음 · 적합 업체가 존재하지 않는다는 뜻은 아닙니다. 코드·허가·서비스 권역과 갱신 자료를 확보하세요.</p>";
  }
  return result.processors.map((processor) => `<h3>${escapeHtml(processor.name)}</h3>
    <p>${escapeHtml(processor.region)} · 인수 ${processor.acceptance === "confirmed" ? "확인" : "미확인"}</p>
    <p>허가 근거 ${references(processor.permitEvidenceIds)} · 확인 ${escapeHtml(processor.verifiedAt ?? "미확인")} · 코드 ${escapeHtml(processor.acceptedWasteCodes.join(", "))}</p>`).join("");
}

function conclusion(result: DecisionResult): string {
  switch (result.state) {
    case "needs-information":
      return '<p class="state question">? 추가 정보 필요</p><h1>추가 정보 필요</h1>';
    case "needs-review":
      return `<p class="state held">! 검토 필요 · 실행 보류</p><h1>검토 필요</h1><p class="held">${escapeHtml(readableReason(result.reasons[0] ?? "실행 전에 사례와 근거를 검토해야 합니다."))}</p>`;
    case "compared": {
      const recommendation = result.recommendations?.[0];
      const route = result.routes.find(item => item.routeId === recommendation?.routeId);
      return `<p class="state recommended">✓ ${recommendation ? "추천 · 공개 근거상 가능한 경로" : "조건부 비교 · 실행 전 확인 필요"}</p><h1>${route ? `${routeNames[route.route]} 추천` : "조건부 비교"}</h1>
        ${result.confidence ? `<p><strong>확신도: ${result.confidence.level === "medium" ? "중간" : "낮음"}</strong></p>${list(result.confidence.reasons.map(readableReason))}` : ""}
        <p>판단 지원 추천 · 실행·반출·계약 승인 아님. ${result.humanApproval === "pending" ? "현장 담당자 승인 대기" : "인간 승인 기록 있음"}</p>`;
    }
  }
}
function reasons(result: DecisionResult, references: EvidenceReferences, presentation: ReportPresentation): string {
  switch (result.state) {
    case "needs-information":
      return list(result.questions.filter(question => !question.startsWith("추가 답변은 필드별 JSON")).map(readableReason));
    case "needs-review":
      return list(result.reasons.slice(1).map(readableReason));
    case "compared": {
      const labels = result.scenarios.map((_, index) => presentation.scenarioLabels?.[index] ?? `대안 ${index + 1}`);
      return `${recommendationSummary(result, references)}
        ${result.scenarios.length ? comparisonSummary(result.scenarios, labels, references) : ""}
        ${comparisonConditions(result.scenarios, labels)}
        ${result.scenarios.length ? prioritySummary(result, labels, references) : ""}
        <p>우열 불확실 · 동일 조건과 완전한 지표를 확인한 뒤 비교하세요. 음의 순배출은 탄소 제거를 뜻하지 않습니다.</p>
        <h2>경로와 조건</h2>${routeConditions(result, references)}
        ${result.processors.length ? `<h2>사례별 업체 근거</h2>${processorCandidates(result, references)}` : ""}
        <h2>제약과 다음 확보 항목</h2>${list(result.limitations.map(readableReason))}`;
    }
  }
}
function executionMetadata(presentation: ReportPresentation): string {
  const runtime = presentation.runtime;
  const missingExecution = runtime?.runner === "local" ? "로컬 실행 · 외부 모델 호출 없음"
    : `${runtime?.runner === "azure" ? "Azure" : runtime?.runner === "subscription" ? "구독 경로 모델 실행" : "실행"} 성공 미검증`;
  const execution = presentation.execution
    ? `<p>실행 추적 ${escapeHtml(presentation.execution.traceId)} · 사용량 ${escapeHtml(presentation.execution.usage ?? "미제공")}</p><p>실행기가 보고한 사용량입니다. 추적 식별자는 제공자 요청 ID를 보증하지 않습니다. 청구 비용 미제공.</p>`
    : presentation.mode === "live" ? `<p>모델 실행 정보 미제공 · ${missingExecution}</p>` : "<p>실행 사용량 미제공</p>";
  const identities = { anonymous: "익명 세션", trusted: "서버 인증 사용자", "local-operator": "로컬 운영자" } as const;
  const runners = { local: "로컬", subscription: "구독 경로 모델 실행", azure: "Azure 연결", unspecified: "미지정" } as const;
  return `<p>계산 ${escapeHtml(presentation.calculationVersion ?? "미제공")} · 출처 묶음 ${escapeHtml(presentation.sourceVersion ?? "미제공")}</p>
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
  const checks = "preExecutionChecks" in result ? result.preExecutionChecks ?? [] : [];
  const answerAction = result.state !== "compared" ? view.answerTarget : undefined;
  const audit = result.state === "compared" ? result.scenarios.map((scenario, index) => scenarioAudit(scenario, presentation.scenarioLabels?.[index] ?? `대안 ${index + 1}`, references)).join("") : "";
  return page("조건부 보고서", `${conclusion(result)}<p>${mode}</p>${data}
    ${presentation.historical ? '<p class="notice">과거 평가: 현재 입력과 평가 당시 입력이 다릅니다. 명시적으로 다시 평가해 주세요.</p>' : ""}
    <div class="cluster screen-only">${answerAction ? `<a class="primary-action" href="${answerAction}">${result.state === "needs-information" ? "답변 입력하기" : "입력 다시 확인하기"}</a>` : ""}<a class="primary-action${answerAction ? " secondary-action" : ""}" href="#evidence">근거 확인하기</a><a class="primary-action secondary-action" href="#checks">실행 전 확인하기</a></div>
    ${view.actions ?? ""}${reasons(result, references, presentation)}
    ${research ? researchCalculations(research) + researchDirectory(research) : ""}
    <section id="checks"><h2>실행 전 확인사항</h2>${checks.length ? list(checks.map(readableReason)) : "<p>질문에 답하고 실제 질량·물질·접촉 이력을 확인하세요. 반출·계약·처리는 현장 담당자의 별도 검토와 승인이 필요합니다.</p>"}</section>
    ${view.editing ?? ""}${evidenceSection(result)}
    ${audit ? `<h2>비용·탄소 상세 감사</h2><details class="screen-only"><summary>계산 조건·비용 항목·탄소 활동과 계수 펼치기</summary>${audit}</details><div class="print-only">${audit}</div>` : ""}
    <details id="advanced"><summary>실행 기록·사례·자료 식별자 확인하기</summary><p>사례 ${escapeHtml(result.caseId)}</p>
    ${presentation.review ? `<p>자료 선언 ${escapeHtml(presentation.review.origin.reference)} · 아티팩트 SHA-256 ${escapeHtml(presentation.review.hash)} · 결합 입력 ${escapeHtml(presentation.review.caseRevision)}</p>` : ""}
    ${result.state === "needs-review" ? `<p>검증 진단 원문</p>${list(result.reasons)}` : ""}${executionMetadata(presentation)}</details>`);
}
