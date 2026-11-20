import type { CaseInput, DecisionResult } from "./contracts.ts";
import { escapeHtml, page } from "./report-html.ts";

const inquiryStyles = `
[data-inquiry-sheet] .inquiry-fields dt{font-weight:600}
[data-inquiry-sheet] .inquiry-fields dd{min-width:0}
[data-inquiry-sheet] .inquiry-warning{font-weight:700}
[data-inquiry-sheet] .inquiry-reply{border-top:var(--border) solid var(--line);padding-top:var(--s12)}
@page inquiry{size:A4;margin:18mm}
@media print{
  main:has(>[data-inquiry-sheet])>footer{display:none}
  [data-inquiry-sheet]{page:inquiry;font-size:10pt;line-height:1.25;word-break:break-all}
  [data-inquiry-sheet] h1{font-size:18pt;margin:0 0 6pt}
  [data-inquiry-sheet] h2{font-size:12.5pt;margin:10pt 0 4pt}
  [data-inquiry-sheet] p{margin:4pt 0;orphans:2;widows:2}
  [data-inquiry-sheet] .notice{padding:5pt}
  [data-inquiry-sheet] .state{margin-top:4pt}
  [data-inquiry-sheet] .inquiry-fields{display:grid;grid-template-columns:30mm minmax(0,1fr);gap:3pt 6pt;margin:6pt 0}
  [data-inquiry-sheet] .inquiry-fields dd{margin:0}
  [data-inquiry-sheet] ol{padding-left:16pt;margin:4pt 0}
  [data-inquiry-sheet] li{margin:4pt 0;break-inside:avoid}
  [data-inquiry-sheet] .inquiry-reply{padding-top:5pt;margin-top:8pt}
  [data-inquiry-sheet] a{display:inline;padding:0}
}`;

/** Bounded visible excerpts only; the stored input and full case URL stay intact. */
function excerpt(value: string | null, limit = 32): string {
  if (value === null || value.trim() === "") return "미상";
  const characters = Array.from(value.replace(/\s+/gu, " ").trim());
  return escapeHtml(characters.slice(0, limit).join("")) + (characters.length > limit ? "… [발췌]" : "");
}

const contactLabels = { yes: "있음 (yes)", no: "없음 (no)", unknown: "미상 (unknown)" } as const;
const stateLabels = {
  "needs-information": "추가 정보 필요 · 실행 보류",
  "needs-review": "검토 필요 · 실행 보류",
  compared: "비교 기록 · 인간 승인 대기 · 실행 미승인",
} as const;

/**
 * Parent supplies the actual current input after auth/readReport and unsupported-input guards.
 * Historical decisions supply no present ranking, approval or processor implication.
 */
export function renderInquiry(
  input: CaseInput,
  decision: DecisionResult,
  options: { readonly historical?: boolean; readonly permissionChanged?: boolean; readonly recipientName?: string },
): string {
  const casePath = `/cases/${encodeURIComponent(input.caseId)}`;
  const historical = options.historical === true;
  const status = historical ? "과거 평가 · 재평가 필요 · 실행 보류"
    : decision.state === "compared" && decision.humanApproval === "approved"
      ? "인간 승인 기록 있음 · 실제 반입·계약 조건은 별도 확인"
      : stateLabels[decision.state];
  const fields = [
    ["사례 ID", escapeHtml(input.caseId)],
    ["평가 기준일", excerpt(input.assessmentDate)],
    ["수지 (신고)", excerpt(input.polymer)],
    ["발생 공정 (신고)", excerpt(input.process)],
    ["오염 상태 (신고)", excerpt(input.contamination)],
    ["질량 (신고)", input.massKg === null ? "미상 · 계량값 확인 필요" : `${escapeHtml(String(input.massKg))} kg`],
    ["발생 지역 (신고)", excerpt(input.region)],
    ["설명 (신고)", excerpt(input.description, 72)],
  ] as const;
  return page("처리업체 문의서", `<article data-inquiry-sheet>
    <nav class="screen-only" aria-label="문의서 동작">
      <a href="${escapeHtml(casePath)}">사례로 돌아가기</a>
      <button type="button" data-inquiry-print>문의서 인쇄</button>
    </nav>
    <h1>처리업체 문의서</h1>
    <p>현재 신고 입력에 대한 확인 요청입니다. 허가·반입 수락·가격·시설 적합성은 확인되지 않았습니다.</p>
    <p class="state held" data-inquiry-status>${status}</p>
    ${historical ? '<p class="inquiry-warning" data-inquiry-historical>과거 평가의 순위·업체 제안은 사용하지 않습니다. 아래 현재 입력으로 재평가가 필요합니다.</p>' : ""}
    ${options.permissionChanged ? '<p class="notice inquiry-warning" role="alert" data-inquiry-permission>사진 권한이 변경되었습니다. 과거 평가는 당시 권한 기준이며, 이미 전송된 사진은 회수할 수 없습니다. 현재 입력으로 재평가가 필요합니다.</p>' : ""}
    <p data-inquiry-recipient>수신 업체: ${options.recipientName?.trim() ? `${excerpt(options.recipientName)} (사용자 선택명 · 허가 증빙 아님)` : "________________ (수신자가 작성하는 공란)"}</p>
    <h2>현재 신고 입력</h2>
    <p class="notice inquiry-warning" data-inquiry-contact="${input.hazardousContact}">유해물질 접촉 (신고): ${contactLabels[input.hazardousContact]}. ${input.hazardousContact === "no" ? "신고값이며 무해성 확인을 뜻하지 않습니다." : "접촉 내역과 취급 요건 확인 전 실행을 보류하세요."}</p>
    <dl class="inquiry-fields">${fields.map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join("")}</dl>
    <p data-inquiry-full-input>긴 항목은 [발췌]로 표시됩니다. 발췌만으로 수락하지 마세요. 전체 입력 참조: <a href="${escapeHtml(casePath)}">사례 원문 (ID: ${escapeHtml(input.caseId)})</a>. 원본 입력은 변경하지 않았습니다.</p>
    <h2>처리업체에 확인할 질문</h2>
    <ol data-inquiry-questions>
      <li data-inquiry-question="permit">신고 재질과 발생 공정이 귀사 허가의 대상 물질·폐기물 코드·처리 범위에 포함되나요? 허가 문서와 해당 범위를 알려 주세요.</li>
      <li data-inquiry-question="contamination">오염·유해물질 접촉에 대한 반입 기준, 필요한 성분 분석·증빙, 세척·분리·포장 요건은 무엇인가요?</li>
      <li data-inquiry-question="logistics">해당 질량의 최소·최대 수용량, 가능 일정, 계량 방식, 수거 지역·운송 주체·운송 조건은 무엇인가요?</li>
      <li data-inquiry-question="quote">처리·운송·분석·추가 비용을 나눈 견적과 단위, VAT 포함 여부, 유효기간, 최종 수락 조건·거절 시 비용을 회신해 주시겠어요?</li>
    </ol>
    <div class="inquiry-reply" data-inquiry-reply>
      <p>업체 회신 작성란 (아래 공란은 수신자가 작성): 담당자·회신 연락처 ________________</p>
      <p>허가 문서·조건·항목별 견적: 별도 회신 첨부 ________________</p>
      <p>반입 수락 여부·조건 ________________ 회신일 ________________</p>
    </div>
  </article>`).replace("</style>", `${inquiryStyles}</style>`);
}
