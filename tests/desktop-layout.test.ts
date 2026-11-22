import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaseInput } from "../src/contracts.ts";
import { form, inputPage, loginPage } from "../src/app-views.ts";
import { createResourceDomain } from "../src/domain.ts";
import { createCaseStore } from "../src/o-case-store.ts";
import { renderReport } from "../src/report.ts";
import { createSyntheticOperationalApp } from "./synthetic-runtime.ts";

const input: CaseInput = {
  caseId: "desktop-layout", description: "깨끗한 구리 절단 스크랩", photoRefs: [],
  process: "사업장일반폐기물 금속 절단", polymer: "구리", contamination: "없음",
  hazardousContact: "no", massKg: 180, region: "경기", assessmentDate: "2026-11-22",
};

test("input workspace keeps one native form with every field and reachable region anchors", async () => {
  const html = inputPage({ authenticated: true, localAuth: true, connected: true, photoEnabled: false, runner: "subscription" });
  const regions: string[] = [], targets: string[] = [], controls: string[] = [], forms: string[] = [];
  await new HTMLRewriter()
    .on(".workspace-nav a", { element(el) { targets.push(el.getAttribute("href") ?? ""); } })
    .on(".input-workspace > [id]", { element(el) {
      regions.push("#" + el.getAttribute("id"));
      assert.equal(el.getAttribute("tabindex"), "-1");
    } })
    .on(".case-editor form", { element(el) {
      forms.push(el.getAttribute("action") ?? "");
      assert.equal(el.getAttribute("method"), "post");
    } })
    .on(".case-editor [name]", { element(el) { controls.push(el.getAttribute("name") ?? ""); } })
    .transform(new Response(html)).text();
  assert.deepEqual(regions, ["#input-overview", "#case-editor"]);
  assert.deepEqual(targets, ["#case-editor", "#input-overview"]);
  assert.deepEqual(forms, ["/cases"]);
  assert.deepEqual(controls, ["description", "process", "polymer", "contamination", "hazardousContact", "massKg", "region", "assessmentDate"]);
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
    const leading: string[] = [], targets: string[] = [];
    await new HTMLRewriter()
      .on(".report-workspace > div, .report-workspace > aside", { element(el) { order.push(el.getAttribute("class") ?? ""); } })
      .on("#report-results > #decision-summary, #report-results > #next-action", { element(el) { leading.push(el.getAttribute("id") ?? ""); } })
      .on(".workspace-nav a", { element(el) { targets.push(el.getAttribute("href") ?? ""); } })
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

test("saved recommended detail links from the next action to the native editor on small screens", async () => {
  const origin = "http://localhost:3000";
  let caseAge = 0;
  const cases = createCaseStore(() => Date.now() - caseAge);
  const app = createSyntheticOperationalApp({ origin, caseStore: cases });
  const { caseId: _id, photoRefs: _photos, ...fields } = input;
  const nativeFields = Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, String(value ?? "")]));
  try {
    const home = await app.fetch(new Request(origin));
    assert.equal(home.status, 200);
    const cookie = home.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const get = async (path: string) => {
      const response = await app.fetch(new Request(origin + path, { headers: { cookie } }));
      assert.equal(response.status, 200);
      return response.text();
    };
    const post = (path: string, fields: Record<string, string>) => app.fetch(new Request(origin + path, {
      method: "POST", headers: { cookie, origin }, body: new URLSearchParams(fields),
    }));
    const submit = async (overrides: Record<string, string> = {}) => {
      const response = await post("/cases", { ...nativeFields, ...overrides });
      assert.equal(response.status, 303);
      const path = response.headers.get("location");
      assert.ok(path);
      return path;
    };
    const path = await submit();
    const detail = await get(path);
    assert.match(detail, /<h1>기계적 재활용 추천<\/h1>/);
    assert.match(detail, /name="baseVersion" value="1"/);
    const edit = await post(path + "/answers", {
      ...Object.fromEntries(Object.entries(nativeFields).map(([name, value]) => ["field_" + name, value])),
      baseVersion: "1", answerMode: "fields", photoSelection: "explicit",
    });
    assert.equal(edit.status, 303);
    assert.equal(edit.headers.get("location"), path);
    const updated = await get(path);
    assert.match(updated, /name="baseVersion" value="2"/);
    assert.match(updated, /name="field_massKg"[^>]*value="180"/);

    const missingMass = await get(await submit({ massKg: "" }));
    assert.match(missingMass, /href="#answer-fields">질량을 입력하면 비용·탄소를 계산해요/);
    const held = await get(await submit({ hazardousContact: "yes" }));
    assert.match(held, /href="#answer-fields">입력 다시 확인하기/);
    caseAge = 31 * 60_000;
    const expiredPath = await submit();
    caseAge = 0;
    const expired = await get(expiredPath);
    assert.match(expired, /수정 기한이 지났습니다/);
    const report = await get(path + "/report");
    assert.ok(report.includes(`href="${path}">사례로 돌아가기`));
    const demo = await get("/demo/normal");
    for (const html of [missingMass, held, expired, report, demo]) {
      assert.doesNotMatch(html, /class="[^"]*\bmobile-editor-shortcut\b/);
    }

    const actions: string[] = [];
    await new HTMLRewriter()
      .on("#report-results > p > a.primary-action, #report-results > p.mobile-editor-shortcut > a", {
        element(el) { actions.push(el.getAttribute("href") ?? ""); },
      })
      .transform(new Response(detail)).text();
    assert.deepEqual(actions.slice(0, 2), ["#checks", "#case-editor"]);
    assert.equal(actions.filter(target => target === "#case-editor").length, 1);
    assert.match(detail, /<p class="screen-only mobile-editor-shortcut"><a href="#case-editor">답변·사례 수정<\/a><\/p>/);
    assert.match(detail, /<aside[^>]*id="case-editor"[^>]*tabindex="-1"/);
    assert.match(detail, /@media screen and \(min-width:1280px\)\s*\{[^@]*\.mobile-editor-shortcut\{display:none\}/);
    assert.match(detail, /@media print\s*\{[^@]*\.screen-only[^}]*\{display:none\}/);
  } finally { app.dispose(); await app.close(); cases.dispose(); }
});

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
