import assert from "node:assert/strict";
import { test } from "node:test";
import { createSyntheticResourceApp as createResourceApp } from "./synthetic-runtime.ts";
import { createCaseStore } from "../src/o-case-store.ts";
import { parseCaseInput } from "../src/input.ts";
import { readCaseResearchCatalog } from "../src/o-case-research.ts";
import { buildPublicCalculations } from "../src/o-public-calculation-engine.ts";

const origin = "http://localhost:3000";
const fields = { description: "QA 질량 극단값", process: "사출", polymer: "PET",
  contamination: "없음", hazardousContact: "no", massKg: "1e306", region: "울산", assessmentDate: "2026-11-25" };
const post = (path: string, values: Readonly<Record<string, string>>) => new Request(origin + path, {
  method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(values),
});
async function draftValues(response: Response) {
  const values: Record<string, string> = {};
  await new HTMLRewriter().on("input", { element(el) {
    const name = el.getAttribute("name");
    if (name) values[name] = el.getAttribute("value") ?? "";
  } }).on("textarea", { element(el) { values[el.getAttribute("name") ?? ""] = ""; },
    text(chunk) { values["description"] = (values["description"] ?? "") + chunk.text; } })
    .transform(response).text();
  return values;
}

test("issue #112 rejects oversized native mass with a retained draft before saving or evaluating", async () => {
  const store = createCaseStore();
  let evaluations = 0;
  const app = createResourceApp({ origin, caseStore: store, actorForRequest: async () => "mass-owner",
    runner: async () => { evaluations++; return {}; } });
  try {
    for (const polymer of ["PET", "HDPE", "PP"]) {
      for (const massKg of ["1000001", "1e305", "1e306", "1e308", "1e309"]) {
        const response = await app.fetch(post("/cases", { ...fields, polymer, massKg }));
        assert.equal(response.status, 400, `${polymer}/${massKg}`);
        const draft = await draftValues(response);
        assert.equal(draft["massKg"], massKg);
        assert.equal(draft["polymer"], polymer);
        assert.equal(draft["description"], fields.description);
        assert.equal(draft["region"], fields.region);
      }
    }
    assert.equal(evaluations, 0);
    assert.deepEqual(store.list("actor:mass-owner"), []);
  } finally { await app.close(); }
});

test("issue #112 accepts the mass boundary and keeps saved facts when an edit exceeds it", async () => {
  const store = createCaseStore();
  const app = createResourceApp({ origin, caseStore: store, actorForRequest: async () => "mass-owner" });
  try {
    const created = await app.fetch(post("/cases", { ...fields, massKg: "1000000" }));
    assert.equal(created.status, 303);
    const path = created.headers.get("location");
    assert.ok(path);
    assert.equal((await app.fetch(new Request(origin + path))).status, 200);
    const before = store.read("actor:mass-owner", path.slice("/cases/".length));
    assert.ok(before);
    const edited = await app.fetch(post(path + "/answers", { answerMode: "fields",
      baseVersion: String(before.version), field_massKg: "1e306", field_description: "수정 초안" }));
    assert.equal(edited.status, 400);
    const draft = await draftValues(edited);
    assert.equal(draft["field_massKg"], "1e306");
    assert.equal(draft["description"], "수정 초안");
    assert.deepEqual(store.read("actor:mass-owner", before.input.caseId), before);
    assert.equal(parseCaseInput({ ...before.input, massKg: 1000001 }).ok, false);
    assert.equal(parseCaseInput({ ...before.input, massKg: null }).ok, true);
  } finally { await app.close(); }
});

test("issue #112 arithmetic overflow becomes unavailable with a reason rather than a rendering exception", async () => {
  const verified = (await readCaseResearchCatalog()).calculations;
  const source = verified.data.cases.find(item => item.material === "PET");
  assert.ok(source);
  const results = buildPublicCalculations({ ...verified, data: { ...verified.data,
    cases: [{ ...source, mass_t: 1e308 }] } }).results;
  for (const result of results) {
    assert.equal(result.net_cost_krw, null);
    assert.equal(result.net_carbon_kgco2e, null);
    assert.equal(result.cost_saving_krw, null);
    assert.equal(result.scenario_carbon_difference_kgco2e, null);
    assert.equal(result.availability.cost, "unavailable");
    assert.equal(result.availability.carbon, "unavailable");
    assert.ok(result.missing_inputs.cost.includes("arithmetic_overflow") || result.missing_inputs.cost.includes("missing:f_inc"));
    assert.ok(result.missing_inputs.carbon.includes("arithmetic_overflow"));
    assert.deepEqual(result.per_tonne, { cost_krw: null, carbon_kgco2e: null });
    assert.deepEqual(Object.values(result.display), [null, null, null, null]);
  }
});
