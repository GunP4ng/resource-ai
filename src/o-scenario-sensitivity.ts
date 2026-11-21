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
    preparedDatasetSha256, sampledOnly: true, samples };
}
