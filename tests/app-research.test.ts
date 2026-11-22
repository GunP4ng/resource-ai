import assert from "node:assert/strict";
import { test } from "node:test";
import { createSyntheticResourceApp as createResourceApp } from "./synthetic-runtime.ts";
import { createCaseStore } from "../src/o-case-store.ts";
import type { CaseArtifact } from "../src/o-case-artifact.ts";
import { prepareResearchCaseRecord, readCaseResearchCatalog } from "../src/o-case-research.ts";
import { revision } from "../src/o-validation.ts";
import { createApp } from "../src/app.ts";
import { createResourceDomain } from "../src/domain.ts";
import { renderReport } from "../src/report.ts";

const origin = "http://localhost:3000";
const catalog = readCaseResearchCatalog();
const post = (path: string, raw: unknown) => new Request(origin + path, {
  method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(raw),
});
async function decisionSurface(html: string) {
  const surface = { heading: "", recommendations: "", checks: "", caseIdentity: "" };
  await new HTMLRewriter()
    .on(".result-overview > h1", { text(chunk) { surface.heading += chunk.text; } })
    .on('section[aria-labelledby="recommendation-heading"]', { text(chunk) { surface.recommendations += chunk.text; } })
    .on("#checks", { text(chunk) { surface.checks += chunk.text; } })
    .on("#advanced > p:first-of-type", { text(chunk) { surface.caseIdentity += chunk.text; } })
    .transform(new Response(html)).text();
  return surface;
}
test("permissionChanged warning stays outside disclosures near the conclusion", async () => {
  const source = (await catalog).calculations.data.cases[0];
  assert.ok(source);
  const store = createCaseStore();
  const app = createResourceApp({
    origin, actorForRequest: async () => "permission-warning",
    runtime: { identity: "trusted", storage: "ephemeral", runner: "local" }, presentationMode: "offline",
    caseStore: { ...store, readReport(owner, id) {
      const report = store.readReport(owner, id);
      return report ? { ...report, snapshot: { ...report.snapshot, permissionChanged: true } } : report;
    } },
    runner: async () => ({}),
  });
  try {
    const { caseId: _originalId, ...raw } = source.original;
    const created = await app.fetch(post("/cases", raw));
    assert.equal(created.status, 303);
    const path = created.headers.get("location");
    assert.ok(path);
    for (const suffix of ["", "/report"]) {
      let visible = "", folded = "";
      const order: string[] = [];
      const response = await app.fetch(new Request(origin + path + suffix));
      const responseHtml = await response.text();
      assert.equal(response.status, 200, responseHtml);
      const html = await new HTMLRewriter()
        .on("#decision-summary", { element() { order.push("conclusion"); } })
        .on(".result-overview > #permission-change-warning", { element() { order.push("notice"); }, text(chunk) { visible += chunk.text; } })
        .on("details #permission-change-warning", { text(chunk) { folded += chunk.text; } })
        .on("#next-action", { element() { order.push("next-action"); } })
        .transform(new Response(responseHtml)).text();
      assert.match(visible, /사진 권한이 바뀌/);
      assert.match(visible, /과거 평가/);
      assert.match(visible, /이미 전송된 사진은 회수되지 않습니다/);
      assert.equal(folded, "");
      assert.deepEqual(order, ["conclusion", "notice", "next-action"]);
      assert.doesNotMatch(html, /data-guidance-stage|id="rank-stability"/);
    }
    const inquiry = await app.fetch(new Request(origin + path + "/inquiry"));
    assert.equal(inquiry.status, 200);
    let inquiryStatus = "";
    const inquiryHtml = await new HTMLRewriter().on("[data-inquiry-status]", {
      text(chunk) { inquiryStatus += chunk.text; },
    }).transform(inquiry).text();
    assert.match(inquiryStatus, /과거 평가.*재평가 필요.*실행 보류/);
    assert.match(inquiryHtml, /data-inquiry-permission/);
  } finally { app.dispose(); }
});

test("committed research uses one atomic report read and only explicit private report includes it", async () => {
  // Given a real stored case, then an installed artifact awaiting explicit reevaluation.
  const data = await catalog;
  const source = data.calculations.data.cases[0];
  assert.ok(source);
  const store = createCaseStore();
  let staged: CaseArtifact | null = null;
  let reads = 0;
  let enabled = true;
  const modelInputs: unknown[] = [];
  const app = createResourceApp({ origin, actorForRequest: async () => enabled ? "ui-private-actor" : null,
    runtime: { identity: "trusted", storage: "ephemeral", runner: "local" }, presentationMode: "offline",
    caseStore: { ...store, read: () => { throw new Error("split snapshot read is forbidden"); },
      readReport: (owner, id) => { reads++; return store.readReport(owner, id); } },
    resources: () => { store.stageResources(staged); return {}; },
    runner: async (input, _signal, resources) => { modelInputs.push({ input, resources }); return {}; },
  });
  try {
    const { caseId: _originalId, ...raw } = source.original;
    const submitted = await app.fetch(post("/cases", raw));
    assert.equal(submitted.status, 303);
    const path = submitted.headers.get("location");
    assert.ok(path);
    const id = path.slice("/cases/".length);
    const initial = store.read("actor:ui-private-actor", id);
    assert.ok(initial);
    staged = await prepareResearchCaseRecord({ actorId: "ui-private-actor", input: initial.input,
      inputRevision: revision(initial.input), codeRevision: "a".repeat(40), signal: new AbortController().signal }, "OYS-20261110-001", data);
    const beforeResponse = await app.fetch(new Request(origin + path));
    const before = await beforeResponse.text();
    assert.equal(beforeResponse.status, 200, before);
    assert.doesNotMatch(before, /data-research-result/);
    assert.match(before, /data-public-scenario-result/);
    assert.equal(store.readReport("actor:ui-private-actor", id)?.research, null);
    const reevaluated = await app.fetch(post(path + "/answers", { baseVersion: initial.version, patch: { description: initial.input.description } }));
    assert.equal(reevaluated.status, 303);
    // When GET renders the committed pair through each output audience.
    reads = 0;
    const normalResponse = await app.fetch(new Request(origin + path));
    const normal = await normalResponse.text();
    assert.equal(normalResponse.status, 200, normal);
    assert.equal(reads, 1);
    const commercialResponse = await app.fetch(new Request(origin + path + "/report"));
    const commercial = await commercialResponse.text();
    assert.equal(commercialResponse.status, 200, commercial);
    const researchResponse = await app.fetch(new Request(origin + path + "/report?purpose=research"));
    const research = await researchResponse.text();
    assert.equal(researchResponse.status, 200, research);
    const exported = await app.fetch(new Request(origin + path + "/input"));
    // Then commercial bytes and model inputs never receive the attachment.
    assert.match(normal, /data-research-result/);
    assert.doesNotMatch(normal, /data-public-scenario-result/);
    assert.match(research, /data-research-result/);
    const publicStages: string[] = [];
    await new HTMLRewriter().on('.screen-only [data-progress-audience="public"] [data-guidance-stage]', {
      element(element) { publicStages.push(element.getAttribute("data-guidance-stage") ?? ""); },
    }).transform(new Response(commercial)).text();
    assert.deepEqual(publicStages, ["1", "2", "3", "4", "5", "6"]);
    assert.doesNotMatch(commercial, /id="hypothetical-summary"|id="rank-stability"|data-model-audit-origin|data-sensitivity/);
    assert.doesNotMatch(commercial, /data-public-scenario-result|data-research-result|data-directory-row|data-recycling-directory-row|WARM|Wonju|-13867|-27\.51/);
    assert.doesNotMatch(commercial, /<form\b/);
    assert.deepEqual(await exported.json(), initial.input);
    assert.doesNotMatch(JSON.stringify(modelInputs), /research|WARM|Wonju|net_carbon_kgco2e/);
    assert.ok(normal.indexOf("기계적 재활용 추천") < normal.indexOf("data-research-result"));
    assert.ok(normal.indexOf("확신도:") < normal.indexOf("data-research-result"));
    assert.ok(normal.indexOf("data-directory-row") < normal.indexOf('id="checks"'));
    enabled = false;
    assert.equal((await app.fetch(new Request(origin + path + "/report?purpose=research"))).status, 403);
  } finally { app.dispose(); await app.close(); store.dispose(); }
});

test("anonymous current case and commercial report expose status-only stages without research calculations", async () => {
  const app = createResourceApp({ origin, presentationMode: "offline" });
  try {
    const home = await app.fetch(new Request(origin));
    const cookie = home.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const created = await app.fetch(new Request(origin + "/cases", {
      method: "POST", headers: { origin, cookie, "content-type": "application/json" },
      body: JSON.stringify({ description: "합성 PET 사출 부산물", photoRefs: [], process: "사출", polymer: "PET",
        contamination: "없음", hazardousContact: "no", massKg: 100, region: "울산", assessmentDate: "2026-11-25" }),
    }));
    assert.equal(created.status, 303);
    const path = created.headers.get("location");
    assert.ok(path);
    for (const suffix of ["", "/report"]) {
      const stages: (string | null)[] = [], states: (string | null)[] = [];
      let reasons = "";
      const html = await new HTMLRewriter()
        .on('.screen-only [data-progress-audience="public"] [data-guidance-stage]', {
          element(element) { stages.push(element.getAttribute("data-guidance-stage")); states.push(element.getAttribute("data-state")); },
        })
        .on('#guidance-stage-5', { text(chunk) { reasons += chunk.text; } })
        .transform(await app.fetch(new Request(origin + path + suffix, { headers: { cookie } }))).text();
      assert.deepEqual(stages, ["1", "2", "3", "4", "5", "6"]);
      assert.deepEqual(states, ["available", "partial", "partial", "missing", "missing", "partial"]);
      assert.match(reasons, /같은 기능단위·경계의 1·2순위 비용값을 확보해야 합니다/); assert.match(reasons, /같은 기능단위·경계의 1·2순위 탄소값을 확보해야 합니다/);
      assert.doesNotMatch(html, /data-public-scenario-result|data-research-result|WARM|Wonju|parentFixtureSha256|id="rank-stability"|id="hypothetical-summary"/);
    }
    assert.equal((await app.fetch(new Request(origin + path + "/report?purpose=research", { headers: { cookie } }))).status, 403);
  } finally { app.dispose(); await app.close(); }
});

test("anonymous session cannot opt into research purpose", async () => {
  // Given the ordinary anonymous local app.
  const app = createResourceApp({ origin });
  try {
    const home = await app.fetch(new Request(origin));
    const cookie = home.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    // When research is requested, even an existing session cannot opt in.
    const response = await app.fetch(new Request(origin + "/cases/unknown/report?purpose=research", { headers: { cookie } }));
    assert.equal(response.status, 403);
    assert.doesNotMatch(await response.text(), /data-research-result/);
  } finally { app.dispose(); await app.close(); }
});

test("ordinary held PET and HDPE inputs show private automatic scenarios without storing or transmitting them", async () => {
  const store = createCaseStore();
  const modelInputs: unknown[] = [];
  let historical = false, revokeOnRead = false, current = true;
  const app = createResourceApp({ origin, actorForRequest: async () => ({
    actorId: "ordinary-owner", validUntil: Date.now() + 60000, assertCurrent: () => { assert.ok(current); },
  }), caseStore: { ...store, readReport: (owner, id) => {
    const report = store.readReport(owner, id);
    if (revokeOnRead) current = false;
    return report && historical ? { ...report, snapshot: { ...report.snapshot,
      input: { ...report.snapshot.input, description: "현재 변경된 입력" } } } : report;
  } }, runtime: { identity: "trusted", storage: "ephemeral", runner: "local" },
  runner: async (input, _signal, resources) => { modelInputs.push({ input, resources }); return {}; } });
  try {
    for (const [polymer, massKg] of [["PET", 24], ["HDPE", 18]] as const) {
      const response = await app.fetch(post("/cases", { description: "실제 사용자가 작성한 비정형 자투리 설명",
        process: "사용자 공정", polymer, contamination: "확인 필요", hazardousContact: "yes",
        massKg, region: "서울특별시", assessmentDate: "2026-11-19", photoRefs: [] }));
      assert.equal(response.status, 303);
      const path = response.headers.get("location");
      assert.ok(path);
      const id = path.slice("/cases/".length);
      const saved = store.readReport("actor:ordinary-owner", id);
      assert.ok(saved);
      const before = structuredClone(saved);
      for (const suffix of ["", "/report?purpose=research"]) {
        const privateResponse = await app.fetch(new Request(origin + path + suffix));
        assert.equal(privateResponse.status, 200);
        const html = await privateResponse.text();
        assert.equal((html.match(/data-public-scenario-result=/g) ?? []).length, 3);
        assert.doesNotMatch(html, /data-research-result=/);
        assert.deepEqual(await decisionSurface(html), await decisionSurface(renderReport(saved.snapshot.assessment.decision,
          { mode: "live" })));
        assert.match(html, /검토 필요/);
      }
      const commercial = await (await app.fetch(new Request(origin + path + "/report"))).text();
      assert.doesNotMatch(commercial, /data-public-scenario-result|WARM|Wonju|parentFixtureSha256/);
      assert.deepEqual(await (await app.fetch(new Request(origin + path + "/input"))).json(), saved.snapshot.input);
      assert.deepEqual(store.readReport("actor:ordinary-owner", id), before);
      historical = true;
      const old = await (await app.fetch(new Request(origin + path))).text();
      assert.doesNotMatch(old, /data-public-scenario-result|data-research-result/);
      assert.match(old, /과거 평가/);
      historical = false;
      revokeOnRead = true;
      const revoked = await app.fetch(new Request(origin + path));
      assert.notEqual(revoked.status, 200);
      assert.doesNotMatch(await revoked.text(), /data-public-scenario-result|WARM|Wonju/);
      revokeOnRead = false;
      current = true;
    }
    assert.doesNotMatch(JSON.stringify(modelInputs), /research|public.scenario|WARM|Wonju|net_carbon_kgco2e/);
  } finally { app.dispose(); await app.close(); store.dispose(); }
});

test("ordinary anonymous PET input cannot expose automatic public scenarios", async () => {
  const app = createResourceApp({ origin });
  try {
    const home = await app.fetch(new Request(origin));
    const cookie = home.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const response = await app.fetch(new Request(origin + "/cases", { method: "POST",
      headers: { origin, cookie, "content-type": "application/json" },
      body: JSON.stringify({ description: "익명 PET", process: null, contamination: null, region: null, polymer: "PET", massKg: 24,
        assessmentDate: "2026-11-19", hazardousContact: "no", photoRefs: [] }) }));
    assert.equal(response.status, 303);
    const path = response.headers.get("location");
    assert.ok(path);
    for (const suffix of ["", "/report"]) {
      const html = await (await app.fetch(new Request(origin + path + suffix, { headers: { cookie } }))).text();
      assert.doesNotMatch(html, /data-public-scenario-result|WARM|Wonju/);
    }
  } finally { app.dispose(); await app.close(); }
});

test("default authenticated demo binds PET and HDPE decisions to source inputs without models or installation", async () => {
  const app = createApp({ origin, actorForRequest: async () => "demo-operator",
    runtime: { identity: "trusted", storage: "ephemeral", runner: "local" },
    adapter: { submit: async () => { throw new Error("read-only demo must not evaluate"); },
      answer: async () => { throw new Error("read-only demo must not evaluate"); } } });
  try {
    for (const [path, sourceCaseId, cost, carbon, landfillCost, landfillCarbon, recoveryCarbon] of [
      ["/demo/normal", "OYS-20261110-001", "-13867", "-27.51", "2761", "0.53", "32.80"],
      ["/demo/normal?purpose=research&material=HDPE", "OYS-20261110-002", "-5493", "-11.98", "2071", "0.40", "25.60"],
    ] as const) {
      const response = await app(new Request(origin + path));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      const html = await response.text();
      assert.match(html, /href="\/demo\/normal\?purpose=research&amp;material=HDPE"/);
      assert.match(html, /href="\/demo\/normal\?purpose=research"/);
      assert.ok(html.includes(sourceCaseId));
      const source = (await catalog).calculations.data.cases.find(item => item.case_id === sourceCaseId);
      assert.ok(source);
      const expectedDecision = await createResourceDomain(source.original).decide();
      assert.equal(expectedDecision.caseId, source.original.caseId);
      assert.deepEqual(await decisionSurface(html),
        await decisionSurface(renderReport(expectedDecision, { mode: "synthetic" })));
      assert.ok(html.includes(revision(source.original)));
      assert.ok(html.includes(`질량 ${source.original.massKg} kg`));
      assert.ok(html.includes(`평가 기준일 ${source.original.assessmentDate}`));
      const rows = new Map<string, string>();
      await new HTMLRewriter().on("[data-research-result]", { element(element) {
        const route = element.getAttribute("data-research-result");
        if (route) rows.set(route, "");
      }, text(chunk) {
        const route = [...rows.keys()].at(-1);
        if (route) rows.set(route, rows.get(route) + chunk.text);
      } }).transform(new Response(html)).text();
      assert.equal(rows.size, 3);
      assert.ok(rows.get("recycling")?.includes(`${cost} KRW`));
      assert.ok(rows.get("recycling")?.includes(`${carbon} kgCO2e`));
      assert.ok(rows.get("landfill")?.includes(`${landfillCost} KRW`));
      assert.ok(rows.get("landfill")?.includes(`${landfillCarbon} kgCO2e`));
      assert.ok(rows.get("energy_recovery")?.includes(`${recoveryCarbon} kgCO2e`));
      assert.ok(rows.get("energy_recovery")?.includes("소각 처리비 없음"));
      assert.equal((html.match(/data-directory-row=/g) ?? []).length, 8);
      assert.equal((html.match(/data-recycling-directory-row=/g) ?? []).length, 4);
      assert.ok(html.indexOf('id="research-calculations"') < html.indexOf('id="recommendation-heading"'));
      assert.doesNotMatch(html, /240,000 KRW/);
      assert.match(html, /공개 자료 기반 계산값\(관측값 아님\)/);
      assert.match(html, /미국 기본 조건의 WARM/);
      assert.match(html, /합성 시나리오 입력입니다\. 견적은 업체에서 받으세요/);
      assert.doesNotMatch(html, /실행 성공 확인됨|Azure 호출 성공/);
    }
    const commercial = await (await app(new Request(origin + "/demo/normal?purpose=commercial&material=HDPE"))).text();
    assert.match(commercial, /240,000 KRW/);
    assert.doesNotMatch(commercial, /data-research-result|data-directory-row|data-recycling-directory-row|WARM|Wonju|-5493|-13867|demo-operator/);
  } finally { app.dispose(); await app.settled(); }
});

test("authenticated research demo normalizes supported material and defaults only when absent", async () => {
  const app = createApp({ origin, actorForRequest: async () => "demo-operator" });
  try {
    for (const [query, caseId] of [
      ["material=hdpe", "OYS-20261110-002"],
      ["material=HDPE", "OYS-20261110-002"],
      ["material=%20hDpE%20", "OYS-20261110-002"],
      ["material=%20pet%20", "OYS-20261110-001"],
      ["", "OYS-20261110-001"],
    ] as const) {
      const response = await app(new Request(origin + "/demo/normal?purpose=research" + (query ? "&" + query : "")));
      assert.equal(response.status, 200);
      assert.match(await response.text(), new RegExp(caseId));
    }
  } finally { app.dispose(); await app.settled(); }
});

test("authenticated research demo notices unsupported and empty material instead of showing PET calculations", async () => {
  const app = createApp({ origin, actorForRequest: async () => "demo-operator" });
  try {
    for (const query of ["material=pp", "material=", "material=%20%20"]) {
      const response = await app(new Request(origin + "/demo/normal?purpose=research&" + query));
      assert.equal(response.status, 400);
      const html = await response.text();
      assert.match(html, /공개 연구 계산 예시는 PET와 HDPE에 있습니다/);
      assert.match(html, /href="\/demo\/normal\?purpose=research"/);
      assert.match(html, /href="\/demo\/normal\?purpose=research&amp;material=HDPE"/);
      assert.doesNotMatch(html, /data-research-result|OYS-20261110-001/);
    }
  } finally { app.dispose(); await app.settled(); }
});

test("anonymous demo remains public but research query cannot grant an audience", async () => {
  for (const authenticated of [false, true]) {
    const app = createApp({ origin, ...(authenticated ? { actorForRequest: async () => null } : {}) });
    try {
      const normal = await app(new Request(origin + "/demo/normal"));
      assert.equal(normal.status, 200);
      const html = await normal.text();
      assert.match(html, /240,000 KRW/);
      assert.doesNotMatch(html, /data-research-result|data-directory-row|data-recycling-directory-row|WARM|Wonju|-13867|-5493/);
      for (const material of ["PET", "HDPE"]) {
        const response = await app(new Request(origin + `/demo/normal?purpose=research&material=${material}`));
        assert.equal(response.status, 403);
        assert.doesNotMatch(await response.text(), /data-research-result|data-directory-row|data-recycling-directory-row|WARM|Wonju/);
      }
    } finally { app.dispose(); await app.settled(); }
  }
});

test("demo research checks authentication expiry and current identity before returning bytes", async () => {
  let validUntil = 101;
  let current = true;
  const app = createApp({ origin, now: () => 100, actorForRequest: async () => ({
    actorId: "demo-operator", validUntil, assertCurrent: () => { assert.ok(current); },
  }) });
  try {
    validUntil = 100;
    assert.equal((await app(new Request(origin + "/demo/normal"))).status, 403);
    validUntil = 101;
    current = false;
    const revoked = await app(new Request(origin + "/demo/normal"));
    assert.notEqual(revoked.status, 200);
    assert.doesNotMatch(await revoked.text(), /data-research-result|data-directory-row|data-recycling-directory-row|WARM|Wonju/);
  } finally { app.dispose(); await app.settled(); }
});
