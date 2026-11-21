import type { CaseResearchReport } from "./o-case-research-schema.ts";
import type { PublicInputScenario } from "./o-input-public-scenario.ts";
import { escapeHtml, list, safeLink } from "./report-html.ts";
import recyclingDirectory from "../data/reference/public-recycling-candidates-20261121.json" with { type: "json" };
import domestic from "../data/reference/domestic-scenario-context-20261121.json" with { type: "json" };

const routeNames = { recycling: "재활용 시나리오", landfill: "매립 시나리오", energy_recovery: "에너지 회수 시나리오" } as const;
export { routeNames as publicScenarioNames };
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
function domesticContext(material: string, inputs: PublicInputScenario["calculations"]["inputs"]): string {
  const warm = inputs.find(input => input.input_id === `warm.${material}.energy_recovery`);
  const electricity = domestic.electricity, waste = domestic.incinerationParameters, fee = domestic.municipalFee;
  const epd = domestic.epdTreatmentReference;
  return `<section aria-label="국내와 미국 계수의 범위"><h3>탄소 계수의 국내·미국 범위</h3>
    <div class="table-wrap" role="region" aria-label="계수와 단위 비교" tabindex="0"><table><thead><tr><th>공개 근거</th><th>값·단위</th><th>계산 경계</th></tr></thead><tbody>
    <tr><td>미국 WARM ${escapeHtml(material)} 에너지 회수</td><td>${warm?.value == null ? "미확보" : escapeHtml(String(warm.value))} MTCO2e/short ton</td><td>운송·에너지 대체 크레딧을 포함한 순 전과정 시나리오</td></tr>
    <tr><td>국내 전력 소비단 · 2025 승인</td><td>${electricity.value} ${electricity.unit}</td><td>2023년 전력 사용의 간접 배출</td></tr>
    <tr><td>국내 폐합성수지 소각 · 2024 승인</td><td>DM ${waste.dryMatterFraction}<br>CF ${waste.carbonFraction}<br>${waste.unit}</td><td>건조물질·탄소 함량 매개변수</td></tr>
    </tbody></table></div>
    <p>국내 전과정 탄소량: 미산정. 단위·활동·경계가 달라 위 값을 직접 빼거나 WARM을 대체하지 않습니다.</p>
    <details><summary>국내 공개 EPD 참고계수 3행 · 혼합폐플라스틱 · 계산 미사용</summary>
      <p>${escapeHtml(epd.boundary)} ${escapeHtml(epd.missing)}</p>
      <div class="table-wrap" role="region" aria-label="EPD 원문 참고계수" tabindex="0"><table><thead><tr><th>원문 범주</th><th>기준 단위</th><th>탄소발자국 (${escapeHtml(epd.carbonUnit)})</th></tr></thead><tbody>
      ${epd.rows.map(row => `<tr data-epd-reference="${row.excelRow}"><td>${escapeHtml(row.label)}</td><td>${epd.sourceUnit}</td><td><data value="${row.carbonFootprint}">약 ${row.carbonFootprint.toLocaleString("ko-KR", { maximumFractionDigits: 6 })}</data></td></tr>`).join("")}
      </tbody></table></div>
      ${originalLink(epd.url, epd.title)} ${originalLink(epd.documentUrl, "원본 계수 파일")}
      <p>제정 ${epd.establishedAt} · ${escapeHtml(epd.sheet)} · ${escapeHtml(epd.locator)} · 화면은 소수6자리 반올림</p>
      <p>${escapeHtml(epd.license)} · 원본 SHA-256 ${epd.sha256}</p>
    </details>
    <p>재사용은 용도·기준 충족 자료와 동일 경계의 비용·탄소 자료가 없어 이 수치표에서 제외했습니다. 0으로 간주하지 않으며, 기존 재사용 경로의 확인 필요 상태를 유지합니다.</p>
    <details><summary>국내 계수 출처와 미산정 사유</summary>
      ${originalLink(electricity.url, electricity.title)}<p>${escapeHtml(electricity.locator)} · ${escapeHtml(electricity.boundary)} ${escapeHtml(electricity.missing)}</p>
      ${originalLink(waste.url, waste.title)}<p>${escapeHtml(waste.locator)} · ${escapeHtml(waste.boundary)} ${escapeHtml(waste.missing)}</p>
      <p>조회 ${domestic.retrievedAt} · 전력 원본 SHA-256 ${electricity.sha256} · 소각 매개변수 원본 SHA-256 ${waste.sha256}</p></details>
    <details><summary>소각 처리비가 미산정인 이유와 공개 반입요금</summary>
      <p>사업장 폐플라스틱에 적용할 소각비는 여전히 미확보입니다. ${escapeHtml(fee.missing)}</p>
      <p>별도 참고: 인천 생활폐기물 ${fee.value.toLocaleString("ko-KR")} ${fee.unit} (${fee.announcedEffectiveFrom} 공표 적용일). ${escapeHtml(fee.boundary)}</p>
      ${originalLink(fee.url, fee.title)}<p>발표 ${fee.publishedAt} · ${escapeHtml(fee.locator)} · ${escapeHtml(fee.license)}</p>
      ${originalLink(fee.eligibilityUrl, "반입 자격·제한 조례")}<p>${escapeHtml(fee.eligibilityLocator)}. 시설 소재지 외 자치구 가산금 등은 별도이며 이 사례의 수수료로 대입하지 않았습니다.</p>
    </details></section>`;
}
export function publicInputCalculations(scenario: PublicInputScenario): string {
  const c = scenario.calculations;
  return `<section id="public-input-scenario" aria-labelledby="public-input-heading"><h2 id="public-input-heading">${escapeHtml(scenario.material)} ${scenario.userMassKg} kg 공개 시나리오</h2>
    <p>${escapeHtml(scenario.label)} · 깨끗한 단일 수지 가정에 사용자 질량만 적용했습니다. 실제 오염·허가·인수 적합성을 뜻하지 않습니다.</p>
    <p>미국 WARM 순 전과정 탄소 · 현장 미검증. 보류·추천 상태와 실행 승인 여부는 바뀌지 않습니다.</p>
    <div class="table-wrap" role="region" aria-label="일반 입력 공개 비용·탄소" tabindex="0"><table><thead><tr><th>대안</th><th>순비용</th><th>순탄소</th></tr></thead><tbody>${c.results.map(result => `<tr data-public-scenario-result="${result.route_id}"><td data-label="대안">${routeNames[result.route_id]}</td><td data-label="순비용">${value(result.display.net_cost_krw, "KRW", result.missing_inputs.cost)}</td><td data-label="순탄소">${value(result.display.net_carbon_kgco2e, "kgCO2e", result.missing_inputs.carbon)}</td></tr>`).join("")}</tbody></table></div>
    <details><summary>사용자 질량·원본 가정·계산 출처 확인하기</summary>
      ${list(scenario.assumptions)}<p>현재 입력 질량 ${scenario.userMassKg} kg · 평가일 ${escapeHtml(scenario.binding.assessmentDate)}. 아래 원본 템플릿의 공정·오염·지역·질량은 현재 사례의 사실이 아닙니다.</p>
      ${scenario.material === "HDPE" ? "<p>HDPE 가격은 일반 PE 참고가격을 대용했습니다.</p>" : ""}
      ${c.cases.map(item => `<p>부모 템플릿: ${escapeHtml(item.original.description)} · 원본 질량 ${item.original.massKg} kg.</p>`).join("")}
      ${c.inputs.map(input => `<p>${escapeHtml(input.input_id)}: ${input.value === null ? `미확보 (${escapeHtml(input.missing_reason ?? "지원값 없음")})` : `${input.value} ${escapeHtml(input.unit)}`} · ${escapeHtml(input.assumption_reason ?? input.transform)}</p>`).join("")}
      ${c.sources.map(source => `<p>${originalLink(source.url, source.title)} · ${escapeHtml(source.published_or_period)} · ${escapeHtml(source.locator)} · ${escapeHtml(source.boundary)}</p>`).join("")}
      <p>입력 결합 ${escapeHtml(scenario.binding.inputRevision)} · 파생 데이터 ${scenario.provenance.derivedDatasetSha256} · 파생 전제 ${scenario.provenance.derivedProvenanceSha256}</p>
      <p>부모 고정 입력 ${scenario.provenance.parentFixtureSha256} · 부모 원본 ${scenario.provenance.parentOriginalSha256}. 파생 데이터는 고정 연구 아티팩트가 아닙니다.</p>
      <p>WARM·Wonju 자료의 상업 이용·재배포 권리 미확인. 인증된 비공개 연구 표시이며 상업용 보고서와 모델 전송에서 제외합니다.</p>
    </details>${domesticContext(scenario.material, c.inputs)}</section>`;
}
export function researchCalculations(research: CaseResearchReport): string {
  const { attachment } = research;
  const c = attachment.calculations;
  return `<section id="research-calculations" aria-labelledby="research-heading"><h2 id="research-heading">${escapeHtml(c.cases[0].material)} 공개 자료 기반 연구 계산</h2>
    <p><strong>${escapeHtml(attachment.label)}</strong> · ${escapeHtml(attachment.status)}</p>
    <p>같은 ${escapeHtml(c.cases[0].material)} ${escapeHtml(String(c.cases[0].original.massKg ?? "질량 미확보"))} kg 시나리오의 대안 비교입니다. 탄소는 미국 WARM 계수이며 국내 실측값이 아닙니다.</p>
    <div class="table-wrap" role="region" aria-label="공개 시나리오 비용·탄소 비교" tabindex="0"><table><thead><tr><th>대안</th><th>순비용</th><th>순탄소</th></tr></thead><tbody>${c.results.map(result => `<tr><td data-label="대안">${routeNames[result.route_id]}</td><td data-label="순비용">${value(result.display.net_cost_krw, "KRW", result.missing_inputs.cost)}</td><td data-label="순탄소">${value(result.display.net_carbon_kgco2e, "kgCO2e", result.missing_inputs.carbon)}</td></tr>`).join("")}</tbody></table></div>
    <details><summary>계산 가정·출처·적용 범위 확인하기</summary>
    <p>공개 시나리오 원본 ${escapeHtml(c.sourceCaseId)} · ${escapeHtml(c.cases[0].original.description)} · 질량 ${escapeHtml(String(c.cases[0].original.massKg ?? "미확보"))} kg · 지역 ${escapeHtml(c.cases[0].original.region ?? "미확보")}. 합성 시나리오 입력이며 실제 견적이 아닙니다.</p>
    <p>평가 기준일 ${escapeHtml(attachment.binding.assessmentDate)} · 법령 시행본 ${escapeHtml(c.cases[0].law_version)}. 연구 숫자는 추천 순위·확신도를 바꾸지 않으며 운영 견적이 아닙니다.</p>
    <p>WARM·Wonju 자료의 상업 이용·재배포 권리 미확인. 인증된 비공개 연구 표시만 제공하며 상업용 보고서·모델 전송에서 제외합니다.</p>
    <p>미국 기본 조건의 WARM 순 전과정 시나리오입니다. 국내 시설의 실측 배출이나 감축 실적이 아닙니다. 기간·GWP·운송 포함 경계 차이로 직접 비교에 한계가 있습니다. 음의 순비용은 계약 이익이 아니며 음의 배출은 탄소 제거가 아닙니다.</p>
    <p>합성 제조 자투리를 단일 수지로 보고 미국의 소비 후 폐플라스틱 폐쇄형 재활용 모형에 가정으로 대응했습니다. 잔재물도 같은 수지로 가정합니다.</p>
    ${c.cases[0].material === "HDPE" ? '<p>HDPE 가격에는 일반 PE(generic PE) 참고가격을 대용했습니다. HDPE 개별 계약가격이 아닙니다.</p>' : ""}
    </details>${domesticContext(c.cases[0].material, c.inputs)}<details><summary>경로별 세부 수치·한계 확인하기</summary>${c.results.map(result => `<section data-research-result="${result.route_id}"><h3>${routeNames[result.route_id]}</h3>
      <p><strong>${escapeHtml(result.label)}</strong> · 시나리오 추정, 현장 미검증</p>
      <dl><dt>순비용</dt><dd>${value(result.display.net_cost_krw, "KRW", result.missing_inputs.cost)}</dd>
      <dt>순탄소</dt><dd>${value(result.display.net_carbon_kgco2e, "kgCO2e", result.missing_inputs.carbon)}</dd>
      <dt>매립 기준 비용 차이</dt><dd>${value(result.display.cost_saving_krw, "KRW", result.missing_inputs.cost)}</dd>
      <dt>매립 기준 탄소 차이</dt><dd>${value(result.display.scenario_carbon_difference_kgco2e, "kgCO2e", result.missing_inputs.carbon)}</dd></dl>
      <p>운송 별도 진단: 자료 없음 · 이 모델에 포함하지 않음. WARM에 포함된 운송 경계를 별도 운송 수치로 대체·중복 합산하지 않습니다.</p></section>`).join("")}
    <ul><li>이 계산은 반출·허가·인수·법적 승인이나 실제 계약·실측 절감 실적을 확인한 결과가 아닙니다.</li>
      <li>국내 GIR 전력 계수는 활동량 모형 없이 플라스틱의 전 처리 경로 계수로 대체할 수 없어 사용하지 않았습니다. 사용권도 미확인입니다.</li>
      <li>상업용 사용이 금지된 KEITI 국가 LCI는 제외했습니다. 영국 보고용 계수도 사용하지 않았습니다.</li>
      <li>탄소 비교는 같은 고정 WARM 버전·표·지역·단위·계산 경계 안에서만 해석하세요. 다른 GWP 기준으로 보정하지 않았습니다.</li></ul></details>
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
    <p>연구 표시 자료 SHA-256 ${escapeHtml(research.artifactSha256)} · 평가 입력 결합 ${escapeHtml(attachment.binding.inputRevision)}</p>
    </details></section>`;
}
function regionComparison(region: string | null | undefined, address: string): string {
  const province = /^(?:대한민국\s+)?([가-힣]+?(?:특별자치도|특별자치시|특별시|광역시|도))/u;
  const reported = region?.trim().match(province)?.[1] ?? null;
  const listed = address.trim().match(province)?.[1] ?? null;
  const state = reported === null || listed === null ? "unknown" : reported === listed ? "same" : "different";
  const labels = { unknown: "비교 불가", same: "일치", different: "불일치" } as const;
  return `<p data-region-comparison="${state}">시·도 표기 ${labels[state]} · 사례 ${escapeHtml(reported ?? "전체 표기 미확인")} / 명부 ${escapeHtml(listed ?? "전체 표기 미확인")}. 주소 표기만 비교하며 운송 거리·영업권역·인수 적합성은 판단하지 않습니다.</p>`;
}
export function researchDirectory(research: CaseResearchReport, inquiryTarget?: string, caseRegion?: string | null): string {
  const directory = research.attachment.processors;
  return `<section id="directory"><h2>처분 문의 후보</h2>
    <p>기계적 재활용 시설 근거 없음. 다음은 처분 상담을 위한 명부 행이며 허가·인수를 검증한 시설 목록이 아닙니다. 복수 등재 행은 독립 시설 수가 아닙니다. 같은 회사의 행을 합치지 않았습니다.</p>
    <p>소각 등재는 에너지 회수 확인이 아닙니다. 이 명부를 WARM 에너지 회수 시설 능력과 연결하지 않습니다. 사무실 주소는 시설 위치·거리 근거가 아닙니다.</p>
    ${originalLink(directory.source.url, directory.source.title)}<p>명부 기준일 ${escapeHtml(directory.source.sourceDate ?? "미확인")} · 업체별 등재·갱신일 미확인 · 사용권 ${escapeHtml(directory.source.license ?? "미확인")}</p>
    ${directory.rows.map(row => `<section data-directory-row="${row.listing.rowNumber}"><h3>${escapeHtml(row.listing.name)} · 명부 ${row.listing.rowNumber}행</h3>
      <p>${escapeHtml(row.listing.description)} · 명부 기준일 ${escapeHtml(row.listing.sourceDate)} · ${escapeHtml(row.listing.district)}</p>
      <p>명부상 사무실 ${escapeHtml(row.listing.officeAddress)} · 영업권역 ${escapeHtml(row.listing.serviceArea || "미확인")}</p>
      ${regionComparison(caseRegion, row.listing.officeAddress)}
      <p>허가 미확인 · 인수 미확인 · 사례 폐기물 코드 미확인 · 시설 위치·거리 미확인</p>
      <details><summary>명부 행 출처 확인하기</summary><p>출처 ${escapeHtml(row.listing.sourceId)} · 행 SHA-256 ${escapeHtml(row.rowSha256)}</p></details></section>`).join("")}
    ${list(directory.missing)}<details><summary>명부 선택·제외 내역 확인하기</summary>
    ${list(directory.excludedRows.map(row => `${row.rowNumber}행: ${row.reason === "municipal-collection-only" ? "생활폐기물 수집운반 전용" : "명시된 영업권역과 사례 지역 불일치"}`))}
    <p>정제 명부 SHA-256 ${escapeHtml(directory.datasetSha256)} · 원본 SHA-256 ${escapeHtml(directory.source.derivedFrom)} · manifest ${escapeHtml(directory.sourceManifestSha256)}</p></details></section>
    ${publicRecyclingDirectory(inquiryTarget, caseRegion)}`;
}
export function publicRecyclingDirectory(inquiryTarget?: string, caseRegion?: string | null): string {
  return `<section id="recycling-directory"><h2>${escapeHtml(recyclingDirectory.label)}</h2>
    ${originalLink(recyclingDirectory.source.url, recyclingDirectory.source.title)}
    <p>명부 기준일 ${escapeHtml(recyclingDirectory.source.sourceDate)} · 조회 ${escapeHtml(recyclingDirectory.source.retrievedAt)}
      · 수집 근거 ${escapeHtml(recyclingDirectory.source.collectionBasis)} · 사용권 ${escapeHtml(recyclingDirectory.source.license)}</p>
    ${list(recyclingDirectory.limitations)}
    ${recyclingDirectory.rows.map(row => `<section data-recycling-directory-row="${row.rowNumber}"><h3>${escapeHtml(row.name)} · 원본 명부 ${row.rowNumber}행</h3>
      <p>업종 ${escapeHtml(row.activity)} · 대상폐기물 ${escapeHtml(row.wasteScope)}</p>
      <p>명부상 소재지 ${escapeHtml(row.address)} · 행 기준일 ${escapeHtml(row.sourceDate)}</p>
      ${regionComparison(caseRegion, row.address)}
      <p data-permit-listed>허가 공개자료 확인 · ${escapeHtml(row.sourceDate)} 기준 명부 등재</p>
      <p data-acceptance-unverified><strong>인수 의사 미확인</strong></p>
      <p>현재 허가 유효성·영업 미확인 · 사례 지역·운송·수지·오염 조건 적합성 미확인</p>
      ${inquiryTarget ? `<p class="screen-only"><a href="${escapeHtml(inquiryTarget)}?recipient=${encodeURIComponent(row.name)}">이 업체에 문의서 준비</a></p>` : ""}</section>`).join("")}
    <details><summary>재활용업 명부 출처 확인하기</summary>
      <p>원본 ${escapeHtml(recyclingDirectory.source.originalFilename)} · 제공기관 ${escapeHtml(recyclingDirectory.source.publisher)}
      · 원본 지역 ${escapeHtml(recyclingDirectory.source.geographicScope)}</p>
      <p>원본 SHA-256 ${escapeHtml(recyclingDirectory.source.rawSha256)} · 첨부 ${escapeHtml(recyclingDirectory.source.attachmentId)}</p>
      ${originalLink(recyclingDirectory.source.licenseUrl, "사용권 안내 열기")}</details></section>`;
}
