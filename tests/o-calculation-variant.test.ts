import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCalculationVariant, CalculationVariantError } from "../src/o-calculation-variant.ts";
import { buildCaseResearchAttachment, readCaseResearchCatalog } from "../src/o-case-research.ts";
import { buildPublicInputScenario } from "../src/o-input-public-scenario.ts";
import { revision } from "../src/o-validation.ts";
import { Invalid } from "../src/o-public-calculation-validation.ts";

const catalog = readCaseResearchCatalog();
for (const sourceCaseId of ["OYS-20261110-001", "OYS-20261110-002"] as const) {
  test(`${sourceCaseId} variants rebuild fee and price hypotheses without altering prepared parents`, async () => {
    const data = await catalog;
    const source = data.calculations.data.cases.find(item => item.case_id === sourceCaseId);
    assert.ok(source);
    const target = { actorId: "variant-owner", input: source.original, inputRevision: revision(source.original) };
    const research = buildCaseResearchAttachment(target, sourceCaseId, data);
    const publicScenario = buildPublicInputScenario(target, data);
    assert.ok(publicScenario);
    for (const context of [research, publicScenario]) {
      const original = JSON.stringify(context), pinned = JSON.stringify(data.calculations);
      const variant = buildCalculationVariant(context, [{ inputId: "f_inc", value: 0 }], "사용자 회신 가정");
      const input = variant.calculations.inputs.find(item => item.input_id === "f_inc");
      assert.ok(input);
      assert.deepEqual([input.kind, input.source_id, input.source_value, input.source_unit, input.cell_id,
        input.missing_reason, input.value], ["assumed", null, null, null, null, null, 0]);
      const value = (id: string) => {
        const item = context.calculations.inputs.find(row => row.input_id === id);
        assert.ok(item && item.value !== null);
        return item.value;
      };
      const mass = context.calculations.cases[0]?.mass_t;
      assert.ok(mass);
      const result = variant.calculations.results.find(item => item.route_id === "energy_recovery");
      assert.equal(result?.net_cost_krw, mass * value("c") + mass * value("d0") * value("r"));
      assert.equal(context.calculations.results.find(item => item.route_id === "energy_recovery")?.net_cost_krw, null);
      const price = buildCalculationVariant(variant, [{ inputId: `${source.material}.price`, value: 0 }], "매각 가격 가정");
      assert.equal(price.calculations.results.find(item => item.route_id === "recycling")?.revenue_krw, 0);
      assert.equal(price.calculations.inputs.find(item => item.input_id === `${source.material}.price`)?.source_id, null);
      assert.equal(price.provenance.parentFixtureSha256, variant.provenance.derivedDatasetSha256);
      assert.equal(price.provenance.parentManifestSha256, variant.provenance.derivedProvenanceSha256);
      assert.equal(variant.provenance.parentFixtureSha256, context.purpose === "research-display"
        ? context.calculations.fixtureSha256 : context.provenance.derivedDatasetSha256);
      assert.deepEqual(variant.use, context.use);
      assert.deepEqual(variant.binding, context.binding);
      assert.ok(price.assumptions.includes("사용자 회신 가정"));
      assert.equal(JSON.stringify(context), original);
      assert.equal(JSON.stringify(data.calculations), pinned);
      assert.equal(context.calculations.inputs.find(item => item.input_id === "f_inc")?.value, null);
    }
  });
}

test("variant boundary rejects unknown IDs, duplicate overrides and nonfinite values; engine rejects overflow", async () => {
  const data = await catalog, source = data.calculations.data.cases[0];
  assert.ok(source);
  const context = buildCaseResearchAttachment({ actorId: "variant-owner", input: source.original,
    inputRevision: revision(source.original) }, "OYS-20261110-001", data);
  for (const overrides of [
    [{ inputId: "material.price", value: 1 }],
    [{ inputId: "f_inc", value: 1 }, { inputId: "f_inc", value: 2 }],
    [{ inputId: "f_inc", value: Infinity }],
    [{ inputId: "f_inc", value: NaN }],
  ]) assert.throws(() => buildCalculationVariant(context, overrides, "가정"), CalculationVariantError);
  assert.throws(() => buildCalculationVariant(context, [], " "), CalculationVariantError);
  assert.throws(() => buildCalculationVariant(context, [
    { inputId: "r", value: Number.MAX_VALUE }, { inputId: "d0", value: Number.MAX_VALUE }],
    "과도한 가정"), (error: unknown) => error instanceof Invalid && error.code === "E_FINITE");
});
