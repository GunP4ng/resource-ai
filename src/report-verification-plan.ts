import type { VerificationPlan } from "./o-verification-plan.ts";
import { readableReasons } from "./report-evidence.ts";
import { escapeHtml } from "./report-html.ts";

export function renderVerificationPlan(plan: VerificationPlan, sharedReasons: readonly string[] = []): string {
  const rejection = {
    "invalid-plan-shape": "제안 형식·개수·중복 조건을 만족하지 못했습니다.",
    "candidate-binding-mismatch": "현재 사례에 제공한 확인 항목과 일치하지 않습니다.",
    "base-proposal-mismatch": "기준 판정이 호스트의 현재 판정과 일치하지 않습니다.",
  } as const;
  if (plan.status === "rejected") return `<details id="verification-plan" data-plan-status="rejected">
    <summary>확인 순서 제안은 적용하지 않았습니다</summary>
    <p>${plan.rejectionReason ? rejection[plan.rejectionReason] : "검증하지 못했습니다."} 기존 판정과 전체 필수 확인 목록을 유지합니다.</p></details>`;
  const displayed = readableReasons(plan.selected.map(item => item.text));
  const isModel = plan.origin !== "runner-output";
  return `<section id="verification-plan" data-plan-status="validated-selection" data-plan-origin="${plan.origin}">
    <h2>${isModel ? "모델이 반환한 확인 순서 제안" : "실행기가 반환한 확인 순서 제안"}</h2>
    <p>${isModel ? "모델이 호스트가 제공한 항목 중에서 순서를 골랐습니다." : "모델 출처를 확인하지 못한 실행기 제안입니다."}
      항목 범위와 현재 사례의 일치만 검사했습니다. 우선순위의 정확성·현장 적합성은 검증하지 않았습니다.</p>
    ${displayed.length ? `<ol>${displayed.map(text => {
      const shared = sharedReasons.indexOf(text);
      return `<li>${shared < 0 ? escapeHtml(text) : `<a href="#case-reason-${shared + 1}">위 보류 사유 ${shared + 1} 확인</a>`}</li>`;
    }).join("")}</ol>`
      : "<p>이번 실행은 별도의 확인 순서를 선택하지 않았습니다.</p>"}
    <p>${sharedReasons.length ? "현재 보류 사유와 안전 확인을 먼저 따르세요." : "현장 안전 확인과 승인 요건은 그대로 유지됩니다."} 이 제안은 처리·반출·계약 승인이나 보류 해제가 아니며,
      <a href="#checks">전체 필수 확인 목록</a>을 줄이지 않습니다.</p>
    <details><summary>제공 항목과 선택 범위</summary>
      <p>호스트 확인 항목 ${plan.candidateCount}개 중 ${plan.offeredCount}개를 제공했고 모델 또는 실행기가 ${plan.selected.length}개를 선택했습니다.
        같은 표시 문구는 합쳐 ${displayed.length}개로 보여 줍니다.</p>
      <p>제공 한도 ${plan.candidateLimit}개, 항목당 ${plan.textLimit}자, 선택 한도 ${plan.selectionLimit}개.
        한도 때문에 제공하지 않은 항목은 ${plan.omittedCount}개이며 전체 필수 확인 목록에 남아 있습니다.</p>
      <p>문구는 호스트 자료이며 모델이 새 사실·수치·허가를 작성한 것이 아닙니다.
        이 순서 제안이 실제 처리 판정을 개선했다는 뜻도 아닙니다.</p></details>
    </section>`;
}
