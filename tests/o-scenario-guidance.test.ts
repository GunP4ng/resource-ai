import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaseInput } from "../src/contracts.ts";
import { readCaseResearchCatalog } from "../src/o-case-research.ts";
import { buildPublicInputScenario } from "../src/o-input-public-scenario.ts";
import type { PublicInputScenario } from "../src/o-input-public-scenario.ts";
import { buildPublicCalculations } from "../src/o-public-calculation-engine.ts";
import { buildScenarioGuidance } from "../src/o-scenario-guidance.ts";
import { canonical, revision } from "../src/o-validation.ts";

const catalogPromise = readCaseResearchCatalog();
const input: CaseInput = { caseId: "guidance-scenario", description: "생산 자투리", photoRefs: [],
  polymer: "PET", process: "성형 자투리 분리 수거", contamination: "없음", hazardousContact: "no",
  massKg: 24, region: "경기도", assessmentDate: "2026-11-20" };

async function context(polymer: "PET" | "HDPE" = "PET", massKg = 24): Promise<PublicInputScenario> {
  const facts = { ...input, polymer, massKg };
  const result = buildPublicInputScenario({ actorId: "researcher", input: facts, inputRevision: revision(facts) }, await catalogPromise);
  assert.ok(result);
  return result;
}

function calculate(context: PublicInputScenario, changes: Readonly<Record<string, number | null>>) {
  const c = context.calculations;
  const data = { schema_version: 1 as const, model_version: c.model_version, sources: c.sources,
    cases: c.cases, limitations: c.limitations,
    inputs: c.inputs.map(item => Object.hasOwn(changes, item.input_id)
      ? { ...item, value: changes[item.input_id] ?? null } : item) };
  return buildPublicCalculations({ data, fixture_sha256: revision(data),
    manifest_sha256: revision({ hypothesis: changes, parent: context.provenance.derivedDatasetSha256 }),
    implementation: context.provenance.implementation, calculator_sha256: context.provenance.implementation.sha256 });
}

for (const [material, mass] of [["PET", 24], ["HDPE", 18], ["PET", 240]] as const) {
  test(`${material}/${mass} sufficient fee threshold matches actual engine at boundary, inside and outside`, async () => {
    const original = await context(material, mass);
    const result = buildScenarioGuidance(original);
    assert.equal(result.status, "conditionally-optimal");
    assert.equal(result.firstRouteId, "recycling");
    assert.equal(result.hypotheticalRunnerUpRouteId, "landfill");
    assert.deepEqual(result.comparedRouteIds, ["recycling", "landfill", "energy_recovery"]);
    const bound = result.feeBound;
    assert.ok(bound);
    assert.equal(bound.actualValue, null);
    assert.equal(bound.sufficientUnderAssumption, true);
    for (const [offset, expected] of [[0, "equal"], [1, "first-cheaper"], [-1, "incineration-cheaper"]] as const) {
      const engine = calculate(original, { f_inc: bound.sufficientMinimum + offset });
      const first = engine.results.find(row => row.route_id === "recycling");
      const inc = engine.results.find(row => row.route_id === "energy_recovery");
      assert.ok(first && inc && first.net_cost_krw !== null && inc.net_cost_krw !== null);
      const difference = inc.net_cost_krw - first.net_cost_krw;
      if (expected === "equal") assert.ok(Math.abs(difference) < 1e-8);
      if (expected === "first-cheaper") assert.ok(difference > 0);
      if (expected === "incineration-cheaper") assert.ok(difference < 0);
      assert.ok(first.net_carbon_kgco2e !== null && inc.net_carbon_kgco2e !== null
        && first.net_carbon_kgco2e <= inc.net_carbon_kgco2e);
    }
    const zero = calculate(original, { f_inc: 0 }).results.find(row => row.route_id === "energy_recovery");
    assert.ok(zero && zero.net_cost_krw !== null);
    const c = original.calculations.inputs.find(row => row.input_id === "c")?.value;
    const r = original.calculations.inputs.find(row => row.input_id === "r")?.value;
    const d0 = original.calculations.inputs.find(row => row.input_id === "d0")?.value;
    assert.ok(c !== null && c !== undefined && r !== null && r !== undefined && d0 !== null && d0 !== undefined);
    assert.equal(zero.net_cost_krw, mass / 1000 * c + mass / 1000 * d0 * r);
    assert.ok(zero.net_cost_krw > 0);
    assert.equal(result.differences.find(row => row.routeId === "energy_recovery")?.costAdvantageKrw, null);
  });
}

test("null fee, input, prepared context and verified catalog remain canonical unchanged", async () => {
  const catalog = await catalogPromise, prepared = await context();
  const before = canonical({ catalog, prepared, input });
  const result = buildScenarioGuidance(prepared);
  assert.equal(canonical({ catalog, prepared, input }), before);
  assert.equal(prepared.calculations.inputs.find(row => row.input_id === "f_inc")?.value, null);
  assert.equal(prepared.calculations.results.find(row => row.route_id === "energy_recovery")?.net_cost_krw, null);
  assert.notEqual(result.provenance.probeDatasetSha256, result.provenance.parentFixtureSha256);
  assert.notEqual(result.provenance.probeDatasetSha256, result.provenance.preparedDatasetSha256);
  assert.notEqual(result.provenance.probeProvenanceSha256, result.provenance.parentManifestSha256);
  assert.equal(result.provenance.probeProvenanceSha256, revision({
    parentFixtureSha256: catalog.calculations.fixture_sha256,
    parentManifestSha256: catalog.calculations.manifest_sha256,
    preparedDatasetSha256: prepared.provenance.derivedDatasetSha256,
    probeDatasetSha256: result.provenance.probeDatasetSha256,
    hypothesis: "f_inc=0", implementationSha256: catalog.calculations.implementation.sha256,
  }));
  assert.equal(result.provenance.parentFixtureSha256, catalog.calculations.fixture_sha256);
  assert.equal(result.provenance.preparedDatasetSha256, prepared.provenance.derivedDatasetSha256);
  assert.equal(result.use.storage, "excluded");
  assert.equal(result.use.commercialExport, "excluded");
  assert.equal(result.use.modelTransmission, "excluded");
});

test("a positive sufficient threshold is not proved by a zero lower bound", async () => {
  const prepared = await context();
  const c = prepared.calculations, zero = calculate(prepared, { f_inc: 0 });
  const first = zero.results.find(row => row.route_id === "recycling")?.net_cost_krw;
  const inc = zero.results.find(row => row.route_id === "energy_recovery")?.net_cost_krw;
  const landfill = zero.results.find(row => row.route_id === "landfill")?.net_cost_krw;
  const price = c.inputs.find(row => row.input_id === "PET.price")?.value;
  const y = c.inputs.find(row => row.input_id === "PET.y")?.value;
  assert.ok(first != null && inc != null && landfill != null && price != null && y != null);
  const between = (inc + landfill) / 2;
  const adjustedPrice = price + (first - between) / (prepared.userMassKg / 1000 * y);
  const changed = { ...prepared, calculations: calculate(prepared, { "PET.price": adjustedPrice }) };
  const result = buildScenarioGuidance(changed);
  assert.equal(result.status, "unavailable");
  assert.ok(result.feeBound && result.feeBound.sufficientMinimum > 0);
  assert.equal(result.feeBound.sufficientUnderAssumption, false);
});

test("cost/carbon tradeoff prevents weighted or fabricated ranking", async () => {
  const prepared = await context();
  const result = buildScenarioGuidance({ ...prepared, calculations: calculate(prepared, { "PET.price": -1_000_000 }) });
  assert.equal(result.status, "unavailable");
  assert.equal(result.firstRouteId, null);
  assert.equal(result.hypotheticalRunnerUpRouteId, null);
  assert.deepEqual(result.comparisonOrder, []);
  assert.equal(result.feeBound, null);
  assert.ok(result.unavailableReasons.length);
});

test("a second missing cost input or missing carbon cannot be hidden by the incineration bound", async () => {
  const prepared = await context();
  const missing: readonly Readonly<Record<string, number | null>>[] = [{ s: null }, { "warm.PET.energy_recovery": null }];
  for (const changes of missing) {
    const result = buildScenarioGuidance({ ...prepared, calculations: calculate(prepared, changes) });
    assert.equal(result.status, "unavailable");
    assert.equal(result.feeBound, null);
    assert.equal(result.firstRouteId, null);
  }
});
