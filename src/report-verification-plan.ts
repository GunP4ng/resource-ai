import { hostVerificationOrder, type VerificationPlan } from "./o-verification-plan.ts";
import type { DecisionResult } from "./contracts.ts";
import { readableReason, readableReasons } from "./report-evidence.ts";
import { escapeHtml } from "./report-html.ts";

export function renderVerificationPlan(plan: VerificationPlan | undefined, decision: DecisionResult): string {
  const order = hostVerificationOrder(decision, plan);
  if (!plan && order.safety.length === 0) return "";
  const sharedReasons = readableReasons(decision.state === "needs-review" ? decision.reasons
    : decision.state === "needs-information" ? decision.questions : []);
  const label = (text: string) => {
    const shared = sharedReasons.indexOf(text);
    return shared < 0 ? escapeHtml(text) : `<a href="#case-reason-${shared + 1}">위 보류 사유 ${shared + 1} 확인</a>`;
  };
  const safety = readableReasons(order.safety);
  const following = readableReasons(order.following.map(item => item.text)).filter(text => !safety.includes(text));
  const rejection = {
    "invalid-plan-shape": "제안 형식·개수·중복 조건을 만족하지 못했습니다.",
    "candidate-binding-mismatch": "현재 사례에 제공한 확인 항목과 일치하지 않습니다.",
    "base-proposal-mismatch": "기준 판정이 호스트의 현재 판정과 일치하지 않습니다.",
  } as const;
  const isModel = plan !== undefined && plan.origin !== "runner-output";
  return `<section id="verification-plan" data-plan-status="${plan?.status ?? "host-only"}" data-plan-origin="${plan?.origin ?? "host-only"}">
    <h2>${safety.length ? "안전 우선 확인 순서" : isModel ? "모델이 반환한 확인 순서 제안" : "실행기가 반환한 확인 순서 제안"}</h2>
    ${safety.length ? '<p data-host-safety-priority><strong>호스트가 안전 사유를 앞에 둠</strong> · 모델의 선택·순서와 관계없이 현재 보류 판정의 안전 사유를 1번에 고정합니다.</p>' : ""}
    ${plan?.status === "validated-selection" ? `<p>${isModel ? "모델이 호스트가 제공한 항목 중에서 순서를 골랐습니다." : "모델 출처를 확인하지 못한 실행기 제안입니다."}
      모델 선택은 항목 범위와 현재 사례의 일치만 검사했습니다. 우선순위의 정확성·현장 적합성은 검증하지 않았습니다.</p>` : ""}
    ${plan?.status === "rejected" ? `<p>모델·실행기의 제안은 적용하지 않았습니다. ${plan.rejectionReason ? rejection[plan.rejectionReason] : "검증하지 못했습니다."}</p>` : ""}
    ${!plan && safety.length ? "<p>모델의 확인 순서 제안 없이 호스트의 현재 안전 보류 사유로 만든 순서입니다.</p>" : ""}
    ${safety.length || following.length ? `<ol data-effective-verification-order>
      ${safety.length ? `<li data-plan-source="host-safety"><strong>안전 사유 먼저 확인</strong>${safety.map(text => `<p>${label(text)}</p>`).join("")}</li>` : ""}
      ${following.map(text => `<li data-plan-source="model">${label(text)}</li>`).join("")}</ol>`
      : plan?.status === "rejected" ? "<p>거부된 제안에서는 확인 항목을 적용하지 않습니다.</p>"
        : "<p>이번 실행은 별도의 확인 순서를 선택하지 않았습니다.</p>"}
    <p>${sharedReasons.length ? "현재 보류 사유와 안전 확인을 먼저 따르세요." : "현장 안전 확인과 승인 요건은 그대로 유지됩니다."} 이 제안은 처리·반출·계약 승인이나 보류 해제가 아니며,
      <a href="#checks">전체 필수 확인 목록</a>을 줄이지 않습니다.</p>
    ${plan ? `<details><summary>제공 항목과 제안 기록</summary>
      <p>호스트 확인 항목 ${plan.candidateCount}개 중 ${plan.offeredCount}개를 제공했고 항목 범위 검사를 통과한 선택은 ${plan.selected.length}개입니다.
        호스트 안전 사유 ${safety.length}개는 별도의 1번 묶음이며 모델 선택 한도에 포함하지 않습니다.</p>
      ${plan.status === "validated-selection" ? `<p><strong>${isModel ? "모델" : "실행기"}의 원래 선택 순서 · 호스트 적용 순서 아님</strong></p>
        <ol data-model-original-order>${plan.selected.map(item => `<li>${label(readableReason(item.text))}</li>`).join("")}</ol>
        <p>원래 선택·순서는 저장 기록에 그대로 남습니다. 같은 표시 문구와 안전 항목은 실행 전 확인 순서에서 중복하지 않습니다.</p>`
        : `<p>거부된 제안은 원문 대신 거부 사유와 요약 해시를 보존합니다: ${escapeHtml(plan.proposalSha256)}</p>`}
      <p>제공 한도 ${plan.candidateLimit}개, 항목당 ${plan.textLimit}자, 선택 한도 ${plan.selectionLimit}개.
        한도 때문에 제공하지 않은 항목은 ${plan.omittedCount}개이며 전체 필수 확인 목록에 남아 있습니다.</p>
      <p>문구는 호스트 자료이며 모델이 새 사실·수치·허가를 작성한 것이 아닙니다.
        이 순서 제안이 실제 처리 판정을 개선했다는 뜻도 아닙니다.</p></details>` : ""}
    </section>`;
}
