import type { CaseInput } from "./contracts.ts";
import { MAX_CASE_MASS_KG } from "./contracts.ts";
import { escapeHtml, page } from "./report-html.ts";
import { caseFormTextLimits, HttpFailure } from "./app-http.ts";
import { intakeForm } from "./intake-form.ts";
import { koreanDeadline, koreanSourceDate } from "./report-date.ts";
export { loginPage } from "./login-views.ts";

const contactLabels = { unknown: "미상", yes: "있음", no: "없음" } as const;
const textFields = [
  ["description", "폐자원 설명"], ["process", "발생 공정"], ["polymer", "재질·품목"],
  ["contamination", "오염 상태"], ["region", "발생 지역"], ["assessmentDate", "평가 기준일"],
] as const;
export function nativeAnswer(raw: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const allowed = new Set(["answerMode", "field_massKg", "field_hazardousContact", ...textFields.map(([field]) => `field_${field}`)]);
  if (Object.keys(raw).some(key => !allowed.has(key))) throw new HttpFailure(400, "수정할 수 없는 필드가 있습니다. 입력란의 항목만 보내 주세요.");
  const patch: Record<string, unknown> = {};
  for (const [field] of textFields) {
    const value = raw[`field_${field}`];
    if (value === undefined) continue;
    if (typeof value !== "string") throw new HttpFailure(400, "답변은 각 입력란에 적어 주세요.");
    patch[field] = value === "" && field !== "description" && field !== "assessmentDate" ? null : value;
  }
  const mass = raw["field_massKg"];
  if (mass !== undefined) {
    if (typeof mass !== "string" || (mass.trim() !== "" && (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(mass) || !Number.isFinite(Number(mass))))) throw new HttpFailure(400, "질량은 kg 숫자로 입력하고, 모르면 비워 두세요.");
    patch["massKg"] = mass.trim() === "" ? null : Number(mass);
  }
  const hazardous = raw["field_hazardousContact"];
  if (hazardous !== undefined) {
    if (hazardous !== "yes" && hazardous !== "no" && hazardous !== "unknown") throw new HttpFailure(400, "유해물질 접촉에서 미상·있음·없음 중 하나를 고르세요.");
    patch["hazardousContact"] = hazardous;
  }
  if (Object.keys(patch).length === 0) throw new HttpFailure(400, "바꿀 항목을 하나 이상 입력하세요.");
  return patch;
}
function fields(input?: CaseInput, draft?: Readonly<Record<string, unknown>>): string {
  const prefix = "field_";
  const supplied = (field: string, fallback: string): string => {
    const value = draft?.[prefix + field];
    return typeof value === "string" ? value : fallback;
  };
  const massField = `<label for="${prefix}massKg">질량 (kg, 0 초과 ~ ${MAX_CASE_MASS_KG.toLocaleString("ko-KR")} 이하, 모르면 비워 두기)</label><input id="${prefix}massKg" name="${prefix}massKg" type="number" min="0" max="${MAX_CASE_MASS_KG}" step="any" value="${escapeHtml(supplied("massKg", String(input?.massKg ?? "")))}"><p>한 사례는 최대 ${MAX_CASE_MASS_KG / 1000}톤 배치입니다. 더 많으면 배치별로 나눠 입력하세요.</p>`;
  const text = textFields.map(([field, label]) => {
    const id = prefix + field;
    const value = supplied(field, input?.[field] ?? "");
    return `<label for="${id}">${label}${field !== "description" && field !== "assessmentDate" ? " (모르면 비워 두기)" : ""}</label>
      ${field === "description" ? `<textarea id="${id}" name="${id}" required maxlength="${caseFormTextLimits.description}">${escapeHtml(value)}</textarea>` : `<input id="${id}" name="${id}" ${field === "assessmentDate" ? 'type="date" required' : `maxlength="${caseFormTextLimits[field]}"`} value="${escapeHtml(value)}">`}`;
  });
  const hazardous = `<label for="${prefix}hazardousContact">유해물질 접촉</label><select id="${prefix}hazardousContact" name="${prefix}hazardousContact">
     ${([["unknown", "모름"], ["yes", "있음"], ["no", "없음"]] as const).map(([value, label]) => `<option value="${value}" ${supplied("hazardousContact", input?.hazardousContact ?? "unknown") === value ? "selected" : ""}>${label}</option>`).join("")}</select>`;
  const remaining = text.slice(1, 4).join("") + hazardous + text.slice(4, 5).join("") + text[0] + text[5];
  const massOnly = input?.massKg === null && input.hazardousContact === "no"
    && [input.process, input.polymer, input.contamination, input.region].every(value => value !== null && value.trim() !== "");
  return massOnly ? massField + remaining : remaining + massField;
}
export function caseInputSummary(input: CaseInput, editTarget?: string): string {
  const values: readonly (readonly [string, string | null])[] = [
    ["발생 공정", input.process], ["재질·품목", input.polymer], ["오염 상태", input.contamination],
    ["유해물질 접촉", contactLabels[input.hazardousContact]], ["질량", input.massKg === null ? null : `${input.massKg.toLocaleString("ko-KR")} kg`],
    ["발생 지역", input.region], ["평가 기준일", koreanSourceDate(input.assessmentDate)],
  ];
  return `<div class="case-input-summary screen-only"><h2>현재 사례 입력</h2><p>${escapeHtml(input.description)}</p><dl>${values.map(([label, value]) =>
    `<dt>${label}</dt><dd>${escapeHtml(value || "미상")}</dd>`).join("")}</dl>${editTarget ? `<a href="${escapeHtml(editTarget)}">입력 수정하기</a>` : ""}</div>`;
}

export function form(action: string, answers = false, version?: number, selection = "", input?: CaseInput, draft?: Readonly<Record<string, unknown>>): string {
  const versionField = version === undefined ? "" : `<input type="hidden" name="baseVersion" value="${version}">`;
  if (!answers) return intakeForm(action, { input, draft });
  const native = input ? `<h2 id="answer-fields" tabindex="-1">답변·사례 수정</h2><p>현재 입력이 채워져 있습니다. 바꿀 항목만 고치고 제출하세요. 빈칸은 미상, 질량은 kg입니다.</p>
    <form method="post" action="${escapeHtml(action)}">${versionField}<input type="hidden" name="answerMode" value="fields">${fields(input, draft)}${selection}
      <button type="submit">다시 평가하기</button></form>` : "";
  return `${native}<details><summary>텍스트로 수정하기 (고급)</summary><form method="post" action="${escapeHtml(action)}">${versionField}
    <label for="answers">수정 내용 (JSON 형식)</label><p id="answers-help">바꿀 항목만 적으세요. 생략한 항목은 그대로 둡니다. 값을 미상으로 바꾸려면 <code>null</code>을 쓰세요. 숫자는 따옴표 없이 씁니다. 사례 번호와 판정·승인은 바꿀 수 없습니다.</p>
    <p>입력 예시: <code>{"polymer":"PP","massKg":100}</code></p>
    <textarea id="answers" name="answers" aria-describedby="answers-help" required maxlength="${caseFormTextLimits.answers}"></textarea>${selection}<button type="submit">수정 내용 제출</button></form></details>`;
}

export interface InputView {
  readonly authenticated: boolean;
  readonly localAuth: boolean;
  readonly connected: boolean;
  readonly photoEnabled: boolean;
}
export interface CaseListRow {
  readonly caseId: string;
  readonly title: string;
  readonly deadline: number;
  readonly state: "compared" | "needs-information" | "needs-review" | "unknown";
}
export function caseListPage(rows: readonly CaseListRow[], localAuth: boolean, options: { readonly deadlineLabel: string; readonly status: string | null }): string {
  const { deadlineLabel } = options;
  const filters = [
    ["all", "전체"], ["compared", "추천"], ["needs-information", "정보 필요"], ["needs-review", "보류"],
  ] as const;
  const selected = filters.find(([value]) => value === options.status)?.[0] ?? "all";
  const counts = { all: rows.length, compared: 0, "needs-information": 0, "needs-review": 0, unknown: 0 };
  for (const row of rows) counts[row.state] += 1;
  const status = {
    compared: ["recommendation", "추천"],
    "needs-information": ["information", "정보 필요"],
    "needs-review": ["hold", "보류"],
    unknown: ["unknown", "상태 미확인"],
  } as const;
  const visibleRows = rows.filter(row => selected === "all" || row.state === selected);
  const tableRows = visibleRows.map(row => {
    const [kind, label] = status[row.state];
    const casePath = `/cases/${encodeURIComponent(row.caseId)}`;
    return `<tr role="row" data-case-id="${escapeHtml(row.caseId)}"><td role="cell" headers="case-title" data-label="사례"><h2>${escapeHtml(row.title)}</h2></td>
      <td role="cell" headers="case-status" data-label="상태"><span class="case-badge case-badge-${kind}">${label}</span></td>
      <td role="cell" headers="case-deadline" data-label="${escapeHtml(deadlineLabel)}">${koreanDeadline(row.deadline)}</td>
      <td role="cell" headers="case-actions" data-label="열기"><div class="case-card-links"><a href="${casePath}">사례 상세</a><a href="${casePath}/report">보고서</a></div></td></tr>`;
  }).join("");
  const countCards = filters.map(([value, label]) => `<li data-status="${value}">${label} <strong>${counts[value]}</strong></li>`).join("");
  const filterLinks = filters.map(([value, label]) => `<a data-status="${value}" href="${value === "all" ? "/cases" : `/cases?status=${value}`}"${selected === value ? ' aria-current="page"' : ""}>${label}</a>`).join("");
  const table = `<table class="case-table" role="table" aria-label="내 사례 목록"><thead role="rowgroup"><tr role="row">
    <th id="case-title" scope="col" role="columnheader">사례</th><th id="case-status" scope="col" role="columnheader">상태</th><th id="case-deadline" scope="col" role="columnheader">${escapeHtml(deadlineLabel)}</th><th id="case-actions" scope="col" role="columnheader">열기</th>
    </tr></thead><tbody role="rowgroup">${tableRows}</tbody></table>`;
  return page("내 사례", `<h1>내 사례</h1><p><a class="primary-action" href="/">새 사례 입력</a></p>
    <section aria-label="사례 판정 건수"><ul class="case-counts">${countCards}</ul></section>
    <nav class="case-filters" aria-label="사례 상태 필터">${filterLinks}</nav>
    <section class="case-list" aria-label="사례 목록">${visibleRows.length ? table : `<p class="case-empty">${rows.length ? "이 상태의 사례가 없습니다." : "저장된 사례가 없어요."}</p>`}</section>
    ${localAuth ? '<form method="post" action="/logout"><button class="secondary-action" type="submit">로그아웃</button></form>' : ""}`, "workspace");
}
type InputCorrection = { readonly draft: Readonly<Record<string, unknown>> }
  & ({ readonly material: string } | { readonly field: "assessmentDate" });

export function inputPage(options: InputView, correction?: InputCorrection): string {
  const scopeCorrection = correction && "material" in correction ? correction : undefined;
  const landing = correction ? "" : `<section class="intake-landing" data-intake-landing aria-labelledby="intake-heading">
      <h1 id="intake-heading">폐자원 처리 방향을 함께 검토해요</h1>
      ${options.connected ? "" : '<p class="notice" data-intake-connection-notice role="status">지금은 검토에 연결할 수 없습니다.</p>'}
      <a class="primary-action" href="#case-intake" data-intake-start>폐자원 검토 시작</a>
    </section>`;
  return page("사례 입력", `${landing}
    <section class="intake-panel" id="case-intake" data-intake-panel aria-label="새 사례 입력" tabindex="-1"${scopeCorrection ? " data-out-of-scope" : ""}>
      <h1 class="intake-heading" id="intake-form-heading" tabindex="-1">새 사례 입력</h1>
      ${correction ? `<div class="notice" role="alert">${scopeCorrection
        ? `<p>${escapeHtml(scopeCorrection.material)}는 검토 범위에 포함되지 않습니다. 판정하거나 저장하지 않았습니다.</p><p>폐플라스틱·금속 스크랩·폐목재·포장재(종이·복합 포함)를 검토합니다. 재질을 확인한 뒤 아래 입력을 고쳐 다시 제출하세요.</p>`
        : "<p>검토 기준일을 9999년 12월 31일 이하의 실제 날짜로 고쳐 다시 제출하세요. 입력한 다른 항목은 그대로 남아 있습니다.</p>"}</div>` : ""}
      <p class="intake-intro">알고 있는 내용을 적어 주세요. 폐자원 설명과 검토 기준일은 필수입니다.</p>
      ${form("/cases", false, undefined, "", undefined, correction?.draft)}
    </section>`, "workspace");
}
