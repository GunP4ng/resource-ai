import { buildCalculationVariant } from "./o-calculation-variant.ts";
import type { CalculationContext } from "./o-calculation-variant.ts";
import { buildScenarioGuidance } from "./o-scenario-guidance.ts";
import type { ScenarioGuidance } from "./o-scenario-guidance.ts";
import { Invalid } from "./o-public-calculation-validation.ts";

export interface ScenarioSensitivity {
  readonly material: "PET" | "HDPE";
  readonly priceInputId: string;
  readonly basePrice: number;
  readonly priceUnit: string;
  readonly baselineRouteId: NonNullable<ScenarioGuidance["firstRouteId"]>;
  readonly preparedDatasetSha256: string;
  readonly sampledOnly: true;
  readonly priceCrossovers: readonly {
    readonly allocation: number;
    readonly minimumPrice: number | null;
    readonly limitingRouteIds: readonly string[];
    readonly unavailableReason: string | null;
    readonly datasetSha256: string;
    readonly provenanceSha256: string;
  }[];
  readonly samples: readonly {
    readonly allocation: number;
    readonly priceMultiplier: number;
    readonly price: number;
    readonly retained: boolean;
    readonly feeMinimum: number | null;
    readonly reasons: readonly string[];
    readonly datasetSha256: string | null;
    readonly provenanceSha256: string | null;
  }[];
}

/** Nine disclosed samples, not an interval proof or observed yield/substitution. */
export function buildScenarioSensitivity(context: CalculationContext, baseline: ScenarioGuidance): ScenarioSensitivity | null {
  const preparedDatasetSha256 = context.purpose === "research-display"
    ? context.calculations.fixtureSha256 : context.provenance.derivedDatasetSha256;
  if (baseline.status !== "conditionally-optimal" || baseline.firstRouteId === null
    || baseline.provenance.preparedDatasetSha256 !== preparedDatasetSha256) return null;
  const material = context.calculations.cases[0]?.material;
  if (material !== "PET" && material !== "HDPE") return null;
  const priceInputId = `${material}.price`;
  const price = context.calculations.inputs.find(input => input.input_id === priceInputId);
  if (price === undefined || price.value === null) return null;
  const basePrice = price.value;
  const priceCrossovers = [0.6, 0.8, 1].map(allocation => {
    const zero = buildCalculationVariant(context, [
      { inputId: `${material}.y`, value: allocation },
      { inputId: priceInputId, value: 0 },
      { inputId: "f_inc", value: 0 },
    ], "가격 교차점 계산을 위한 판매단가 0·소각단가 0 가정. 실제 미확보값은 유지합니다.");
    const rows = zero.calculations.results;
    const recycling = rows.find(row => row.route_id === "recycling");
    const other = rows.filter(row => row.route_id !== "recycling");
    const allocatedMass = zero.calculations.routes.find(row => row.route_id === "recycling")?.mass_flow.recycling_t;
    const receipt = { allocation, datasetSha256: zero.provenance.derivedDatasetSha256,
      provenanceSha256: zero.provenance.derivedProvenanceSha256 };
    const recyclingCost = recycling?.net_cost_krw;
    const recyclingCarbon = recycling?.net_carbon_kgco2e;
    if (baseline.firstRouteId !== "recycling" || recycling === undefined || recyclingCost == null || recyclingCarbon == null
      || allocatedMass == null || allocatedMass <= 0 || other.length !== 2
      || other.some(row => row.net_cost_krw === null || row.net_carbon_kgco2e === null
        || row.carbon_boundary_id !== recycling.carbon_boundary_id || recyclingCarbon > row.net_carbon_kgco2e)) {
      return { ...receipt, minimumPrice: null, limitingRouteIds: [],
        unavailableReason: "동일 경계의 비용·탄소와 양의 재활용 배분 질량이 없어 가격만의 경계를 제시하지 않습니다." };
    }
    // Existing engine has C_recycling(p) = C_recycling(0) - recycling_t * p.
    // The maximum pairwise crossing preserves separate cost/carbon dominance, not a weighted score.
    const crossings = other.flatMap(row => row.net_cost_krw === null ? []
      : [{ routeId: row.route_id, price: (recyclingCost - row.net_cost_krw) / allocatedMass }]);
    const minimumPrice = Math.max(...crossings.map(row => row.price));
    return Number.isFinite(minimumPrice)
      ? { ...receipt, minimumPrice, limitingRouteIds: crossings.filter(row => row.price === minimumPrice).map(row => row.routeId),
        unavailableReason: null }
      : { ...receipt, minimumPrice: null, limitingRouteIds: [], unavailableReason: "유한한 가격 경계를 계산하지 못했습니다." };
  });
  const samples = [0.6, 0.8, 1].flatMap(allocation => [0.8, 1, 1.2].map(priceMultiplier => {
    const common = { allocation, priceMultiplier, price: basePrice * priceMultiplier };
    try {
      const variant = buildCalculationVariant(context, [
        { inputId: `${material}.y`, value: allocation },
        { inputId: priceInputId, value: common.price },
      ], "모델 배분 y=0.6/0.8/1, 가격 배율=0.8/1/1.2의 한정된 민감도 가정");
      const comparison = buildScenarioGuidance(variant);
      return { ...common, retained: comparison.status === "conditionally-optimal"
        && comparison.firstRouteId === baseline.firstRouteId,
      feeMinimum: comparison.feeBound?.sufficientMinimum ?? null,
      reasons: comparison.unavailableReasons,
      datasetSha256: variant.provenance.derivedDatasetSha256,
      provenanceSha256: variant.provenance.derivedProvenanceSha256 };
    } catch (error) {
      if (!(error instanceof Invalid) || !["E_FINITE", "E_MASS"].includes(error.code)) throw error;
      return { ...common, retained: false, feeMinimum: null,
        reasons: ["이 가정의 수치 범위에서 기존 계산기의 유한값·질량 균형을 만족하지 못했습니다."],
        datasetSha256: null, provenanceSha256: null };
    }
  }));
  return { material, priceInputId, basePrice, priceUnit: price.unit, baselineRouteId: baseline.firstRouteId,
    preparedDatasetSha256, sampledOnly: true, samples, priceCrossovers };
}
