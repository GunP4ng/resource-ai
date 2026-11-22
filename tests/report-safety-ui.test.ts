import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaseInput, DecisionResult } from "../src/contracts.ts";
import { createResourceDomain } from "../src/domain.ts";
import { renderReport } from "../src/report.ts";
import { createSyntheticResourceApp as createResourceApp } from "./synthetic-runtime.ts";
import { safetyReasons } from "../src/o-safety-reasons.ts";
import { readableReason } from "../src/report-evidence.ts";
import { demo } from "../src/o-demo.ts";

const input: CaseInput = { caseId: "safety-ui", description: "구리 절단 스크랩", photoRefs: [],
  process: "사업장일반폐기물 금속 절단", polymer: "구리", contamination: "오일 있음",
  hazardousContact: "no", massKg: 180, region: "경기", assessmentDate: "2026-11-15" };

for (const count of [1, 3, 6]) test(`checks show the first three and preserve all ${count} ordered entries`, async () => {
  const decision = await createResourceDomain(input).decide();
  assert.equal(decision.state, "needs-review");
  const checks = [safetyReasons.materialTreatment, "SDS를 확인하세요.", "반출을 보류하세요.",
    "처리 허가를 확인하세요.", "계약 전에 확인하세요.", "SDS를 확인하세요."].slice(0, count);
  const result = { ...decision, preExecutionChecks: checks };
  const before = structuredClone(result);
  const first: string[] = [], rest: string[] = [];
  let disclosures = 0;
  await new HTMLRewriter()
    .on("#checks > ul > li", { element() { first.push(""); }, text(chunk) { first[first.length - 1] += chunk.text; } })
    .on("#remaining-checks li", { element() { rest.push(""); }, text(chunk) { rest[rest.length - 1] += chunk.text; } })
    .on("#remaining-checks", { element(el) { disclosures++; assert.equal(el.hasAttribute("open"), false); } })
    .transform(new Response(renderReport(result, { mode: "offline" }))).text();
  assert.deepEqual(first, checks.slice(0, 3).map(readableReason));
  assert.deepEqual(rest, checks.slice(3).map(readableReason));
  assert.equal(disclosures, count > 3 ? 1 : 0);
  assert.deepEqual(result, before);
});

for (const state of ["compared", "needs-review", "needs-information"] as const) {
  test(`commercial summary contains ${state} conclusion, actual source locations and unavailable values`, async () => {
    const result = await createResourceDomain({ ...input,
      contamination: state === "needs-review" ? "오일 있음" : "없음",
      polymer: state === "needs-information" ? null : "구리", massKg: null,
    }).decide();
    assert.equal(result.state, state);
    const before: DecisionResult = structuredClone(result);
    let summaries = 0, conclusion = "", action = "", unavailable = "", evidenceIndex = "";
    const locations: string[] = [], targets: string[] = [], ids: string[] = [], evidenceText = new Map<string, string>();
    await new HTMLRewriter()
      .on("main > #commercial-summary", { element() { summaries++; } })
      .on("#commercial-summary #decision-summary", { text(chunk) { conclusion += chunk.text; } })
      .on("#commercial-summary #next-action", { text(chunk) { action += chunk.text; } })
      .on("#summary-unavailable", { text(chunk) { unavailable += chunk.text; } })
      .on('#summary-evidence li a[href^="#"]', {
        element(el) {
          locations.push("");
          targets.push((el.getAttribute("href") ?? "").slice(1));
        },
        text(chunk) { locations[locations.length - 1] += chunk.text; },
      })
      .on("#summary-evidence > p > a", { element(el) { evidenceIndex = el.getAttribute("href") ?? ""; } })
      .on("[id]", { element(el) { ids.push(el.getAttribute("id") ?? ""); } })
      .on('#evidence > section', { element(el) {
        const id = el.getAttribute("id") ?? "";
        evidenceText.set(id, "");
      }, text(chunk) {
        const id = [...evidenceText.keys()].at(-1);
        if (id) evidenceText.set(id, evidenceText.get(id) + chunk.text);
      } })
      .transform(new Response(renderReport(result, { mode: "offline", historical: true }))).text();
    assert.equal(summaries, 1);
    assert.match(conclusion, state === "compared" ? /먼저 검토/ : state === "needs-review" ? /보류/ : /정보가 부족/);
    assert.match(action, /다음 할 일:/);
    assert.match(unavailable, /비용/);
    assert.match(unavailable, /탄소/);
    assert.match(unavailable, state === "compared" ? /미산정/ : /실행 보류로 비교하지 않음/);
    const expectedLocations = ["[1] 폐기물관리법 시행규칙 · 제4조의2 제1항"];
    if (state === "compared") expectedLocations.push(
      "[2] 폐기물관리법 시행규칙 별표 4 비철금속 스크랩 발췌 · 별표4 제2호 51-29-02, PDF 11쪽",
      "[3] 폐기물관리법 시행규칙 별표 4-2 비철금속 스크랩 발췌 · 별표4의2 제2호가목3), PDF 1쪽",
    );
    assert.deepEqual(locations, expectedLocations);
    assert.deepEqual(targets, result.evidence.slice(0, 3).map((_, index) => `evidence-${index + 1}`));
    assert.equal(evidenceIndex, "#evidence");
    for (const [index, target] of targets.entries()) {
      const record = result.evidence[index];
      assert.ok(record);
      assert.ok(evidenceText.get(target)?.includes(record.locator));
    }
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(result, before);
  });
}

test("commercial summary collapses equal localized labels and escapes distinct labels", async () => {
  const decision = await createResourceDomain(input).decide();
  const source = decision.evidence[0];
  assert.ok(source);
  const result: DecisionResult = {
    ...decision,
    evidence: [
      source,
      { ...source, sourceId: "summary-localized", title: "CSV 2행 · metal/iron 열", locator: "CSV row 2, column 철 스크랩" },
      { ...source, sourceId: "summary-escaped", title: '표 <b> & "인용"', locator: "행 > 1 & '위치'" },
    ],
  };
  const links: string[] = [];
  await new HTMLRewriter().on("#summary-evidence li a", {
    element() { links.push(""); },
    text(chunk) { links[links.length - 1] += chunk.text; },
  }).transform(new Response(renderReport(result, { mode: "offline" }))).text();
  assert.deepEqual(links, [
    "[1] 폐기물관리법 시행규칙 · 제4조의2 제1항",
    "[2] CSV 2행 · 철 스크랩 열",
    "[3] 표 &lt;b&gt; &amp; &quot;인용&quot; · 행 &gt; 1 &amp; &#39;위치&#39;",
  ]);
});

test("native commercial report alone gets the summary while detail retains editing and research separation", async () => {
  const origin = "http://localhost:3000";
  const app = createResourceApp({ origin, timeoutMs: 30_000, actorForRequest: async () => "summary-owner" });
  try {
    const created = await app.fetch(new Request(origin + "/cases", { method: "POST",
      headers: { origin, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ description: "구리 스크랩", process: "사업장일반폐기물 금속 절단", polymer: "구리",
        contamination: "없음", hazardousContact: "no", massKg: "", region: "경기", assessmentDate: "2026-11-15" }) }));
    assert.equal(created.status, 303);
    const path = created.headers.get("location");
    assert.ok(path);
    for (const [suffix, summaryCount] of [["/report", 1], ["", 0], ["/report?purpose=research", 0]] as const) {
      const response = await app.fetch(new Request(origin + path + suffix));
      assert.equal(response.status, 200, suffix || "native detail");
      let summaries = 0, researchNumbers = 0, conclusion = "";
      const formActions: (string | null)[] = [];
      const answerControls: (string | null)[] = [];
      await new HTMLRewriter()
        .on("#commercial-summary", { element() { summaries++; } })
        .on('form[method="post"]', { element(el) { formActions.push(el.getAttribute("action")); } })
        .on('input[name="answerMode"], textarea[name="answers"]', { element(el) { answerControls.push(el.getAttribute("name")); } })
        .on("#hypothetical-summary", { element() { researchNumbers++; } })
        .on("#decision-summary", { text(chunk) { conclusion += chunk.text; } })
        .transform(response).text();
      assert.equal(summaries, summaryCount);
      assert.deepEqual(formActions, suffix === "" ? [path + "/answers", path + "/answers"] : []);
      assert.deepEqual(answerControls, suffix === "" ? ["answerMode", "answers"] : []);
      assert.match(conclusion, /기계적 재활용/);
      if (suffix === "/report") assert.equal(researchNumbers, 0);
    }
  } finally { await app.close(); }
});

test("commercial summary distinguishes absent and unavailable estimates from an actual zero", async () => {
  const fixture = await demo("normal");
  assert.ok(fixture && fixture.result.state === "compared");
  const evidence = fixture.result.evidence[0];
  assert.ok(evidence);
  for (const kind of ["zero", "unavailable", "absent"] as const) {
    const result: DecisionResult = { ...fixture.result, scenarios: kind === "absent" ? [] : fixture.result.scenarios.map((scenario): typeof scenario => ({
      ...scenario,
      netCost: kind === "unavailable" ? { state: "unavailable", missingInputs: ["견적 미확보"] } as const
        : { state: "available", low: 0, central: 0, high: 0, unit: "KRW",
          evidenceIds: [evidence.sourceId], assumptions: ["합성 0원 견적"] } as const,
    })) };
    const before: DecisionResult = structuredClone(result);
    let status = "";
    await new HTMLRewriter().on("#summary-unavailable li", { text(chunk) { status += chunk.text; } })
      .transform(new Response(renderReport(result, fixture.presentation))).text();
    assert.match(status, kind === "zero" ? /비용: 판정 상세에 계산값 있음/
      : kind === "unavailable" ? /비용: 2개 비교값 중 2개 미산정/ : /비용: 비교값 없음/);
    assert.deepEqual(result, before);
  }
});

test("commercial detail views retain controls without a standalone summary, even after editing expires", async () => {
  const result = { state: "needs-information", caseId: "detail-summary", questions: ["재질 확인"], evidence: [] } as const;
  for (const view of [
    { editing: '<form method="post"><textarea id="answers"></textarea><button>답변</button></form>', answerTarget: "#answers" as const },
    { editing: '<p class="notice">수정 기한이 지났습니다.</p>', inquiryTarget: "/cases/detail-summary/inquiry" },
  ]) {
    let summaries = 0, fallback = "", editing = "";
    await new HTMLRewriter()
      .on("#commercial-summary", { element() { summaries++; } })
      .on("#checks", { text(chunk) { fallback += chunk.text; } })
      .on("form, .notice", { text(chunk) { editing += chunk.text; } })
      .transform(new Response(renderReport(result, { mode: "offline" }, { audience: "commercial" }, view))).text();
    assert.equal(summaries, 0);
    assert.match(fallback, /현장 담당자 검토와 승인 후/);
    assert.match(editing, view.answerTarget ? /답변/ : /수정 기한이 지났습니다/);
  }
  let evidence = "", reason = "";
  await new HTMLRewriter()
    .on("#summary-evidence", { text(chunk) { evidence += chunk.text; } })
    .on("#case-reasons", { text(chunk) { reason += chunk.text; } })
    .transform(new Response(renderReport(result, { mode: "offline" }))).text();
  assert.match(evidence, /연결된 근거 없음/);
  assert.match(reason, /재질 확인/);
});

test("safety-held reports subordinate citation shortage without losing reason anchors", async () => {
  const result = await createResourceDomain(input).decide();
  assert.equal(result.state, "needs-review");
  assert.ok(result.reasons.includes(safetyReasons.materialTreatment));
  assert.ok(result.reasons.some(reason => reason.includes("인용 부족")));
  const before = structuredClone(result);
  const primary: string[] = [], secondary: string[] = [], allIds: string[] = [], links: string[] = [];
  const html = renderReport(result, { mode: "offline" });
  await new HTMLRewriter()
    .on("#case-reasons > ul > li", { text(chunk) { primary.push(chunk.text); } })
    .on("#case-reasons .supporting-reasons li", { text(chunk) { secondary.push(chunk.text); } })
    .on('#case-reasons li[id]', { element(el) { allIds.push(el.getAttribute("id") ?? ""); } })
    .on('a[href^="#case-reason-"]', { element(el) { links.push((el.getAttribute("href") ?? "").slice(1)); } })
    .transform(new Response(html)).text();
  assert.ok(primary.join("").includes(readableReason(safetyReasons.materialTreatment)));
  assert.ok(!primary.join("").includes("인용 부족"));
  assert.ok(secondary.join("").includes("인용 부족"));
  assert.ok(html.indexOf(readableReason(safetyReasons.materialTreatment)) < html.indexOf('class="supporting-reasons"'));
  assert.equal(new Set(allIds).size, allIds.length);
  assert.equal(allIds.length, result.reasons.length);
  assert.ok(links.every(id => allIds.includes(id)));
  assert.deepEqual(result, before);
});

test("citation shortage remains primary when it is not subordinate to a safety hold", async () => {
  const result = await createResourceDomain({ ...input, caseId: "citation-ui", process: "사출",
    polymer: "PVC", contamination: "없음" }).decide();
  assert.equal(result.state, "needs-review");
  let groups = 0;
  const primary: string[] = [];
  await new HTMLRewriter().on(".supporting-reasons", { element() { groups++; } })
    .on("#case-reasons > ul > li", { text(chunk) { primary.push(chunk.text); } })
    .transform(new Response(renderReport(result, { mode: "offline" }))).text();
  assert.equal(groups, 0);
  assert.ok(primary.join("").includes("인용 부족"));
});

test("unknown-material questions render neutral wording while the stored decision stays unchanged", async () => {
  const unknown = { ...input, caseId: "neutral-ui", description: "재질 확인 중",
    process: "unknown", polymer: "unknown", contamination: "없음", region: "unknown" };
  const result = await createResourceDomain(unknown).decide();
  assert.equal(result.state, "needs-information");
  const before = structuredClone(result);
  const text: string[] = [];
  await new HTMLRewriter().on("#case-reasons", { text(chunk) { text.push(chunk.text); } })
    .transform(new Response(renderReport(result, { mode: "offline" }))).text();
  assert.ok(text.join("").includes("폐자원이 발생한"));
  assert.ok(text.join("").includes("확인된 재질"));
  assert.ok(!text.join("").includes("폐플라스틱이"));
  assert.deepEqual(result, before);
});

test("the native unknown-material report uses neutral questions in its reason and progress sections", async () => {
  const origin = "http://localhost:3000";
  const app = createResourceApp({ origin, actorForRequest: async () => "neutral-owner" });
  try {
    const created = await app.fetch(new Request(origin + "/cases", { method: "POST",
      headers: { origin, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ description: "재질 확인 중", process: "unknown", polymer: "unknown",
        contamination: "없음", hazardousContact: "no", massKg: "", region: "unknown", assessmentDate: "2026-11-15" }) }));
    assert.equal(created.status, 303);
    const path = created.headers.get("location");
    assert.ok(path);
    const detail = await app.fetch(new Request(origin + path));
    assert.equal(detail.status, 200);
    const text: string[] = [];
    await new HTMLRewriter().on("#case-reasons, #case-progress", { text(chunk) { text.push(chunk.text); } })
      .transform(detail).text();
    assert.ok(text.join("").includes("폐자원이 발생한"));
    assert.ok(!text.join("").includes("폐플라스틱이"));
    const saved: unknown = await (await app.fetch(new Request(origin + path + "/input"))).json();
    assert.ok(saved && typeof saved === "object" && "polymer" in saved && "process" in saved);
    assert.equal(saved.polymer, "unknown");
    assert.equal(saved.process, "unknown");
  } finally { await app.close(); }
});
