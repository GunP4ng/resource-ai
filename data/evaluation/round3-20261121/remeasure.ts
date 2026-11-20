import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import development from "../development.json" with { type: "json" };
import previous from "../rubric-followup-20261121/conditional-alternatives/results.json" with { type: "json" };
import { createResourceDomain } from "../../../src/domain.ts";
import { parseCaseInput } from "../../../src/input.ts";
import { parseDecision } from "../../../src/o-decision.ts";
import { revision } from "../../../src/o-validation.ts";
import { readCaseResearchCatalog } from "../../../src/o-case-research.ts";
import { buildPublicInputScenario } from "../../../src/o-input-public-scenario.ts";
import { sha } from "../../../src/o-public-calculation-validation.ts";
import type { DecisionResult } from "../../../src/contracts.ts";

const directory = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(directory, "../../..");
const catalog = await readCaseResearchCatalog({ root });
const sourcePaths = ["src/evidence.ts", "src/conditional-alternatives.ts", "src/o-input-public-scenario.ts",
  "src/app-case-routes.ts", "src/report.ts", "src/report-research.ts",
  "data/sources/evidence-candidates.json", "data/sources/manifest.json",
  "data/reference/domestic-scenario-context-20261121.json"];
const implementation = await Promise.all(sourcePaths.map(async path => ({
  path, sha256: sha(await readFile(resolve(root, path))),
})));
const rows: {
  caseId: string; originalInputSha256: string; executionInputSha256: string; assessmentDate: string;
  stateBefore: string; stateAfter: string; decisionSha256: string; comparedUnchanged: boolean | null;
  supportedBefore: boolean; supportedAfter: boolean; scenario: null | {
    material: string; userMassKg: number; derivedDatasetSha256: string; derivedProvenanceSha256: string;
    parentFixtureSha256: string;
    results: readonly { routeId: string; costKrw: number | null; carbonKgCo2e: number | null }[];
  }; result: DecisionResult;
}[] = [];
assert.equal(development.cases.length, 18);
assert.equal(new Set(development.cases.map(item => item.caseId)).size, 18);
for (const item of development.cases) {
  const bytes = await readFile(resolve(root, "data/evaluation", item.inputRef));
  assert.equal(sha(bytes), item.sourceHash);
  const parsed = parseCaseInput(JSON.parse(bytes.toString("utf8")));
  assert.ok(parsed.ok);
  const input = { ...parsed.value, photoRefs: [] };
  const inputRevision = revision(input);
  const before = previous.find(row => row.caseId === input.caseId);
  assert.ok(before);
  assert.deepEqual(input, before.input);
  const domain = createResourceDomain(input);
  const result = await domain.decide();
  assert.deepEqual(parseDecision(result), result);
  assert.equal(result.state, before.result.state);
  assert.ok((await domain.assessRoutes(input)).every(route => route.eligibility.state === "unknown"));
  if (result.state === "compared") assert.equal(revision(result), revision(before.result));
  else for (const alternative of result.conditionalAlternatives ?? []) assert.equal(alternative.executable, false);
  const scenario = buildPublicInputScenario({ actorId: "measurement-only", input, inputRevision }, catalog);
  assert.equal(revision(input), inputRevision);
  if (scenario) {
    assert.equal(scenario.binding.inputRevision, inputRevision);
    assert.equal(scenario.userMassKg, input.massKg);
    assert.equal(scenario.calculations.results.find(row => row.route_id === "energy_recovery")?.net_cost_krw, null);
  }
  rows.push({
    caseId: input.caseId, originalInputSha256: sha(bytes), executionInputSha256: inputRevision,
    assessmentDate: input.assessmentDate, stateBefore: before.result.state, stateAfter: result.state,
    decisionSha256: revision(result), comparedUnchanged: result.state === "compared" ? true : null,
    supportedBefore: before.routeSupportedUnion,
    supportedAfter: result.state === "compared" || (result.conditionalAlternatives ?? []).some(a => a.support.state === "route-supported"),
    scenario: scenario ? { material: scenario.material, userMassKg: scenario.userMassKg,
      derivedDatasetSha256: scenario.provenance.derivedDatasetSha256,
      derivedProvenanceSha256: scenario.provenance.derivedProvenanceSha256,
      parentFixtureSha256: scenario.provenance.parentFixtureSha256,
      results: scenario.calculations.results.map(row => ({ routeId: row.route_id, costKrw: row.net_cost_krw, carbonKgCo2e: row.net_carbon_kgco2e })) } : null,
    result,
  });
}
const summary = {
  scope: "Same 18 exposed text-only development inputs; deterministic host and public arithmetic, zero provider calls",
  cases: rows.length, originalInputHashesVerified: rows.length,
  states: Object.fromEntries(["compared", "needs-review", "needs-information"].map(state =>
    [state, rows.filter(row => row.stateAfter === state).length])),
  stateChanges: rows.filter(row => row.stateBefore !== row.stateAfter).length,
  comparedOutputsUnchanged: rows.filter(row => row.comparedUnchanged).length,
  routeSupportedBefore: rows.filter(row => row.supportedBefore).length,
  routeSupportedAfter: rows.filter(row => row.supportedAfter).length,
  newlySupported: rows.filter(row => !row.supportedBefore && row.supportedAfter).map(row => row.caseId),
  remainingUnsupported: rows.filter(row => !row.supportedAfter).map(row => row.caseId),
  automaticPublicScenarioCount: rows.filter(row => row.scenario !== null).length,
  interpretation: "Conditional source-chain support is not factual eligibility or measured accuracy. Automatic scenarios use user mass with template assumptions; holds and null incineration cost remain.",
  implementation,
};
await writeFile(resolve(directory, "results.json"), JSON.stringify(rows, null, 2) + "\n");
await writeFile(resolve(directory, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
