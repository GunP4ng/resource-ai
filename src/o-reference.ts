import { readFileSync } from "node:fs";
import { readPriceSnapshot, readSanitizedProcessorSnapshot, sourceManifest } from "./sources.ts";
import { escapeHtml as e, list, page, safeLink } from "./report.ts";
/** Read only the repository's fixed allowlist; no request URL/path reaches file IO. */
export function referencePage(): string {
  const price = sourceManifest.find((s) => s.sourceId === "keco-price-2026-10");
  const directory = sourceManifest.find((s) => s.sourceId === "ulsan-processors-2025-12-sanitized");
  // Source uses repository data; the app bundle uses its staged sibling data.
  const prices = price?.localPath ? readPriceSnapshot(readFileSync(new URL(`../${price.localPath}`, import.meta.url)), price) : null;
  const processors = directory?.localPath ? readSanitizedProcessorSnapshot(readFileSync(new URL(`../${directory.localPath}`, import.meta.url)), directory) : null;
  return page("실자료 현황", `<h1>실자료 현황</h1><p>검증 후보 0곳 · 실제 비용·탄소 총액 계산 불가</p>${list(["실제 업체별 허가·폐기물 코드·인수 의사는 미확인입니다.", "실제 견적·VAT·물류 범위가 없어 비용 합산에 사용할 수 없습니다.", "계산 승인된 실제 계수 registry는 비어 있습니다. 활동량·대체율·GWP·권리 검증이 필요합니다.", "일반 법령 연결 인용은 코드나 재활용 경로의 적합성을 증명하지 않습니다."])}
  <h2>참고 매각가격</h2><p>VAT·물류 미확인 · 실제 견적 아님</p>${prices?.state === "available" ? `<p>${prices.rows.length}개 정규화 가격 · 공란은 미발표 유지</p><details><summary>참고가격 원자료 보기</summary><table><caption>한국환경공단 참고 매각가격 (원/kg)</caption><thead><tr><th>품목 / 지역</th><th>가격 / 기준일 / 원문 위치</th></tr></thead><tbody>${prices.rows.map((r) => `<tr><td>${e(r.itemLabel)} · ${e(r.region)}</td><td>${r.priceKrwPerKg === null ? "미발표" : e(String(r.priceKrwPerKg))}<br>${e(r.observedOn)} · ${e(r.sourceLocator)}</td></tr>`).join("")}</tbody></table></details>` : "<p>가격 snapshot 확인 불가</p>"}
  <h2>등재 업체 · 허가 미확인</h2>${processors?.state === "available" ? `<p>${processors.rows.length}곳 등재. 사무실 주소로 처리시설 위치를 추정하지 않습니다.</p><details><summary>등재 업체 보기</summary>${list(processors.rows.map((r) => `${r.name} · 등재 영업구역 ${r.serviceArea} · CSV 행 ${r.rowNumber} · 기준 ${r.sourceDate} · 허가 미확인`))}</details>` : "<p>업체 snapshot 확인 불가</p>"}
  <h2>일반 법령 연결 인용</h2><p>데이터 인계의 제4조의2 제1항: 폐기물 종류별 세부분류는 별표 4에 따른다는 연결 인용입니다. 별표의 적용 행·공정별 코드와 업체 허가를 확인한 자료가 아닙니다.</p><h2>출처·버전</h2>${sourceManifest.filter((s) => ["keco-price-2026-10", "ulsan-processors-2025-12-sanitized", "waste-rule-2026-10"].includes(s.sourceId) || s.category === "law").map((s) => { const url = safeLink(s.url); return `<p>${url === null ? e(s.title) : `<a href="${url}" rel="noreferrer">${e(s.title)}</a>`}<br>${e(s.publisher)} · 버전 ${e(s.datasetVersion)} · 조회 ${e(s.retrievedAt)}<br>원문 위치·미확인 항목: ${e(s.missing.join(", "))}</p>`; }).join("")}`);
}
