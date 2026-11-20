import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import { readPublicCalculationDataset } from "../../../../src/o-public-calculation-data.ts";
import { buildPublicCalculations } from "../../../../src/o-public-calculation-engine.ts";
import { fixtureSchema, PublicCalculationResultSchema, PublicCalculationRouteSchema } from "../../../../src/o-public-calculation-schema.ts";
import type { Dataset } from "../../../../src/o-public-calculation-schema.ts";
import { parse, sha } from "../../../../src/o-public-calculation-validation.ts";
import { design, directory, root, temporary, save, readJson, hashObject, snapshot, verifySnapshot, pinSchema } from "./local.ts";
import { verifyContrasts } from "./contrast.ts";
import { independentRows, compareNumbers, ranking } from "./oracle.ts";

const recoverySchema = Type.Array(Type.Object({
  id: Type.String(), ordinal: Type.Number(), data: fixtureSchema, derived_dataset_sha256: Type.String(),
  provenance: Type.Object({ status: Type.Literal("derived_hypothetical_not_verified_catalog"),
    parent_fixture_sha256: Type.String(), parent_manifest_sha256: Type.String(),
    material: Type.String(), y: Type.Number(), price_multiplier: Type.Number() }),
  provenance_sha256: Type.String(), evidence_status: Type.String(), independent: Type.Unknown(),
  actual_results: Type.Array(PublicCalculationResultSchema), actual_routes: Type.Array(PublicCalculationRouteSchema),
  actual_ranking: Type.Unknown(), independent_ranking: Type.Unknown(),
}));
function independentRanking(rows: ReturnType<typeof independentRows>) {
  const cost = rows.filter(r => typeof r.metrics["net_cost_krw"] === "number")
    .sort((a, b) => (a.metrics["net_cost_krw"] ?? Infinity) - (b.metrics["net_cost_krw"] ?? Infinity)).map(r => r.route_id);
  const carbon = [...rows].sort((a, b) => (a.metrics["net_carbon_kgco2e"] ?? Infinity) - (b.metrics["net_carbon_kgco2e"] ?? Infinity)).map(r => r.route_id);
  const dominates = (a: typeof rows[number], b: typeof rows[number]) => {
    const ac = a.metrics["net_cost_krw"], bc = b.metrics["net_cost_krw"];
    const ae = a.metrics["net_carbon_kgco2e"], be = b.metrics["net_carbon_kgco2e"];
    return typeof ac === "number" && typeof bc === "number" && typeof ae === "number" && typeof be === "number" &&
      ac <= bc && ae <= be && (ac < bc || ae < be);
  };
  const complete = rows.filter(r => typeof r.metrics["net_cost_krw"] === "number" && typeof r.metrics["net_carbon_kgco2e"] === "number");
  return { basis: "independent rational values, not retained engine output", cost_ascending: cost, carbon_ascending: carbon,
    pareto_complete_routes: complete.filter(b => !complete.some(a => dominates(a, b))).map(r => r.route_id),
    excluded_missing_cost: rows.filter(r => r.metrics["net_cost_krw"] === null).map(r => r.route_id) };
}
const mode = process.argv[2];
assert.ok(mode === "--finish-budget" || mode === "--verify");
const files = ["design.json", "local.ts", "contrast.ts", "oracle.ts", "sensitivity.ts", "run.ts", "recover.ts",
  "tsconfig.json", "methodology.md", "typecheck.log", "contrast-inputs.json", "contrasts.json", "parent-receipt.json",
  "originals-before.json", "originals-after.json", "pre-execution.json", "execution-failure.json",
  "sensitivity-recovery.json", "summary.json"] as const;
await mkdir(temporary);
process.env["TMPDIR"] = temporary;
process.env["XDG_CACHE_HOME"] = temporary;
process.env["BUN_RUNTIME_TRANSPILER_CACHE_PATH"] = "0";
try {
  const parent = await readPublicCalculationDataset({ root });
  if (mode === "--finish-budget") {
    assert.equal(existsSync(join(directory, "sensitivity-recovery.json")), false, "Use --verify; the two remaining engine calls must not repeat.");
    const recovered = [];
    let ordinal = 0;
    for (const material of design.sensitivity.materials) for (const y of design.sensitivity.allocation_y)
      for (const multiplier of design.sensitivity.reference_price_multipliers) {
        ordinal++;
        const c = parent.data.cases.find(item => item.material === material);
        assert.ok(c);
        const price = parent.data.inputs.find(i => i.input_id === `${material}.price`);
        assert.ok(price?.value !== null && price?.value !== undefined);
        const referencePrice = price.value;
        const data: Dataset = { ...parent.data, cases: [c], inputs: parent.data.inputs.map(i =>
          i.input_id === `${material}.y` ? { ...i, value: y, assumption_reason: `${i.assumption_reason}; recovery grid y=${y}` } :
          i.input_id === `${material}.price` ? { ...i, value: referencePrice * multiplier,
            assumption_reason: `${i.assumption_reason}; recovery hypothetical multiplier=${multiplier}` } : i) };
        const provenance = { status: "derived_hypothetical_not_verified_catalog", parent_fixture_sha256: parent.fixture_sha256,
          parent_manifest_sha256: parent.manifest_sha256, material, y, price_multiplier: multiplier } as const;
        const derivedHash = hashObject(data), provenanceHash = hashObject(provenance);
        // Ordinals 1-16 already ran. Never fabricate their lost raw output or replay them.
        const actual = ordinal <= 16 ? null : buildPublicCalculations({ data, fixture_sha256: derivedHash,
          manifest_sha256: provenanceHash, calculator_sha256: parent.calculator_sha256, implementation: parent.implementation });
        recovered.push({ id: `${material}-y${y}-p${multiplier}`, ordinal, data, derived_dataset_sha256: derivedHash,
          provenance, provenance_sha256: provenanceHash,
          evidence_status: ordinal <= 15 ? "prior_assertions_passed_by_control_flow_raw_output_lost" :
            ordinal === 16 ? "prior_display_assertion_failed_raw_output_lost" : "engine_output_captured_in_recovery",
          independent: independentRows(data), actual_results: actual?.results ?? [], actual_routes: actual?.routes ?? [],
          actual_ranking: actual === null ? null : ranking(actual.results),
          independent_ranking: independentRanking(independentRows(data)) });
        // Checkpoint after EACH new engine call, before its independent assertions.
        if (actual !== null) await save("sensitivity-recovery.json", recovered);
      }
    assert.equal(ordinal, 18);
    await save("originals-after.json", await snapshot());
  }
  const originals = await verifySnapshot();
  const contrasts = await verifyContrasts(originals.source_sha256);
  const rows = parse(recoverySchema, await readJson("sensitivity-recovery.json"));
  assert.equal(rows.length, 18);
  let numericComparisons = 0, maximumError = 0;
  for (const [index, row] of rows.entries()) {
    assert.equal(row.ordinal, index + 1);
    assert.equal(row.derived_dataset_sha256, hashObject(row.data));
    assert.equal(row.provenance_sha256, hashObject(row.provenance));
    assert.equal(row.provenance.parent_fixture_sha256, parent.fixture_sha256);
    assert.equal(row.data.inputs.find(i => i.input_id === "f_inc")?.value, null);
    const expected = independentRows(row.data);
    assert.deepEqual(row.independent, expected);
    assert.deepEqual(row.independent_ranking, independentRanking(expected));
    if (row.ordinal <= 16) { assert.deepEqual(row.actual_results, []); assert.deepEqual(row.actual_routes, []); continue; }
    assert.equal(row.actual_results.length, 3);
    for (const e of expected) {
      const actual = row.actual_results.find(r => r.route_id === e.route_id);
      const route = row.actual_routes.find(r => r.route_id === e.route_id);
      assert.ok(actual && route);
      const checked = compareNumbers({ route_id: actual.route_id, metrics: actual, display: actual.display,
        components: actual.cost_components_krw, revenue: actual.revenue_krw, per_tonne: actual.per_tonne, mass_flow: route.mass_flow }, e);
      numericComparisons += checked.comparisons;
      maximumError = Math.max(maximumError, checked.maximum_absolute_error);
    }
    assert.deepEqual(row.actual_ranking, ranking(row.actual_results));
  }
  const independentRanges = design.sensitivity.materials.map(material => {
    const recycled = rows.filter(row => row.provenance.material === material)
      .flatMap(row => independentRows(row.data).filter(r => r.route_id === "recycling"));
    const range = (key: string) => {
      const values = recycled.map(r => r.metrics[key]).filter((v): v is number => typeof v === "number");
      return { min: Math.min(...values), max: Math.max(...values) };
    };
    return { material, basis: "independent oracle only; full raw engine evidence unavailable",
      recycling_net_cost_krw: range("net_cost_krw"), recycling_net_carbon_kgco2e: range("net_carbon_kgco2e"),
      cost_saving_vs_landfill_krw: range("cost_saving_krw"),
      carbon_difference_vs_landfill_kgco2e: range("scenario_carbon_difference_kgco2e") };
  });
  const summary = { status: "INCOMPLETE_SENSITIVITY_EVIDENCE", originals_unchanged: true,
    source_sha256: originals.source_sha256, contrast: contrasts,
    scenario_calls: { domain: 36, initial_engine_inferred_from_control_flow: 16, recovery_engine: 2, total: 54, limit: 54 },
    sensitivity: { designed_scenarios: 18, independently_recomputed_rows: 54, captured_engine_scenarios: 2,
      captured_engine_rows: 6, lost_raw_scenarios: 16, fully_checked_prior_scenarios_inferred: 15,
      failing_prior_scenario: "HDPE-y1-p0.8", display_agreement: false,
      recovery_numeric_comparisons: numericComparisons, recovery_maximum_absolute_error: maximumError,
      full_numeric_agreement_verified: false, missing_incineration_cost_unchanged: true,
      independent_ranges: independentRanges,
      pareto_limit: "No global three-route cost/Pareto claim; incineration cost is missing.",
      conclusion: "All 18 independent arithmetic scenarios are available. Only two have retained actual engine rows. Prior control flow supports 15 completed checks and one display failure, but does not restore lost raw evidence. Full sensitivity evidence requires 16 additional engine calls, which are not authorized under the 54-run cap." } };
  if (mode === "--finish-budget") {
    await save("summary.json", summary);
    const pins = await Promise.all(files.map(async path => ({ path, sha256: sha(await readFile(join(directory, path))) })));
    await save("artifacts.json", { files: pins, sha256: hashObject(pins) });
  } else {
    assert.deepEqual(await readJson("summary.json"), summary);
    const sealed = parse(Type.Object({ files: Type.Array(pinSchema), sha256: Type.String() }), await readJson("artifacts.json"));
    assert.deepEqual(sealed.files.map(pin => pin.path), [...files]);
    for (const pin of sealed.files) assert.equal(sha(await readFile(join(directory, pin.path))), pin.sha256, pin.path);
    assert.equal(hashObject(sealed.files), sealed.sha256);
  }
  console.log(JSON.stringify({ status: summary.status, mode, scenario_calls_total: 54,
    additional_calls_now: mode === "--finish-budget" ? 2 : 0, states: contrasts.states,
    first_routes: contrasts.first_routes, originals_unchanged: true, captured_engine_rows: 6,
    recovery_numeric_comparisons: numericComparisons, recovery_maximum_error: maximumError }));
  process.exitCode = 2; // Evidence is deliberately not labeled complete or green.
} finally {
  await rm(temporary, { recursive: true });
}
