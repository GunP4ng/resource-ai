import { readFileSync } from "node:fs";
import { readPriceSnapshot, readSanitizedProcessorSnapshot, sourceManifest } from "./sources.ts";
import { escapeHtml as e, list, page, safeLink } from "./report.ts";
import { koreanSourceDate } from "./report-date.ts";
import { displayLawTitle, displayLawVersion, displayLocator } from "./report-copy.ts";
import materialPrices from "../data/reference/keco-material-price-reference-20261122.json" with { type: "json" };
/** Read only the repository's fixed allowlist; no request URL/path reaches file IO. */
export function referencePage(): string {
  const price = sourceManifest.find((s) => s.sourceId === "keco-price-2026-10");
  const directory = sourceManifest.find((s) => s.sourceId === "ulsan-processors-2025-12-sanitized");
  // Source uses repository data; the app bundle uses its staged sibling data.
  const prices = price?.localPath ? readPriceSnapshot(readFileSync(new URL(`../${price.localPath}`, import.meta.url)), price) : null;
  const processors = directory?.localPath ? readSanitizedProcessorSnapshot(readFileSync(new URL(`../${directory.localPath}`, import.meta.url)), directory) : null;
  return page("실자료 현황", `<h1>실자료 현황</h1><p>검증 업체 0곳 · 사례 비용·탄소 총액은 견적·계수 확보 후 계산</p>${list(["업체별 허가·폐기물 코드·인수 의사는 업체에 직접 확인해야 합니다.", "비용 합산에는 견적, 부가세, 물류 범위가 필요합니다.", "계산용 계수 등록부가 비어 있습니다. 활동량·대체율·지구온난화지수·사용권을 검증해 채워야 합니다.", "일반 법령 인용은 분류 기준의 위치를 안내합니다. 코드와 경로는 사례별로 확인하세요."])}
  <h2>참고 매각가격</h2><p>참고가격 · 부가세·물류 별도 확인</p>${prices?.state === "available" ? `<p>${prices.rows.length}개 가격 · 공란은 미발표</p><details><summary>참고가격 원자료 보기</summary><table><caption>한국환경공단 참고 매각가격 (원/kg)</caption><thead><tr><th>품목 / 지역</th><th>가격 / 기준일 / 원문 위치</th></tr></thead><tbody>${prices.rows.map((r) => `<tr><td>${e(r.itemLabel)} · ${e(r.region)}</td><td>${r.priceKrwPerKg === null ? "미발표" : e(String(r.priceKrwPerKg))}<br>${e(koreanSourceDate(r.observedOn))} · ${e(displayLocator(r.sourceLocator))}</td></tr>`).join("")}</tbody></table></details>` : "<p>가격 자료를 불러오지 못했습니다</p>"}
  <section id="material-purchase-prices" aria-labelledby="material-purchase-title">
  <h2 id="material-purchase-title">철스크랩·폐지 참고 매입가격 통계</h2>
  <p>${e(materialPrices.publisher)} ${e(materialPrices.title)} · 기준월 ${e(koreanSourceDate(materialPrices.surveyMonth))} · ${e(materialPrices.region)}<br>조사 기준일 ${e(koreanSourceDate(materialPrices.referenceDate))} · 공표일 ${e(koreanSourceDate(materialPrices.publicationDate))} · 조회일 ${e(koreanSourceDate(materialPrices.lookupDate))}<br>${e(materialPrices.unit)} · ${e(materialPrices.vat)} · ${e(materialPrices.logistics)}</p>
  ${list(materialPrices.limits.map(limit => limit.replace(" (NOT A QUOTE)", "")))}
  <table><caption>품목·등급별 전국 참고 매입가격</caption><thead><tr><th scope="col">품목 / 품질 등급 / 상태</th><th scope="col">전국 참고 통계</th><th scope="col">거래 단계 / 원문 위치</th></tr></thead><tbody>${materialPrices.items.map((r) => `<tr><td>${e(r.material)} · ${e(r.grade)} · ${e(r.qualityState)}</td><td>${e(String(r.priceKrwPerKg))} ${e(materialPrices.unit)}</td><td>${e(r.transactionQuote)}<br>${e(r.valueLocator)}<br>품질·거래 정의: ${e(r.definitionLocator)}<br>CSV ${e(String(r.csvLine))}행 (${e(r.csvLabel)}, 지역별 값 수록)</td></tr>`).join("")}</tbody></table>
  <h3>가격 자료가 없는 품목</h3>${list(materialPrices.excluded.map((r) => `${r.material}: 가격 없음 · ${r.reason}`))}
  <details><summary>공식 출처·원문 인용·해시</summary>
  ${([["PDF 게시물", materialPrices.pdf.url], ["공공데이터포털 CSV", materialPrices.csv.url], [materialPrices.license.name, materialPrices.license.url]] as const).map(([title, sourceUrl]) => { const url = safeLink(sourceUrl); return `<p>${url === null ? e(title) : `<a href="${url}" rel="noreferrer">${e(title)}</a>`}</p>`; }).join("")}
  <p>PDF SHA-256: <code>${e(materialPrices.pdf.sha256)}</code><br>CSV SHA-256: <code>${e(materialPrices.csv.sha256)}</code><br>CSV: ${e(materialPrices.csv.rowConvention)} · ${e(materialPrices.csv.limitation)}</p>
  <p>${e(materialPrices.pdf.methodLocator)}: 「${e(materialPrices.pdf.methodQuote)}」<br>${e(materialPrices.pdf.transactionLocator)}: 「${e(materialPrices.pdf.transactionQuote)}」</p>
  <p>출처: ${e(materialPrices.publisher)}, ${e(materialPrices.title)}, ${e(koreanSourceDate(materialPrices.surveyMonth))} · 조회 ${e(koreanSourceDate(materialPrices.lookupDate))}<br>${e(materialPrices.license.name)} · 「${e(materialPrices.license.quote)}」<br>${e(materialPrices.license.scope)}</p>
  </details></section>
  <h2>등재 업체 · 허가는 업체에 확인</h2>${processors?.state === "available" ? `<p>${processors.rows.length}곳 등재. 주소는 사무실 기준이며 처리시설 위치는 업체에 확인하세요.</p><details><summary>등재 업체 보기</summary>${list(processors.rows.map((r) => `${r.name} · 등재 영업구역 ${r.serviceArea} · CSV 행 ${r.rowNumber} · 기준 ${koreanSourceDate(r.sourceDate)} · 허가 확인 필요`))}</details>` : "<p>업체 자료를 불러오지 못했습니다</p>"}
  <h2>일반 법령 인용</h2><p>제4조의2 제1항: 폐기물 종류별 세부분류는 별표 4를 따릅니다. 사례에 맞는 별표 행·공정별 코드와 업체 허가는 따로 확인하세요.</p><h2>출처와 자료 기준</h2>${sourceManifest.filter((s) => ["keco-price-2026-10", "ulsan-processors-2025-12-sanitized", "waste-rule-2026-10"].includes(s.sourceId) || s.category === "law").map((s) => {
    const url = safeLink(s.url), title = e(displayLawTitle(s.title));
    const version = s.datasetVersion.endsWith("-sanitized") ? `${koreanSourceDate(s.datasetVersion.slice(0, -"-sanitized".length))} 정리본` : displayLawVersion(s.datasetVersion);
    const notes = s.missing.map(note => note.replace(/legal-(\d+)-\* 레코드 참조/gu, "해당 시행본(일련번호 $1)의 별표 발췌를 참고하세요"));
    return `<p>${url === null ? title : `<a href="${url}" rel="noreferrer">${title}</a>`}<br>${e(s.publisher)} · 자료 기준 ${e(version)} · 조회 ${e(koreanSourceDate(s.retrievedAt))}<br>원문 위치·확인할 항목: ${e(notes.join(", "))}</p>`;
  }).join("")}`);
}
