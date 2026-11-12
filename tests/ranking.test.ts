import { test } from "node:test";
import assert from "node:assert/strict";
import type { Estimate, ScenarioComparison } from "../src/contracts.ts";
import { demo } from "../src/o-demo.ts";
import { rankScenarios } from "../src/ranking.ts";

const amount = <U extends "KRW" | "kgCO2e">(low: number, high: number, unit: U): Estimate<U> =>
  ({ state: "available", low, central: (low + high) / 2, high, unit, evidenceIds: ["synthetic-evidence"], assumptions: [] });

async function fixture() {
  const output = await demo("normal");
  if (output?.result.state !== "compared") throw new Error("Missing compared fixture");
  return output.result;
}

test("keeps an empty comparison unranked", () => {
  assert.deepEqual(rankScenarios([], []), []);
});

test("prioritizes the cheaper eligible quotation with equal emissions, preserving scenario identity", async () => {
  const result = await fixture();
  assert.deepEqual(rankScenarios(result.scenarios, result.routes).map((item) => [item.scenarioIndex, item.group]), [[1, 1], [0, 2]]);
});

for (const kind of ["tie", "tradeoff", "overlap"] as const) test(`does not invent an order within ${kind} Pareto candidates`, async () => {
  const result = await fixture();
  const scenarios = result.scenarios.map((scenario, index): ScenarioComparison => ({
    ...scenario,
    netCost: amount(index === 0 || kind === "tie" ? 10 : kind === "overlap" ? 15 : 20, kind === "overlap" ? 30 : index === 0 || kind === "tie" ? 10 : 20, "KRW"),
    netEmissions: amount(kind === "tradeoff" && index === 1 ? 5 : 10, 10, "kgCO2e"),
  }));
  assert.deepEqual(rankScenarios(scenarios, result.routes).map((item) => item.group), [1, 1]);
});

for (const kind of ["unavailable", "unavailable-carbon", "unknown", "ineligible", "boundary", "unit"] as const) test(
  `withholds unjustified priority for ${kind} inputs`, async () => {
    const result = await fixture();
    const scenarios = result.scenarios.map((scenario, index): ScenarioComparison => ({
      ...scenario,
      ...(index === 0 && kind === "unavailable" ? { netCost: { state: "unavailable", missingInputs: ["quote-missing"] } } : {}),
      ...(index === 0 && kind === "unavailable-carbon" ? { netEmissions: { state: "unavailable", missingInputs: ["factor-missing"] } } : {}),
      ...(index === 0 && kind === "boundary" ? { boundary: "other-boundary" } : {}),
      ...(index === 0 && kind === "unit" ? { functionalUnit: "other-mass" } : {}),
    }));
    const routes = result.routes.map((route) => ({
      ...route,
      eligibility: kind === "unknown" ? { state: "unknown", missingFacts: ["permit"] } as const
        : kind === "ineligible" ? { state: "ineligible", evidenceIds: ["synthetic-evidence"], reasons: ["permit"] } as const : route.eligibility,
    }));
    assert.deepEqual(rankScenarios(scenarios, routes).map((item) => item.group), [null, null]);
  },
);
