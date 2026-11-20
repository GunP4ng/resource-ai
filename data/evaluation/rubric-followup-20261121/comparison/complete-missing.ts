import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { readPublicCalculationDataset } from "../../../../src/o-public-calculation-data.ts";
import { buildPublicCalculations } from "../../../../src/o-public-calculation-engine.ts";
import { independentRows, compareNumbers, ranking } from "./oracle.ts";
import { root, directory, hashObject } from "./local.ts";
import { join } from "node:path";

const output = join(directory, "sensitivity-complete.json");
const parent = await readPublicCalculationDataset({ root });
const rows = JSON.parse(await readFile(join(directory, "sensitivity-recovery.json"), "utf8"));
assert.equal(rows.length, 18);
assert.equal(rows.filter((row: { actual_results: unknown[] }) => row.actual_results.length === 0).length, 16);
const result = { completedAt: "", additionalEngineCalls: 0, previousBudgetCalls: 54,
  numericComparisons: 0, maximumAbsoluteError: 0,
  displayMismatches: [] as { id: string; route: string; field: string; actual: unknown; expected: unknown }[],
  rows: [] as unknown[] };
await writeFile(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
for (const row of rows) {
  assert.equal(row.derived_dataset_sha256, hashObject(row.data));
  assert.equal(row.provenance_sha256, hashObject(row.provenance));
  assert.equal(row.provenance.parent_fixture_sha256, parent.fixture_sha256);
  if (row.actual_results.length === 0) {
    assert.ok(result.additionalEngineCalls < 16);
    const actual = buildPublicCalculations({ data: row.data, fixture_sha256: row.derived_dataset_sha256,
      manifest_sha256: row.provenance_sha256, calculator_sha256: parent.calculator_sha256,
      implementation: parent.implementation });
    result.additionalEngineCalls++;
    row.actual_results = actual.results;
    row.actual_routes = actual.routes;
    row.actual_ranking = ranking(actual.results);
    row.evidence_status = "recaptured_after_documented_runner_output_loss";
  }
  result.rows.push(row);
  // Preserve the actual observation before any independent assertion.
  await writeFile(output, JSON.stringify(result, null, 2) + "\n");
  const independent = independentRows(row.data);
  assert.deepEqual(independent, row.independent);
  for (const expected of independent) {
    const actual = row.actual_results.find((candidate: { route_id: string }) => candidate.route_id === expected.route_id);
    const route = row.actual_routes.find((candidate: { route_id: string }) => candidate.route_id === expected.route_id);
    assert.ok(actual && route);
    const { display: expectedDisplay, ...numericExpected } = expected;
    const checked = compareNumbers({ route_id: actual.route_id, metrics: actual,
      components: actual.cost_components_krw, revenue: actual.revenue_krw,
      per_tonne: actual.per_tonne, mass_flow: route.mass_flow }, numericExpected);
    result.numericComparisons += checked.comparisons;
    result.maximumAbsoluteError = Math.max(result.maximumAbsoluteError, checked.maximum_absolute_error);
    for (const [field, value] of Object.entries(expectedDisplay)) {
      if (actual.display[field] !== value) result.displayMismatches.push({
        id: row.id, route: expected.route_id, field, actual: actual.display[field], expected: value,
      });
    }
  }
}
assert.equal(result.additionalEngineCalls, 16);
result.completedAt = new Date().toISOString();
await writeFile(output, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ status: result.displayMismatches.length ? "DISPLAY_MISMATCH_RETAINED" : "PASS",
  scenarios: result.rows.length, additionalEngineCalls: result.additionalEngineCalls,
  numericComparisons: result.numericComparisons, maximumAbsoluteError: result.maximumAbsoluteError,
  displayMismatches: result.displayMismatches }));
// A known discrepancy stays a nonzero diagnostic, never a silently green check.
if (result.displayMismatches.length) process.exitCode = 1;
