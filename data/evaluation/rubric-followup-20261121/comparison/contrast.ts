import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createResourceDomain } from "../../../../src/domain.ts";
import { parseCaseInput } from "../../../../src/input.ts";
import { parseDecision } from "../../../../src/o-decision.ts";
import { Type } from "typebox";
import { CaseInputSchema } from "../../../../src/o-public-calculation-schema.ts";
import { parse, sha } from "../../../../src/o-public-calculation-validation.ts";
import { design, root, save, hashObject, readJson } from "./local.ts";

export const contrastSchema = Type.Array(Type.Object({
  id: Type.String(), input: CaseInputSchema, input_sha256: Type.String(),
  state: Type.String(), first_recommended_route: Type.Union([Type.String(), Type.Null()]),
  result: Type.Unknown(), source_sha256: Type.String(),
}));

export async function contrastInputs() {
  const bytes = await readFile(join(root, design.contrast.baseline_path));
  assert.equal(sha(bytes), design.contrast.baseline_sha256);
  const parsed = parseCaseInput(JSON.parse(bytes.toString("utf8")));
  assert.ok(parsed.ok);
  const inputs = design.contrast.polymer_levels.flatMap((polymer, i) =>
    design.contrast.contamination_levels.map((contamination, j) => ({
      id: `contrast-${i + 1}-${j + 1}`, input: { ...parsed.value, polymer, contamination },
    })));
  assert.equal(inputs.length, 36);
  for (const { input } of inputs) {
    const { polymer: _p, contamination: _c, ...fixed } = input;
    const { polymer: _bp, contamination: _bc, ...baseline } = parsed.value;
    assert.deepEqual(fixed, baseline);
  }
  return inputs;
}

export async function runContrasts(source_sha256: string) {
  const inputs = await contrastInputs();
  // Persist the complete finite input list before the first domain call.
  await save("contrast-inputs.json", inputs);
  const rows = [];
  for (const { id, input } of inputs) {
    const result = await createResourceDomain(input).decide();
    const first = result.state === "compared" ? result.recommendations?.[0]?.routeId ?? null : null;
    rows.push({ id, input, input_sha256: hashObject(input), source_sha256,
      state: result.state, first_recommended_route: first, result });
  }
  await save("contrasts.json", rows);
}

export async function verifyContrasts(source_sha256: string) {
  const rows = parse(contrastSchema, await readJson("contrasts.json"));
  const inputs = await contrastInputs();
  assert.deepEqual(await readJson("contrast-inputs.json"), inputs);
  assert.equal(rows.length, 36);
  for (const [i, row] of rows.entries()) {
    assert.deepEqual({ id: row.id, input: row.input }, inputs[i]);
    assert.equal(row.source_sha256, source_sha256);
    assert.equal(row.input_sha256, hashObject(row.input));
    const result = parseDecision(row.result);
    assert.equal(row.state, result.state);
    const first = result.state === "compared" ? result.recommendations?.[0]?.routeId ?? null : null;
    assert.equal(row.first_recommended_route, first);
    if (result.state === "compared") {
      assert.ok(result.recommendations?.every(r => r.routeId === "mechanical-recycling" && r.rank === 1));
      assert.ok(result.routes.every(r => r.eligibility.state !== "eligible"));
    }
  }
  const firstRoutes = [...new Set(rows.flatMap(row => row.first_recommended_route === null ? [] : [row.first_recommended_route]))];
  return {
    decisions: rows.length,
    states: Object.fromEntries([...new Set(rows.map(row => row.state))].map(state => [state, rows.filter(row => row.state === state).length])),
    first_routes: firstRoutes,
    recommended: rows.filter(row => row.first_recommended_route !== null).length,
    withdrawn_or_absent: rows.filter(row => row.first_recommended_route === null).length,
    first_route_switch_found: firstRoutes.length > 1,
    finite_conclusion: "This declared 36-input grid contains no switch between distinct first recommended routes. Withdrawal or state changes are separate outcomes.",
    invariant_scope: "Source proof for default resources only: assessCase gives unknown without supplied route reviews; recommend fallback makes only mechanical-recycling conditional. Fixed priority never sorts by cost/carbon. This is not a proof for arbitrary supplied reviews, future code/registries or all possible configurations.",
    source_locations: ["src/assessment.ts:154", "src/recommendation.ts:77", "src/recommendation.ts:81", "src/domain.ts:135"],
  };
}
