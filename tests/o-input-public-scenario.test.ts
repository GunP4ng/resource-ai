import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaseInput } from "../src/contracts.ts";
import { readCaseResearchCatalog } from "../src/o-case-research.ts";
import { buildPublicInputScenario, publicScenarioEligibility } from "../src/o-input-public-scenario.ts";
import { revision } from "../src/o-validation.ts";
import type { PublicCalculationResult } from "../src/o-public-calculation-schema.ts";

const catalog = readCaseResearchCatalog();
const input: CaseInput = { caseId: "ordinary-case", description: "사용자가 입력한 자투리",
  process: "현장 공정", polymer: "PET", contamination: "확인 필요", hazardousContact: "unknown",
  massKg: 24, region: "서울", assessmentDate: "2026-11-19", photoRefs: [] };
const target = (value: CaseInput) => ({ actorId: "owner", input: value, inputRevision: revision(value) });

for (const [material, mass, sourceCaseId] of [
  ["PET", 24, "OYS-20261110-001"], ["HDPE", 18, "OYS-20261110-002"],
] as const) test(`${material} user mass scales raw amounts while parent assumptions and null incineration remain`, async () => {
  const data = await catalog;
  const originalCatalog = structuredClone(data.calculations);
  const smallInput = { ...input, polymer: ` ${material.toLowerCase()} `, massKg: mass };
  const largeInput = { ...smallInput, massKg: mass * 2 };
  const smallTarget = target(smallInput), savedTarget = structuredClone(smallTarget);
  const small = buildPublicInputScenario(smallTarget, data);
  const large = buildPublicInputScenario(target(largeInput), data);
  assert.ok(small && large);
  assert.deepEqual(smallTarget, savedTarget);
  const parent = data.calculations.data.cases.find(item => item.case_id === sourceCaseId);
  assert.ok(parent);
  assert.equal(small.sourceCaseId, sourceCaseId);
  assert.deepEqual(small.binding, { actorId: "owner", caseId: input.caseId,
    inputRevision: revision(smallInput), assessmentDate: input.assessmentDate });
  assert.equal(small.userMassKg, mass);
  const selected = small.calculations.cases[0];
  assert.ok(selected);
  assert.notEqual(selected.case_id, sourceCaseId);
  assert.ok(selected.case_id.includes(revision(smallInput)));
  assert.notEqual(selected.case_id, large.calculations.cases[0]?.case_id);
  assert.deepEqual(selected, { ...parent, case_id: selected.case_id, mass_t: mass / 1000 });
  for (const item of small.calculations.inputs) {
    const parentInput = data.calculations.data.inputs.find(value => value.input_id === item.input_id);
    assert.ok(parentInput);
    if (item.input_id === `${material}.mass`) {
      assert.equal(item.value, mass / 1000);
      assert.equal(item.quality_grade, "user_input_unverified");
      assert.equal(item.source_id, null);
    } else assert.deepEqual(item, parentInput);
  }
  for (const row of small.calculations.results) {
    const doubled: PublicCalculationResult | undefined = large.calculations.results.find(item => item.route_id === row.route_id);
    assert.ok(doubled);
    for (const key of ["net_cost_krw", "net_carbon_kgco2e", "cost_saving_krw", "scenario_carbon_difference_kgco2e"] as const) {
      assert.equal(doubled[key], row[key] === null ? null : row[key] * 2);
    }
    assert.deepEqual(doubled.per_tonne, row.per_tonne);
    if (row.route_id === "energy_recovery") {
      assert.equal(row.net_cost_krw, null);
      assert.ok(row.missing_inputs.cost.includes("missing:f_inc"));
    }
  }
  const derivedDataset = { ...data.calculations.data,
    cases: [selected],
    inputs: data.calculations.data.inputs.map(item => small.calculations.inputs.find(value => value.input_id === item.input_id) ?? item) };
  assert.equal(small.provenance.derivedDatasetSha256, revision(derivedDataset));
  const { derivedProvenanceSha256, implementation, ...hashes } = small.provenance;
  assert.equal(derivedProvenanceSha256, revision({ binding: small.binding, sourceCaseId, material,
    userMassKg: mass, ...hashes, assumptions: small.assumptions }));
  assert.equal(small.provenance.parentOriginalSha256, parent.original_sha256);
  assert.equal(small.provenance.parentProvenanceSha256, revision(parent.provenance));
  assert.equal(small.provenance.parentFixtureSha256, data.calculations.fixture_sha256);
  assert.equal(small.provenance.parentManifestSha256, data.calculations.manifest_sha256);
  assert.deepEqual(implementation, data.calculations.implementation);
  assert.notEqual(small.provenance.derivedDatasetSha256, large.provenance.derivedDatasetSha256);
  assert.notEqual(derivedProvenanceSha256, large.provenance.derivedProvenanceSha256);
  assert.equal(Object.hasOwn(small.calculations, "fixture_sha256"), false);
  assert.equal(Object.hasOwn(small.calculations, "verification"), false);
  assert.deepEqual(small.use, { display: "authenticated-research", storage: "private-runtime",
    redistribution: "not-authorized-by-package", commercialExport: "excluded", modelTransmission: "excluded" });
  assert.notEqual(selected.original, parent.original);
  assert.notEqual(small.calculations.inputs[0], data.calculations.data.inputs[0]);
  assert.deepEqual(data.calculations, originalCatalog);
});

test("unsupported or mixed polymers and missing nonpositive or nonfinite masses have no scenario", async () => {
  const data = await catalog;
  for (const polymer of [null, "", "unknown", "PP", "PET/HDPE", "PET mixed", "PET+PP"]) {
    assert.equal(buildPublicInputScenario(target({ ...input, polymer }), data), null);
  }
  for (const massKg of [null, 0, -1, NaN, Infinity, -Infinity, 1000001, 1e306]) {
    assert.equal(buildPublicInputScenario(target({ ...input, massKg }), data), null);
  }
  assert.throws(() => buildPublicInputScenario({ ...target(input), inputRevision: "a".repeat(64) }, data));
  assert.throws(() => buildPublicInputScenario({ ...target(input), actorId: "" }, data));
});

test("#111 public calculations use the same explicit PET and HDPE aliases as the decision", async () => {
  const data = await catalog;
  for (const [polymer, material] of [
    ["PET(폴리에틸렌테레프탈레이트)", "PET"],
    ["Polyethylene terephthalate", "PET"], ["ＰＥＴ", "PET"],
    ["HDPE(고밀도 폴리에틸렌)", "HDPE"], ["High-density polyethylene", "HDPE"],
  ] as const) {
    const facts = { ...input, polymer };
    assert.deepEqual(publicScenarioEligibility(facts), { status: "available", material, massKg: 24 });
    const result = buildPublicInputScenario(target(facts), data);
    assert.ok(result);
    assert.equal(result.material, material);
    assert.equal(result.binding.inputRevision, revision(facts));
  }
});
