import type { DecisionResult, Estimate, ScenarioComparison } from "./contracts.ts";
import { parseDecision } from "./o-decision.ts";
export interface ReportPresentation {
  readonly mode: "synthetic" | "offline" | "live" | "recording";
  readonly scenarioLabels?: readonly string[];
  readonly execution?: { readonly traceId: string; readonly usage: string | null };
  readonly calculationVersion?: string;
  readonly sourceVersion?: string;
}
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}
export function safeLink(value: string): string | null {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && url.username === "" && url.password === "" ? escapeHtml(url.href) : null;
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}
export const list = (items: readonly string[]): string => `<ul>${items.map((v) => `<li>${escapeHtml(v)}</li>`).join("")}</ul>`;
export function page(title: string, body: string): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} · Re:Source</title><style>
  :root{color-scheme:light dark;--bg:#fbfbfa;--ink:#252824;--muted:#535b52;--line:#737b72;--surface:#fff;--action:#273e31;--on-action:#fff;--focus:#076641;--selection:#d7e9dc}
  @media(prefers-color-scheme:dark){:root{--bg:#171c19;--ink:#eef2ec;--muted:#bac5ba;--line:#8c998d;--surface:#202922;--action:#c5e5cb;--on-action:#13231a;--focus:#a4e9bf;--selection:#385c44}
}
  *{box-sizing:border-box}
html{scrollbar-color:var(--line) var(--bg)}
body{margin:0;background:var(--bg);color:var(--ink);font:1rem/1.7 system-ui,'Noto Sans KR',sans-serif;overflow-wrap:anywhere}
main{max-width:74ch;margin:auto;padding:2rem 1.25rem 4rem}
nav{display:flex;gap:1rem;flex-wrap:wrap}
nav a{padding:.5rem 0}
h1{font-size:2rem;line-height:1.25;margin:2rem 0 1rem}
h2{font-size:1.56rem;line-height:1.4;margin:3rem 0 1rem}
h3{font-size:1.25rem;margin:2rem 0 .75rem}
p{margin:.75rem 0}
a{color:var(--focus);text-underline-offset:.2em}
a:hover{text-decoration-thickness:2px}
a:active{opacity:.8}
:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
::selection{background:var(--selection);color:var(--ink)}
section{margin-block:2rem}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{text-align:left;vertical-align:top;padding:.75rem .4rem;border-bottom:1px solid var(--line);overflow-wrap:anywhere}
caption{text-align:left;font-weight:700;padding-block:.75rem}
small,.muted{color:var(--muted)}
label{display:block;margin-top:1.25rem}
input,textarea,select,button{font:inherit;border:1px solid var(--line);border-radius:4px;min-height:44px;padding:.65rem;background:var(--surface);color:var(--ink);caret-color:var(--focus)}
input,textarea,select{width:100%}
textarea{min-height:8rem;resize:vertical}
button{background:var(--action);color:var(--on-action);cursor:pointer;margin-top:1.5rem;padding-inline:1.25rem}
button:hover{filter:brightness(1.12)}
button:active{filter:brightness(.9)}
button:disabled{opacity:.6;cursor:wait}
.notice{padding:1rem;background:var(--surface)}
dl{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:.75rem}
dd{margin:0;font-variant-numeric:tabular-nums}
li{margin-block:.4rem}
.table-wrap{overflow:auto}
summary{cursor:pointer;min-height:44px;padding:.5rem 0}
footer{margin-top:3rem;border-top:1px solid var(--line);padding-top:1rem}
.print-only{display:none}
@page{size:A4;margin:18mm}
@media print{nav,form,.screen-only{display:none}
.print-only{display:block}
body{background:white;color:#222;font-size:10.5pt;line-height:1.45}
main{max-width:none;padding:0}
h1,h2,h3{break-after:avoid}
h1{font-size:20pt;margin:.75rem 0 .5rem}
h2{font-size:15pt;margin:1.25rem 0 .5rem}
h3{font-size:12pt;margin:.75rem 0 .35rem}
section{margin-block:.75rem}
th,td{padding:.35rem .3rem}
caption{padding-block:.35rem}
ul,ol{margin-block:.4rem}
li{margin-block:.2rem}
dl{gap:.35rem;margin-block:.5rem}
tr{break-inside:avoid}
thead{display:table-header-group}
p{margin-block:.5rem;orphans:3;widows:3}
footer{margin-top:.5rem;padding-top:.25rem}
.table-wrap{overflow:visible}
}
  </style></head><body><main><nav aria-label="주 메뉴"><a href="/">사례 입력</a><a href="/demo/normal">합성 비교 데모</a><a href="/demo/held">합성 보류 데모</a><a href="/reference">실자료 현황</a></nav>${body}<footer>Re:Source · 조건부 의사결정 지원. 처리·계약 실행은 별도 인간 검토가 필요합니다.</footer></main></body></html>`;
}
type Metric = Estimate<"KRW" | "kgCO2e">;
type EvidenceReferences = (ids: readonly string[]) => string;

function metric(value: Metric, references: EvidenceReferences, shared: readonly string[] = [], compact = false): string {
  switch (value.state) {
    case "unavailable":
      return `<strong>계산 불가</strong>${list(value.missingInputs)}`;
    case "available": {
      const amount = `${escapeHtml(value.central.toLocaleString("ko-KR", { maximumFractionDigits: 3 }))} ${escapeHtml(value.unit)}`;
      const range = value.low !== value.high ? ` (범위 ${escapeHtml(String(value.low))}–${escapeHtml(String(value.high))})` : "";
      if (compact) return `${amount}${range}`;
      const assumptions = value.assumptions.filter((item) => !shared.includes(item));
      return `${amount}${range}${assumptions.length ? list(assumptions) : ""}<small>근거: ${references(value.evidenceIds)}</small>`;
    }
  }
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
    <tbody>${rows.map((name, index) => `<tr><th scope="row">${name}</th>${scenarios.map((s) => `<td>${metric(metrics(s)[index]![1], references, [], true)}</td>`).join("")}</tr>`).join("")}
    <tr><th scope="row">기준선 / 회피량</th>${scenarios.map((s) => `<td>${baseline(s, references, true)}</td>`).join("")}</tr></tbody></table></div>`;
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
    <dl>${carbonMetrics.map(([name, value]) => `<dt>${escapeHtml(name)}</dt><dd>${metric(value, references, shared)}</dd>`).join("")}</dl>
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
      case "eligible":
        return `${heading} · 조건부 가능</h3>${list(route.eligibility.conditions)}<p>판정 근거: ${references(route.eligibility.evidenceIds)}</p>`;
      case "ineligible":
        return `${heading} · 부적합</h3>${list(route.eligibility.reasons)}`;
      case "unknown":
        return `${heading} · 미확인</h3>${list(route.eligibility.missingFacts)}`;
    }
  }).join("");
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
      content = `<h1>검토 필요</h1>${list(result.reasons)}`;
      break;
    case "compared": {
      const labels = result.scenarios.map((_, index) => presentation.scenarioLabels?.[index] ?? `대안 ${index + 1}`);
      const audit = result.scenarios.map((s, index) => scenarioAudit(s, labels[index]!, references)).join("");
      content = `<h1>조건부 비교</h1>
        <p class="notice">${result.humanApproval === "pending" ? "인간 승인 대기" : "인간 승인 기록 있음"} · humanApproval: ${escapeHtml(result.humanApproval)}</p>
        ${comparisonSummary(result.scenarios, labels, references)}
        ${comparisonConditions(result.scenarios, labels)}
        <p>우열 불확실 · 동일 조건과 완전한 지표를 확인한 뒤 비교하세요. 음의 순배출은 탄소 제거를 뜻하지 않습니다.</p>
        <h2>경로와 조건</h2>${routeConditions(result, references)}
        <h2>검증된 업체 후보</h2>${processorCandidates(result, references)}
        <h2>비용·탄소 상세 감사</h2>
        <details class="screen-only"><summary>계산 조건·비용 항목·탄소 활동과 계수 펼치기</summary>${audit}</details>
        <div class="print-only">${audit}</div>
        <h2>제약과 다음 확보 항목</h2>${list(result.limitations)}`;
      break;
    }
  }
  const execution = presentation.mode === "live" && presentation.execution
    ? `<p>추적 ${escapeHtml(presentation.execution.traceId)} · 사용량 ${escapeHtml(presentation.execution.usage ?? "미제공")}</p>`
    : "<p>실행 사용량 미제공</p>";
  return page("조건부 보고서", `<p>${mode}</p><p>사례 ${escapeHtml(result.caseId)}</p>${content}
    ${evidenceSection(result)}<h2>실행·계산 버전</h2>
    <p>계산 ${escapeHtml(presentation.calculationVersion ?? "미제공")} · 출처 묶음 ${escapeHtml(presentation.sourceVersion ?? "미제공")}</p>${execution}`);
}
