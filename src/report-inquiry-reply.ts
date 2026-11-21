import type { CalculationContext, CalculationVariant } from "./o-calculation-variant.ts";
import type { InquiryReply, ReplyAmountOption } from "./o-inquiry-reply.ts";
import { escapeHtml, page } from "./report-html.ts";

export interface InquiryReplyView {
  readonly caseId: string;
  readonly version: number;
  readonly inputRevision: string;
  readonly options: readonly ReplyAmountOption[];
  readonly blockedReason: string | null;
  readonly reply?: InquiryReply;
  readonly comparison?: { readonly baseline: CalculationContext; readonly variant: CalculationVariant };
}
const acceptanceLabels = { unknown: "미상", yes: "수락 신고", conditional: "조건부 신고", no: "거절 신고" } as const;
const unitName = (unit: string) => unit === "KRW/metric_tonne" ? "원/t (1,000kg)" : unit;

export function renderInquiryReply(view: InquiryReplyView): string {
  const path = `/cases/${encodeURIComponent(view.caseId)}`;
  const reply = view.reply;
  const selected = (value: string, current: string | undefined) => value === current ? " selected" : "";
  const units = [...new Set(view.options.map(option => option.unit))];
  const comparison = view.comparison;
  const rows = comparison?.variant.calculations.results.map(result => {
    const before = comparison.baseline.calculations.results.find(item => item.case_id === result.case_id && item.route_id === result.route_id);
    const change = before?.net_cost_krw === null || before?.net_cost_krw === undefined || result.net_cost_krw === null
      ? "미산정 (기준값 미확보)" : (result.net_cost_krw - before.net_cost_krw).toLocaleString("ko-KR", { maximumFractionDigits: 0 });
    const route = { recycling: "재활용", landfill: "매립", energy_recovery: "소각·에너지 회수" }[result.route_id];
    return `<tr data-reply-result="${result.route_id}"><th scope="row">${route}</th><td data-label="기준 순비용 (원)">${escapeHtml(before?.display.net_cost_krw ?? "미확보")}</td><td data-label="가정 순비용 (원)">${escapeHtml(result.display.net_cost_krw ?? "미확보")}</td><td data-label="차이 (가정 − 기준, 원)">${escapeHtml(change)}</td></tr>`;
  }).join("") ?? "";
  return page("업체 회신 가정 비교", `<h1>업체 회신 가정 비교</h1>
    <p class="notice" data-reply-unsaved>회신은 저장되지 않습니다. 사용자 신고·미검증 정보이며 실제 승인·업체 사실·사례 입력·기존 평가 결과를 갱신하지 않습니다.</p>
    <p>사례 ID: ${escapeHtml(view.caseId)}</p>
    <p><a href="${escapeHtml(path)}/inquiry">문의서로 돌아가기</a> · <a href="${escapeHtml(path)}">실제 사례 결과</a></p>
    ${view.blockedReason === null ? "" : `<p class="notice" role="alert" data-reply-blocked>${escapeHtml(view.blockedReason)}</p>`}
    ${reply ? `<section aria-labelledby="reported-reply"><h2 id="reported-reply">사용자 신고 회신 · 미검증</h2>
      <dl><dt>업체명 (신고)</dt><dd>${escapeHtml(reply.companyName)}</dd><dt>반입 수락 (신고)</dt><dd>${acceptanceLabels[reply.acceptance]} · 실행 승인 아님</dd>
      <dt>허가 확인일 (신고)</dt><dd>${escapeHtml(reply.permitCheckDate || "미상")} · 허가 검증 아님</dd>
      <dt>출처 메모 (신고)</dt><dd>${escapeHtml(reply.sourceNote || "미기재")}</dd>
      <dt>금액 가정</dt><dd>${reply.amount === null ? "미확보 · 0으로 대체하지 않음" : `${escapeHtml(String(reply.amount))} ${escapeHtml(unitName(reply.unit))}`} (${escapeHtml(reply.inputId)})</dd></dl></section>` : ""}
    ${comparison ? `<section aria-labelledby="reply-comparison"><h2 id="reply-comparison">공개 자료 모델과 사용자 가정의 비교</h2>
      <p>실측·확정 견적·실제 추천이 아닙니다. 입력 금액은 KECO 가격으로 귀속하지 않습니다. 기준 모델도 실제 사례 비용이 아닙니다.</p>
      <div class="table-wrap" role="region" aria-label="회신 가정의 순비용 비교" tabindex="0"><table><caption>모델 순비용 비교 · 차이는 가정에서 기준을 뺀 값 · 원 단위 표시</caption><thead><tr><th scope="col">모델 경로</th><th scope="col">기준 순비용 (원)</th><th scope="col">가정 순비용 (원)</th><th scope="col">차이 (가정 − 기준, 원)</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p>음수 순비용은 모델의 매각 수입을 공제한 값이며 실제 이익을 보장하지 않습니다. 가격 항목만 바꾸므로 탄소 계산값은 기준 모델과 같습니다.</p>
      <p>다른 미확보 입력과 권리 제한은 유지됩니다. 미국 WARM 및 원주 처리비 경계를 포함한 비공개 연구 계산이며 상업용 내보내기·모델 전송 대상이 아닙니다.</p>
      <details><summary>계산 가정과 파생 출처</summary><ul>${comparison.variant.assumptions.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      <p>부모 데이터: ${escapeHtml(comparison.variant.provenance.parentFixtureSha256)}<br>파생 데이터: ${escapeHtml(comparison.variant.provenance.derivedDatasetSha256)}<br>파생 이력: ${escapeHtml(comparison.variant.provenance.derivedProvenanceSha256)}</p>
      <ul>${comparison.variant.calculations.limitations.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></details></section>` : ""}
    <form method="post" action="${escapeHtml(path)}/inquiry-reply" data-inquiry-reply-form>
      <input type="hidden" name="baseVersion" value="${view.version}">
      <input type="hidden" name="inputRevision" value="${escapeHtml(view.inputRevision)}">
      <label>업체명 (사용자 신고·미검증)<input name="companyName" maxlength="200" required value="${escapeHtml(reply?.companyName ?? "")}"></label>
      <label>반입 수락 (사용자 신고·미검증)<select name="acceptance">${Object.entries(acceptanceLabels).map(([value, label]) => `<option value="${value}"${selected(value, reply?.acceptance ?? "unknown")}>${label}</option>`).join("")}</select></label>
      <label>허가 확인일 (사용자 신고·미검증, 선택)<input type="date" name="permitCheckDate" value="${escapeHtml(reply?.permitCheckDate ?? "")}"></label>
      <label>출처 메모 (선택)<textarea name="sourceNote" maxlength="2000">${escapeHtml(reply?.sourceNote ?? "")}</textarea></label>
      <label>회신 가격 종류<select name="inputId">${view.options.map(option => `<option value="${escapeHtml(option.inputId)}"${selected(option.inputId, reply?.inputId)}>${escapeHtml(option.label)} · ${escapeHtml(unitName(option.unit))}</option>`).join("")}</select></label>
      <label>모델 입력 단위 (선택 항목과 일치해야 함)<select name="unit">${units.map(unit => `<option value="${escapeHtml(unit)}"${selected(unit, reply?.unit)}>${escapeHtml(unitName(unit))}</option>`).join("")}</select></label>
      <label>금액 (0 이상, 모르면 공란)<input type="number" name="amount" min="0" step="any" value="${reply?.amount === undefined || reply.amount === null ? "" : escapeHtml(String(reply.amount))}"></label>
      <p>소각비는 투입량 1t당, 재활용 처리비·매각 가격은 모델에서 재활용에 배분한 양 1t당입니다. 수집·운송·선별비는 별도 가정입니다. 회신의 적용량·포함 범위를 확인하지 못했으면 금액을 공란으로 두세요.</p>
      <p>단위는 모델 입력 단위 그대로입니다. VAT·통화·운송비를 자동 환산하거나 포함한다고 가정하지 않습니다. 공란은 미확보, 명시적 0은 사용자 가정입니다.</p>
      <label class="consent"><input type="checkbox" name="hypotheticalAcknowledgement" value="yes" required>미검증 회신으로 가정 비교만 하며 실제 승인·수락·확정 견적으로 사용하지 않음에 동의합니다.</label>
      <button type="submit">저장 없이 가정 비교</button>
    </form>`);
}
