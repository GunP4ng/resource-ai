import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import manifest from "../data/evaluation/development.json" with { type: "json" };
import baseline from "../data/evaluation/round3-20261121/results.json" with { type: "json" };
import { parseCaseInput } from "../src/input.ts";
import { createResourceDomain } from "../src/domain.ts";
import { revision } from "../src/o-validation.ts";
import { readCaseResearchCatalog } from "../src/o-case-research.ts";
import { buildPublicInputScenario, publicScenarioEligibility } from "../src/o-input-public-scenario.ts";
import { buildCaseGuidance } from "../src/o-case-guidance.ts";
import { buildScenarioSensitivity } from "../src/o-scenario-sensitivity.ts";
import { unsupportedScope } from "../src/o-supported-scope.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const outputArgument = args[1];
assert.ok(args.length === 2 && args[0] === "--out" && typeof outputArgument === "string" && outputArgument.trim(),
  "usage: bun scripts/measure-guidance.ts --out NEW_DIRECTORY");
const output = resolve(root, outputArgument);
// An existing evidence directory is immutable; replay into a new directory.
await mkdir(output);
const previous = new Map(baseline.map(row => [row.caseId, row]));
assert.deepEqual(manifest.cases.map(row => row.caseId).sort(), [...previous.keys()].sort());
const catalog = await readCaseResearchCatalog();
const catalogBefore = revision(catalog);
const rows = await Promise.all(manifest.cases.map(async item => {
  const bytes = await readFile(resolve(root, "data/evaluation", item.inputRef));
  const originalSha256 = createHash("sha256").update(bytes).digest("hex");
  assert.equal(originalSha256, item.sourceHash, item.caseId + ": original bytes");
  const raw: unknown = JSON.parse(new TextDecoder().decode(bytes));
  assert.ok(raw && typeof raw === "object" && !Array.isArray(raw));
  const parsed = parseCaseInput({ ...raw, photoRefs: [] });
  assert.ok(parsed.ok, item.caseId + ": input");
  const input = parsed.value;
  assert.equal(unsupportedScope(input), null, item.caseId + ": scope");
  const before = previous.get(item.caseId);
  assert.ok(before);
  const decision = await createResourceDomain(input).decide();
  assert.deepEqual(decision, before.result, item.caseId + ": complete decision");
  const inputBefore = revision(input), decisionBefore = revision(decision);
  const scenario = buildPublicInputScenario({ actorId: "guidance-measure", input, inputRevision: inputBefore }, catalog);
  const eligibility = publicScenarioEligibility(input);
  const scenarioBefore = revision(scenario);
  const guidance = await buildCaseGuidance(input, decision, {
    publicScenario: scenario ?? undefined, publicDirectoryCount: 4,
  });
  const sensitivity = scenario && guidance.scenario ? buildScenarioSensitivity(scenario, guidance.scenario) : null;
  assert.equal(revision(input), inputBefore);
  assert.equal(revision(decision), decisionBefore);
  assert.equal(revision(scenario), scenarioBefore);
  if (scenario) {
    assert.equal(scenario.calculations.inputs.find(value => value.input_id === "f_inc")?.value, null);
    assert.equal(scenario.calculations.results.find(value => value.route_id === "energy_recovery")?.net_cost_krw, null);
  }
  if (decision.state !== "compared") assert.equal(guidance.scenario, null);
  const actualSecond = decision.state === "compared" && decision.recommendations.some(value => value.rank === 2);
  assert.equal(guidance.actualComparison.actualSecondAvailable, actualSecond);
  assert.equal(guidance.stages.length, 6);
  return {
    caseId: item.caseId, originalSha256, executionInputSha256: inputBefore,
    assessmentDate: input.assessmentDate, state: decision.state,
    canonicalDecisionUnchanged: true, decisionSha256: decisionBefore,
    automaticPublicScenario: scenario !== null,
    publicScenarioOmissionReasons: eligibility.status === "unavailable" ? eligibility.reasons : [],
    conditionalOptimum: guidance.scenario?.status === "conditionally-optimal",
    actualSecondAvailable: actualSecond,
    firstFact: guidance.oneFactPriority.priorityFactId,
    probeCount: guidance.oneFactPriority.probes.length,
    noPriorityStatus: guidance.oneFactPriority.status,
    noPriorityFacts: decision.state !== "compared" && guidance.oneFactPriority.priorityFactId === null
      ? guidance.actualComparison.regulatoryConditions.filter(reason => !reason.startsWith("추가 답변은 필드별 JSON")) : [],
    sensitivitySamples: sensitivity?.samples.length ?? 0,
    sensitivityRetained: sensitivity?.samples.filter(sample => sample.retained).length ?? 0,
    priceCrossovers: sensitivity?.priceCrossovers ?? [],
    guidance, sensitivity,
    unchangedDecisionRef: `data/evaluation/round3-20261121/results.json#/${baseline.findIndex(row => row.caseId === item.caseId)}/result`,
  };
}));
assert.equal(rows.length, 18);
assert.equal(revision(catalog), catalogBefore);
const implementation = await Promise.all([
  "src/o-case-guidance.ts", "src/o-scenario-guidance.ts", "src/o-supported-scope.ts", "src/o-input-public-scenario.ts",
  "src/o-calculation-variant.ts", "src/o-scenario-sensitivity.ts", "src/o-inquiry-reply.ts", "src/report-inquiry-reply.ts",
  "src/app-case-routes.ts", "src/app.ts", "src/app-views.ts", "src/app-feedback.ts",
  "src/report.ts", "src/report-guidance.ts", "src/report-inquiry.ts", "src/report-model-audit.ts",
  "src/o-model-audit.ts", "src/o-model-audit-schema.ts", "src/domain.ts", "src/session.ts",
  "src/app-types.ts", "src/o-case-record-validation.ts",
  "src/report-research.ts", "src/report-styles.ts",
  "scripts/measure-guidance.ts",
  "data/reference/domestic-scenario-context-20261121.json",
].map(async path => ({ path, sha256: createHash("sha256")
  .update(await readFile(resolve(root, path))).digest("hex") })));
const summary = {
  scope: "Same 18 exposed original inputs; text-only as prior baseline; deterministic existing rules and engine; zero model/provider calls",
  cases: rows.length, originalHashesVerified: rows.length, completeDecisionsUnchanged: rows.length,
  states: Object.fromEntries(["compared", "needs-information", "needs-review"].map(state =>
    [state, rows.filter(row => row.state === state).length])),
  stateChanges: 0,
  automaticPublicScenarios: rows.filter(row => row.automaticPublicScenario).length,
  conditionalOptima: rows.filter(row => row.conditionalOptimum).length,
  actualSeconds: rows.filter(row => row.actualSecondAvailable).length,
  recommendedWithoutPublicScenarioWithReasons: rows.filter(row => row.state === "compared"
    && !row.automaticPublicScenario && row.publicScenarioOmissionReasons.length > 0).length,
  computedPriceCrossovers: rows.reduce((sum, row) => sum + row.priceCrossovers.filter(point => point.minimumPrice !== null).length, 0),
  heldCasesWithOneFactPriority: rows.filter(row => row.firstFact !== null).length,
  hypotheticalOneFactProbes: rows.reduce((sum, row) => sum + row.probeCount, 0),
  heldWithoutPriorityWithRequiredFacts: rows.filter(row => row.noPriorityFacts.length > 0).length,
  sensitivity: {
    cases: rows.filter(row => row.sensitivitySamples > 0).length,
    samples: rows.reduce((sum, row) => sum + row.sensitivitySamples, 0),
    retained: rows.reduce((sum, row) => sum + row.sensitivityRetained, 0),
    priceMultipliers: [0.8, 1, 1.2], allocationValues: [0.6, 0.8, 1],
    interpretation: "Finite model samples; y is a model allocation, not measured substitution. No interval/extrapolation guarantee.",
  },
  inputDecisionContextCatalogPreserved: true,
  actualIncinerationFeeAndCostRemainNull: true,
  baseline: {
    path: "data/evaluation/round3-20261121/results.json",
    sha256: createHash("sha256").update(await readFile(resolve(root, "data/evaluation/round3-20261121/results.json"))).digest("hex"),
  },
  limitations: [
    "Development inputs were exposed, not an unseen evaluation or human accuracy study.",
    "Hypothetical route openings are not strict eligibility, facility acceptance or execution approval.",
    "No actual rank2 is invented from the fully quantified scenario comparator.",
    "Conditional optimum holds only for the modeled three routes, fixed other assumptions and stated fee bound.",
  ],
  implementation,
};
await writeFile(resolve(output, "results.json"), JSON.stringify(rows, null, 2) + "\n");
await writeFile(resolve(output, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
await writeFile(resolve(output, "compact.json"), JSON.stringify(rows.map(({ guidance: _g, sensitivity: _s, ...row }) => row), null, 2) + "\n");
console.log(JSON.stringify(summary));
