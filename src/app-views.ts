import type { CaseInput } from "./contracts.ts";
import { escapeHtml, page } from "./report-html.ts";
import { HttpFailure } from "./app-http.ts";

const textFields = [
  ["description", "폐자원 설명"], ["process", "발생 공정"], ["polymer", "수지"],
  ["contamination", "오염 상태"], ["region", "발생 지역"], ["assessmentDate", "평가 기준일"],
] as const;
export function nativeAnswer(raw: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const allowed = new Set(["answerMode", "field_massKg", "field_hazardousContact", ...textFields.map(([field]) => `field_${field}`)]);
  if (Object.keys(raw).some(key => !allowed.has(key))) throw new HttpFailure(400, "수정 입력 필드를 확인해 주세요.");
  const patch: Record<string, unknown> = {};
  for (const [field] of textFields) {
    const value = raw[`field_${field}`];
    if (value === undefined) continue;
    if (typeof value !== "string") throw new HttpFailure(400, "답변은 일반 입력란에 입력해 주세요.");
    patch[field] = value === "" && field !== "description" && field !== "assessmentDate" ? null : value;
  }
  const mass = raw["field_massKg"];
  if (mass !== undefined) {
    if (typeof mass !== "string" || (mass.trim() !== "" && (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(mass) || !Number.isFinite(Number(mass))))) throw new HttpFailure(400, "질량은 kg 단위 숫자 또는 미상 공란으로 입력하세요.");
    patch["massKg"] = mass.trim() === "" ? null : Number(mass);
  }
  const hazardous = raw["field_hazardousContact"];
  if (hazardous !== undefined) {
    if (hazardous !== "yes" && hazardous !== "no" && hazardous !== "unknown") throw new HttpFailure(400, "유해물질 접촉 값을 확인해 주세요.");
    patch["hazardousContact"] = hazardous;
  }
  if (Object.keys(patch).length === 0) throw new HttpFailure(400, "수정할 사례 필드를 입력하세요.");
  return patch;
}
function fields(input?: CaseInput, editing = false): string {
  const prefix = editing ? "field_" : "";
  const massField = `<label for="${prefix}massKg">질량 (kg, 0보다 큰 숫자, 미상은 공란)</label><input id="${prefix}massKg" name="${prefix}massKg" type="number" min="0" step="any" value="${input?.massKg ?? ""}">`;
  const text = textFields.map(([field, label]) => {
    const id = prefix + field;
    const value = input?.[field] ?? "";
    return `<label for="${id}">${label}${field !== "description" && field !== "assessmentDate" ? " (미상은 공란)" : ""}</label>
      ${field === "description" ? `<textarea id="${id}" name="${id}" required maxlength="10000">${escapeHtml(value)}</textarea>` : `<input id="${id}" name="${id}" ${field === "assessmentDate" ? 'type="date" required' : 'maxlength="500"'} value="${escapeHtml(value)}">`}`;
  });
  const hazardous = `<label for="${prefix}hazardousContact">유해물질 접촉</label><select id="${prefix}hazardousContact" name="${prefix}hazardousContact">
     ${([["unknown", "미상"], ["yes", "있음"], ["no", "없음"]] as const).map(([value, label]) => `<option value="${value}" ${(input?.hazardousContact ?? "unknown") === value ? "selected" : ""}>${label}</option>`).join("")}</select>`;
  if (!editing) return text.slice(0, 4).join("") + hazardous + massField + text.slice(4).join("");
  const remaining = text.slice(1, 4).join("") + hazardous + text.slice(4, 5).join("") + text[0] + text[5];
  const massOnly = input?.massKg === null && input.hazardousContact === "no"
    && [input.process, input.polymer, input.contamination, input.region].every(value => value !== null && value.trim() !== "");
  return massOnly ? massField + remaining : remaining + massField;
}
export function form(action: string, answers = false, version?: number, selection = "", input?: CaseInput): string {
  const versionField = version === undefined ? "" : `<input type="hidden" name="baseVersion" value="${version}">`;
  if (!answers) return `<form method="post" action="${escapeHtml(action)}">${fields()}<p>사진은 사례를 만든 후 별도로 업로드하세요.</p><button type="submit">사례 제출</button></form>`;
  const native = input ? `<h2 id="answer-fields" tabindex="-1">답변·사례 수정</h2><p>현재 입력을 표시합니다. 바꿀 항목을 수정하세요. 공란은 미상이며 질량 단위는 kg입니다. 그대로 제출해도 실제 입력값으로 다시 평가합니다.</p>
    <form method="post" action="${escapeHtml(action)}">${versionField}<input type="hidden" name="answerMode" value="fields">${fields(input, true)}${selection}
      <button type="submit">자료 반영해 다시 평가하기</button></form>` : "";
  return `${native}<details><summary>고급 JSON으로 답변·수정하기</summary><form method="post" action="${escapeHtml(action)}">${versionField}
    <label for="answers">사례 필드 답변·수정 (JSON 객체)</label><p id="answers-help">수정할 필드만 입력하세요. 생략한 필드는 유지됩니다. 허용되는 필드의 null은 미상이며 숫자에는 따옴표를 붙이지 않습니다. caseId와 판정·승인은 수정할 수 없습니다.</p>
    <p>입력 예시 (자동 입력되지 않음): <code>{"polymer":"PP","massKg":100}</code></p>
    <textarea id="answers" name="answers" aria-describedby="answers-help" required maxlength="10000"></textarea>${selection}<button type="submit">사례 필드 수정 제출</button></form></details>`;
}

const runners = { local: "로컬", subscription: "구독 경로 모델 실행", azure: "Azure 연결", unspecified: "미지정" } as const;
export interface InputView {
  readonly authenticated: boolean;
  readonly localAuth: boolean;
  readonly connected: boolean;
  readonly photoEnabled: boolean;
  readonly runner?: keyof typeof runners;
}
export function loginPage(): string {
  return page("로그인", `<h1>로컬 운영자 로그인</h1><p>운영자가 발급한 계정으로 로그인하세요. 조직 소속이나 자료 승인을 인증하지 않습니다.</p><form method="post" action="/login"><label for="username">사용자 이름</label><input id="username" name="username" autocomplete="username" required maxlength="64"><label for="password">비밀번호</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="1024"><button type="submit">로그인</button></form>`);
}
export function caseListPage(rows: string, localAuth: boolean): string {
  return page("내 사례", `<h1>내 사례</h1><p><a class="primary-action" href="/">새 사례 입력</a></p>${rows ? `<div class="table-wrap case-list" role="region" aria-label="내 사례 목록" tabindex="0"><table><thead><tr><th>사례</th><th>버전</th><th>보관 만료 (UTC)</th><th>결과</th></tr></thead><tbody>${rows}</tbody></table></div>` : "<p>저장된 사례가 없습니다.</p>"}${localAuth ? '<form method="post" action="/logout"><button class="secondary-action" type="submit">로그아웃</button></form>' : ""}`);
}
export function inputPage(options: InputView): string {
  const { authenticated, localAuth, connected, photoEnabled, runner } = options;
  const runnerLabel = runner ? runners[runner] : "미제공";
  const purpose = "<p>공정에서 나온 폐기물·부산물의 재사용·재활용·처리 대안을 비교합니다. 재질과 오염 상태를 입력하면 조건별 대안, 공개 근거, 비용·탄소 자료와 다음 확인할 일을 보여 줍니다.</p><p>정보가 부족하거나 위험이 의심되면 실행을 보류하고, 어떤 조건을 확인해야 다음 대안을 검토할 수 있는지 안내합니다.</p>";
  if (authenticated && localAuth) return page("사례 입력", `<h1>폐자원 조건부 검토</h1>${purpose}<p class="notice">로그인한 담당자 · 사례 보관 최대 1시간 · 검토 방식 ${runnerLabel} · 실행 성공은 평가 후 확인</p><p>입력은 미검토 자료입니다. 로그인은 자료나 법적 승인을 뜻하지 않습니다.</p><p><a href="/cases">내 사례·복구</a></p>${form("/cases")}<p>사진: ${photoEnabled ? "비공개 저장 전용" : "저장 비활성"}</p><p><a href="/demo/normal">합성 비교 데모</a></p>`);
  return page("사례 입력", `<h1>폐자원 조건부 검토</h1>
          ${purpose}<p class="notice">${connected ? "입력을 받아 검토할 준비가 됐습니다. 제출 후 결과를 확인하세요." : "사례 검토 연결을 준비 중입니다. 지금 제출하면 준비 상태를 안내합니다."}</p>
          <p>실제 자료와 합성 데모를 구분합니다. 설명·사진만으로 법적 코드나 처리 허가를 확정하지 않습니다.</p>
          <p>${authenticated ? "서버 인증 사용자" : "익명 임시 세션 · 재시작하면 사례를 복구할 수 없습니다."}${runner ? ` 구성된 실행기 ${runnerLabel} · 실행 성공은 평가 후 확인하세요.` : ""}</p>
          <p><a href="/cases">내 사례·복구</a></p>
          ${form("/cases")}<p>사진 저장: ${photoEnabled ? "인증된 사례에서 사용 가능" : "인증된 비공개 사진 저장소를 사용할 수 없습니다."}</p><p><a href="/demo/review">합성 위험·검토 예시 보기</a></p>`);
}
