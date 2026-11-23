import type { CaseInput } from "./contracts.ts";
import { randomUUID } from "node:crypto";
import { MAX_CASE_MASS_KG } from "./contracts.ts";
import { caseFormTextLimits } from "./app-http.ts";
import { escapeHtml } from "./report-html.ts";

// Presentation groups only. Chip values are existing materialAliases literals.
const materials = [
  { id: "plastic", label: "플라스틱", values: ["PP", "PET", "HDPE", "PE", "PVC"],
    drawing: '<path d="M27 10h10v9l7 9v25H20V28l7-9Z"/><path d="M27 16h10M20 34h24M26 41h12M26 47h12"/>' },
  { id: "metal", label: "금속", values: ["철 스크랩", "알루미늄", "구리", "비철금속"],
    drawing: '<path d="m10 24 22-12 22 12-22 12Z"/><path d="m10 34 22 12 22-12M10 44l22 12 22-12M32 36v20"/>' },
  { id: "wood", label: "목재", values: ["목재", "톱밥", "목재 포장재"],
    drawing: '<path d="M10 18h44v28H10Z"/><path d="M10 27h44M10 37h44M19 18v9M43 27v10M24 37v9"/>' },
  { id: "paper", label: "종이·포장재", values: ["종이", "골판지", "종이팩", "복합 포장재"],
    drawing: '<path d="M18 10h22l10 10v34H18Z"/><path d="M40 10v12h10M25 31h18M25 39h18M25 47h12M12 18v40h30"/>' },
] as const;

export function intakeForm(action: string, values: {
  readonly input?: CaseInput | undefined;
  readonly draft?: Readonly<Record<string, unknown>> | undefined;
  readonly submissionId?: string | undefined;
  readonly retry?: boolean;
} = {}): string {
  const supplied = (field: keyof CaseInput): string => {
    const draft = values.draft?.[field];
    return escapeHtml(typeof draft === "string" ? draft : String(values.input?.[field] ?? ""));
  };
  const hazard = typeof values.draft?.["hazardousContact"] === "string"
    ? values.draft["hazardousContact"] : values.input?.hazardousContact ?? "unknown";
  const description = supplied("description");
  // The HTML parser discards one leading newline in a textarea.
  const textareaDescription = /^[\r\n]/u.test(description) ? `\n${description}` : description;
  return `<form method="post" action="${escapeHtml(action)}" class="intake-form" data-intake-form>
    <input type="hidden" name="submissionId" value="${escapeHtml(values.submissionId ?? randomUUID())}">
    <div class="intake-layout">
    <div class="intake-fields">
    <fieldset class="intake-section" data-intake-section="material" aria-labelledby="intake-material-heading">
      <legend class="intake-section-title" id="intake-material-heading">어떤 폐자원인가요?</legend>
      <div class="intake-material-picker" data-intake-picker hidden>
        <div class="intake-materials" role="group" aria-label="재질 종류">
          ${materials.map(material => `<button type="button" class="intake-material" data-intake-material="${material.id}" aria-pressed="false" aria-controls="intake-chips-${material.id}">
            <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${material.drawing}</svg>
            <span>${material.label}</span><span class="intake-selected" aria-hidden="true">선택됨</span>
          </button>`).join("")}
        </div>
        ${materials.map(material => `<div id="intake-chips-${material.id}" class="intake-chips" data-intake-chips="${material.id}" role="group" aria-label="${material.label} 세부 재질" hidden>
          ${material.values.map(value => `<button type="button" class="secondary-action" data-intake-value="${value}" aria-pressed="false">${value}</button>`).join("")}
        </div>`).join("")}
      </div>
      <div class="intake-field">
        <label for="polymer">재질·품목 <span class="intake-optional">모르면 비워 두기</span></label>
        <input id="polymer" name="polymer" maxlength="${caseFormTextLimits.polymer}" value="${supplied("polymer")}" aria-describedby="intake-polymer-help">
        <p id="intake-polymer-help" class="intake-help">예: PP 사출 불량품, 구리 스크랩. 직접 적어도 됩니다.</p>
      </div>
      <div class="intake-field">
        <label for="description">폐자원 설명 <span class="intake-required">필수</span></label>
        <textarea id="description" name="description" required maxlength="${caseFormTextLimits.description}" aria-describedby="intake-description-help">${textareaDescription}</textarea>
        <p id="intake-description-help" class="intake-help">예: 색상 불량으로 나온 PP 부품, 이물 없음</p>
      </div>
    </fieldset>
    <fieldset class="intake-section" data-intake-section="source" aria-labelledby="intake-source-heading">
      <legend class="intake-section-title" id="intake-source-heading">어디서 나왔나요?</legend>
      <div class="intake-pair">
      <div class="intake-field">
        <label for="process">발생 공정 <span class="intake-optional">모르면 비워 두기</span></label>
        <input id="process" name="process" maxlength="${caseFormTextLimits.process}" value="${supplied("process")}" aria-describedby="intake-process-help">
        <p id="intake-process-help" class="intake-help">예: 사출 성형 후 선별</p>
      </div>
      <div class="intake-field">
        <label for="region">사업장 지역 <span class="intake-optional">모르면 비워 두기</span></label>
        <input id="region" name="region" maxlength="${caseFormTextLimits.region}" value="${supplied("region")}" aria-describedby="intake-region-help">
        <p id="intake-region-help" class="intake-help">예: 강원 원주시</p>
      </div>
      </div>
    </fieldset>
    <fieldset class="intake-section" data-intake-section="state" aria-labelledby="intake-state-heading">
      <legend class="intake-section-title" id="intake-state-heading">지금 상태는 어떤가요?</legend>
      <div class="intake-pair">
      <div class="intake-field">
        <label for="contamination">오염 상태 <span class="intake-optional">모르면 비워 두기</span></label>
        <input id="contamination" name="contamination" maxlength="${caseFormTextLimits.contamination}" value="${supplied("contamination")}" aria-describedby="intake-contamination-help">
        <p id="intake-contamination-help" class="intake-help">예: 기름·도료 묻음 없음</p>
      </div>
      <div class="intake-field">
        <label for="hazardousContact">유해물질 접촉</label>
        <select id="hazardousContact" name="hazardousContact" aria-describedby="intake-hazard-help">
          ${([["unknown", "모름"], ["yes", "있음"], ["no", "없음"]] as const).map(([value, label]) => `<option value="${value}" ${hazard === value ? "selected" : ""}>${label}</option>`).join("")}
        </select>
        <p id="intake-hazard-help" class="intake-help">예: 없음, 절삭유 닿음, 잘 모름</p>
      </div>
      </div>
      <div class="intake-pair">
        <div class="intake-field">
          <label for="massKg">양 (kg) <span class="intake-optional">선택</span></label>
          <input id="massKg" name="massKg" type="number" min="0" max="${MAX_CASE_MASS_KG}" step="any" value="${supplied("massKg")}" aria-describedby="intake-mass-help">
          <p id="intake-mass-help" class="intake-help">0 초과 ~ ${MAX_CASE_MASS_KG.toLocaleString("ko-KR")} kg. 모르면 비워 두세요. 더 많으면 배치별로 나눠 주세요.</p>
        </div>
        <div class="intake-field">
          <label for="assessmentDate">검토 기준일 <span class="intake-required">필수</span></label>
          <input id="assessmentDate" name="assessmentDate" type="date" required max="9999-12-31" value="${supplied("assessmentDate")}" aria-describedby="intake-date-help">
          <p id="intake-date-help" class="intake-help">검토에 적용할 기준 날짜를 골라 주세요.</p>
        </div>
      </div>
    </fieldset>
    </div>
    <aside class="intake-summary" data-intake-summary aria-labelledby="intake-summary-heading">
      <h2 id="intake-summary-heading">현재 입력</h2>
      <dl class="intake-summary-values" data-intake-summary-values aria-live="polite" aria-atomic="false" hidden>
        ${([
          ["polymer", "재질·품목"], ["description", "폐자원 설명"], ["process", "발생 공정"],
          ["region", "사업장 지역"], ["contamination", "오염 상태"], ["hazardousContact", "유해물질 접촉"],
          ["massKg", "양"], ["assessmentDate", "검토 기준일"],
        ] as const).map(([field, label]) => `<div><dt>${label}</dt><dd data-intake-summary-value="${field}">입력 전</dd></div>`).join("")}
      </dl>
      <noscript><p>입력한 내용을 확인한 뒤 검토를 요청해 주세요.</p></noscript>
      <p class="intake-help" id="intake-submit-help" data-intake-submit-help>제출하면 검토 결과나 연결 상태를 알려드립니다.</p>
      <div class="intake-actions">
        <button type="button" class="secondary-action intake-example" data-intake-example hidden>예시로 채우기</button>
        <button type="submit" data-intake-submit aria-describedby="intake-submit-help">${values.retry ? "다시 요청" : "검토 요청"}</button>
      </div>
      <p class="intake-help intake-example-status" data-intake-example-status role="status"></p>
    </aside>
    </div>
  </form>`;
}
