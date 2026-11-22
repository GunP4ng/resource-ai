import { hostVerificationOrder, type VerificationPlan } from "./o-verification-plan.ts";
import type { DecisionResult } from "./contracts.ts";
import { rawReasons, readableReason } from "./report-evidence.ts";
import { escapeHtml } from "./report-html.ts";

export function renderVerificationPlan(plan: VerificationPlan | undefined, decision: DecisionResult): string {
  const order = hostVerificationOrder(decision, plan);
  if (!plan && order.safety.length === 0) return "";
  const sharedReasons = rawReasons(decision.state === "needs-review" ? decision.reasons
    : decision.state === "needs-information" ? decision.questions : []);
  const label = (text: string) => {
    const shared = sharedReasons.indexOf(text);
    return shared < 0 ? escapeHtml(readableReason(text)) : `<a href="#case-reason-${shared + 1}">위 보류 사유 ${shared + 1} 확인</a>`;
  };
  const safety = rawReasons(order.safety);
  const following = rawReasons(order.following.map(item => item.text)).filter(text => !safety.includes(text));
  const rejection = {
    "invalid-plan-shape": "제안 형식, 개수, 중복 조건이 맞지 않았습니다.",
    "candidate-binding-mismatch": "이 사례에 제공한 확인 항목과 다른 항목을 골랐습니다.",
    "base-proposal-mismatch": "제안의 기준 판정이 앱의 현재 판정과 다릅니다.",
  } as const;
  const isModel = plan !== undefined && plan.origin !== "runner-output";
  return `<section id="verification-plan" data-plan-status="${plan?.status ?? "host-only"}" data-plan-origin="${plan?.origin ?? "host-only"}">
    <h2>${safety.length ? "안전 우선 확인 순서" : isModel ? "모델이 제안한 확인 순서" : "실행기가 제안한 확인 순서"}</h2>
    ${safety.length ? '<p data-host-safety-priority><strong>안전 확인이 항상 먼저입니다.</strong> AI가 제안한 순서와 관계없이 안전 사유를 1번에 둡니다.</p>' : ""}
    ${plan?.status === "validated-selection" ? `<p>${isModel ? "모델이 앱이 제공한 항목 중에서 순서를 골랐습니다." : "모델 출처 기록이 없는 실행기 제안입니다."}
      앱은 선택한 항목이 이 사례에 제공한 범위 안에 있는지 검사했습니다. 순서는 현장 판단으로 조정하세요.</p>` : ""}
    ${plan?.status === "rejected" ? `<p>모델·실행기 제안을 거부했습니다. ${plan.rejectionReason ? rejection[plan.rejectionReason] : "검증에 실패했습니다."}</p>` : ""}
    ${!plan && safety.length ? "<p>앱이 현재 안전 보류 사유로 만든 순서입니다.</p>" : ""}
    ${safety.length || following.length ? `<ol data-effective-verification-order>
      ${safety.length ? `<li data-plan-source="host-safety"><strong>안전 사유 먼저 확인</strong>${safety.map(text => `<p>${label(text)}</p>`).join("")}</li>` : ""}
      ${following.map(text => `<li data-plan-source="model">${label(text)}</li>`).join("")}</ol>`
      : plan?.status === "rejected" ? "<p>거부된 제안이라 추가 확인 항목이 없습니다.</p>"
        : "<p>이번 실행에서 고른 추가 확인 항목이 없습니다.</p>"}
    <p>${sharedReasons.length ? "보류 사유와 안전 확인부터 처리하세요." : "현장 안전 확인과 승인 요건은 그대로 적용됩니다."} 이 제안은 처리·반출·계약 승인이나 보류 해제가 아니며,
      <a href="#checks">전체 필수 확인 목록</a>을 모두 확인하세요.</p>
    ${plan ? `<details><summary>제공 항목과 제안 기록</summary>
      <p>앱 확인 항목 ${plan.candidateCount}개 중 ${plan.offeredCount}개를 제공했고 범위 검사를 통과한 선택은 ${plan.selected.length}개입니다.
        안전 사유 ${safety.length}개는 1번 묶음으로 따로 표시하고 모델 선택 한도와 별개로 셉니다.</p>
      ${plan.status === "validated-selection" ? `<p><strong>${isModel ? "모델" : "실행기"}가 고른 원래 순서 (위 표시 순서와 다를 수 있음)</strong></p>
        <ol data-model-original-order>${plan.selected.map(item => `<li>${label(item.text)}</li>`).join("")}</ol>
        <p>원래 선택과 순서는 저장 기록에 남습니다. 같은 문구와 안전 항목은 한 번만 표시합니다.</p>`
        : `<p>거부된 제안은 거부 사유와 요약 해시로 보존합니다: ${escapeHtml(plan.proposalSha256)}</p>`}
      <p>제공 한도 ${plan.candidateLimit}개, 항목당 ${plan.textLimit}자, 선택 한도 ${plan.selectionLimit}개.
        한도를 넘어 모델에 보내지 않은 항목 ${plan.omittedCount}개도 전체 필수 확인 목록에 있습니다.</p>
      <p>항목 문구는 앱이 만든 것이고, 모델은 순서만 골랐습니다.
        처리 판정은 이 순서와 별개로 정해집니다.</p></details>` : ""}
    </section>`;
}
