import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/app.ts";
import { HttpFailure } from "../src/app-http.ts";
import { createCaseStore } from "../src/o-case-store.ts";
import type { CaseReport } from "../src/o-case-store.ts";
import type { CaseInput, DecisionResult } from "../src/contracts.ts";
import { readCaseResearchCatalog } from "../src/o-case-research.ts";
import { createResourceDomain } from "../src/domain.ts";
import { revision } from "../src/o-validation.ts";

const origin = "http://localhost:3000";
const catalog = readCaseResearchCatalog();
async function setup(material: "PET" | "HDPE" = "PET", patch: Partial<CaseInput> = {}) {
  const data = await catalog, source = data.calculations.data.cases.find(item => item.material === material);
  assert.ok(source);
  const input = { ...source.original, caseId: `reply-${material}`, ...patch };
  const store = createCaseStore();
  const decision = await createResourceDomain(input).decide();
  const lease = store.begin("actor:reply-owner", input.caseId, null);
  await store.run(lease, input, async () => ({ decision }));
  store.commit(lease, { decision }, () => {});
  const saved = store.readReport("actor:reply-owner", input.caseId);
  assert.ok(saved);
  let actor: string | null = "reply-owner", identityCurrent = true, writes = 0, evaluations = 0;
  let mapReport = (report: CaseReport): CaseReport => report;
  const forbiddenWrite = () => { writes++; throw new Error("preview attempted a case write"); };
  const app = createApp({ origin, actorForRequest: async () => actor ? {
    actorId: actor, validUntil: Date.now() + 60000,
    assertCurrent: () => { if (!identityCurrent) throw new HttpFailure(403, "권한이 변경되었습니다."); },
  } : null, caseStore: { ...store, begin: forbiddenWrite, commit: forbiddenWrite, run: forbiddenWrite,
    readReport(owner, id) { const result = store.readReport(owner, id); return result ? mapReport(result) : result; } },
    preparer: { prepareSubmit: forbiddenWrite, prepareAnswer: forbiddenWrite,
      evaluate: async () => { evaluations++; throw new Error("preview attempted evaluation"); } },
  });
  const path = `/cases/${input.caseId}`;
  const fields = {
    baseVersion: saved.snapshot.version, inputRevision: revision(input), companyName: "신고 업체",
    acceptance: "unknown", permitCheckDate: "", sourceNote: "", inputId: "f_inc",
    unit: data.calculations.data.inputs.find(item => item.input_id === "f_inc")?.unit,
    amount: "0", hypotheticalAcknowledgement: "yes",
  };
  const post = (changes: Record<string, unknown> = {}, headers: Record<string, string> = {}) => app(new Request(origin + path + "/inquiry-reply", {
    method: "POST", headers: { origin, "content-type": "application/json", ...headers },
    body: JSON.stringify({ ...fields, ...changes }),
  }));
  return { app, store, input, saved, path, fields, post,
    setActor(value: string | null) { actor = value; },
    revoke() { identityCurrent = false; },
    map(value: typeof mapReport) { mapReport = value; },
    assertReadOnly() { assert.equal(writes, 0); assert.equal(evaluations, 0);
      assert.deepEqual(store.readReport("actor:reply-owner", input.caseId), saved); },
    dispose() { app.dispose(); store.dispose(); },
  };
}
async function results(response: Response) {
  const rows: { route: string; cells: string[] }[] = [];
  let current: { route: string; cells: string[] } | undefined, cell = -1;
  await new HTMLRewriter().on("[data-reply-result]", { element(element) {
    current = { route: element.getAttribute("data-reply-result") ?? "", cells: [] }; rows.push(current);
  } }).on("[data-reply-result] td", { element() { if (current) cell = current.cells.push("") - 1; },
    text(chunk) { if (current) current.cells[cell] += chunk.text; },
  }).transform(response).text();
  return rows;
}
for (const material of ["PET", "HDPE"] as const) {
  test(`${material} owner follows inquiry link and previews exact zero without changing actual records`, async () => {
    const env = await setup(material);
    try {
      assert.equal(env.saved.snapshot.assessment.decision.state, "compared");
      let target = "";
      await new HTMLRewriter().on("[data-inquiry-reply-link]", { element(element) {
        target = element.getAttribute("href") ?? "";
      } }).transform(await env.app(new Request(origin + env.path + "/inquiry"))).text();
      assert.equal(target, env.path + "/inquiry-reply");
      const form = await env.app(new Request(origin + target));
      assert.equal(form.status, 200);
      const values: Record<string, string | null> = {};
      await new HTMLRewriter().on("input[name=baseVersion], input[name=inputRevision]", { element(element) {
        values[element.getAttribute("name") ?? ""] = element.getAttribute("value");
      } }).transform(form).text();
      assert.deepEqual(values, { baseVersion: String(env.saved.snapshot.version), inputRevision: revision(env.input) });
      const response = await env.post({ acceptance: "no" });
      assert.equal(response.status, 200);
      const rows = await results(response);
      const awaitedCatalog = await catalog;
      const cost = (id: string) => {
        const item = awaitedCatalog.calculations.data.inputs.find(row => row.input_id === id);
        assert.ok(item && item.value !== null); return item.value;
      };
      const mass = env.input.massKg;
      assert.ok(mass);
      const expected = mass / 1000 * cost("c") + mass / 1000 * cost("d0") * cost("r");
      assert.equal(rows.find(row => row.route === "energy_recovery")?.cells[0], "값 없음");
      assert.equal(Number(rows.find(row => row.route === "energy_recovery")?.cells[1]), Math.round(expected));
      assert.equal((await env.app(new Request(origin + env.path + "/report"))).status, 200);
      env.assertReadOnly();
    } finally { env.dispose(); }
  });
}

test("empty amount stays missing and native form submission accepts an explicit zero hypothesis", async () => {
  const env = await setup();
  try {
    assert.deepEqual(await results(await env.post({ amount: "" })), []);
    const response = await env.app(new Request(origin + env.path + "/inquiry-reply", {
      method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(Object.entries(env.fields).map(([key, value]) => [key, String(value)])),
    }));
    assert.equal(response.status, 200);
    assert.equal((await results(response)).length, 3);
    env.assertReadOnly();
  } finally { env.dispose(); }
});

test("each selectable reply amount uses the selected model input and keeps fee missing on sale hypotheses", async () => {
  const env = await setup();
  try {
    const data = await catalog;
    for (const inputId of ["f_inc", "f_rec", "PET.price"]) {
      const unit = data.calculations.data.inputs.find(item => item.input_id === inputId)?.unit;
      const response = await env.post({ inputId, unit, amount: inputId === "f_rec" ? "90000" : "0" });
      assert.equal(response.status, 200);
      const rows = await results(response);
      assert.equal(rows.length, 3);
      const incineration = rows.find(row => row.route === "energy_recovery");
      assert.equal(incineration?.cells[0], "값 없음");
      if (inputId !== "f_inc") assert.equal(incineration?.cells[1], "값 없음");
      const recycling = rows.find(row => row.route === "recycling");
      assert.ok(recycling);
      if (inputId !== "f_inc") assert.notEqual(recycling.cells[0], recycling.cells[1]);
    }
    env.assertReadOnly();
  } finally { env.dispose(); }
});

test("reply boundary rejects invalid values, units, IDs, acknowledgement and foreign origins", async () => {
  const env = await setup();
  try {
    for (const changes of [
      { amount: "-1" }, { amount: "Infinity" }, { amount: "NaN" }, { amount: "1e999" },
      { amount: "0x10" }, { amount: true }, { unit: "KRW/kg" }, { inputId: "PET.y" },
      { inputId: "material.price" }, { hypotheticalAcknowledgement: "no" },
      { permitCheckDate: "2026-02-30" }, { companyName: "" }, { actorId: "reply-owner" },
    ]) assert.equal((await env.post(changes)).status, 400, JSON.stringify(changes));
    assert.equal((await env.post({}, { origin: "https://foreign.example" })).status, 403);
    assert.equal((await env.post({}, { "sec-fetch-site": "cross-site" })).status, 403);
    assert.equal((await env.post({ sourceNote: "x".repeat(17000) })).status, 413);
    env.assertReadOnly();
  } finally { env.dispose(); }
});

test("anonymous and foreign owners cannot read or submit reply previews", async () => {
  const env = await setup();
  try {
    for (const [actor, expected] of [[null, 403], ["other-owner", 404]] as const) {
      env.setActor(actor);
      assert.equal((await env.app(new Request(origin + env.path + "/inquiry-reply"))).status, expected);
      assert.equal((await env.post()).status, expected);
    }
    env.assertReadOnly();
  } finally { env.dispose(); }
});

test("stale submitted version or input revision and changes after await cannot deliver new numbers", async () => {
  const env = await setup();
  try {
    assert.equal((await env.post({ baseVersion: env.saved.snapshot.version + 1 })).status, 409);
    assert.equal((await env.post({ inputRevision: "0".repeat(64) })).status, 409);
    let reads = 0;
    env.map(report => ++reads >= 2 ? { ...report, snapshot: { ...report.snapshot, permissionChanged: true } } : report);
    assert.equal((await env.post()).status, 409);
    reads = 0;
    env.map(report => ++reads >= 2 ? { ...report, snapshot: { ...report.snapshot, version: report.snapshot.version + 1 } } : report);
    assert.equal((await env.post()).status, 409);
    reads = 0;
    env.map(report => { if (++reads >= 2) env.revoke(); return report; });
    assert.equal((await env.post()).status, 403);
    env.assertReadOnly();
  } finally { env.dispose(); }
});

test("held, hazardous, historical, permission-changed and photo cases show no numerical promotion", async () => {
  const env = await setup();
  try {
    const held: DecisionResult = { state: "needs-review", caseId: env.input.caseId, reasons: ["추가 확인"], evidence: [] };
    const changedInput = (report: CaseReport, patch: Partial<CaseInput>): CaseReport => {
      const input = { ...report.snapshot.input, ...patch };
      return { ...report, snapshot: { ...report.snapshot, input,
        evaluated: { ...report.snapshot.evaluated, revision: revision(input) } } };
    };
    const variants: readonly ((report: CaseReport) => CaseReport)[] = [
      report => ({ ...report, snapshot: { ...report.snapshot, assessment: { decision: held } } }),
      ...(["yes", "unknown"] as const).map(hazardousContact => (report: CaseReport) => changedInput(report, { hazardousContact })),
      report => ({ ...report, snapshot: { ...report.snapshot, evaluated: { ...report.snapshot.evaluated, revision: "0".repeat(64) } } }),
      report => ({ ...report, snapshot: { ...report.snapshot, permissionChanged: true } }),
      report => changedInput(report, { photoRefs: ["conflicting-photo"] }),
    ];
    for (const map of variants) {
      env.map(map);
      const current = map(env.saved);
      const response = await env.post({ inputRevision: revision(current.snapshot.input), acceptance: "yes",
        second_companyName: "두 번째 미검증 업체", second_acceptance: "yes",
        second_inputId: "f_inc", second_unit: env.fields.unit, second_amount: "0" });
      assert.equal(response.status, 200);
      assert.deepEqual(await results(response), []);
    }
    env.assertReadOnly();
  } finally { env.dispose(); }
});

test("malicious reported company and source text remain text, not active HTML", async () => {
  const env = await setup();
  try {
    const hostile = '</textarea><img src=x onerror="alert(1)"><script>alert(2)</script>';
    const response = await env.post({ companyName: hostile, sourceNote: hostile });
    assert.equal(response.status, 200);
    let images = 0, scripts = 0, value = "";
    await new HTMLRewriter().on("img", { element() { images++; } })
      .on("script:not([src])", { element() { scripts++; } })
      .on("input[name=companyName]", { element(element) { value = element.getAttribute("value") ?? ""; } })
      .transform(response).text();
    assert.equal(images, 0); assert.equal(scripts, 0);
    assert.equal(value, "&lt;/textarea&gt;&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt;");
    env.assertReadOnly();
  } finally { env.dispose(); }
});
