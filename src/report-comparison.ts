import { creditPolicyNotes, restrictedNet } from "./carbon.ts";
import type { DecisionResult, Estimate, ScenarioComparison } from "./contracts.ts";
import { rankScenarios } from "./ranking.ts";
import { escapeHtml, list } from "./report-html.ts";
type Metric = Estimate<"KRW" | "kgCO2e">;
export type EvidenceReferences = (ids: readonly string[]) => string;

export function metric(value: Metric, references: EvidenceReferences, shared: readonly string[] = [], compact = false): string {
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
export function comparisonSummary(scenarios: readonly ScenarioComparison[], labels: readonly string[], references: EvidenceReferences): string {
  const rows = ["순비용 (사업자 관점)", "총배출", "원료 크레딧", "에너지 크레딧", "순배출"];
  return `<h2>대안 비교 요약</h2>
    <div class="table-wrap"><table><caption>동일 조건 확인 후 비교 · 우열 불확실</caption>
    <thead><tr><th scope="col">지표</th>${labels.map((label) => `<th scope="col">${escapeHtml(label)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((name, index) => `<tr><th scope="row">${name}</th>${scenarios.map((s) => `<td>${metric(metrics(s)[index]![1], references, [], true)}${unavailableNetPolicy(s, metrics(s)[index]![1])}</td>`).join("")}</tr>`).join("")}
    <tr><th scope="row">기준선 / 회피량</th>${scenarios.map((s) => `<td>${baseline(s, references, true)}</td>`).join("")}</tr></tbody></table></div>`;
}
export function prioritySummary(result: Extract<DecisionResult, { state: "compared" }>, labels: readonly string[], references: EvidenceReferences): string {
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
export function scenarioAudit(s: ScenarioComparison, label: string, references: EvidenceReferences): string {
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
export function comparisonConditions(scenarios: readonly ScenarioComparison[], labels: readonly string[]): string {
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
export function routeConditions(result: Extract<DecisionResult, { state: "compared" }>, references: EvidenceReferences): string {
  return result.routes.map((route) => {
    const names = { reuse: "재사용", "mechanical-recycling": "기계적 재활용", "other-recovery": "기타 회수", disposal: "처분" } as const;
    const heading = `<h3>${names[route.route]}`;
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
