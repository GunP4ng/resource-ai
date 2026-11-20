import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaseInput, DecisionResult, Estimate, ScenarioComparison } from "../src/contracts.ts";
import { createResourceDomain } from "../src/domain.ts";
import { buildCaseGuidance } from "../src/o-case-guidance.ts";
import { buildCaseResearchAttachment, readCaseResearchCatalog } from "../src/o-case-research.ts";
import { buildPublicInputScenario } from "../src/o-input-public-scenario.ts";
import { canonical, revision } from "../src/o-validation.ts";

const catalogPromise = readCaseResearchCatalog();
const clean: CaseInput = { caseId: "guidance-case", description: "PET 생산 자투리", photoRefs: [],
  polymer: "PET", process: "PET 용기 성형 후 자투리 분리 수거", contamination: "없음", hazardousContact: "no",
  massKg: 24, region: "경기도", assessmentDate: "2026-11-20" };
const target = (input: CaseInput) => ({ actorId: "researcher", input, inputRevision: revision(input) });

test("standalone current guidance preserves the actual single recommendation without inventing second place", async () => {
  const decision = await createResourceDomain(clean).decide();
  assert.equal(decision.state, "compared");
  const before = canonical({ clean, decision });
  const result = await buildCaseGuidance(clean, decision);
  assert.equal(canonical({ clean, decision }), before);
  assert.equal(result.actualComparison.firstRouteId, "mechanical-recycling");
  assert.equal(result.actualComparison.secondRouteId, null);
  assert.equal(result.actualComparison.actualSecondAvailable, false);
  assert.equal(result.actualComparison.costAdvantageKrw, null);
  assert.equal(result.actualComparison.stability.status, "unavailable");
  assert.equal(result.scenario, null);
  assert.equal(result.oneFactPriority.status, "not-held");
  assert.deepEqual(result.stages.map(row => row.stage), [1, 2, 3, 4, 5, 6]);
  assert.equal(result.stages.find(row => row.stage === 3)?.status, "partial");
  assert.equal(result.stages.find(row => row.stage === 4)?.status, "missing");
});

test("public-directory and hypothetical calculation outputs stay partial while numeric guidance stays separate", async () => {
  const catalog = await catalogPromise;
  const original = catalog.calculations.data.cases.find(row => row.case_id === "OYS-20261110-001")?.original;
  assert.ok(original);
  const input = { ...original, caseId: "research-guidance-case" };
  const decision = await createResourceDomain(input).decide();
  const research = buildCaseResearchAttachment(target(input), "OYS-20261110-001", catalog);
  const before = canonical({ input, decision, research, catalog });
  const result = await buildCaseGuidance(input, decision, { research });
  assert.equal(canonical({ input, decision, research, catalog }), before);
  assert.equal(result.scenario?.status, "conditionally-optimal");
  assert.equal(result.actualComparison.secondRouteId, null);
  assert.equal(result.stages.find(row => row.stage === 4)?.status, "partial");
  assert.equal(result.stages.find(row => row.stage === 5)?.status, "partial");
  assert.equal(result.stages.find(row => row.stage === 6)?.status, "partial");
});

for (const [label, patch] of [
  ["unknown resin", { polymer: null }],
  ["mixed resin", { polymer: "PET/HDPE 혼합" }],
  ["hazard", { hazardousContact: "yes" }],
  ["unknown contact", { hazardousContact: "unknown" }],
  ["missing contamination", { contamination: null }],
] satisfies readonly (readonly [string, Partial<CaseInput>])[]) {
  test(`${label} excludes numeric ranking and leaves actual decision unchanged`, async () => {
    const input = { ...clean, ...patch };
    const decision = await createResourceDomain(input).decide();
    const context = buildPublicInputScenario(target(input), await catalogPromise);
    const before = canonical({ input, decision, context });
    const result = await buildCaseGuidance(input, decision, context ? { publicScenario: context } : {});
    assert.equal(result.scenario, null);
    assert.equal(result.actualComparison.secondRouteId, null);
    assert.equal(canonical({ input, decision, context }), before);
    assert.ok(result.limitations.length);
    if (label === "hazard") assert.deepEqual(result.oneFactPriority.probes, []);
    if (label === "unknown resin") assert.equal(result.oneFactPriority.probes.some(row => row.field === "polymer"), false);
    if (label === "mixed resin") assert.deepEqual(result.oneFactPriority.probes.filter(row => row.field === "polymer")
      .map(row => row.hypotheticalValue).sort(), ["HDPE", "PET"]);
  });
}

test("single unresolved contact confirmation is prioritized by an executed public-domain effect", async () => {
  const input: CaseInput = { ...clean, hazardousContact: "unknown" };
  const decision = await createResourceDomain(input).decide();
  const result = await buildCaseGuidance(input, decision);
  assert.equal(result.oneFactPriority.priorityFactId, "hazardousContact:no");
  assert.equal(result.oneFactPriority.multipleFactsMayBeRequired, false);
  const probe = result.oneFactPriority.probes[0];
  assert.ok(probe);
  const independent = createResourceDomain({ ...input, hazardousContact: "no" });
  const after = await independent.decide();
  assert.equal(after.state, "compared");
  assert.equal(probe.resultingState, after.state);
  assert.deepEqual(probe.newlyRecommendedRouteIds, ["mechanical-recycling"]);
  assert.deepEqual(probe.newlySupportedRouteIds, []);
  assert.equal(probe.openedPathCount, 1);
  assert.ok(probe.strictRoutes.every(row => row.state === "unknown"));
  assert.deepEqual(probe.strictRoutes, independent.assess().routes.map(row => ({ routeId: row.routeId, state: row.eligibility.state })));
  assert.equal(input.hazardousContact, "unknown");
});

test("two unresolved facts retain no-route outcomes instead of silently combining confirmations", async () => {
  const input: CaseInput = { ...clean, contamination: null, hazardousContact: "unknown" };
  const result = await buildCaseGuidance(input, await createResourceDomain(input).decide());
  assert.equal(result.oneFactPriority.status, "evaluated");
  assert.equal(result.oneFactPriority.priorityFactId, null);
  assert.equal(result.oneFactPriority.multipleFactsMayBeRequired, true);
  assert.deepEqual(result.oneFactPriority.probes.map(row => [row.id, row.openedPathCount]),
    [["contamination:없음", 0], ["hazardousContact:no", 0]]);
  assert.ok(result.oneFactPriority.probes.every(row => row.resultingState !== "compared" && row.remainingUnknowns.length > 0));
});

test("unknown resin is never guessed from descriptive narrative", async () => {
  const input = { ...clean, polymer: null, description: "PET처럼 보인다는 미확인 서술" };
  const result = await buildCaseGuidance(input, await createResourceDomain(input).decide());
  assert.equal(result.oneFactPriority.priorityFactId, null);
  assert.deepEqual(result.oneFactPriority.probes, []);
  assert.equal(result.oneFactPriority.multipleFactsMayBeRequired, true);
});

test("photographs and hazardous narratives are not cleared to open a hypothetical route", async () => {
  for (const input of [
    { ...clean, polymer: "PET/HDPE", photoRefs: ["photo://original"] },
    { ...clean, contamination: "유해물질 접촉 의심", hazardousContact: "unknown" as const },
  ]) {
    const decision = await createResourceDomain(input).decide();
    const before = canonical({ input, decision });
    const result = await buildCaseGuidance(input, decision);
    assert.equal(canonical({ input, decision }), before);
    assert.equal(result.oneFactPriority.status, "limited");
    assert.deepEqual(result.oneFactPriority.probes, []);
    assert.equal(result.scenario, null);
  }
});

test("mismatched current research revision returns an explicit exclusion without a numeric result", async () => {
  const context = buildPublicInputScenario(target(clean), await catalogPromise);
  assert.ok(context);
  const input = { ...clean, massKg: 30 };
  const result = await buildCaseGuidance(input, await createResourceDomain(input).decide(), { publicScenario: context });
  assert.equal(result.scenario, null);
  assert.ok(result.limitations.length);
});

function estimate<Unit extends "KRW" | "kgCO2e">(unit: Unit, low: number, high: number): Estimate<Unit> {
  return { state: "available", low, central: (low + high) / 2, high, unit, evidenceIds: [], assumptions: ["test interval"] };
}
function scenario(routeId: string, costLow: number, costHigh: number, carbonLow: number, carbonHigh: number): ScenarioComparison {
  return { routeId, functionalUnit: "24 kg", boundary: "test-shared-boundary", costLines: [], carbonLines: [],
    netCost: estimate("KRW", costLow, costHigh), netEmissions: estimate("kgCO2e", carbonLow, carbonHigh),
    grossEmissions: { state: "unavailable", missingInputs: ["test"] },
    materialCredit: { state: "unavailable", missingInputs: ["test"] },
    energyCredit: { state: "unavailable", missingInputs: ["test"] }, avoidedEmissions: { state: "no-baseline" } };
}

test("actual interval stability requires both metrics against every modeled route and cannot invent a rank-two recommendation", async () => {
  const publicDecision = await createResourceDomain(clean).decide();
  assert.equal(publicDecision.state, "compared");
  if (publicDecision.state !== "compared") return;
  const base: Extract<DecisionResult, { state: "compared" }> = { ...publicDecision,
    scenarios: [scenario("mechanical-recycling", 1, 2, 3, 4), scenario("disposal", 2, 5, 4, 7)] };
  const boundary = await buildCaseGuidance(clean, base);
  assert.equal(boundary.actualComparison.stability.status, "sufficient");
  assert.equal(boundary.actualComparison.stability.costMarginKrw, 0);
  assert.equal(boundary.actualComparison.stability.carbonMarginKgCo2e, 0);
  assert.equal(boundary.actualComparison.actualSecondAvailable, false);
  assert.equal(boundary.actualComparison.secondRouteId, null);
  for (const other of [scenario("disposal", 1.99, 5, 4, 7), scenario("disposal", 2, 5, 3.99, 7),
    { ...scenario("disposal", 2, 5, 4, 7), boundary: "different-boundary" }]) {
    const result = await buildCaseGuidance(clean, { ...base, scenarios: [base.scenarios[0] ?? other, other] });
    assert.equal(result.actualComparison.stability.status, "unavailable");
  }
  const thirdRoute = await buildCaseGuidance(clean, { ...base,
    scenarios: [...base.scenarios, scenario("other-recovery", 0, 1, 10, 11)] });
  assert.equal(thirdRoute.actualComparison.stability.status, "unavailable");
});

test("an existing actual second rank exposes separate metric differences without assigning weights", async () => {
  const decision = await createResourceDomain(clean).decide();
  assert.equal(decision.state, "compared");
  if (decision.state !== "compared") return;
  const first = decision.recommendations?.[0];
  assert.ok(first);
  const result = await buildCaseGuidance(clean, { ...decision,
    recommendations: [first, { ...first, routeId: "disposal", rank: 2 }],
    scenarios: [scenario(first.routeId, 10, 20, 30, 40), scenario("disposal", 40, 50, 10, 20)] });
  assert.equal(result.actualComparison.secondRouteId, "disposal");
  assert.equal(result.actualComparison.actualSecondAvailable, true);
  assert.equal(result.actualComparison.costAdvantageKrw, 30);
  assert.equal(result.actualComparison.carbonAdvantageKgCo2e, -20);
  assert.equal(result.actualComparison.stability.status, "unavailable");
  assert.equal(result.actualComparison.stability.costMarginKrw, 20);
  assert.equal(result.actualComparison.stability.carbonMarginKgCo2e, -30);
});
