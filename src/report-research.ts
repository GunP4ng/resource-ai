import type { CaseResearchReport } from "./o-case-research-schema.ts";
import { escapeHtml, list, safeLink } from "./report-html.ts";

const routeNames = { recycling: "재활용 시나리오", landfill: "매립 시나리오", energy_recovery: "에너지 회수 시나리오" } as const;
const missingNames: Readonly<Record<string, string>> = {
  missing_mass: "질량 미확보", "missing:f_inc": "소각 처리비 미확보",
  "missing:PP.price": "PP 가격 미확보", "missing:PP.y": "PP 수율 미확보",
};
function missingReason(reasons: readonly string[]): string {
  return reasons.map(reason => missingNames[reason] ?? `계산 입력 미확보 (${reason})`).join(" · ") || "지원된 표시값 없음";
}
function value(display: string | null, unit: string, reasons: readonly string[]): string {
  return display === null ? `자료 없음: ${escapeHtml(missingReason(reasons))}` : `${escapeHtml(display)} ${unit}`;
}
function originalLink(url: string, title: string): string {
  const href = safeLink(url);
  return href === null ? escapeHtml(title) : `<a class="source-link" href="${href}" rel="noreferrer">${escapeHtml(title)}</a>`;
}
export function researchCalculations(research: CaseResearchReport): string {
  const { attachment } = research;
  const c = attachment.calculations;
  return `<section id="research-calculations" aria-labelledby="research-heading"><h2 id="research-heading">공개 자료 기반 연구 계산</h2>
    <p><strong>${escapeHtml(attachment.label)}</strong> · ${escapeHtml(attachment.status)}</p>
    <p>평가 기준일 ${escapeHtml(attachment.binding.assessmentDate)} · 법령 시행본 ${escapeHtml(c.cases[0].law_version)}. 연구 숫자는 추천 순위·확신도를 바꾸지 않으며 운영 견적이 아닙니다.</p>
    <p>WARM·Wonju 자료의 상업 이용·재배포 권리 미확인. 인증된 비공개 연구 표시만 제공하며 상업용 보고서·모델 전송에서 제외합니다.</p>
    <p>미국 기본 조건의 WARM 순 전과정 시나리오입니다. 국내 시설의 실측 배출이나 감축 실적이 아닙니다. 기간·GWP·운송 포함 경계 차이로 직접 비교에 한계가 있습니다. 음의 순비용은 계약 이익이 아니며 음의 배출은 탄소 제거가 아닙니다.</p>
    <p>합성 제조 자투리를 단일 수지로 보고 미국의 소비 후 폐플라스틱 폐쇄형 재활용 모형에 가정으로 대응했습니다. 잔재물도 같은 수지로 가정합니다.</p>
    ${c.cases[0].material === "HDPE" ? '<p>HDPE 가격에는 일반 PE(generic PE) 참고가격을 대용했습니다. HDPE 개별 계약가격이 아닙니다.</p>' : ""}
    ${c.results.map(result => `<section data-research-result="${result.route_id}"><h3>${routeNames[result.route_id]}</h3>
      <p><strong>${escapeHtml(result.label)}</strong> · 시나리오 추정, 현장 미검증</p>
      <dl><dt>순비용</dt><dd>${value(result.display.net_cost_krw, "KRW", result.missing_inputs.cost)}</dd>
      <dt>순탄소</dt><dd>${value(result.display.net_carbon_kgco2e, "kgCO2e", result.missing_inputs.carbon)}</dd>
      <dt>매립 기준 비용 차이</dt><dd>${value(result.display.cost_saving_krw, "KRW", result.missing_inputs.cost)}</dd>
      <dt>매립 기준 탄소 차이</dt><dd>${value(result.display.scenario_carbon_difference_kgco2e, "kgCO2e", result.missing_inputs.carbon)}</dd></dl>
      <p>운송 별도 진단: 자료 없음 · 이 모델에 포함하지 않음. WARM에 포함된 운송 경계를 별도 운송 수치로 대체·중복 합산하지 않습니다.</p></section>`).join("")}
    <ul><li>이 계산은 반출·허가·인수·법적 승인이나 실제 계약·실측 절감 실적을 확인한 결과가 아닙니다.</li>
      <li>국내 GIR 전력 계수는 활동량 모형 없이 플라스틱의 전 처리 경로 계수로 대체할 수 없어 사용하지 않았습니다. 사용권도 미확인입니다.</li>
      <li>상업용 사용이 금지된 KEITI 국가 LCI는 제외했습니다. 영국 보고용 계수도 사용하지 않았습니다.</li>
      <li>탄소 비교는 같은 고정 WARM 버전·표·지역·단위·계산 경계 안에서만 해석하세요. 다른 GWP 기준으로 보정하지 않았습니다.</li></ul>
    <details><summary>연구 출처·입력·원본 연결 확인하기</summary>
    <h3>자료에 기록된 가정·한계 원문</h3>
    ${list(c.cases.map(item => item.material_mapping_assumption))}${list(c.limitations)}
    ${c.sources.map(source => `<section><h3>${escapeHtml(source.title)}</h3>${originalLink(source.url, "계산 출처 원문 열기")}
      <p>${escapeHtml(source.agency)} · ${escapeHtml(source.published_or_period)} · ${escapeHtml(source.locator)}</p>
      <p>지역 ${escapeHtml(source.geography)} · GWP ${escapeHtml(source.gwp)} · 경계 ${escapeHtml(source.boundary)}</p>
      <p>${escapeHtml(source.rights_notice_summary)}</p>${originalLink(source.rights_url, "사용권 안내 열기")}
      <p>출처 ${escapeHtml(source.source_id)} · SHA-256 ${escapeHtml(source.raw_sha256)} · 조회 ${escapeHtml(source.retrieved_at)}</p>${list(source.limitations)}</section>`).join("")}
    ${c.inputs.map(input => `<p><strong>${escapeHtml(input.input_id)}</strong>: ${input.value === null ? `자료 없음: ${escapeHtml(input.missing_reason ?? "지원값 없음")}` : `${escapeHtml(String(input.value))} ${escapeHtml(input.unit)}`} · ${input.kind === "assumed" ? "가정" : input.kind === "derived" ? "출처에서 변환" : "공개 참고값"}
      · ${escapeHtml(input.assumption_reason ?? input.transform)} · ${escapeHtml(input.period)} · ${escapeHtml(input.geography)} · ${escapeHtml(input.tax_basis)}
      · 의존 입력 ${escapeHtml(input.depends_on_input_ids.join(", ") || "없음")}</p>`).join("")}
    <p>원본 사례 ${escapeHtml(c.sourceCaseId)} · 원본 SHA-256 ${escapeHtml(c.originalSha256)} · provenance SHA-256 ${escapeHtml(c.provenanceSha256)} · manifest ${escapeHtml(c.provenanceManifestSha256)}</p>
    <p>고정 입력 ${escapeHtml(c.fixtureSha256)} · manifest ${escapeHtml(c.manifestSha256)} · 구현 ${escapeHtml(c.implementation.sha256)} · 모델 ${escapeHtml(c.model_version)}</p>
    <p>저장 아티팩트 ${escapeHtml(research.artifactSha256)} · 평가 입력 결합 ${escapeHtml(attachment.binding.inputRevision)}</p>
    </details></section>`;
}
export function researchDirectory(research: CaseResearchReport): string {
  const directory = research.attachment.processors;
  return `<section id="directory"><h2>처분 문의 후보</h2>
    <p>기계적 재활용 시설 근거 없음. 다음은 처분 상담을 위한 명부 행이며 허가·인수를 검증한 시설 목록이 아닙니다. 복수 등재 행은 독립 시설 수가 아닙니다. 같은 회사의 행을 합치지 않았습니다.</p>
    <p>소각 등재는 에너지 회수 확인이 아닙니다. 이 명부를 WARM 에너지 회수 시설 능력과 연결하지 않습니다. 사무실 주소는 시설 위치·거리 근거가 아닙니다.</p>
    ${originalLink(directory.source.url, directory.source.title)}<p>명부 기준일 ${escapeHtml(directory.source.sourceDate ?? "미확인")} · 업체별 등재·갱신일 미확인 · 사용권 ${escapeHtml(directory.source.license ?? "미확인")}</p>
    ${directory.rows.map(row => `<section data-directory-row="${row.listing.rowNumber}"><h3>${escapeHtml(row.listing.name)} · 명부 ${row.listing.rowNumber}행</h3>
      <p>${escapeHtml(row.listing.description)} · 명부 기준일 ${escapeHtml(row.listing.sourceDate)} · ${escapeHtml(row.listing.district)}</p>
      <p>명부상 사무실 ${escapeHtml(row.listing.officeAddress)} · 영업권역 ${escapeHtml(row.listing.serviceArea || "미확인")}</p>
      <p>허가 미확인 · 인수 미확인 · 사례 폐기물 코드 미확인 · 시설 위치·거리 미확인</p>
      <details><summary>명부 행 출처 확인하기</summary><p>출처 ${escapeHtml(row.listing.sourceId)} · 행 SHA-256 ${escapeHtml(row.rowSha256)}</p></details></section>`).join("")}
    ${list(directory.missing)}<details><summary>명부 선택·제외 내역 확인하기</summary>
    ${list(directory.excludedRows.map(row => `${row.rowNumber}행: ${row.reason === "municipal-collection-only" ? "생활폐기물 수집운반 전용" : "명시된 영업권역과 사례 지역 불일치"}`))}
    <p>정제 명부 SHA-256 ${escapeHtml(directory.datasetSha256)} · 원본 SHA-256 ${escapeHtml(directory.source.derivedFrom)} · manifest ${escapeHtml(directory.sourceManifestSha256)}</p></details></section>`;
}
