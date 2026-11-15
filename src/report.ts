import { creditPolicyNotes, restrictedNet } from "./carbon.ts";
import type { DecisionResult, Estimate, ScenarioComparison } from "./contracts.ts";
import { parseDecision } from "./o-decision.ts";
import { rankScenarios } from "./ranking.ts";
import { escapeHtml, safeLink, list, page } from "./report-html.ts";
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
type Metric = Estimate<"KRW" | "kgCO2e">;
type EvidenceReferences = (ids: readonly string[]) => string;

function metric(value: Metric, references: EvidenceReferences, shared: readonly string[] = [], compact = false): string {
  switch (value.state) {
    case "unavailable":
      return `<strong>계산 불가</strong>${list(value.missingInputs)}`;
    case "available": {
      const amount = `${escapeHtml(value.central.toLocaleString("ko-KR", { maximumFractionDigits: 3 }))} ${escapeHtml(value.unit)}`;
      const range = value.low !== value.high ? ` (범위 ${escapeHtml(String(value.low))}–${escapeHtml(String(value.high))})` : "";
      if (compact) return `${amount}${range}${list(value.assumptions.filter((note) => /대체효과 제외 경계/.test(note)))}`;
      const assumptions = value.assumptions.filter((item) => !shared.includes(item));
      return `${amount}${range}${assumptions.length ? list(assumptions) : ""}<small>근거: ${references(value.evidenceIds)}</small>`;
    }
  }
}
function unavailableNetPolicy(s: ScenarioComparison, value: Metric): string {
  const notes = creditPolicyNotes([s.materialCredit, s.energyCredit]);
  return value === s.netEmissions && value.state === "unavailable" && notes.length
    ? list([...notes, restrictedNet]) : "";
}
function metrics(s: ScenarioComparison): readonly (readonly [string, Metric])[] {
  return [
    ["순비용 (사업자 관점)", s.netCost],
    ["총배출", s.grossEmissions],
    ["원료 크레딧", s.materialCredit],
    ["에너지 크레딧", s.energyCredit],
    ["순배출", s.netEmissions],
  ];
}
function baseline(s: ScenarioComparison, references: EvidenceReferences, compact: boolean): string {
  switch (s.avoidedEmissions.state) {
    case "no-baseline":
      return "기준선 없음";
    case "baseline-provided":
      return `기준선 ${escapeHtml(s.avoidedEmissions.baselineRouteId)} · 회피량 ${metric(s.avoidedEmissions.amount, references, [], compact)}`;
  }
}
function comparisonSummary(scenarios: readonly ScenarioComparison[], labels: readonly string[], references: EvidenceReferences): string {
  const rows = ["순비용 (사업자 관점)", "총배출", "원료 크레딧", "에너지 크레딧", "순배출"];
  return `<h2>대안 비교 요약</h2>
    <div class="table-wrap"><table><caption>동일 조건 확인 후 비교 · 우열 불확실</caption>
    <thead><tr><th scope="col">지표</th>${labels.map((label) => `<th scope="col">${escapeHtml(label)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((name, index) => `<tr><th scope="row">${name}</th>${scenarios.map((s) => `<td>${metric(metrics(s)[index]![1], references, [], true)}${unavailableNetPolicy(s, metrics(s)[index]![1])}</td>`).join("")}</tr>`).join("")}
    <tr><th scope="row">기준선 / 회피량</th>${scenarios.map((s) => `<td>${baseline(s, references, true)}</td>`).join("")}</tr></tbody></table></div>`;
}
function prioritySummary(result: Extract<DecisionResult, { state: "compared" }>, labels: readonly string[], references: EvidenceReferences): string {
  const priorities = rankScenarios(result.scenarios, result.routes);
  return `<section aria-labelledby="priority-heading"><h2 id="priority-heading">서버 후보 우선순위</h2>
    <p>적합성 충족 후보의 사업자 순비용(KRW)과 순배출(kgCO2e)을 작을수록 우선합니다. 같은 기능단위·계산 경계에서 두 지표의 최악값이 상대 최선값 이하이고 하나 이상 엄격히 작을 때만 우월합니다. 우월한 후보부터 제거하며 순위군을 계산합니다.</p>
    <p>같은 군의 동률·상충·범위 중첩은 우열 불확실로 남깁니다. 가중치나 비용·탄소 환산은 사용하지 않습니다. 군 안의 표시 순서는 입력 순서이며 우선순위가 아닙니다. 자료가 부족한 후보는 순위 보류입니다.</p>
    <ol>${priorities.map((priority) => {
      const scenario = result.scenarios[priority.scenarioIndex];
      if (scenario === undefined) return "";
      return `<li><strong>${priority.group === null ? "순위 보류" : `${priority.group}순위군`} · ${escapeHtml(labels[priority.scenarioIndex] ?? scenario.routeId)}</strong>
        <p>${escapeHtml(priority.reason)}</p><div>순비용 ${metric(scenario.netCost, references, [], true)} · 순배출 ${metric(scenario.netEmissions, references, [], true)}</div></li>`;
    }).join("")}</ol><p>순위는 비교 가능한 후보 안의 조건부 우선순위이며 반출·계약·처리 승인이나 탄소 제거를 뜻하지 않습니다.</p></section>`;
}
function sharedAssumptions(values: readonly Metric[]): readonly string[] {
  const available = values.filter((value) => value.state === "available");
  const first = available[0];
  if (first === undefined) return [];
  return [...new Set(first.assumptions)].filter((item) =>
    ["입력값 고정 계산 · 불확실성 범위 미제공", "VAT 포함", "VAT 별도"].includes(item)
    && available.every((value) => value.assumptions.includes(item)));
}
function auditGroup(title: string, values: readonly Metric[], render: (shared: readonly string[]) => string): string {
  const shared = sharedAssumptions(values);
  return `<h4>${title}</h4>${render(shared)}`;
}
function scenarioAudit(s: ScenarioComparison, label: string, references: EvidenceReferences): string {
  const cost = auditGroup("비용 조건·내역", [s.netCost, ...s.costLines.map((line) => line.amount)], (shared) => `
    <p>순비용: ${metric(s.netCost, references, shared)}</p>
    <div class="table-wrap"><table><caption>비용 항목</caption>
    <thead><tr><th scope="col">항목 / 구분</th><th scope="col">금액 / 합산 조건</th></tr></thead>
    <tbody>${s.costLines.map((line) => `<tr><td>${escapeHtml(line.quoteId)}<br>${escapeHtml(line.category)}</td><td>${metric(line.amount, references, shared)}</td></tr>`).join("")}</tbody></table></div>`);
  const carbonMetrics = metrics(s).slice(1);
  const carbonValues = [...carbonMetrics.map(([, value]) => value), ...s.carbonLines.map((line) => line.amount)];
  if (s.avoidedEmissions.state === "baseline-provided") carbonValues.push(s.avoidedEmissions.amount);
  const carbon = auditGroup("탄소 조건·내역", carbonValues, (shared) => `
    <dl>${carbonMetrics.map(([name, value]) => `<dt>${escapeHtml(name)}</dt><dd>${metric(value, references, shared)}${unavailableNetPolicy(s, value)}</dd>`).join("")}</dl>
    <p>회피량: ${s.avoidedEmissions.state === "no-baseline" ? "기준선 없음" : `기준선 ${escapeHtml(s.avoidedEmissions.baselineRouteId)} ${metric(s.avoidedEmissions.amount, references, shared)}`}</p>
    <div class="table-wrap"><table><caption>탄소 활동·계수</caption>
    <thead><tr><th scope="col">활동 / 계수 버전</th><th scope="col">배출·크레딧</th></tr></thead>
    <tbody>${s.carbonLines.map((line) => `<tr><td>${escapeHtml(line.activityId)} · ${escapeHtml(line.stage)}<br>${escapeHtml(line.factorId ?? "계수 없음")} / ${escapeHtml(line.factorVersion ?? "버전 없음")}</td><td>${metric(line.amount, references, shared)}</td></tr>`).join("")}</tbody></table></div>`);
  return `<section><h3>${escapeHtml(label)} · 경로 ${escapeHtml(s.routeId)}</h3>${cost}${carbon}</section>`;
}
function comparisonConditions(scenarios: readonly ScenarioComparison[], labels: readonly string[]): string {
  const groups = new Map<string, { functionalUnit: string; boundary: string; labels: string[] }>();
  const conditions = new Map<string, { title: string; assumptions: readonly string[]; labels: string[] }>();
  scenarios.forEach((s, index) => {
    const key = JSON.stringify([s.functionalUnit, s.boundary]);
    const group = groups.get(key) ?? { functionalUnit: s.functionalUnit, boundary: s.boundary, labels: [] };
    group.labels.push(labels[index]!);
    groups.set(key, group);
    const carbon = [...metrics(s).slice(1).map(([, value]) => value), ...s.carbonLines.map((line) => line.amount)];
    if (s.avoidedEmissions.state === "baseline-provided") carbon.push(s.avoidedEmissions.amount);
    for (const [title, values] of [["비용", [s.netCost, ...s.costLines.map((line) => line.amount)]], ["탄소", carbon]] as const) {
      const assumptions = sharedAssumptions(values);
      if (assumptions.length === 0) continue;
      const conditionKey = JSON.stringify([title, assumptions]);
      const condition = conditions.get(conditionKey) ?? { title, assumptions, labels: [] };
      condition.labels.push(labels[index]!);
      conditions.set(conditionKey, condition);
    }
  });
  const notes = [...conditions.values()].map((condition) => `<p>${escapeHtml(condition.labels.join(" / "))} · ${condition.title}</p>${list(condition.assumptions)}`).join("");
  return [...groups.values()].map((group) => `<p>${escapeHtml(group.labels.join(" / "))} · 기능단위 ${escapeHtml(group.functionalUnit)}<br>계산 경계: ${escapeHtml(group.boundary)}</p>`).join("") + notes;
}
function routeConditions(result: Extract<DecisionResult, { state: "compared" }>, references: EvidenceReferences): string {
  return result.routes.map((route) => {
    const heading = `<h3>${escapeHtml(route.routeId)}`;
    switch (route.eligibility.state) {
      case "conditional":
        return `${heading} · 공개 근거상 가능(조건부)</h3>${list(route.eligibility.conditions)}<p>공개 법령 근거: ${references(route.eligibility.evidenceIds)}</p>`;
      case "eligible":
        return `${heading} · 조건부 가능</h3>${list(route.eligibility.conditions)}<p>판정 근거: ${references(route.eligibility.evidenceIds)}</p>`;
      case "ineligible":
        return `${heading} · 부적합</h3>${list(route.eligibility.reasons)}`;
      case "unknown":
        return `${heading} · 미확인</h3>${list(route.eligibility.missingFacts)}`;
    }
  }).join("");
}
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
  }).join("")}</ol><p>확신도: ${result.confidence?.level === "medium" ? "중간" : "낮음"}</p>${list(result.confidence?.reasons ?? [])}</section>`;
}
function processorCandidates(result: Extract<DecisionResult, { state: "compared" }>, references: EvidenceReferences): string {
  if (result.processors.length === 0) {
    return "<p>검증된 후보 없음 · 적합 업체가 존재하지 않는다는 뜻은 아닙니다. 코드·허가·서비스 권역과 갱신 자료를 확보하세요.</p>";
  }
  return result.processors.map((processor) => `<h3>${escapeHtml(processor.name)}</h3>
    <p>${escapeHtml(processor.region)} · 인수 ${processor.acceptance === "confirmed" ? "확인" : "미확인"}</p>
    <p>허가 근거 ${references(processor.permitEvidenceIds)} · 확인 ${escapeHtml(processor.verifiedAt ?? "미확인")} · 코드 ${escapeHtml(processor.acceptedWasteCodes.join(", "))}</p>`).join("");
}
function evidenceSection(result: DecisionResult): string {
  if (result.evidence.length === 0) return "<h2>출처와 원문 위치</h2><p>연결된 근거 없음</p>";
  return `<h2>출처와 원문 위치</h2>${result.evidence.map((evidence, index) => {
    const url = safeLink(evidence.url);
    const title = url === null ? escapeHtml(evidence.title) : `<a href="${url}" rel="noreferrer">${escapeHtml(evidence.title)}</a>`;
    return `<section id="evidence-${index + 1}"><h3>[${index + 1}] ${title}</h3>
      <p>출처 ID ${escapeHtml(evidence.sourceId)} · ${escapeHtml(evidence.publisher)} · ${escapeHtml(evidence.locator)}</p>
      <p>버전 ${escapeHtml(evidence.datasetVersion)} · 조회 ${escapeHtml(evidence.retrievedAt)}</p>
      <p>사용권 ${escapeHtml(evidence.license ?? "미확인")} · 확인 ${evidence.licenseVerified ? "예" : "아니오"}</p></section>`;
  }).join("")}`;
}
export function renderReport(result: DecisionResult, presentation: ReportPresentation): string {
  parseDecision(result);
  const references: EvidenceReferences = (ids) => ids.map((id) => {
    const index = result.evidence.findIndex((evidence) => evidence.sourceId === id);
    return index < 0 ? escapeHtml(id) : `<a href="#evidence-${index + 1}">[${index + 1}]</a>`;
  }).join(", ");
  const mode = {
    synthetic: "합성 데모 · 모델 호출 없음",
    offline: "오프라인 계산 · 모델 호출 없음",
    live: "실행 어댑터 결과",
    recording: "사전 녹화",
  }[presentation.mode];
  let content: string;
  switch (result.state) {
    case "needs-information":
      content = `<h1>추가 정보 필요</h1>${list(result.questions)}`;
      break;
    case "needs-review":
      content = `<h1>검토 필요</h1>${list(result.reasons)}
        ${result.preExecutionChecks ? `<h2>실행 전 확인사항</h2>${list(result.preExecutionChecks)}` : ""}`;
      break;
    case "compared": {
      const labels = result.scenarios.map((_, index) => presentation.scenarioLabels?.[index] ?? `대안 ${index + 1}`);
      const audit = result.scenarios.map((s, index) => scenarioAudit(s, labels[index]!, references)).join("");
      content = `<h1>${result.recommendations ? "추천 후보, 실행 전 확인 필요" : "조건부 비교"}</h1>
        <p class="notice">${result.recommendations ? "판단 지원 추천 · 실행·반출·계약 승인 아님" : result.humanApproval === "pending" ? "인간 승인 대기" : "인간 승인 기록 있음"} · humanApproval: ${escapeHtml(result.humanApproval)}</p>
        ${recommendationSummary(result, references)}
        ${result.scenarios.length ? comparisonSummary(result.scenarios, labels, references) : ""}
        ${comparisonConditions(result.scenarios, labels)}
        ${result.scenarios.length ? prioritySummary(result, labels, references) : ""}
        <p>우열 불확실 · 동일 조건과 완전한 지표를 확인한 뒤 비교하세요. 음의 순배출은 탄소 제거를 뜻하지 않습니다.</p>
        <h2>경로와 조건</h2>${routeConditions(result, references)}
        ${result.preExecutionChecks ? `<h2>실행 전 확인사항</h2>${list(result.preExecutionChecks)}` : ""}
        <h2>검증된 업체 후보</h2>${processorCandidates(result, references)}
        <h2>비용·탄소 상세 감사</h2>
        <details class="screen-only"><summary>계산 조건·비용 항목·탄소 활동과 계수 펼치기</summary>${audit}</details>
        <div class="print-only">${audit}</div>
        <h2>제약과 다음 확보 항목</h2>${list(result.limitations)}`;
      break;
    }
  }
  const execution = presentation.execution
    ? `<p>실행 추적 ${escapeHtml(presentation.execution.traceId)} · 사용량 ${escapeHtml(presentation.execution.usage ?? "미제공")}</p><p>실행기가 보고한 사용량입니다. 추적 식별자는 제공자 요청 ID를 보증하지 않습니다. 청구 비용 미제공.</p>`
    : presentation.mode === "live" ? "<p>모델 실행 정보 미제공 · Azure 성공 미검증</p>" : "<p>실행 사용량 미제공</p>";
  const runtime = presentation.runtime ? `<p>평가 당시: ${escapeHtml(presentation.runtime.identity)} · ${escapeHtml(presentation.runtime.storage)} · 구성된 실행기 ${escapeHtml(presentation.runtime.runner)} (실행 성공과 별개)</p>` : "<p>평가 당시 인증·저장·실행기 설정 미제공</p>";
  const data = presentation.review ? `<p class="notice">${presentation.review.origin.kind === "synthetic" ? "합성 자료 · 현장 근거 아님" : "현장 자료로 선언된 검토 아티팩트 · 인간·법적 승인 아님"} · review-required</p><p>자료 선언 ${escapeHtml(presentation.review.origin.reference)} · 아티팩트 SHA-256 ${escapeHtml(presentation.review.hash)} · 결합 입력 ${escapeHtml(presentation.review.caseRevision)}</p>` : presentation.mode === "synthetic" ? "<p>합성 입력·계산 예시 · 현장 근거 아님</p>" : "<p>미검토 사용자 입력 · 정확한 입력에 결합된 검토 아티팩트 없음 · 운영 자료 미제공</p>";
  return page("조건부 보고서", `<p>${mode}</p>${data}${presentation.historical ? '<p class="notice">과거 평가: 현재 입력과 평가 당시 입력이 다릅니다. 명시적으로 다시 평가해 주세요.</p>' : ""}<p>사례 ${escapeHtml(result.caseId)}</p>${content}
    ${evidenceSection(result)}<h2>실행·계산 버전</h2>
    <p>계산 ${escapeHtml(presentation.calculationVersion ?? "미제공")} · 출처 묶음 ${escapeHtml(presentation.sourceVersion ?? "미제공")}</p>${runtime}${execution}<p>사용량은 청구·비용 증빙이 아닙니다.</p>`);
}
