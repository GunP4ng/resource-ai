import type { ModelHostAudit } from "./o-model-audit.ts";
import type { ModelAuditField } from "./o-model-audit-schema.ts";
import { escapeHtml, list } from "./report-html.ts";
import { readableReasons } from "./report-evidence.ts";

const statuses = {
  absent: "제안 필드 없음",
  "not-evaluated": "검사하지 않음",
  "syntax-invalid": "형식 오류로 거부",
  "validation-rejected": "호스트 검증 거부",
  "validation-passed": "호스트 검증 통과",
} as const;
const origins = {
  "model-output": "모델이 반환한 구조화 제안",
  "host-decision-reference": "모델이 선택해 반환한 호스트 판정 참조",
  "runner-output": "실행기 제안 · 모델 출처 미확인",
} as const;
const stageNames = ["식별·분류", "재활용 가능성", "규정 근거", "업체", "비용·탄소", "처리 방안"] as const;
const states = { compared: "조건부 비교", "needs-information": "추가 정보 필요", "needs-review": "검토 필요" } as const;
const availability = { available: "값 있음", unavailable: "미확보" } as const;
const routes = { reuse: "재사용", "mechanical-recycling": "기계적 재활용", "other-recovery": "기타 회수", disposal: "처분" } as const;
const eligibility = { eligible: "적격", conditional: "조건부", ineligible: "부적격", unknown: "미확인" } as const;
const reasons = {
  "not-in-proposal-contract": "현재 제안 형식에 이 단계의 필드가 없습니다.",
  "no-proposed-fields": "이 실행의 제안에 해당 항목이 없습니다.",
  "invalid-proposal-shape": "기존 판정 형식을 만족하지 못했습니다.",
  "early-host-guard": "호스트가 안전·검토 조건으로 먼저 보류하여 제안 검사를 진행하지 않았습니다.",
  "proposal-check-rejected": "해당 필드 또는 사례 결합 검사를 통과하지 못했습니다.",
  "field-check-passed": "기록된 호스트 검사만 통과했습니다. 독립적인 모델 기여나 실행 승인이 아닙니다.",
  "field-not-validated": "이 필드를 검사한 기록이 없습니다.",
} as const;

function fieldText(item: ModelAuditField): string {
  const id = (value: { readonly hostId: string | null; readonly sha256: string }) =>
    Object.entries(routes).find(([key]) => key === value.hostId)?.[1]
      ?? value.hostId ?? `호스트 미확인 식별자 SHA-256 ${value.sha256}`;
  switch (item.kind) {
    case "route": return `${routes[item.route]} · ${eligibility[item.eligibility]}`;
    case "alternative": return `${routes[item.routeId]} · ${{ "clean-separated": "깨끗한 단일 수지 분리 확인", "contaminated-or-inseparable": "오염·분리 가능성 확인", "hazard-classification": "유해성 분류 확인", "reuse-purpose": "재사용 용도 확인" }[item.condition]} · ${item.support === "route-supported" ? "조건별 경로 근거 있음" : "경로 근거 미확보"}`;
    case "evidence": return `출처 ${id(item.sourceId)} · 기록 SHA-256 ${item.recordSha256}`;
    case "processor": return `업체 ${id(item.processorId)} · 인수 ${item.acceptance === "confirmed" ? "확인" : "미확인"}`;
    case "scenario": return `${id(item.routeId)} · 비용 ${availability[item.cost]} · 탄소 ${availability[item.carbon]}`;
    case "decision": return `${states[item.state]} · 질문 ${item.questionCount}개 · 보류 사유 ${item.reasonCount}개 · 승인 ${item.humanApproval === "approved" ? "승인 표시" : item.humanApproval === "pending" ? "대기" : "해당 필드 없음"}`;
    case "recommendation": return `${item.rank ?? "미확인"}순위 ${id(item.routeId)} · ${item.grade === "public-conditional" ? "공개 근거 조건부" : "검토 자료 있음"}`;
    default: {
      const exhaustive: never = item;
      return exhaustive;
    }
  }
}

export function renderModelHostAudit(audit: ModelHostAudit, sharedReasons: readonly string[] = []): string {
  const validationReasons = readableReasons(audit.validation.reasons);
  return `<section id="model-host-audit" data-model-audit-origin="${audit.origin}">
    <h3>이 평가에 저장된 모델 제안과 호스트 검사</h3>
    <p><strong>${origins[audit.origin]} · ${statuses[audit.validation.status]}</strong></p>
    <p>호스트가 최종 판정을 계산합니다. 검증 통과는 제안의 독립적 기여·자동 채택·현장 적합성·실행 승인의 증명이 아닙니다.
      ${audit.origin === "host-decision-reference" ? "이 실행은 호스트가 이미 만든 결과를 모델이 선택한 기록이며, 모델이 새 판단을 만들었다고 해석하지 않습니다." : ""}
      제안과 최종 출력의 구조화된 항목만 보존하며 모델의 내부 사고 과정은 기록하지 않습니다.</p>
    ${list(validationReasons.filter(reason => !sharedReasons.includes(reason)))}
    ${validationReasons.some(reason => sharedReasons.includes(reason)) ? '<p><a href="#case-reasons">호스트가 먼저 확인한 보류 사유 보기</a></p>' : ""}
    ${audit.validation.reasonsTruncated ? "<p>검사 사유는 저장 한도에서 일부만 표시합니다.</p>" : ""}
    ${audit.stages.map(stage => `<details data-model-audit-stage="${stage.stage}" data-validation-status="${stage.status}">
      <summary>${stage.stage}. ${stageNames[stage.stage - 1]} · ${statuses[stage.status]}</summary>
      <p>${reasons[stage.reason]}</p>
      <p><strong>반환된 제안</strong> · ${stage.proposed.totalItems}개</p>
      ${stage.proposed.items.length ? list(stage.proposed.items.map(fieldText)) : "<p>이 단계의 구조화 제안 필드가 없습니다.</p>"}
      <p><strong>호스트 최종 출력</strong> · ${stage.hostSelected.totalItems}개</p>
      ${stage.hostSelected.items.length ? list(stage.hostSelected.items.map(fieldText)) : "<p>이 단계의 구조화 출력 필드가 없습니다.</p>"}
      ${stage.proposed.totalItems > stage.proposed.items.length || stage.hostSelected.totalItems > stage.hostSelected.items.length
        ? "<p>각 목록은 앞의 16개 항목까지 표시합니다. 전체 개수와 구분하세요.</p>" : ""}</details>`).join("")}
    <details><summary>저장 기록 결합 확인</summary><p>사례 ${escapeHtml(audit.caseId)} · 입력 ${escapeHtml(audit.inputRevision)}
      · 최종 판정 ${escapeHtml(audit.decisionRevision)}</p>
      <p>통과한 검사: ${escapeHtml(audit.validation.passedChecks.join(", ") || "없음")} · 실패 검사: ${escapeHtml(audit.validation.failedCheck ?? "없음")}</p></details>
    </section>`;
}
