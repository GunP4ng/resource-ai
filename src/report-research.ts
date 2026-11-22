import type { CaseResearchReport } from "./o-case-research-schema.ts";
import type { PublicInputScenario } from "./o-input-public-scenario.ts";
import { escapeHtml, list, safeLink } from "./report-html.ts";
import recyclingDirectory from "../data/reference/public-recycling-candidates-20261121.json" with { type: "json" };
import { koreanSourceDate } from "./report-date.ts";
import { displayLocator, displaySourcePeriod, displayUnit } from "./report-copy.ts";
import domestic from "../data/reference/domestic-scenario-context-20261121.json" with { type: "json" };

const routeNames = { recycling: "재활용 시나리오", landfill: "매립 시나리오", energy_recovery: "에너지 회수 시나리오" } as const;
export { routeNames as publicScenarioNames };
const missingNames: Readonly<Record<string, string>> = {
  missing_mass: "질량 없음", "missing:f_inc": "소각 처리비 없음",
  arithmetic_overflow: "값이 계산 범위를 넘었습니다 · 질량과 단위를 확인해 주세요",
  "missing:PP.price": "PP 가격 없음", "missing:PP.y": "PP 수율 없음",
};
function missingReason(reasons: readonly string[]): string {
  return reasons.map(reason => missingNames[reason] ?? (reason.startsWith("missing:") ? `${inputLabel(reason.slice(8))} 없음` : `계산 입력 없음 (${reason})`)).join(" · ") || "표시할 값 없음";
}
function value(display: string | null, unit: string, reasons: readonly string[]): string {
  return display === null ? `자료 없음: ${escapeHtml(missingReason(reasons))}` : `${escapeHtml(display)} ${escapeHtml(displayUnit(unit))}`;
}
const researchFields: Readonly<Record<string, string>> = {
  c: "수집 작업비", s: "선별비", r: "거리당 운송단가",
  d1: "발생지에서 선별장까지 거리", d2: "잔재물의 매립장 운송 거리", d0: "기준 운송 거리",
  f_rec: "재활용 처리비", f_inc: "소각 처리비", f: "매립 처리비", "fee.reference": "공개 처리비 참고값",
};
function inputLabel(id: string): string {
  const material = /^(?:(price|warm)\.)?(PET|HDPE|PP)\.(mass|y|price|recycling|landfill|energy_recovery)$/u.exec(id);
  if (material) {
    const fields: Readonly<Record<string, string>> = { mass: "질량", y: "재활용 배분 비율", price: "매각 참고가격", recycling: "재활용 탄소계수", landfill: "매립 탄소계수", energy_recovery: "에너지 회수 탄소계수" };
    return `${material[2]} ${fields[material[3] ?? ""] ?? "계산 입력"}`;
  }
  const price = /^price\.(PET|HDPE|PP)$/u.exec(id);
  return price ? `${price[1]} 매각 참고가격` : researchFields[id] ?? "계산 입력";
}
const researchText: Readonly<Record<string, string>> = {
  identity: "원본 값 그대로 적용", multiply_by_1000: "1,000배 환산",
  incineration_fee_unavailable: "소각 처리비 자료 없음",
  unverified: "확인 필요", not_applicable: "해당 없음",
  US: "미국", KR: "대한민국", "KR-Wonju": "대한민국 원주", Wonju: "원주",
  "US default": "미국 기본 조건", synthetic_KR: "대한민국 합성 시나리오",
  reference_price: "참고가격", facility_fee: "시설 반입요금",
  "EPA-WARM-v16-US-default-net-lifecycle": "미국 WARM 16판 기본 조건의 순 전과정",
  as_published_not_independently_harmonized: "원문 기준 · 독립적인 통일 환산 없음",
  "Collection work excludes transport": "수집 작업비이며 운송비는 제외합니다.",
  "Sorting includes hypothetical preparation for compressed reference sale form": "압축 참고 판매 형태로 준비하는 비용을 선별비에 가정해 포함합니다.",
  "Hypothetical variable transport rate; minimum dispatch, empty return and fixed charges unverified": "가정한 거리당 운송단가이며 최소 배차·공차 회송·고정비는 확인 필요합니다.",
  "Hypothetical generator to sorting distance": "가정한 발생지에서 선별장까지의 거리입니다.",
  "Hypothetical residue to landfill distance": "가정한 잔재물의 매립장 운송 거리입니다.",
  "Hypothetical baseline distance": "가정한 기준 운송 거리입니다.",
  "Hypothetical purchase with no separate acceptance fee": "별도 반입비 없이 매입한다고 가정합니다.",
  "No incineration cost premise secured": "소각 처리비 전제를 확보하지 못했습니다.",
  "Hypothetically apply Wonju facility-generated business waste fee; eligibility, tax, region, date and polymer applicability unverified": "원주 시설배출 사업장폐기물 요금을 가정해 적용합니다. 반입 자격·세금·지역·날짜·수지 적용 여부는 확인 필요합니다.",
  "Fraction allocated to WARM recycling after sorting; not an extra embedded yield; residue remains the same polymer": "선별 후 WARM 재활용에 배분하는 비율입니다. 별도의 내재 수율을 더하지 않으며 잔재물은 같은 수지로 가정합니다.",
  "Hypothetical reference grade/region/form sale mapping; not a verified batch or contract price. Compressed mixed-colour preparation assumed; VAT/logistics unverified.": "참고 등급·지역·형태의 가격을 가정해 대응했습니다. 개별 물량·계약 가격은 확인 필요하며 혼합색 압축 준비를 가정합니다. 부가세·물류비도 확인 필요합니다.",
};
function researchDisplay(text: string): string {
  return researchText[text] ?? (/[가-힣]/u.test(text) ? text : "원문에서 확인");
}
function researchInput(input: PublicInputScenario["calculations"]["inputs"][number]): string {
  const explanation = input.assumption_reason ?? input.transform;
  const translated = researchText[explanation];
  return `<section data-research-input="${escapeHtml(input.input_id)}"><h4>${escapeHtml(inputLabel(input.input_id))}</h4>
    <p>${input.value === null ? `자료 없음: ${escapeHtml(researchDisplay(input.missing_reason ?? "값 없음"))}` : `${escapeHtml(String(input.value))} ${escapeHtml(displayUnit(input.unit))}`} · ${input.kind === "assumed" ? "가정" : input.kind === "derived" ? "출처에서 변환" : "공개 참고값"}
    · 기간 ${escapeHtml(displaySourcePeriod(input.period))} · 지역 ${escapeHtml(researchDisplay(input.geography))} · 세금 ${escapeHtml(researchDisplay(input.tax_basis))}</p>
    ${translated ? `<p>${escapeHtml(translated)}</p>` : ""}
    <details><summary>계산 입력·가정 원문과 식별자</summary><p>${escapeHtml(input.input_id)} · 원문 단위 ${escapeHtml(input.unit)} · ${escapeHtml(explanation)}</p>
    <p>기간·지역·세금 원문: ${escapeHtml(input.period)} · ${escapeHtml(input.geography)} · ${escapeHtml(input.tax_basis)} · 변환 원문 ${escapeHtml(input.transform)}</p>
    <p>누락 사유 원문 ${escapeHtml(input.missing_reason ?? "없음")} · 의존 입력 ${escapeHtml(input.depends_on_input_ids.join(", ") || "없음")}</p></details></section>`;
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
    <tr><td>미국 WARM ${escapeHtml(material)} 에너지 회수</td><td>${warm?.value == null ? "값 없음" : escapeHtml(String(warm.value))} ${escapeHtml(displayUnit("MTCO2e/US_short_ton"))}</td><td>운송·에너지 대체 크레딧을 포함한 순 전과정 시나리오</td></tr>
    <tr><td>국내 전력 소비단 · 2025 승인</td><td>${electricity.value} ${escapeHtml(displayUnit(electricity.unit))}</td><td>2023년 전력 사용의 간접 배출</td></tr>
    <tr><td>국내 폐합성수지 소각 · 2024 승인</td><td>건조물질 비율 ${waste.dryMatterFraction}<br>탄소 함량 비율 ${waste.carbonFraction}<br>${waste.unit}</td><td>건조물질·탄소 함량 매개변수</td></tr>
    </tbody></table></div>
    <p>국내 전과정 탄소량: 미산정. 위 값은 단위·활동·경계가 서로 달라 참고용으로만 보여 줍니다.</p>
    <details><summary>국내 공개 EPD 참고계수 3행 · 혼합폐플라스틱 · 참고용</summary>
      <p>${escapeHtml(epd.boundary)} ${escapeHtml(epd.missing)}</p>
      <div class="table-wrap" role="region" aria-label="EPD 원문 참고계수" tabindex="0"><table><thead><tr><th>원문 범주</th><th>기준 단위</th><th>탄소발자국 (${escapeHtml(displayUnit(epd.carbonUnit))})</th></tr></thead><tbody>
      ${epd.rows.map(row => `<tr data-epd-reference="${row.excelRow}"><td>${escapeHtml(row.label)}</td><td>${escapeHtml(displayUnit(epd.sourceUnit))}</td><td><data value="${row.carbonFootprint}">약 ${row.carbonFootprint.toLocaleString("ko-KR", { maximumFractionDigits: 6 })}</data></td></tr>`).join("")}
      </tbody></table></div>
      ${originalLink(epd.url, epd.title)} ${originalLink(epd.documentUrl, "원본 계수 파일")}
      <p>제정 ${epd.establishedAt} · ${escapeHtml(epd.sheet)} · ${escapeHtml(epd.locator)} · 소수 6자리 반올림 표시</p>
      <p>${escapeHtml(epd.license)} · 원본 SHA-256 ${epd.sha256}</p>
    </details>
    <p>재사용은 용도·기준 자료와 같은 경계의 비용·탄소 자료가 없어 이 표에서 제외했습니다. 0으로 보지 않으며 재사용 경로는 계속 확인 필요 상태입니다.</p>
    <details><summary>국내 계수 출처와 미산정 사유</summary>
      ${originalLink(electricity.url, electricity.title)}<p>${escapeHtml(electricity.locator)} · ${escapeHtml(electricity.boundary)} ${escapeHtml(electricity.missing)}</p>
      ${originalLink(waste.url, waste.title)}<p>${escapeHtml(waste.locator)} · ${escapeHtml(waste.boundary)} ${escapeHtml(waste.missing)}</p>
      <p>조회 ${escapeHtml(koreanSourceDate(domestic.retrievedAt))} · 전력 원본 SHA-256 ${electricity.sha256} · 소각 매개변수 원본 SHA-256 ${waste.sha256}</p></details>
    <details><summary>소각 처리비가 빈 이유와 공개 반입요금</summary>
      <p>사업장 폐플라스틱 소각비 자료를 확보해야 합니다. ${escapeHtml(fee.missing)}</p>
      <p>참고: 인천 생활폐기물 ${fee.value.toLocaleString("ko-KR")} ${escapeHtml(displayUnit(fee.unit))} (${fee.announcedEffectiveFrom} 공표 적용일). ${escapeHtml(fee.boundary)}</p>
      ${originalLink(fee.url, fee.title)}<p>발표 ${fee.publishedAt} · ${escapeHtml(fee.locator)} · ${escapeHtml(fee.license)}</p>
      ${originalLink(fee.eligibilityUrl, "반입 자격·제한 조례")}<p>${escapeHtml(fee.eligibilityLocator)}. 시설 소재지 외 자치구 가산금 등은 별도입니다. 이 요금은 참고용으로 표시했습니다.</p>
    </details></section>`;
}
export function publicInputCalculations(scenario: PublicInputScenario): string {
  const c = scenario.calculations;
  return `<section id="public-input-scenario" aria-labelledby="public-input-heading"><h2 id="public-input-heading">${escapeHtml(scenario.material)} ${scenario.userMassKg} kg 공개 시나리오</h2>
    <p>${escapeHtml(scenario.label)} · 깨끗한 단일 수지를 가정하고 입력한 질량을 적용했습니다. 오염·허가·인수는 따로 확인하세요.</p>
    <p>미국 WARM 순 전과정 탄소 기준입니다. 보류·추천 상태는 이 계산과 무관하게 유지됩니다.</p>
    <div class="table-wrap" role="region" aria-label="입력 기준 공개 비용·탄소" tabindex="0"><table><thead><tr><th>대안</th><th>순비용</th><th>순탄소</th></tr></thead><tbody>${c.results.map(result => `<tr data-public-scenario-result="${result.route_id}"><td data-label="대안">${routeNames[result.route_id]}</td><td data-label="순비용">${value(result.display.net_cost_krw, "KRW", result.missing_inputs.cost)}</td><td data-label="순탄소">${value(result.display.net_carbon_kgco2e, "kgCO2e", result.missing_inputs.carbon)}</td></tr>`).join("")}</tbody></table></div>
    <details><summary>질량·가정·계산 출처 보기</summary>
      ${list(scenario.assumptions)}<p>입력 질량 ${scenario.userMassKg} kg · 평가일 ${escapeHtml(scenario.binding.assessmentDate)}. 아래 원본 템플릿의 공정·오염·지역·질량은 계산 틀이며, 현재 사례에는 입력 질량만 적용했습니다.</p>
      ${scenario.material === "HDPE" ? "<p>HDPE 가격은 일반 PE 참고가격을 썼습니다.</p>" : ""}
      <details><summary>합성 시나리오 템플릿 원문</summary>${c.cases.map(item => `<p>원본 템플릿: ${escapeHtml(item.original.description)} · 원본 질량 ${item.original.massKg} kg.</p>`).join("")}</details>
      ${c.inputs.map(researchInput).join("")}
      ${c.sources.map(source => `<p>${originalLink(source.url, source.title)} · ${escapeHtml(displaySourcePeriod(source.published_or_period))} · 위치 ${escapeHtml(researchDisplay(displayLocator(source.locator)))} · ${escapeHtml(researchDisplay(source.boundary))}</p><details><summary>출처 기간·위치·경계 원문</summary><p>${escapeHtml(source.published_or_period)} · ${escapeHtml(source.locator)} · ${escapeHtml(source.boundary)}</p></details>`).join("")}
      <p>입력 연결 ${escapeHtml(scenario.binding.inputRevision)} · 파생 데이터 ${scenario.provenance.derivedDatasetSha256} · 파생 전제 ${scenario.provenance.derivedProvenanceSha256}</p>
      <p>원본 고정 입력 ${scenario.provenance.parentFixtureSha256} · 원본 파일 ${scenario.provenance.parentOriginalSha256}. 파생 데이터는 이 화면에서 새로 계산한 값입니다.</p>
      <p>WARM·Wonju 자료는 상업 이용·재배포 권리가 확인되지 않아 로그인한 연구 화면에만 표시하고, 상업용 보고서와 모델 전송에서 뺍니다.</p>
    </details>${domesticContext(scenario.material, c.inputs)}</section>`;
}
export function researchCalculations(research: CaseResearchReport): string {
  const { attachment } = research;
  const c = attachment.calculations;
  return `<section id="research-calculations" aria-labelledby="research-heading"><h2 id="research-heading">${escapeHtml(c.cases[0].material)} 공개 자료 기반 연구 계산</h2>
    <p><strong>${escapeHtml(attachment.label)}</strong> · ${escapeHtml(attachment.status)}</p>
    <p>같은 ${escapeHtml(c.cases[0].material)} ${escapeHtml(String(c.cases[0].original.massKg ?? "질량 없음"))} kg 시나리오의 대안 비교입니다. 탄소는 미국 WARM 계수로 계산했습니다.</p>
    <div class="table-wrap" role="region" aria-label="공개 시나리오 비용·탄소 비교" tabindex="0"><table><thead><tr><th>대안</th><th>순비용</th><th>순탄소</th></tr></thead><tbody>${c.results.map(result => `<tr><td data-label="대안">${routeNames[result.route_id]}</td><td data-label="순비용">${value(result.display.net_cost_krw, "KRW", result.missing_inputs.cost)}</td><td data-label="순탄소">${value(result.display.net_carbon_kgco2e, "kgCO2e", result.missing_inputs.carbon)}</td></tr>`).join("")}</tbody></table></div>
    <details><summary>계산 가정·출처·적용 범위 보기</summary>
    <p>공개 시나리오 원본 ${escapeHtml(c.sourceCaseId)} · 질량 ${escapeHtml(String(c.cases[0].original.massKg ?? "값 없음"))} kg · 지역 ${escapeHtml(c.cases[0].original.region ?? "값 없음")}. 합성 시나리오 입력입니다. 견적은 업체에서 받으세요.</p>
    <details><summary>합성 시나리오 설명 원문</summary><p>${escapeHtml(c.cases[0].original.description)}</p></details>
    <p>평가 기준일 ${escapeHtml(attachment.binding.assessmentDate)} · 법령 시행본 ${escapeHtml(c.cases[0].law_version)}. 추천 순위와 확신도는 이 연구 숫자와 별개로 정해집니다.</p>
    <p>WARM·Wonju 자료는 상업 이용·재배포 권리가 확인되지 않아 로그인한 연구 화면에만 표시하고, 상업용 보고서와 모델 전송에서 뺍니다.</p>
    <p>미국 기본 조건의 WARM 순 전과정 시나리오입니다. 기간·GWP·운송 경계가 국내 자료와 다릅니다. 음의 순비용은 모델상 매각 수입이 큰 경우이고, 음의 배출은 대체 크레딧이 큰 경우입니다.</p>
    <p>합성 제조 자투리를 단일 수지로 보고 미국의 소비 후 폐플라스틱 폐쇄형 재활용 모형에 대응시켰습니다. 잔재물도 같은 수지로 가정합니다.</p>
    ${c.cases[0].material === "HDPE" ? '<p>HDPE 가격에는 일반 PE(generic PE) 참고가격을 썼습니다.</p>' : ""}
    </details>${domesticContext(c.cases[0].material, c.inputs)}<details><summary>경로별 세부 수치 보기</summary>${c.results.map(result => `<section data-research-result="${result.route_id}"><h3>${routeNames[result.route_id]}</h3>
      <p><strong>${escapeHtml(result.label)}</strong> · 시나리오 추정</p>
      <dl><dt>순비용</dt><dd>${value(result.display.net_cost_krw, "KRW", result.missing_inputs.cost)}</dd>
      <dt>순탄소</dt><dd>${value(result.display.net_carbon_kgco2e, "kgCO2e", result.missing_inputs.carbon)}</dd>
      <dt>매립 기준 비용 차이</dt><dd>${value(result.display.cost_saving_krw, "KRW", result.missing_inputs.cost)}</dd>
      <dt>매립 기준 탄소 차이</dt><dd>${value(result.display.scenario_carbon_difference_kgco2e, "kgCO2e", result.missing_inputs.carbon)}</dd></dl>
      <p>운송은 WARM 경계에 포함되어 있어 별도로 더하지 않았습니다.</p></section>`).join("")}
    <ul><li>반출·허가·인수·계약은 이 계산과 별도로 확인하세요.</li>
      <li>국내 GIR 전력 계수는 처리 경로별 활동량 모형이 있어야 쓸 수 있어 참고로만 둡니다. 사용권도 확인이 필요합니다.</li>
      <li>상업용 사용이 금지된 KEITI 국가 LCI는 제외했습니다. 영국 보고용 계수도 사용하지 않았습니다.</li>
      <li>탄소 비교는 같은 WARM 버전·표·지역·단위·계산 경계 안에서 해석하세요.</li></ul></details>
    <details><summary>연구 출처·입력·원본 보기</summary>
    <h3>자료에 기록된 가정·한계 원문</h3>
    ${list(c.cases.map(item => item.material_mapping_assumption))}${list(c.limitations)}
    ${c.sources.map(source => `<section><h3>${escapeHtml(source.title)}</h3>${originalLink(source.url, "계산 출처 원문 열기")}
      <p>${escapeHtml(source.agency)} · ${escapeHtml(displaySourcePeriod(source.published_or_period))} · 위치 ${escapeHtml(researchDisplay(displayLocator(source.locator)))}</p>
      <p>지역 ${escapeHtml(researchDisplay(source.geography))} · 지구온난화지수 ${escapeHtml(researchDisplay(source.gwp))} · 경계 ${escapeHtml(researchDisplay(source.boundary))}</p>
      <details><summary>출처·사용권·한계 원문</summary>
      <p>${escapeHtml(source.published_or_period)} · ${escapeHtml(source.locator)} · ${escapeHtml(source.geography)} · ${escapeHtml(source.gwp)} · ${escapeHtml(source.boundary)}</p>
      <p>${escapeHtml(source.rights_notice_summary)}</p>${originalLink(source.rights_url, "사용권 안내 열기")}
      ${list(source.limitations)}</details><p>출처 ${escapeHtml(source.source_id)} · SHA-256 ${escapeHtml(source.raw_sha256)} · 조회 ${escapeHtml(koreanSourceDate(source.retrieved_at))}</p></section>`).join("")}
    ${c.inputs.map(researchInput).join("")}
    <p>원본 사례 ${escapeHtml(c.sourceCaseId)} · 원본 SHA-256 ${escapeHtml(c.originalSha256)} · 출처 이력 SHA-256 ${escapeHtml(c.provenanceSha256)} · 출처 이력 명세 ${escapeHtml(c.provenanceManifestSha256)}</p>
    <p>고정 입력 ${escapeHtml(c.fixtureSha256)} · 입력 명세 ${escapeHtml(c.manifestSha256)} · 구현 ${escapeHtml(c.implementation.sha256)} · 모델 ${escapeHtml(c.model_version)}</p>
    <p>연구 표시 자료 SHA-256 ${escapeHtml(research.artifactSha256)} · 평가 입력 연결 ${escapeHtml(attachment.binding.inputRevision)}</p>
    </details></section>`;
}
function regionComparison(region: string | null | undefined, address: string): string {
  const province = /^(?:대한민국\s+)?([가-힣]+?(?:특별자치도|특별자치시|특별시|광역시|도))/u;
  const reported = region?.trim().match(province)?.[1] ?? null;
  const listed = address.trim().match(province)?.[1] ?? null;
  const state = reported === null || listed === null ? "unknown" : reported === listed ? "same" : "different";
  const labels = { unknown: "비교 불가", same: "일치", different: "불일치" } as const;
  return `<p data-region-comparison="${state}">시·도 표기 ${labels[state]} · 사례 ${escapeHtml(reported ?? "시·도 표기 없음")} / 명부 ${escapeHtml(listed ?? "시·도 표기 없음")}. 주소의 시·도 표기를 비교했습니다. 운송 거리·영업권역·인수는 업체에 확인하세요.</p>`;
}
export function researchDirectory(research: CaseResearchReport, inquiryTarget?: string, caseRegion?: string | null): string {
  const directory = research.attachment.processors;
  return `<section id="directory"><h2>처분 문의 후보</h2>
    <p>기계적 재활용 시설 근거가 아직 없어 처분 상담용 명부 행을 보여 줍니다. 허가·인수는 업체에 확인하세요. 같은 회사가 여러 행에 나올 수 있습니다.</p>
    <p>소각 등재 업체의 에너지 회수 여부와 실제 시설 위치는 업체에 확인하세요. 표시 주소는 사무실 기준입니다.</p>
    ${originalLink(directory.source.url, directory.source.title)}<p>명부 기준일 ${escapeHtml(koreanSourceDate(directory.source.sourceDate ?? "확인 필요"))} · 업체별 등재·갱신일 없음 · 사용권 ${escapeHtml(directory.source.license ?? "확인 필요")}</p>
    ${directory.rows.map(row => `<section data-directory-row="${row.listing.rowNumber}"><h3>${escapeHtml(row.listing.name)} · 명부 ${row.listing.rowNumber}행</h3>
      <p>${escapeHtml(row.listing.description)} · 명부 기준일 ${escapeHtml(koreanSourceDate(row.listing.sourceDate))} · ${escapeHtml(row.listing.district)}</p>
      <p>명부상 사무실 ${escapeHtml(row.listing.officeAddress)} · 영업권역 ${escapeHtml(row.listing.serviceArea || "확인 필요")}</p>
      ${regionComparison(caseRegion, row.listing.officeAddress)}
      <p>확인 필요: 허가 · 인수 · 폐기물 코드 · 시설 위치·거리</p>
      <details><summary>명부 행 출처 보기</summary><p>출처 ${escapeHtml(row.listing.sourceId)} · 행 SHA-256 ${escapeHtml(row.rowSha256)}</p></details></section>`).join("")}
    ${list(directory.missing)}<details><summary>명부 선택·제외 내역 보기</summary>
    ${list(directory.excludedRows.map(row => `${row.rowNumber}행: ${row.reason === "municipal-collection-only" ? "생활폐기물 수집운반 전용" : "영업권역이 사례 지역과 다름"}`))}
    <p>정제 명부 SHA-256 ${escapeHtml(directory.datasetSha256)} · 원본 SHA-256 ${escapeHtml(directory.source.derivedFrom)} · 출처 명세 ${escapeHtml(directory.sourceManifestSha256)}</p></details></section>
    ${publicRecyclingDirectory(inquiryTarget, caseRegion)}`;
}
export function publicRecyclingDirectory(inquiryTarget?: string, caseRegion?: string | null): string {
  return `<section id="recycling-directory"><h2>${escapeHtml(recyclingDirectory.label)}</h2>
    ${originalLink(recyclingDirectory.source.url, recyclingDirectory.source.title)}
    <p>명부 기준일 ${escapeHtml(koreanSourceDate(recyclingDirectory.source.sourceDate))} · 조회 ${escapeHtml(koreanSourceDate(recyclingDirectory.source.retrievedAt))}
      · 수집 근거 ${escapeHtml(recyclingDirectory.source.collectionBasis)} · 사용권 ${escapeHtml(recyclingDirectory.source.license)}</p>
    ${list(recyclingDirectory.limitations)}
    ${recyclingDirectory.rows.map(row => `<section data-recycling-directory-row="${row.rowNumber}"><h3>${escapeHtml(row.name)} · 원본 명부 ${row.rowNumber}행</h3>
      <p>업종 ${escapeHtml(row.activity)} · 대상폐기물 ${escapeHtml(row.wasteScope)}</p>
      <p>명부상 소재지 ${escapeHtml(row.address)} · 행 기준일 ${escapeHtml(koreanSourceDate(row.sourceDate))}</p>
      ${regionComparison(caseRegion, row.address)}
      <p data-permit-listed>허가 공개자료 확인 · ${escapeHtml(koreanSourceDate(row.sourceDate))} 기준 명부 등재</p>
      <p data-acceptance-unverified><strong>인수 의사는 문의로 확인</strong></p>
      <p>확인 필요: 현재 허가·영업 상태, 사례 지역·운송·재질·품목·오염 조건 적합성</p>
      ${inquiryTarget ? `<p class="screen-only"><a href="${escapeHtml(inquiryTarget)}?recipient=${encodeURIComponent(row.name)}">이 업체에 문의서 준비</a></p>` : ""}</section>`).join("")}
    <details><summary>재활용업 명부 출처 보기</summary>
      <p>원본 ${escapeHtml(recyclingDirectory.source.originalFilename)} · 제공기관 ${escapeHtml(recyclingDirectory.source.publisher)}
      · 원본 지역 ${escapeHtml(recyclingDirectory.source.geographicScope)}</p>
      <p>원본 SHA-256 ${escapeHtml(recyclingDirectory.source.rawSha256)} · 첨부 ${escapeHtml(recyclingDirectory.source.attachmentId)}</p>
      ${originalLink(recyclingDirectory.source.licenseUrl, "사용권 안내 열기")}</details></section>`;
}
