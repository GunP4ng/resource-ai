import assert from "node:assert/strict";
import { Type } from "typebox";
import { readPublicCalculationDataset } from "../../../../src/o-public-calculation-data.ts";
import { buildPublicCalculations } from "../../../../src/o-public-calculation-engine.ts";
import { fixtureSchema, PublicCalculationResultSchema, PublicCalculationRouteSchema } from "../../../../src/o-public-calculation-schema.ts";
import type { Dataset, DeepReadonly, PublicCalculationResult } from "../../../../src/o-public-calculation-schema.ts";
import { parse } from "../../../../src/o-public-calculation-validation.ts";
import { design, root, save, hashObject, readJson } from "./local.ts";
import { independentRows, compareNumbers, ranking } from "./oracle.ts";

const provenanceSchema = Type.Object({
  status: Type.Literal("derived_hypothetical_not_verified_catalog"),
  parent_fixture_sha256: Type.String(), parent_manifest_sha256: Type.String(),
  case_id: Type.String(), material: Type.String(), allocation_y: Type.Number(),
  reference_price_multiplier: Type.Number(), price_reference_input_id: Type.String(),
  changes: Type.Array(Type.Object({ input_id: Type.String(), before: Type.Number(), after: Type.Number() })),
});
export const scenarioSchema = Type.Object({
  id: Type.String(), data: fixtureSchema, derived_dataset_sha256: Type.String(),
  provenance: provenanceSchema, provenance_sha256: Type.String(),
  engine_receipt: Type.Object({ fixture_sha256: Type.String(), manifest_sha256: Type.String(), calculator_sha256: Type.String() }),
  results: Type.Array(PublicCalculationResultSchema), routes: Type.Array(PublicCalculationRouteSchema),
  independent: Type.Unknown(), numeric_agreement: Type.Unknown(), ranking: Type.Unknown(),
  deltas_from_original_premise: Type.Unknown(),
});
export const sensitivitySchema = Type.Array(scenarioSchema);
type ExecutedScenario = Omit<DeepReadonly<Type.Static<typeof scenarioSchema>>, "deltas_from_original_premise">;

function premiseDeltas(rows: readonly PublicCalculationResult[], reference: readonly PublicCalculationResult[]) {
  return rows.map(row => {
    const baseline = reference.find(r => r.route_id === row.route_id);
    assert.ok(baseline);
    const difference = (key: "net_cost_krw" | "net_carbon_kgco2e" | "cost_saving_krw" | "scenario_carbon_difference_kgco2e") => {
      const a = row[key], b = baseline[key];
      return a === null || b === null ? null : a - b;
    };
    return { route_id: row.route_id, net_cost_krw: difference("net_cost_krw"),
      net_carbon_kgco2e: difference("net_carbon_kgco2e"), cost_saving_krw: difference("cost_saving_krw"),
      scenario_carbon_difference_kgco2e: difference("scenario_carbon_difference_kgco2e") };
  });
}

export async function runSensitivity() {
  const parent = await readPublicCalculationDataset({ root });
  await save("parent-receipt.json", { ...parent, data: undefined,
    private_evidence_checked: false, validation: "existing loader, public upstream hashes and semantic checks only" });
  const scenarios: ExecutedScenario[] = [];
  for (const material of design.sensitivity.materials) {
    const c = parent.data.cases.find(item => item.material === material);
    assert.ok(c && design.sensitivity.case_ids.includes(c.case_id));
    const originalY = parent.data.inputs.find(i => i.input_id === `${material}.y`);
    const originalPrice = parent.data.inputs.find(i => i.input_id === `${material}.price`);
    assert.ok(originalY?.value !== null && originalY?.value !== undefined);
    assert.ok(originalPrice?.value !== null && originalPrice?.value !== undefined);
    for (const y of design.sensitivity.allocation_y) for (const multiplier of design.sensitivity.reference_price_multipliers) {
      const id = `${material}-y${y}-p${multiplier}`;
      const price = originalPrice.value * multiplier;
      const provenance = {
        status: "derived_hypothetical_not_verified_catalog",
        parent_fixture_sha256: parent.fixture_sha256, parent_manifest_sha256: parent.manifest_sha256,
        case_id: c.case_id, material, allocation_y: y, reference_price_multiplier: multiplier,
        price_reference_input_id: material === "HDPE" ? "price.PE" : "price.PET",
        changes: [{ input_id: originalY.input_id, before: originalY.value, after: y },
          { input_id: originalPrice.input_id, before: originalPrice.value, after: price }],
      } as const;
      const data: Dataset = { ...structuredClone(parent.data), cases: [c],
        inputs: parent.data.inputs.map(i => i.input_id === originalY.input_id
          ? { ...i, value: y, assumption_reason: `${i.assumption_reason}; declared followup allocation grid ${y}` }
          : i.input_id === originalPrice.input_id
          ? { ...i, value: price, assumption_reason: `${i.assumption_reason}; hypothetical reference multiplier ${multiplier}` } : i) };
      const derivedHash = hashObject(data), provenanceHash = hashObject(provenance);
      // The arithmetic API's structural receipt is NOT a validator approval.
      // Use new hashes, never the original verified receipt for modified data.
      const bundle = buildPublicCalculations({ data, fixture_sha256: derivedHash, manifest_sha256: provenanceHash,
        calculator_sha256: parent.calculator_sha256, implementation: parent.implementation });
      const independent = independentRows(data);
      const numeric = independent.map(expected => {
        const actual = bundle.results.find(r => r.route_id === expected.route_id);
        const route = bundle.routes.find(r => r.route_id === expected.route_id);
        assert.ok(actual && route);
        return compareNumbers({ route_id: actual.route_id, metrics: actual, display: actual.display, components: actual.cost_components_krw,
          revenue: actual.revenue_krw, per_tonne: actual.per_tonne, mass_flow: route.mass_flow }, expected);
      });
      scenarios.push({ id, data, derived_dataset_sha256: derivedHash, provenance, provenance_sha256: provenanceHash,
        engine_receipt: { fixture_sha256: bundle.fixture_sha256, manifest_sha256: bundle.manifest_sha256,
          calculator_sha256: bundle.calculator_sha256 }, results: bundle.results, routes: bundle.routes,
        independent, numeric_agreement: numeric, ranking: ranking(bundle.results) });
    }
  }
  assert.equal(scenarios.length, 18);
  await save("sensitivity.json", scenarios.map(scenario => {
    const originalY = parent.data.inputs.find(i => i.input_id === `${scenario.provenance.material}.y`);
    const baseline = scenarios.find(s => s.provenance.material === scenario.provenance.material &&
      s.provenance.allocation_y === originalY?.value && s.provenance.reference_price_multiplier === 1);
    assert.ok(baseline);
    return { ...scenario, deltas_from_original_premise: {
      reference_scenario_id: baseline.id, sign: "scenario minus original premise; null remains unknown",
      rows: premiseDeltas(scenario.results, baseline.results),
    } };
  }));
}

export async function verifySensitivity() {
  const scenarios = parse(sensitivitySchema, await readJson("sensitivity.json"));
  const parent = await readPublicCalculationDataset({ root });
  assert.equal(scenarios.length, 18);
  const grid = design.sensitivity.materials.flatMap(material => design.sensitivity.allocation_y.flatMap(y =>
    design.sensitivity.reference_price_multipliers.map(p => ({ id: `${material}-y${y}-p${p}`, material, y, p }))));
  assert.deepEqual(scenarios.map(s => s.id), grid.map(point => point.id));
  let maximumError = 0, comparisons = 0;
  for (const scenario of scenarios) {
    const { data, provenance } = scenario;
    const point = grid.find(item => item.id === scenario.id);
    assert.ok(point);
    assert.equal(provenance.material, point.material);
    assert.equal(provenance.allocation_y, point.y);
    assert.equal(provenance.reference_price_multiplier, point.p);
    assert.equal(data.cases[0]?.material, point.material);
    const originalY = parent.data.inputs.find(i => i.input_id === `${point.material}.y`);
    const originalPrice = parent.data.inputs.find(i => i.input_id === `${point.material}.price`);
    assert.ok(originalY?.value !== null && originalY?.value !== undefined);
    assert.ok(originalPrice?.value !== null && originalPrice?.value !== undefined);
    assert.deepEqual(provenance.changes, [
      { input_id: originalY.input_id, before: originalY.value, after: point.y },
      { input_id: originalPrice.input_id, before: originalPrice.value, after: originalPrice.value * point.p },
    ]);
    assert.equal(data.schema_version, parent.data.schema_version);
    assert.equal(data.model_version, parent.data.model_version);
    assert.equal(scenario.derived_dataset_sha256, hashObject(data));
    assert.equal(scenario.provenance_sha256, hashObject(provenance));
    assert.equal(provenance.parent_fixture_sha256, parent.fixture_sha256);
    assert.equal(provenance.parent_manifest_sha256, parent.manifest_sha256);
    assert.equal(scenario.engine_receipt.fixture_sha256, scenario.derived_dataset_sha256);
    assert.equal(scenario.engine_receipt.manifest_sha256, scenario.provenance_sha256);
    assert.equal(scenario.engine_receipt.calculator_sha256, parent.calculator_sha256);
    assert.notEqual(scenario.derived_dataset_sha256, parent.fixture_sha256);
    assert.deepEqual(data.cases, parent.data.cases.filter(c => c.case_id === provenance.case_id));
    assert.deepEqual(data.sources, parent.data.sources);
    assert.deepEqual(data.limitations, parent.data.limitations);
    for (const input of data.inputs) {
      const original = parent.data.inputs.find(i => i.input_id === input.input_id);
      assert.ok(original);
      const change = provenance.changes.find(item => item.input_id === input.input_id);
      if (change) {
        assert.equal(input.value, change.after);
        assert.equal(original.value, change.before);
        const { value: _v, assumption_reason: _a, ...fixed } = input;
        const { value: _ov, assumption_reason: _oa, ...originalFixed } = original;
        assert.deepEqual(fixed, originalFixed);
      } else assert.deepEqual(input, original);
    }
    assert.equal(data.inputs.length, parent.data.inputs.length);
    assert.equal(data.inputs.find(i => i.input_id === "f_inc")?.value, null);
    assert.equal(scenario.results.length, 3);
    assert.equal(scenario.routes.length, 3);
    assert.deepEqual(scenario.results.map(r => r.route_id), ["recycling", "landfill", "energy_recovery"]);
    assert.deepEqual(scenario.routes.map(r => r.route_id), ["recycling", "landfill", "energy_recovery"]);
    const expectedRows = independentRows(data);
    assert.deepEqual(scenario.independent, expectedRows);
    const checks = expectedRows.map(expected => {
      const actual = scenario.results.find(r => r.route_id === expected.route_id);
      const route = scenario.routes.find(r => r.route_id === expected.route_id);
      assert.ok(actual && route);
      assert.equal(actual.case_id, provenance.case_id);
      assert.equal(actual.embedded_transport, true);
      assert.equal(actual.commercial_ready, false);
      assert.equal(actual.facility_eligibility, "unverified_assumption");
      if (actual.route_id === "energy_recovery") {
        assert.equal(actual.availability.cost, "unavailable");
        assert.deepEqual(actual.missing_inputs.cost, ["missing:f_inc"]);
      }
      const checked = compareNumbers({ route_id: actual.route_id, metrics: actual, display: actual.display, components: actual.cost_components_krw,
        revenue: actual.revenue_krw, per_tonne: actual.per_tonne, mass_flow: route.mass_flow }, expected);
      maximumError = Math.max(maximumError, checked.maximum_absolute_error);
      comparisons += checked.comparisons;
      return checked;
    });
    assert.deepEqual(scenario.numeric_agreement, checks);
    assert.deepEqual(scenario.ranking, ranking(scenario.results));
    const originalAllocation = parent.data.inputs.find(i => i.input_id === `${point.material}.y`);
    const baseline = scenarios.find(s => s.provenance.material === point.material &&
      s.provenance.allocation_y === originalAllocation?.value && s.provenance.reference_price_multiplier === 1);
    assert.ok(baseline);
    assert.deepEqual(scenario.deltas_from_original_premise, {
      reference_scenario_id: baseline.id, sign: "scenario minus original premise; null remains unknown",
      rows: premiseDeltas(scenario.results, baseline.results),
    });
  }
  const ranges = design.sensitivity.materials.map(material => {
    const selected = scenarios.filter(s => s.provenance.material === material);
    const recycled = selected.flatMap(s => s.results.filter(r => r.route_id === "recycling"));
    const minmax = (values: readonly (number | null)[]) => {
      const known = values.filter((v): v is number => v !== null);
      return { min: Math.min(...known), max: Math.max(...known) };
    };
    return { material, scenarios: selected.length, recycling_net_cost_krw: minmax(recycled.map(r => r.net_cost_krw)),
      recycling_net_carbon_kgco2e: minmax(recycled.map(r => r.net_carbon_kgco2e)),
      cost_saving_vs_landfill_krw: minmax(recycled.map(r => r.cost_saving_krw)),
      carbon_difference_vs_landfill_kgco2e: minmax(recycled.map(r => r.scenario_carbon_difference_kgco2e)),
      ranking_variants: [...new Set(selected.map(s => JSON.stringify(s.ranking)))].map(value => JSON.parse(value)) };
  });
  return { scenarios: scenarios.length, rows: scenarios.reduce((n, s) => n + s.results.length, 0),
    independent_numeric_comparisons: comparisons, maximum_absolute_error: maximumError, absolute_tolerance: 1e-9,
    ranges, conclusion: "Only the declared grid is covered. Cost and carbon rankings are arithmetic orders, not domain recommendation priority. Missing incineration cost prevents full cost ordering and global Pareto claims." };
}
