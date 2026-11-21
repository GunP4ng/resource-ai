import registryJson from "../data/sources/evidence-candidates.json" with { type: "json" };
import { loadEvidenceRegistry } from "./evidence-registry.ts";
import { sourceManifest } from "./sources.ts";
import type { DecisionResult } from "./contracts.ts";
import { escapeHtml, safeLink } from "./report-html.ts";

const registry = loadEvidenceRegistry(registryJson).candidates;
const reasons: Readonly<Record<string, string>> = {
  "hazardous-contact-unconfirmed": "유해물질 접촉 여부가 확인되지 않았습니다",
  "currentness-unverified": "평가일에 적용할 법령 시행본의 유효성을 확인하지 못했습니다",
  "context-missing": "사례 조건이 부족합니다", "context-ambiguous": "입력 조건이 상충하거나 모호합니다",
  "out-of-period": "근거의 적용 기간 밖입니다", "hash-mismatch": "등록 원문과 해시가 다릅니다",
  "quote-not-in-snapshot": "저장 원문에서 인용문을 확인하지 못했습니다",
  "snapshot-unavailable": "등록 원문을 사용할 수 없습니다", "source-not-registered": "등록되지 않은 출처입니다",
  "original-unverified": "원문 대조가 확인되지 않았습니다", "reuse-unverified": "사용권이 확인되지 않았습니다",
  "claim-unverified": "주장의 근거가 확인되지 않았습니다", "unrelated": "사례와 근거의 관련성을 확인하지 못했습니다",
  "version-not-registered": "해당 법령 버전이 등록되지 않았습니다", "access-failed": "원문에 접근하지 못했습니다",
  "stale": "근거 갱신 확인이 필요합니다", "site-specific": "다른 현장에 한정된 근거입니다",
  "proposal-case-mismatch": "모델 제안의 사례 식별자가 현재 사례와 다릅니다",
  "proposal-evidence-conflict": "모델 제안의 근거가 호스트 검증 자료와 다릅니다",
  "proposal-comparison-mismatch": "모델 제안의 비교 결과가 호스트 계산과 다릅니다",
  "proposal-human-approval-forbidden": "모델이 현장 담당자의 승인을 대신할 수 없습니다",
};
export function readableReason(reason: string): string {
  let text = reason.replace("합성 보류 예시:", "합성 추가 정보 예시:");
  text = text.replaceAll("폐플라스틱이 발생한", "폐자원이 발생한")
    .replace("확인된 수지 종류와 이를 확인한 자료(라벨·재질 명세 등)가 있나요?",
      "확인된 재질·품목과 이를 확인한 자료(라벨·재질 명세·발생 이력 등)가 있나요?");
  for (const [code, korean] of Object.entries(reasons)) text = text.replaceAll(code, korean);
  text = text.replace(/\s*\((?:legal-|waste-rule-)[^)]+\)/g, "");
  text = text.replace("비용·탄소 비교값이 없어 검토 순서만 제시합니다.",
    "사례별 검증된 비용·탄소 비교값이 없어 실제 추천은 검토 순서만 제시합니다.");
  return text;
}
export function readableReasons(items: readonly string[]): readonly string[] {
  return [...new Set(items.filter(item => !item.startsWith("추가 답변은 필드별 JSON")).map(readableReason))];
}
export function evidenceSection(result: DecisionResult): string {
  return `<section id="evidence"><h2>출처와 원문 위치</h2>${result.evidence.length ? result.evidence.map((evidence, index) => {
    const candidate = registry.find(item => item.record.sourceId === evidence.sourceId
      && item.record.sha256 === evidence.sha256 && item.record.datasetVersion === evidence.datasetVersion
      && item.record.locator === evidence.locator);
    const provenance = candidate?.provenance;
    const original = provenance ? sourceManifest.find(item => item.sourceId === provenance.originalSourceId && item.sha256 === provenance.originalSha256) : undefined;
    const page = candidate?.record.locator.match(/PDF\s*(\d+)쪽/);
    const originalUrl = original?.downloadUrl ?? original?.url ?? evidence.url;
    const url = safeLink(page && original ? `${originalUrl}#page=${page[1]}` : originalUrl);
    const title = url === null ? escapeHtml(evidence.title) : `<a class="source-link" href="${url}" rel="noreferrer">${escapeHtml(evidence.title)} · 원문 열기</a>`;
    return `<section id="evidence-${index + 1}"><h3>[${index + 1}] ${title}</h3>
      ${provenance ? `<blockquote>${escapeHtml(provenance.quote)}</blockquote>` : "<p>등록된 원문 발췌 없음 · 아래 원문 위치를 확인하세요.</p>"}
      <p>${escapeHtml(evidence.publisher)} · ${escapeHtml(evidence.locator)}</p>
      <p>시행본 ${escapeHtml(evidence.datasetVersion)} · 조회 ${escapeHtml(evidence.retrievedAt)}</p>
      <p>사용권 ${escapeHtml(evidence.license ?? "미확인")} · 확인 ${evidence.licenseVerified ? "예" : "아니오"}</p>
      <details><summary>근거 식별자와 원본 연결 확인하기</summary><p>출처 ID ${escapeHtml(evidence.sourceId)} · SHA-256 ${escapeHtml(evidence.sha256)}</p>
      ${provenance ? `<p>원본 ${escapeHtml(provenance.originalSourceId ?? "미확인")} · SHA-256 ${escapeHtml(provenance.originalSha256 ?? "미확인")}</p>` : ""}</details></section>`;
  }).join("") : "<p>연결된 근거 없음</p>"}</section>`;
}
