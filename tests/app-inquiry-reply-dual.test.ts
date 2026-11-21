import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/app.ts";
import { createCaseStore } from "../src/o-case-store.ts";
import { readCaseResearchCatalog } from "../src/o-case-research.ts";
import { createResourceDomain } from "../src/domain.ts";
import { buildPublicInputScenario } from "../src/o-input-public-scenario.ts";
import { buildCalculationVariant } from "../src/o-calculation-variant.ts";
import { revision } from "../src/o-validation.ts";

const origin = "http://localhost:3000";
async function setup(material: "PET" | "HDPE" = "PET") {
  const catalog = await readCaseResearchCatalog();
  const source = catalog.calculations.data.cases.find(item => item.material === material);
  assert.ok(source);
  const input = { ...source.original, caseId: `dual-${material}` };
  const store = createCaseStore(), owner = "actor:dual-owner";
  const decision = await createResourceDomain(input).decide();
  const lease = store.begin(owner, input.caseId, null);
  await store.run(lease, input, async () => ({ decision }));
  store.commit(lease, { decision }, () => {});
  const saved = store.readReport(owner, input.caseId);
  assert.ok(saved);
  const forbidden = () => { throw new Error("reply attempted persistence or evaluation"); };
  const app = createApp({ origin, actorForRequest: async () => ({
    actorId: "dual-owner", validUntil: Date.now() + 60000, assertCurrent() {},
  }), caseStore: { ...store, begin: forbidden, run: forbidden, commit: forbidden },
  preparer: { prepareSubmit: forbidden, prepareAnswer: forbidden, evaluate: forbidden } });
  const path = `/cases/${input.caseId}`;
  const context = buildPublicInputScenario({ actorId: "dual-owner", input, inputRevision: revision(input) }, catalog);
  assert.ok(context);
  const fields: Record<string, string | number> = { baseVersion: saved.snapshot.version,
    inputRevision: revision(input), companyName: "업체 A", acceptance: "unknown",
    hypotheticalAcknowledgement: "yes" };
  for (const inputId of ["f_inc", "f_rec", `${material}.price`]) {
    const unit: string | undefined = context.calculations.inputs.find(item => item.input_id === inputId)?.unit;
    assert.ok(unit);
    fields[`unit_${inputId}`] = unit;
    fields[`amount_${inputId}`] = "";
  }
  const second = Object.fromEntries(Object.entries(fields).filter(([key]) =>
    key.startsWith("unit_") || key.startsWith("amount_")).map(([key, value]) => [`second_${key}`, value]));
  const post = (changes: Record<string, unknown> = {}) => app(new Request(origin + path + "/inquiry-reply", {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ ...fields, ...changes }),
  }));
  return { app, path, input, context, fields, second, post,
    readOnly() { assert.deepEqual(store.readReport(owner, input.caseId), saved); },
    dispose() { app.dispose(); store.dispose(); } };
}
async function readRows(response: Response) {
  assert.equal(response.status, 200);
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
  test(`${material} dual company amounts match the engine independently and leave reports unchanged`, async () => {
    const env = await setup(material);
    try {
      const reports = await Promise.all(["/report", "/report?purpose=research"].map(async suffix =>
        (await env.app(new Request(origin + env.path + suffix))).text()));
      const overrides = [
        [{ inputId: "f_inc", value: 250000 }, { inputId: "f_rec", value: 90000 }, { inputId: `${material}.price`, value: 0 }],
        [{ inputId: "f_rec", value: 0 }, { inputId: `${material}.price`, value: 750000 }],
      ];
      const variants = overrides.map(items => buildCalculationVariant(env.context, items, "HTTP test hypothesis"));
      const response = await env.post({ ...env.second, second_companyName: "업체 B", second_acceptance: "no",
        acceptance: "yes", permitCheckDate: "2026-11-21", second_permitCheckDate: "2026-01-01",
        amount_f_inc: "250000", amount_f_rec: "90000", [`amount_${material}.price`]: "0",
        second_amount_f_rec: "0", [`second_amount_${material}.price`]: "750000" });
      const parents: string[] = [];
      await new HTMLRewriter().on("[data-reply-parent]", {
        element() { parents.push(""); },
        text(chunk) { const index = parents.length - 1; parents[index] += chunk.text; },
      })
        .transform(response.clone()).text();
      assert.deepEqual(parents, [env.context.provenance.derivedDatasetSha256, env.context.provenance.derivedDatasetSha256]);
      const rows = await readRows(response);
      assert.equal(rows.length, 3);
      for (const row of rows) {
        const baseline = env.context.calculations.results.find(item => item.route_id === row.route);
        assert.ok(baseline);
        assert.equal(row.cells[0], baseline.display.net_cost_krw ?? "미확보");
        variants.forEach((variant, index) => {
          const expected = variant.calculations.results.find(item => item.route_id === row.route);
          assert.ok(expected);
          assert.equal(row.cells[1 + index * 2], expected.display.net_cost_krw ?? "미확보");
          if (baseline.net_cost_krw !== null && expected.net_cost_krw !== null) {
            assert.equal(row.cells[2 + index * 2], (expected.net_cost_krw - baseline.net_cost_krw)
              .toLocaleString("ko-KR", { maximumFractionDigits: 0 }));
          }
        });
      }
      const incineration = rows.find(item => item.route === "energy_recovery");
      assert.equal(incineration?.cells[0], "미확보");
      assert.notEqual(incineration?.cells[1], "미확보");
      assert.equal(incineration?.cells[3], "미확보");
      for (const [index, suffix] of ["/report", "/report?purpose=research"].entries()) {
        assert.equal(await (await env.app(new Request(origin + env.path + suffix))).text(), reports[index]);
      }
      assert.deepEqual(await readRows(await env.app(new Request(origin + env.path + "/inquiry-reply"))), []);
      env.readOnly();
    } finally { env.dispose(); }
  });
}

test("native dual form retains blank versus zero and an unused optional company stays absent", async () => {
  const env = await setup();
  try {
    const form = new URLSearchParams();
    await new HTMLRewriter().on("input", { element(element) {
      const name = element.getAttribute("name");
      if (name) form.set(name, element.getAttribute("value") ?? "");
    } }).transform(await env.app(new Request(origin + env.path + "/inquiry-reply"))).text();
    for (const prefix of ["", "second_"]) {
      form.set(prefix + "acceptance", "unknown"); form.set(prefix + "sourceNote", "");
    }
    form.set("companyName", "업체 A"); form.set("amount_f_inc", "0");
    const submit = () => env.app(new Request(origin + env.path + "/inquiry-reply", {
      method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: form,
    }));
    const single = await readRows(await submit());
    assert.equal(single[0]?.cells.length, 3);
    form.set("second_companyName", "업체 B");
    const response = await submit();
    let zero = "", blank = "";
    await new HTMLRewriter().on("input[name=amount_f_inc]", { element(element) { zero = element.getAttribute("value") ?? ""; } })
      .on("input[name=second_amount_f_inc]", { element(element) { blank = element.getAttribute("value") ?? ""; } })
      .transform(response.clone()).text();
    assert.equal(zero, "0"); assert.equal(blank, "");
    const dual = await readRows(response);
    assert.equal(dual[0]?.cells.length, 5);
    assert.equal(dual.find(item => item.route === "energy_recovery")?.cells[3], "미확보");
    env.readOnly();
  } finally { env.dispose(); }
});

test("dual fields reject hostile keys units nonfinite values and conflicting legacy amounts", async () => {
  const env = await setup();
  try {
    for (const changes of [
      { amount_f_inc: "1e999" }, { amount_f_inc: "0x10" }, { amount_f_inc: [] },
      { amount_f_inc: null }, { unit_f_inc: "KRW/kg" }, { amount_PET_y: "1" },
      { ...env.second, second_companyName: "B", second_acceptance: "yes", second_amount_f_inc: "NaN" },
      { ...env.second, second_companyName: "B", second_acceptance: "yes", second_amount_f_rec: -1 },
      { ...env.second, second_companyName: "B", second_acceptance: "yes", "second_amount_HDPE.price": "1" },
      { ...env.second, second_companyName: "B", second_acceptance: "yes", second_permitCheckDate: "2026-02-30" },
      { ...env.second, second_actorId: "dual-owner" }, { ...env.second, second_amount_f_inc: "0" },
      { inputId: "f_inc", unit: env.fields["unit_f_inc"], amount: "0" },
    ]) assert.equal((await env.post(changes)).status, 400, JSON.stringify(changes));
    env.readOnly();
  } finally { env.dispose(); }
});

test("both reported company names and notes are escaped in headers metadata and form controls", async () => {
  const env = await setup();
  try {
    const hostile = '</textarea><img src=x onerror="alert(1)"><script>alert(2)</script>';
    const response = await env.post({ ...env.second, companyName: hostile, sourceNote: hostile,
      second_companyName: hostile, second_sourceNote: hostile, second_acceptance: "yes", amount_f_inc: "0" });
    assert.equal(response.status, 200);
    let active = 0, values = 0;
    await new HTMLRewriter().on("img, script:not([src])", { element() { active++; } })
      .on("input[name=companyName], input[name=second_companyName]", { element(element) {
        assert.match(element.getAttribute("value") ?? "", /&lt;img/); values++;
      } }).transform(response).text();
    assert.equal(active, 0); assert.equal(values, 2);
    env.readOnly();
  } finally { env.dispose(); }
});
