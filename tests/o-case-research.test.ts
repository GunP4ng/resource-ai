import assert from "node:assert/strict";
import { test } from "node:test";
import { Value } from "typebox/value";
import type { Type } from "typebox";
import fixtureJson from "../data/o-public-calculations/2026-11-15/fixtures.json" with { type: "json" };
import { fixtureSchema } from "../src/o-public-calculation-schema.ts";
import { readCaseResearchCatalog, buildCaseResearchAttachment, prepareResearchCaseRecord } from "../src/o-case-research.ts";
import type { ResearchTarget } from "../src/o-case-research.ts";
import { validateCaseResearchAttachment, validateResearchCaseArtifact } from "../src/o-case-research-validation.ts";
import { ResearchCaseArtifactSchema } from "../src/o-case-artifact.ts";
import { CaseResearchAttachmentSchema } from "../src/o-case-research-schema.ts";
import type { ResearchSourceCaseId } from "../src/o-case-research-schema.ts";
import { canonical, revision } from "../src/o-validation.ts";

const fixture = Value.Parse(fixtureSchema, fixtureJson);
const catalogPromise = readCaseResearchCatalog();
const signal = () => new AbortController().signal;
function target(sourceCaseId: ResearchSourceCaseId): ResearchTarget {
  const source = fixture.cases.find(c => c.case_id === sourceCaseId);
  assert.ok(source);
  const input = { ...source.original, caseId: `actual-${sourceCaseId}` };
  return { actorId: "authenticated-actor", input, inputRevision: revision(input) };
}
async function artifact(sourceCaseId: ResearchSourceCaseId = "OYS-20261110-001") {
  return prepareResearchCaseRecord({ ...target(sourceCaseId), codeRevision: "a".repeat(40), signal: signal() },
    sourceCaseId, await catalogPromise);
}

for (const [id, cost, carbon, baseline, energy] of [
  ["OYS-20261110-001", "-13867", "-27.51", "2761", "32.80"],
  ["OYS-20261110-002", "-5493", "-11.98", "2071", "25.60"],
  ["OYS-20261110-003", null, null, null, null],
] as const) test(`source ${id} preserves original history and shared engine display/null reasons`, async () => {
  const catalog = await catalogPromise;
  const b = buildCaseResearchAttachment(target(id), id, catalog), c = b.calculations;
  assert.ok(Value.Check(CaseResearchAttachmentSchema, b));
  assert.equal(c.sourceCaseId, id);
  assert.equal(c.cases.length, 1);
  assert.equal(c.cases[0].original.caseId, id);
  assert.equal(c.cases[0].assessment_date, "2026-11-10");
  assert.equal(c.cases[0].law_version, "290881");
  assert.equal(c.cases[0].original.massKg, id.endsWith("001") ? 24 : id.endsWith("002") ? 18 : null);
  assert.deepEqual(c.results.map(r => [r.case_id, r.route_id]), [
    [id, "recycling"], [id, "landfill"], [id, "energy_recovery"],
  ]);
  assert.deepEqual(c.results.map(r => [r.display.net_cost_krw, r.display.net_carbon_kgco2e]), [
    [cost, carbon], [baseline, id.endsWith("001") ? "0.53" : id.endsWith("002") ? "0.40" : null], [null, energy],
  ]);
  assert.ok(c.results.every(r => r.label === "공개 자료 기반 계산값(관측값 아님)"));
  assert.ok(c.results[2]?.missing_inputs.cost.includes("missing:f_inc"));
  if (cost === null) assert.ok(c.results.every(r => r.missing_inputs.cost.includes("missing_mass") && r.missing_inputs.carbon.includes("missing_mass")));
  assert.ok(c.inputs.filter(i => i.source_id === null).every(i => i.assumption_reason?.trim()));
  assert.ok(c.inputs.every(i => i.depends_on_input_ids.every(dep => c.inputs.some(upstream => upstream.input_id === dep))));
  assert.deepEqual(validateCaseResearchAttachment(b, target(id), catalog), b);
});

test("source selection never remaps by polymer or permits changed input facts after revision resealing", async () => {
  const catalog = await catalogPromise, actual = target("OYS-20261110-001");
  assert.throws(() => buildCaseResearchAttachment(actual, "OYS-20261110-002", catalog), /E_SOURCE_INPUT/);
  for (const patch of [{ massKg: 25 }, { assessmentDate: "2026-11-16" }, { region: "울산광역시" },
    { hazardousContact: "yes" as const }, { description: "replacement history" }, { process: null }, { photoRefs: ["extra"] }]) {
    const input = { ...actual.input, ...patch };
    assert.throws(() => buildCaseResearchAttachment({ ...actual, input, inputRevision: revision(input) }, "OYS-20261110-001", catalog), /E_SOURCE_INPUT/);
  }
  const stale = { ...actual, inputRevision: "0".repeat(64) };
  assert.throws(() => buildCaseResearchAttachment(stale, "OYS-20261110-001", catalog), /E_RESEARCH_BINDING/);
});

test("editing a returned attachment cannot mutate the server's pinned catalog", async () => {
  const catalog = await catalogPromise, actual = target("OYS-20261110-001");
  const edited = Value.Parse(CaseResearchAttachmentSchema, buildCaseResearchAttachment(actual, "OYS-20261110-001", catalog));
  edited.calculations.cases[0].original.massKg = 99;
  const next = buildCaseResearchAttachment(actual, "OYS-20261110-001", catalog);
  assert.equal(next.calculations.cases[0].original.massKg, 24);
  assert.throws(() => validateCaseResearchAttachment(edited, actual, catalog), /E_RESEARCH_MISMATCH/);
});

test("processor inquiries preserve original row coordinates, duplicates, rights and exclusions without facility claims", async () => {
  const b = buildCaseResearchAttachment(target("OYS-20261110-001"), "OYS-20261110-001", await catalogPromise);
  const p = b.processors;
  assert.deepEqual(p.rows.map(r => r.listing.rowNumber), [25, 26, 27, 28, 29, 30, 31, 32]);
  assert.deepEqual(p.rows.map(r => r.listing.description), [...Array(4).fill("사업장폐기물소각업체"), ...Array(4).fill("사업장폐기물매립업체")]);
  assert.deepEqual(p.rows.filter(r => r.listing.name === "㈜코엔텍").map(r => r.listing.rowNumber), [25, 29]);
  assert.ok(p.rows.every(r => r.purpose === "disposal-inquiry" && r.serviceMatch === "unknown"
    && r.listing.serviceArea === "" && r.permit === "unverified" && r.acceptance === "unconfirmed"
    && r.caseWasteCode === null && r.listing.acceptedWasteCodes.length === 0 && r.rowSha256 === revision(r.listing)));
  assert.deepEqual(p.excludedRows, [...Array.from({ length: 21 }, (_, i) => ({ rowNumber: i + 2, reason: "municipal-collection-only" })),
    { rowNumber: 23, reason: "listed-service-area-not-matched" },
    { rowNumber: 24, reason: "listed-service-area-not-matched" }]);
  assert.equal(p.datasetSha256, "e6f7b9509db39006af30fe124a28d724a753a9ade2b7aec4c96d878362205bfc");
  assert.equal(p.source.derivedFrom, "794b619d7e0606ded9ebe447bb226fcebdbc442efeed69f625296f3fe39c68ed");
  assert.deepEqual(p.source.removedColumns, ["대표자", "전화번호"]);
  assert.ok(p.source.licenseVerified);
});

type RawArtifact = Type.Static<typeof ResearchCaseArtifactSchema>;
const mutations: readonly [string, (a: RawArtifact) => void][] = [
  ["actor", a => { a.record.research.binding.actorId = "other"; }],
  ["case", a => { a.record.research.binding.caseId = "other"; }],
  ["revision", a => { a.record.research.binding.inputRevision = "0".repeat(64); }],
  ["historical date", a => { a.record.research.binding.assessmentDate = "2026-11-16"; }],
  ["source case", a => { a.record.research.calculations.sourceCaseId = "OYS-20261110-001"; }],
  ["original", a => { a.record.research.calculations.cases[0].original.massKg = 99; }],
  ["provenance", a => { a.record.research.calculations.cases[0].provenance.collector = "field observer"; }],
  ["original hash", a => { a.record.research.calculations.originalSha256 = "0".repeat(64); }],
  ["provenance hash", a => { a.record.research.calculations.provenanceSha256 = "0".repeat(64); }],
  ["implementation", a => { a.record.research.calculations.implementation.sha256 = "0".repeat(64); }],
  ["rights promotion", a => { const s = a.record.research.calculations.sources.find(s => s.source_id === "WARM"); assert.ok(s); s.commercial_use = "allowed_with_conditions"; }],
  ["source cells", a => { const s = a.record.research.calculations.sources[0]?.selected_cells[0]; assert.ok(s); s.value = 1; }],
  ["generic PE relabel", a => { const i = a.record.research.calculations.inputs.find(i => i.input_id === "price.PE"); assert.ok(i); i.input_id = "price.HDPE"; }],
  ["fee dependency", a => { const i = a.record.research.calculations.inputs.find(i => i.input_id === "f"); assert.ok(i); i.depends_on_input_ids = []; }],
  ["assumption reason", a => { const i = a.record.research.calculations.inputs.find(i => i.input_id === "HDPE.price"); assert.ok(i); i.assumption_reason = null; }],
  ["display", a => { const r = a.record.research.calculations.results[0]; assert.ok(r); r.display.net_cost_krw = "123"; }],
  ["null reason", a => { const r = a.record.research.calculations.results[2]; assert.ok(r); r.missing_inputs.cost = []; }],
  ["period", a => { const i = a.record.research.calculations.inputs[0]; assert.ok(i); i.period = "today"; }],
  ["processor lineage", a => { a.record.research.processors.source.derivedFrom = "0".repeat(64); }],
  ["processor row", a => { const r = a.record.research.processors.rows[0]; assert.ok(r); r.listing.rowNumber = 22; r.rowSha256 = revision(r.listing); }],
  ["extra field", a => { Reflect.set(a.record.research.calculations, "approved", true); }],
  ["commercial declaration", a => { Reflect.set(a.record.research.use, "commercialExport", "allowed"); }],
  ["model declaration", a => { Reflect.set(a.record.research.use, "modelTransmission", "allowed"); }],
  ["cached assessment", a => { a.record.assessment = {}; }],
  ["operational resources", a => { Reflect.set(a.record.resources, "calculations", {}); }],
];
for (const [name, mutate] of mutations) test(`outer resealing cannot authorize changed ${name}`, async () => {
  const a = Value.Parse(ResearchCaseArtifactSchema, await artifact("OYS-20261110-002"));
  mutate(a); a.sha256 = revision(a.record);
  await assert.rejects(validateResearchCaseArtifact(a, target("OYS-20261110-002"), await catalogPromise, signal()), /E_RESEARCH|E_SOURCE_INPUT/);
});

test("v2 requires the actual actor binding and preserves v1 resources/origin semantics", async () => {
  const a = await artifact(), actual = target("OYS-20261110-001"), catalog = await catalogPromise;
  assert.equal(a.record.version, 2);
  assert.equal(a.sha256, revision(a.record));
  assert.deepEqual(a.record.resources, {});
  assert.equal(a.record.dataOrigin.kind, "synthetic");
  assert.equal(a.record.caseRevision, actual.inputRevision);
  assert.equal(a.record.research.calculations.cases[0].original.caseId, "OYS-20261110-001");
  const declarations = a.record.research.use;
  assert.deepEqual(declarations, { display: "authenticated-research", storage: "private-runtime",
    redistribution: "not-authorized-by-package", commercialExport: "excluded", modelTransmission: "excluded" });
  assert.equal(canonical(await validateResearchCaseArtifact(a, actual, catalog, signal())), canonical(a));
  assert.ok(!canonical(a.record.input).includes("WARM"));
  assert.ok(!canonical(a.record.resources).includes("research"));
  await assert.rejects(validateResearchCaseArtifact(a, { ...actual, actorId: "another-actual-actor" }, catalog, signal()), /E_RESEARCH_MISMATCH/);
  const absent = { ...actual }; Reflect.deleteProperty(absent, "actorId");
  await assert.rejects(validateResearchCaseArtifact(a, absent, catalog, signal()), /E_ACTOR_BINDING/);
});
