import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaseInput } from "../src/contracts.ts";
import { form, inputPage, loginPage } from "../src/app-views.ts";
import { createResourceDomain } from "../src/domain.ts";
import { renderReport } from "../src/report.ts";

const input: CaseInput = {
  caseId: "desktop-layout", description: "깨끗한 구리 절단 스크랩", photoRefs: [],
  process: "사업장일반폐기물 금속 절단", polymer: "구리", contamination: "없음",
  hazardousContact: "no", massKg: 180, region: "경기", assessmentDate: "2026-11-22",
};

test("one-page intake has three visible sections and a native submit in the summary", async () => {
  const html = inputPage({ authenticated: true, localAuth: true, connected: true, photoEnabled: false });
  const steps: string[] = [], targets: string[] = [], controls: string[] = [], forms: string[] = [];
  await new HTMLRewriter()
    .on("[data-intake-start]", { element(el) { targets.push(el.getAttribute("href") ?? ""); } })
    .on("#case-intake fieldset[data-intake-section]", { element(el) {
      steps.push(el.getAttribute("data-intake-section") ?? "");
      assert.equal(el.hasAttribute("hidden"), false);
    } })
    .on("#case-intake form", { element(el) {
      forms.push(el.getAttribute("action") ?? "");
      assert.equal(el.getAttribute("method"), "post");
    } })
    .on("#case-intake form [name]", { element(el) { controls.push(el.getAttribute("name") ?? ""); } })
    .on("#case-intake form [data-intake-summary] button[type=submit]", { element(el) {
      assert.equal(el.hasAttribute("hidden"), false);
      targets.push("native submit");
    } })
    .transform(new Response(html)).text();
  assert.deepEqual(steps, ["material", "source", "state"]);
  assert.deepEqual(targets, ["#case-intake", "native submit"]);
  assert.deepEqual(forms, ["/cases"]);
  assert.deepEqual(controls, ["polymer", "description", "process", "region", "contamination", "hazardousContact", "massKg", "assessmentDate"]);
});

for (const hazardousContact of ["no", "yes", "unknown"] as const) {
  test(`editable ${hazardousContact} workspace preserves report-first flow, native editor values and saved version`, async () => {
    const facts = { ...input, hazardousContact };
    const decision = await createResourceDomain(facts).decide();
    const before = structuredClone(decision);
    const action = "/cases/desktop-layout/answers";
    const html = renderReport(decision, { mode: "synthetic" }, { audience: "commercial" }, {
      editing: form(action, true, 7, '<input type="hidden" name="photoSelection" value="explicit">', facts),
      answerTarget: "#answer-fields",
    });
    const order: string[] = [], actions: string[] = [], versions: string[] = [], selected: string[] = [];
    const controls = new Map<string, string>();
    const leading: string[] = [], targets: string[] = [], mobileEdits: (string | null)[] = [];
    let editTarget = 0;
    await new HTMLRewriter()
      .on(".report-workspace > div, .report-workspace > aside", { element(el) { order.push(el.getAttribute("class") ?? ""); } })
      .on("#report-results > .result-overview > #decision-summary, #report-results > .result-overview > #next-action", { element(el) { leading.push(el.getAttribute("id") ?? ""); } })
      .on(".workspace-nav a", { element(el) { targets.push(el.getAttribute("href") ?? ""); } })
      .on(".result-actions.screen-only .mobile-edit-shortcut", { element(el) { mobileEdits.push(el.getAttribute("href")); } })
      .on(".case-editor #answer-fields", { element(el) { if (el.getAttribute("tabindex") === "-1") editTarget++; } })
      .on(".case-editor form", { element(el) {
        actions.push(el.getAttribute("action") ?? "");
        assert.equal(el.getAttribute("method"), "post");
      } })
      .on('.case-editor input[name="baseVersion"]', { element(el) { versions.push(el.getAttribute("value") ?? ""); } })
      .on(".case-editor input[name^='field_']", { element(el) { controls.set(el.getAttribute("name") ?? "", el.getAttribute("value") ?? ""); } })
      .on(".case-editor option[selected]", { element(el) { selected.push(el.getAttribute("value") ?? ""); } })
      .transform(new Response(html)).text();
    assert.deepEqual(order, ["report-results", "case-editor", "report-records"]);
    assert.deepEqual(leading, ["decision-summary", "next-action"]);
    assert.deepEqual(targets, ["#case-editor", "#report-results"]);
    assert.deepEqual(mobileEdits, decision.state === "compared" ? ["#answer-fields"] : []);
    assert.equal(editTarget, 1);
    assert.deepEqual(actions, [action, action]);
    assert.deepEqual(versions, ["7", "7"]);
    assert.deepEqual(selected, [hazardousContact]);
    assert.deepEqual(Object.fromEntries(controls), {
      field_process: facts.process, field_polymer: facts.polymer, field_contamination: facts.contamination,
      field_region: facts.region, field_assessmentDate: facts.assessmentDate, field_massKg: String(facts.massKg),
    });
    assert.deepEqual(decision, before);
  });
}

test("local operator login retains native authentication fields without the workspace editor", async () => {
  const controls: string[] = [];
  let editors = 0, action = "";
  await new HTMLRewriter()
    .on(".case-editor", { element() { editors++; } })
    .on("form", { element(el) { action = el.getAttribute("action") ?? ""; } })
    .on("input", { element(el) { controls.push(el.getAttribute("name") ?? ""); } })
    .transform(new Response(loginPage())).text();
  assert.equal(editors, 0);
  assert.equal(action, "/login");
  assert.deepEqual(controls, ["username", "password"]);
});
