import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaseInput } from "../src/contracts.ts";
import { createResourceDomain } from "../src/domain.ts";
import { renderReport } from "../src/report.ts";
import { createResourceApp } from "../src/session.ts";
import { safetyReasons } from "../src/o-safety-reasons.ts";

const input: CaseInput = { caseId: "safety-ui", description: "구리 절단 스크랩", photoRefs: [],
  process: "사업장일반폐기물 금속 절단", polymer: "구리", contamination: "오일 있음",
  hazardousContact: "no", massKg: 180, region: "경기", assessmentDate: "2026-11-15" };

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
  assert.ok(primary.join("").includes(safetyReasons.materialTreatment));
  assert.ok(!primary.join("").includes("인용 부족"));
  assert.ok(secondary.join("").includes("인용 부족"));
  assert.ok(html.indexOf(safetyReasons.materialTreatment) < html.indexOf('class="supporting-reasons"'));
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
