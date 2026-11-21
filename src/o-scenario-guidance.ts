import type { CaseResearchAttachment } from "./o-case-research-schema.ts";
import type { PublicInputScenario } from "./o-input-public-scenario.ts";
import { buildPublicCalculations } from "./o-public-calculation-engine.ts";
import type { VerifiedPublicDataset } from "./o-public-calculation-data.ts";
import type { PublicCalculationResult } from "./o-public-calculation-schema.ts";
import { revision } from "./o-validation.ts";

type ScenarioRoute = PublicCalculationResult["route_id"];

export interface ScenarioDifference {
  readonly routeId: ScenarioRoute;
  /** Comparator minus first: positive means first uses less money/carbon. */
  readonly costAdvantageKrw: number | null;
  readonly carbonAdvantageKgCo2e: number | null;
  readonly costAdvantageLowerBoundKrw: number | null;
  readonly unavailableReasons: readonly string[];
}

export interface ScenarioGuidance {
  readonly purpose: "hypothetical-comparison-only";
  readonly use: {
    readonly display: "authenticated-research";
    readonly storage: "excluded";
    readonly commercialExport: "excluded";
    readonly modelTransmission: "excluded";
  };
  readonly status: "conditionally-optimal" | "unavailable";
  readonly summary: string;
  readonly objective: string;
  readonly boundary: string | null;
  readonly assumptions: readonly string[];
  /** Complete, comparable modeled rows only; never actual route recommendations. */
  readonly comparisonOrder: readonly ScenarioRoute[];
  readonly firstRouteId: ScenarioRoute | null;
  readonly hypotheticalRunnerUpRouteId: ScenarioRoute | null;
  readonly comparedRouteIds: readonly ScenarioRoute[];
  readonly differences: readonly ScenarioDifference[];
  readonly feeBound: {
    readonly inputId: "f_inc";
    readonly actualValue: null;
    readonly unit: "KRW/t";
    readonly sufficientMinimum: number;
    readonly assumedMinimum: 0;
    readonly sufficientUnderAssumption: boolean;
    readonly formula: "(first_cost - engine_cost_at_f_inc_0) / mass_t";
    readonly probe: "hypothetical-zero-fee-not-observed";
  } | null;
  readonly provenance: {
    readonly parentFixtureSha256: string;
    readonly parentManifestSha256: string;
    readonly preparedDatasetSha256: string;
    readonly probeDatasetSha256: string | null;
    readonly probeProvenanceSha256: string | null;
  };
  readonly unavailableReasons: readonly string[];
}

/** Receives a host-prepared context only. No catalog IO, persisted artifact enrichment or actual fee substitution. */
export function buildScenarioGuidance(context: PublicInputScenario | CaseResearchAttachment): ScenarioGuidance {
  const calculations = context.calculations;
  const selected = calculations.cases[0];
  const rows = calculations.results.filter(row => row.case_id === selected?.case_id);
  const baseData = { schema_version: 1 as const, model_version: calculations.model_version,
    sources: calculations.sources, inputs: calculations.inputs, cases: calculations.cases,
    limitations: calculations.limitations };
  const parentFixtureSha256 = context.purpose === "input-public-scenario"
    ? context.provenance.parentFixtureSha256 : context.calculations.fixtureSha256;
  const parentManifestSha256 = context.purpose === "input-public-scenario"
    ? context.provenance.parentManifestSha256 : context.calculations.manifestSha256;
  const preparedDatasetSha256 = context.purpose === "input-public-scenario"
    ? context.provenance.derivedDatasetSha256 : context.calculations.fixtureSha256;
  const assumptions = [
    "공개 시나리오의 수율·가격·거리·수거·선별·처리비와 WARM 계수를 고정합니다. 현장 관측값이나 견적이 아닙니다.",
    "이 충분조건은 실제 소각비 f_inc가 null인 입력에 한정됩니다. f_inc >= 0 KRW/t는 관측값이 아닌 명시적인 가정입니다.",
    "비용(KRW)과 탄소(kgCO2e)를 각각 최소화하며 가중합을 만들지 않습니다.",
    "미국 WARM 경계·내재 운송·재활용 배분 가정을 유지합니다. 수율은 실제 대체율 검증이 아닙니다.",
    "모델링한 세 경로만 비교합니다. 실제 허가·업체 인수·실행 승인 또는 실제 추천 2순위를 뜻하지 않습니다.",
    "comparisonOrder와 가상 차순위는 비용·탄소가 모두 확보된 행 사이의 순서이며 누락 비용 경로를 포함한 전체 차순위가 아닙니다.",
  ];
  const base = {
    purpose: "hypothetical-comparison-only", use: { display: "authenticated-research", storage: "excluded",
      commercialExport: "excluded", modelTransmission: "excluded" },
    objective: "같은 기능단위·계산 경계에서 비용과 탄소를 각각 최소화하는 약우월성",
    boundary: rows[0]?.carbon_boundary_id ?? null, assumptions,
    comparedRouteIds: rows.map(row => row.route_id),
    provenance: { parentFixtureSha256, parentManifestSha256, preparedDatasetSha256,
      probeDatasetSha256: null, probeProvenanceSha256: null },
  } as const;
  const unavailable = (reasons: readonly string[]): ScenarioGuidance => ({
    ...base, status: "unavailable", summary: "현재 경계와 미확보값으로 조건부 최적 경로를 증명할 수 없습니다.",
    comparisonOrder: [], firstRouteId: null, hypotheticalRunnerUpRouteId: null,
    differences: [], feeBound: null, unavailableReasons: reasons,
  });
  if (selected === undefined || calculations.cases.length !== 1 || selected.mass_t === null || selected.mass_t <= 0
    || !Number.isFinite(selected.mass_t) || !["PET", "HDPE"].includes(selected.material)) {
    return unavailable(["단일 PET/HDPE 시나리오와 양의 질량이 필요합니다. 혼합·미확인 수지는 수치 대응하지 않습니다."]);
  }
  if (rows.length !== 3 || new Set(rows.map(row => row.route_id)).size !== 3
    || rows.some(row => row.carbon_boundary_id !== base.boundary || row.net_carbon_kgco2e === null
      || !Number.isFinite(row.net_carbon_kgco2e))) {
    return unavailable(["세 모델 경로 모두의 동일 경계 탄소값이 필요합니다. 누락 차원을 임의로 채우지 않습니다."]);
  }
  const fee = calculations.inputs.find(item => item.input_id === "f_inc");
  const incineration = rows.find(row => row.route_id === "energy_recovery");
  if (fee?.value !== null || incineration?.net_cost_krw !== null
    || incineration.missing_inputs.cost.length !== 1 || incineration.missing_inputs.cost[0] !== "missing:f_inc") {
    return unavailable(["이 충분조건은 실제 f_inc=null이고 소각 비용에서 f_inc만 미확보인 고정 모델에 한정됩니다."]);
  }
  const complete = rows.filter(row => row.net_cost_krw !== null && Number.isFinite(row.net_cost_krw));
  if (complete.length !== 2) return unavailable(["소각비 외의 비용 미확보값이 있어 충분한 경계를 만들 수 없습니다."]);
  // First must weakly dominate every other known cost and every modeled carbon,
  // not just a scalar sorting key. The missing incineration cost is bounded below separately.
  const first = complete.find(candidate => complete.every(other =>
    candidate.net_cost_krw !== null && other.net_cost_krw !== null && candidate.net_cost_krw <= other.net_cost_krw)
    && rows.every(other => candidate.net_carbon_kgco2e !== null && other.net_carbon_kgco2e !== null
      && candidate.net_carbon_kgco2e <= other.net_carbon_kgco2e));
  if (first === undefined || first.net_cost_krw === null || first.net_carbon_kgco2e === null) {
    return unavailable(["비용·탄소 간 상충이 있어 가중치 없는 전체 약우월 경로가 없습니다."]);
  }
  const probeData = { ...structuredClone(baseData), inputs: baseData.inputs.map(item => item.input_id === "f_inc"
    ? { ...structuredClone(item), value: 0, assumption_reason: "hypothetical-zero-fee-not-observed" } : structuredClone(item)) };
  const implementation = context.purpose === "input-public-scenario" ? context.provenance.implementation
    : context.calculations.implementation;
  const verifiedProbe: VerifiedPublicDataset = {
    data: probeData, fixture_sha256: revision(probeData),
    manifest_sha256: revision({ parentFixtureSha256, parentManifestSha256, preparedDatasetSha256,
      probeDatasetSha256: revision(probeData), hypothesis: "f_inc=0", implementationSha256: implementation.sha256 }),
    calculator_sha256: implementation.sha256, implementation,
  };
  const zeroCost = buildPublicCalculations(verifiedProbe).results.find(row => row.route_id === "energy_recovery")?.net_cost_krw;
  if (zeroCost === null || zeroCost === undefined || !Number.isFinite(zeroCost)) {
    return unavailable(["기존 엔진의 격리된 0원 소각비 가설 계산에서 절편을 확보하지 못했습니다."]);
  }
  // Existing engine: C_inc(f) = C_inc(0) + mass_t * f. No second calculator.
  const sufficientMinimum = (first.net_cost_krw - zeroCost) / selected.mass_t;
  if (!Number.isFinite(sufficientMinimum)) return unavailable(["유한한 소각비 경계를 계산할 수 없습니다."]);
  const sufficientUnderAssumption = sufficientMinimum <= 0;
  const runnerUp = complete.find(row => row.route_id !== first.route_id);
  const firstCost = first.net_cost_krw, firstCarbon = first.net_carbon_kgco2e;
  const differences = rows.filter(row => row.route_id !== first.route_id).map((row): ScenarioDifference => ({
    routeId: row.route_id,
    costAdvantageKrw: row.net_cost_krw === null ? null : row.net_cost_krw - firstCost,
    carbonAdvantageKgCo2e: row.net_carbon_kgco2e === null ? null : row.net_carbon_kgco2e - firstCarbon,
    costAdvantageLowerBoundKrw: row.route_id === "energy_recovery" ? zeroCost - firstCost : null,
    unavailableReasons: [...row.missing_inputs.cost, ...row.missing_inputs.carbon],
  }));
  const pair = differences.find(row => row.routeId === runnerUp?.route_id);
  return {
    ...base, status: sufficientUnderAssumption ? "conditionally-optimal" : "unavailable",
    summary: sufficientUnderAssumption
      ? `가상 비교 ${first.route_id}는 ${runnerUp?.route_id ?? "비교 행"}보다 비용 ${pair?.costAdvantageKrw ?? 0} KRW·탄소 ${pair?.carbonAdvantageKgCo2e ?? 0} kgCO2e가 낮거나 같고, 나머지 가정을 고정한 f_inc >= 0에서 세 모델 경로에 약우월합니다. 실제 2순위·허가·승인이 아닙니다.`
      : `가상 비교의 ${first.route_id}를 유지하려면 f_inc >= ${sufficientMinimum} KRW/t가 필요합니다. f_inc >= 0만으로 전체 약우월성은 증명되지 않습니다.`,
    firstRouteId: first.route_id, hypotheticalRunnerUpRouteId: runnerUp?.route_id ?? null,
    comparisonOrder: [first.route_id, ...(runnerUp === undefined ? [] : [runnerUp.route_id])],
    differences, feeBound: { inputId: "f_inc", actualValue: null, unit: "KRW/t",
      sufficientMinimum, assumedMinimum: 0, sufficientUnderAssumption,
      formula: "(first_cost - engine_cost_at_f_inc_0) / mass_t", probe: "hypothetical-zero-fee-not-observed" },
    provenance: { ...base.provenance, probeDatasetSha256: verifiedProbe.fixture_sha256,
      probeProvenanceSha256: verifiedProbe.manifest_sha256 },
    unavailableReasons: sufficientUnderAssumption ? [] : ["소각비 하한 0이 충분 경계보다 작아 전체 순위를 보장하지 못합니다."],
  };
}
