import type { ModelHostAudit } from "./o-model-audit.ts";
import type { ModelAuditField } from "./o-model-audit-schema.ts";
import { escapeHtml, list } from "./report-html.ts";
import { rawReasons, readableReason } from "./report-evidence.ts";

const checkLabels: Readonly<Record<string, string>> = {
  "syntax": "형식 검사",
  "alternatives": "대안 검사",
  "case-binding": "사례 연결 검사",
  "evidence": "근거 검사",
  "comparison": "비교 검사"
};
const checkName = (check: string) => checkLabels[check] ?? check;
const statuses = {
  absent: "제안 없음",
  "not-evaluated": "검사 생략",
  "syntax-invalid": "형식 오류로 거부",
  "validation-rejected": "앱 검증에서 거부",
  "validation-passed": "앱 검증 통과",
} as const;
const origins = {
  "model-output": "모델이 만든 제안",
  "host-decision-reference": "앱 판정 중 모델이 고른 결과",
  "runner-output": "실행기 제안 · 모델 출처 미확인",
} as const;
const stageNames = ["식별·분류", "재활용 가능성", "규정 검토", "업체", "비용·탄소", "처리 방안"] as const;
const states = { compared: "조건부 비교", "needs-information": "추가 정보 필요", "needs-review": "검토 필요" } as const;
const availability = { available: "값 있음", unavailable: "값 없음" } as const;
const routes = { reuse: "재사용", "mechanical-recycling": "기계적 재활용", "other-recovery": "기타 회수", disposal: "처분" } as const;
const eligibility = { eligible: "적격", conditional: "조건부", ineligible: "부적격", unknown: "확인 필요" } as const;
const reasons = {
  "not-in-proposal-contract": "이 단계는 모델 제안 대상이 아닙니다.",
  "no-proposed-fields": "이번 제안에는 이 항목이 없습니다.",
  "invalid-proposal-shape": "판정 형식이 맞지 않아 거부했습니다.",
  "early-host-guard": "앱이 안전·검토 조건으로 먼저 보류해 제안 검사를 생략했습니다.",
  "proposal-check-rejected": "필드 검사나 사례 일치 검사에서 거부했습니다.",
  "field-check-passed": "기록된 호스트 검사를 통과했습니다. 모델의 독립 기여나 실행 승인은 아닙니다.",
  "field-not-validated": "이 필드의 검사 기록이 없습니다.",
} as const;

function fieldText(item: ModelAuditField): string {
  const id = (value: { readonly hostId: string | null; readonly sha256: string }) =>
    Object.entries(routes).find(([key]) => key === value.hostId)?.[1]
      ?? value.hostId ?? `등록되지 않은 식별자 SHA-256 ${value.sha256}`;
  switch (item.kind) {
    case "route": return `${routes[item.route]} · ${eligibility[item.eligibility]}`;
    case "alternative": return `${routes[item.routeId]} · ${{ "clean-separated": "깨끗한 단일 재질·품목 분리 확인", "contaminated-or-inseparable": "오염·분리 가능성 확인", "hazard-classification": "유해성 분류 확인", "reuse-purpose": "재사용 용도 확인" }[item.condition]} · ${item.support === "route-supported" ? "조건별 경로 근거 있음" : "경로 근거 필요"}`;
    case "evidence": return `출처 ${id(item.sourceId)} · 기록 SHA-256 ${item.recordSha256}`;
    case "processor": return `업체 ${id(item.processorId)} · 인수 ${item.acceptance === "confirmed" ? "확인" : "확인 필요"}`;
    case "scenario": return `${id(item.routeId)} · 비용 ${availability[item.cost]} · 탄소 ${availability[item.carbon]}`;
    case "decision": return `${states[item.state]} · 질문 ${item.questionCount}개 · 보류 사유 ${item.reasonCount}개 · 승인 ${item.humanApproval === "approved" ? "승인 표시" : item.humanApproval === "pending" ? "대기" : "없음"}`;
    case "recommendation": return `${item.rank ?? "확인 필요"}순위 ${id(item.routeId)} · ${item.grade === "public-conditional" ? "공개 근거 조건부" : "검토 자료 있음"}`;
    default: {
      const exhaustive: never = item;
      return exhaustive;
    }
  }
}

export function renderModelHostAudit(audit: ModelHostAudit, sharedReasons: readonly string[] = []): string {
  const validationReasons = rawReasons(audit.validation.reasons);
  return `<section id="model-host-audit" data-model-audit-origin="${audit.origin}">
    <h3>모델 제안과 앱 검사 기록</h3>
    <p><strong>${origins[audit.origin]} · ${statuses[audit.validation.status]}</strong></p>
    <p>최종 판정은 호스트가 계산합니다. 검증 통과는 제안의 독립 기여·자동 채택·현장 적합성·실행 승인을 증명하지 않습니다.
      ${audit.origin === "host-decision-reference" ? "이번 실행에서 모델은 앱이 만든 결과 중 하나를 골랐습니다." : ""}
      제안과 최종 출력의 구조화 항목을 보존합니다.</p>
    ${list(validationReasons.filter(reason => !sharedReasons.includes(reason)).map(readableReason))}
    ${validationReasons.some(reason => sharedReasons.includes(reason)) ? '<p><a href="#case-reasons">앱이 먼저 판단한 보류 사유 보기</a></p>' : ""}
    ${audit.validation.reasonsTruncated ? "<p>검사 사유는 저장 한도까지 표시합니다.</p>" : ""}
    ${audit.stages.map(stage => `<details data-model-audit-stage="${stage.stage}" data-validation-status="${stage.status}">
      <summary>${stage.stage}. ${stageNames[stage.stage - 1]} · ${statuses[stage.status]}</summary>
      <p>${reasons[stage.reason]}</p>
      <p><strong>반환된 제안</strong> · ${stage.proposed.totalItems}개</p>
      ${stage.proposed.items.length ? list(stage.proposed.items.map(fieldText)) : "<p>이 단계의 제안이 없습니다.</p>"}
      <p><strong>앱 최종 출력</strong> · ${stage.hostSelected.totalItems}개</p>
      ${stage.hostSelected.items.length ? list(stage.hostSelected.items.map(fieldText)) : "<p>이 단계의 출력이 없습니다.</p>"}
      ${stage.proposed.totalItems > stage.proposed.items.length || stage.hostSelected.totalItems > stage.hostSelected.items.length
        ? "<p>각 목록은 앞 16개를 표시합니다. 전체 개수는 제목 옆 숫자입니다.</p>" : ""}</details>`).join("")}
    <details><summary>저장 기록 연결 정보</summary><p>사례 ${escapeHtml(audit.caseId)} · 입력 ${escapeHtml(audit.inputRevision)}
      · 최종 판정 ${escapeHtml(audit.decisionRevision)}</p>
      <p>통과한 검사: ${escapeHtml(audit.validation.passedChecks.map(checkName).join(", ") || "없음")} · 실패한 검사: ${escapeHtml(audit.validation.failedCheck === null ? "없음" : checkName(audit.validation.failedCheck))}</p></details>
    </section>`;
}
