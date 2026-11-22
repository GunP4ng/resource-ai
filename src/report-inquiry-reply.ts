import { displayReason } from "./report-copy.ts";
import type { CalculationContext, CalculationVariant } from "./o-calculation-variant.ts";
import type { InquiryReply, ReplyAmountOption } from "./o-inquiry-reply.ts";
import { escapeHtml, page } from "./report-html.ts";

export interface InquiryReplyView {
  readonly caseId: string;
  readonly version: number;
  readonly inputRevision: string;
  readonly options: readonly ReplyAmountOption[];
  readonly blockedReason: string | null;
  readonly replies?: readonly InquiryReply[];
  readonly comparison?: { readonly baseline: CalculationContext; readonly variants: readonly (CalculationVariant | null)[] };
}
const acceptanceLabels = { unknown: "미상", yes: "수락 신고", conditional: "조건부 신고", no: "거절 신고" } as const;
const unitName = (unit: string) => unit === "KRW/metric_tonne" ? "원/t (1,000kg)" : unit;

export function renderInquiryReply(view: InquiryReplyView): string {
  const path = `/cases/${encodeURIComponent(view.caseId)}`;
  const replies = view.replies ?? [];
  const selected = (value: string, current: string | undefined) => value === current ? " selected" : "";
  const comparison = view.comparison;
  const rows = comparison?.baseline.calculations.results.map(before => {
    const route = { recycling: "재활용", landfill: "매립", energy_recovery: "소각·에너지 회수" }[before.route_id];
    const cells = comparison.variants.map((variant, index) => {
      if (variant === null) {
        return `<td data-label="업체 ${index + 1} 회신 금액 없음 · 기준값 사용"><span data-reply-amount>${escapeHtml(before.display.net_cost_krw ?? "값 없음")}</span></td><td data-label="업체 ${index + 1} 차이 (원)">${before.net_cost_krw === null ? "미산정" : "기준과 동일"}</td>`;
      }
      const result = variant.calculations.results.find(item => item.case_id === before.case_id && item.route_id === before.route_id);
      const baselineWon = before.display.net_cost_krw;
      const assumedWon = result?.display.net_cost_krw;
      const change = baselineWon == null || assumedWon == null
        ? null
        : (BigInt(assumedWon) - BigInt(baselineWon)).toLocaleString("ko-KR");
      return `<td data-label="업체 ${index + 1} 가정 순비용 (원)"><span data-reply-amount>${escapeHtml(result?.display.net_cost_krw ?? "값 없음")}</span></td><td data-label="업체 ${index + 1} 차이 (가정 − 기준, 원)">${change === null ? "미산정 (기준값 또는 회신 금액 없음)" : `<span data-reply-amount>${escapeHtml(change)}</span>`}</td>`;
    }).join("");
    return `<tr data-reply-result="${before.route_id}"><th scope="row" class="reply-route">${route}</th><td data-label="기준 순비용 (원)"><span data-reply-amount>${escapeHtml(before.display.net_cost_krw ?? "값 없음")}</span></td>${cells}</tr>`;
  }).join("") ?? "";
  const companyForm = (prefix: string, index: number) => {
    const reply = replies[index];
    return `<fieldset><legend>업체 ${index + 1} 회신 · 저장 안 함 · 미검증${index ? " (선택)" : ""}</legend>
      <label>업체명 (사용자 신고)<input name="${prefix}companyName" maxlength="200"${index ? "" : " required"} value="${escapeHtml(reply?.companyName ?? "")}"></label>
      <label>반입 수락 (사용자 신고)<select name="${prefix}acceptance">${Object.entries(acceptanceLabels).map(([value, label]) => `<option value="${value}"${selected(value, reply?.acceptance ?? "unknown")}>${label}</option>`).join("")}</select></label>
      <label>허가 확인일 (사용자 신고, 선택)<input type="date" name="${prefix}permitCheckDate" value="${escapeHtml(reply?.permitCheckDate ?? "")}"></label>
      <label>출처 메모 (선택)<textarea name="${prefix}sourceNote" maxlength="2000">${escapeHtml(reply?.sourceNote ?? "")}</textarea></label>
      ${view.options.map(option => {
        const amount = reply?.amounts.find(item => item.inputId === option.inputId)?.amount;
        return `<label>${escapeHtml(option.label)} (${escapeHtml(unitName(option.unit))}, 0 이상, 모르면 비워 두기)<input type="number" name="${prefix}amount_${escapeHtml(option.inputId)}" min="0" step="any" value="${amount === undefined || amount === null ? "" : escapeHtml(String(amount))}"></label>
          <input type="hidden" name="${prefix}unit_${escapeHtml(option.inputId)}" value="${escapeHtml(option.unit)}">`;
      }).join("")}</fieldset>`;
  };
  return page("업체 회신 가정 비교", `<h1>업체 회신 가정 비교</h1>
    <p class="notice" data-reply-unsaved>회신은 저장하지 않습니다. 사용자가 신고한 미검증 정보라 승인·업체 사실·사례 입력·평가 결과를 바꾸지 않습니다.</p>
    <p>사례 ID: ${escapeHtml(view.caseId)}</p>
    <p><a href="${escapeHtml(path)}/inquiry">문의서로 돌아가기</a> · <a href="${escapeHtml(path)}">사례 결과로 돌아가기</a></p>
    ${view.blockedReason === null ? "" : `<p class="notice" role="alert" data-reply-blocked>${escapeHtml(view.blockedReason)}</p>`}
    ${replies.map((reply, index) => `<section aria-labelledby="reported-reply-${index}"><h2 id="reported-reply-${index}">업체 ${index + 1} 사용자 신고 회신 · 저장 안 함 · 미검증</h2>
      <dl><dt>업체명 (신고)</dt><dd>${escapeHtml(reply.companyName)}</dd><dt>반입 수락 (신고)</dt><dd>${acceptanceLabels[reply.acceptance]} · 실행은 현장 승인 후</dd>
      <dt>허가 확인일 (신고)</dt><dd>${escapeHtml(reply.permitCheckDate || "미상")} · 허가증으로 확인 필요</dd>
      <dt>출처 메모</dt><dd>${escapeHtml(reply.sourceNote || "미기재")}</dd>
      ${reply.amounts.map(item => `<dt>${escapeHtml(item.label)} 가정 (${escapeHtml(item.inputId)})</dt><dd>${item.amount === null ? "미확보 · 0으로 채우지 않음" : `${escapeHtml(String(item.amount))} ${escapeHtml(unitName(item.unit))}`}</dd>`).join("")}</dl></section>`).join("")}
    ${comparison ? `<section aria-labelledby="reply-comparison"><h2 id="reply-comparison">공개 자료 모델과 회신 가정 비교</h2>
      <p>공개 자료 모델에 회신 금액을 넣어 본 가정 계산입니다. 입력 금액은 KECO 가격과 구분해 표시합니다.</p>
      <p>업체별 가정은 같은 기준 모델에서 각각 계산합니다. 빈칸은 기준 입력을 그대로 쓰고, 실제 사례의 null은 채우지 않습니다. 반입 수락·허가 확인일 신고는 계산·적격성·승인에 쓰지 않습니다.</p>
      <p class="screen-only">표가 넓으면 좌우로 스크롤해 두 업체를 비교하세요.</p>
      <div class="table-wrap" data-reply-comparison role="region" aria-label="회신 가정의 순비용 비교" tabindex="0"><table><caption>모델 순비용 비교 · 차이 = 가정 − 기준 · 단위 원</caption><thead><tr><th scope="col">모델 경로</th><th scope="col">기준 순비용 (원)</th>${replies.map((reply, index) => `<th scope="col">업체 ${index + 1}: ${escapeHtml(reply.companyName)} ${comparison.variants[index] === null ? "회신 금액 없음 · 기준값 사용" : "가정 순비용 (원)"}</th><th scope="col">업체 ${index + 1} 차이 (가정 − 기준, 원)</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
      <p>음수 순비용은 모델상 매각 수입이 비용보다 큰 경우입니다. 가격만 바꾸므로 탄소값은 기준과 같습니다.</p>
      <p>미국 WARM과 원주 처리비 자료를 쓴 비공개 연구 계산입니다. 상업용 보고서와 모델 전송에서 빠집니다.</p>
      ${comparison.variants.map((variant, index) => variant ? `<details data-reply-provenance="${index + 1}"><summary>업체 ${index + 1} 계산 가정과 파생 출처</summary><ul>${variant.assumptions.map(item => `<li>${escapeHtml(displayReason(item))}</li>`).join("")}</ul>
      <p>기준 데이터: <span data-reply-parent>${escapeHtml(variant.provenance.parentFixtureSha256)}</span><br>파생 데이터: ${escapeHtml(variant.provenance.derivedDatasetSha256)}<br>파생 이력: ${escapeHtml(variant.provenance.derivedProvenanceSha256)}</p>
      <ul>${variant.calculations.limitations.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></details>` : "").join("")}</section>` : ""}
    <form method="post" action="${escapeHtml(path)}/inquiry-reply" data-inquiry-reply-form>
      <input type="hidden" name="baseVersion" value="${view.version}">
      <input type="hidden" name="inputRevision" value="${escapeHtml(view.inputRevision)}">
      ${companyForm("", 0)}${companyForm("second_", 1)}
      <p>업체 2를 비교하려면 업체명을 입력하세요. 쓰지 않으면 모든 칸을 비우고 반입 수락은 미상으로 두세요.</p>
      <p>소각비는 투입량 1t당, 재활용 처리비·매각 가격은 재활용 배분량 1t당입니다. 수집·운송·선별비는 별도 항목입니다. 회신 금액의 적용량·포함 범위가 불분명하면 비워 두세요.</p>
      <p>모델 입력 단위 그대로 넣으세요. 소각비는 투입량 1t당, 재활용 비용·가격은 배분량 1t당입니다. VAT·통화·운송비는 자동 환산하지 않습니다. 빈칸은 미확보, 0은 사용자가 정한 가정값입니다.</p>
      <label class="consent"><input type="checkbox" name="hypotheticalAcknowledgement" value="yes" required>미검증 회신으로 가정 비교만 하고, 실제 승인·수락·확정 견적으로 쓰지 않겠습니다.</label>
      <button type="submit">가정 비교하기 (저장 안 함)</button>
    </form>`);
}
