import assert from "node:assert/strict";
import { test } from "node:test";
import { readCaseResearchCatalog } from "../src/o-case-research.ts";
import { buildPublicInputScenario } from "../src/o-input-public-scenario.ts";
import { buildCalculationVariant } from "../src/o-calculation-variant.ts";
import { buildPublicCalculations } from "../src/o-public-calculation-engine.ts";
import type { PublicCalculationResult } from "../src/o-public-calculation-schema.ts";
import { buildScenarioGuidance } from "../src/o-scenario-guidance.ts";
import { buildScenarioSensitivity } from "../src/o-scenario-sensitivity.ts";
import { canonical, revision } from "../src/o-validation.ts";

const catalog = readCaseResearchCatalog();
for (const material of ["PET", "HDPE"] as const) {
  test(`${material} sensitivity uses all nine specified engine hypotheses and preserves actual missing fee`, async () => {
    const source = (await catalog).calculations.data.cases.find(row => row.material === material);
    assert.ok(source);
    const context = buildPublicInputScenario({ actorId: "sensitivity-owner", input: source.original,
      inputRevision: revision(source.original) }, await catalog);
    assert.ok(context);
    const baseline = buildScenarioGuidance(context), before = canonical({ context, baseline });
    const sensitivity = buildScenarioSensitivity(context, baseline);
    assert.ok(sensitivity);
    assert.deepEqual(sensitivity.samples.map(row => [row.allocation, row.priceMultiplier]),
      [[0.6, 0.8], [0.6, 1], [0.6, 1.2], [0.8, 0.8], [0.8, 1], [0.8, 1.2], [1, 0.8], [1, 1], [1, 1.2]]);
    for (const sample of sensitivity.samples) {
      const c = context.calculations;
      const data = { schema_version: 1 as const, model_version: c.model_version, sources: c.sources,
        cases: c.cases, limitations: c.limitations, inputs: c.inputs.map(input => ({
          ...input, value: input.input_id === `${material}.y` ? sample.allocation
            : input.input_id === `${material}.price` ? sensitivity.basePrice * sample.priceMultiplier
              : input.input_id === "f_inc" ? 0 : input.value,
        })) };
      const calculated = buildPublicCalculations({ data, fixture_sha256: revision(data), manifest_sha256: revision(data),
        implementation: context.provenance.implementation, calculator_sha256: context.provenance.implementation.sha256 });
      const first: PublicCalculationResult | undefined = calculated.results.find(row => row.route_id === sensitivity.baselineRouteId);
      const inc = calculated.results.find(row => row.route_id === "energy_recovery");
      assert.ok(first && inc && first.net_cost_krw !== null && first.net_carbon_kgco2e !== null && inc.net_cost_krw !== null);
      const firstCost = first.net_cost_krw, firstCarbon = first.net_carbon_kgco2e;
      const dominates = calculated.results.every(row => row.net_cost_krw !== null && row.net_carbon_kgco2e !== null
        && firstCost <= row.net_cost_krw && firstCarbon <= row.net_carbon_kgco2e);
      assert.equal(sample.retained, dominates);
      if (sample.retained) {
        assert.ok(sample.feeMinimum !== null);
        assert.ok(Math.abs(sample.feeMinimum - (firstCost - inc.net_cost_krw) / (context.userMassKg / 1000)) < 1e-7);
      }
    }
    assert.deepEqual(sensitivity.priceCrossovers.map(row => row.allocation), [0.6, 0.8, 1]);
    for (const boundary of sensitivity.priceCrossovers) {
      assert.ok(boundary.minimumPrice !== null && boundary.minimumPrice > 0);
      for (const offset of [-1, 0, 1]) {
        const variant = buildCalculationVariant(context, [
          { inputId: `${material}.y`, value: boundary.allocation },
          { inputId: `${material}.price`, value: boundary.minimumPrice + offset },
          { inputId: "f_inc", value: 0 },
        ], "가격 경계의 양쪽과 동률을 기존 엔진으로 대조");
        const first = variant.calculations.results.find(row => row.route_id === "recycling");
        const others = variant.calculations.results.filter(row => row.route_id !== "recycling");
        assert.ok(first && first.net_cost_krw !== null && first.net_carbon_kgco2e !== null);
        const cost = first.net_cost_krw, carbon = first.net_carbon_kgco2e;
        const dominated = others.every(row => row.net_cost_krw !== null && row.net_carbon_kgco2e !== null
          && cost <= row.net_cost_krw + 1e-8 && carbon <= row.net_carbon_kgco2e);
        assert.equal(dominated, offset >= 0);
        if (offset === 0) assert.deepEqual(others.filter(row => row.net_cost_krw !== null
          && Math.abs(cost - row.net_cost_krw) < 1e-8).map(row => row.route_id), boundary.limitingRouteIds);
      }
    }
    assert.equal(canonical({ context, baseline }), before);
    assert.equal(context.calculations.inputs.find(row => row.input_id === "f_inc")?.value, null);
    assert.equal(context.calculations.results.find(row => row.route_id === "energy_recovery")?.net_cost_krw, null);
  });
}

test("a lower price sample can lose the sufficient bound while the baseline retains it", async () => {
  const source = (await catalog).calculations.data.cases.find(row => row.material === "PET");
  assert.ok(source);
  const original = buildPublicInputScenario({ actorId: "sensitivity-owner", input: source.original,
    inputRevision: revision(source.original) }, await catalog);
  assert.ok(original);
  const fixedAllocation = buildCalculationVariant(original, [{ inputId: "PET.y", value: 0.8 }], "단가 변화만 검사하기 위한 모델 배분 가정");
  const zero = buildCalculationVariant(fixedAllocation, [{ inputId: "f_inc", value: 0 }], "단가 경계의 계산기 절편");
  const recycling = zero.calculations.results.find(row => row.route_id === "recycling")?.net_cost_krw;
  const incineration = zero.calculations.results.find(row => row.route_id === "energy_recovery")?.net_cost_krw;
  const price = original.calculations.inputs.find(row => row.input_id === "PET.price")?.value;
  const allocation = fixedAllocation.calculations.inputs.find(row => row.input_id === "PET.y")?.value;
  assert.ok(recycling != null && incineration != null && price != null && allocation != null && allocation > 0);
  // The independent engine supplies the price crossover, rather than guessing a fixture amount.
  const crossover = price + (recycling - incineration) / (original.userMassKg / 1000 * allocation);
  assert.ok(crossover > 0);
  const context = buildCalculationVariant(fixedAllocation, [{ inputId: "PET.price", value: crossover * 1.1 }], "단가 경계 위의 회귀 가정");
  const baseline = buildScenarioGuidance(context);
  assert.equal(baseline.status, "conditionally-optimal");
  const result = buildScenarioSensitivity(context, baseline);
  assert.ok(result);
  assert.equal(result.samples.find(row => row.allocation === 0.8 && row.priceMultiplier === 0.8)?.retained, false);
  assert.equal(result.samples.find(row => row.allocation === 0.8 && row.priceMultiplier === 1)?.retained, true);
  assert.equal(buildScenarioSensitivity(original, baseline), null);
  const insufficient = buildCalculationVariant(fixedAllocation, [{ inputId: "PET.price", value: crossover * 0.9 }], "불충분 단가 경계");
  assert.equal(buildScenarioSensitivity(insufficient, buildScenarioGuidance(insufficient)), null);
});
