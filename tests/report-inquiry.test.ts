import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaseInput, DecisionResult } from "../src/contracts.ts";
import { renderInquiry } from "../src/report-inquiry.ts";

const input: CaseInput = {
  caseId: "inquiry-current-42", description: "투명 용기 생산 부산물",
  polymer: "PET", process: "용기 성형", contamination: "접착제 잔류",
  hazardousContact: "unknown", massKg: 123.5, region: "원주시",
  assessmentDate: "2026-11-20", photoRefs: ["PRIVATE_PHOTO_SENTINEL"],
};
const decision: DecisionResult = {
  state: "compared", caseId: input.caseId, routes: [], processors: [], scenarios: [],
  evidence: [], limitations: ["PRIVATE_DECISION_SENTINEL"], humanApproval: "pending",
};

async function textAt(html: string, selector: string): Promise<string[]> {
  const values: string[] = [];
  let current = -1;
  await new HTMLRewriter().on(selector, {
    element() { current = values.push("") - 1; },
    text(chunk) { values[current] += chunk.text; },
  }).transform(new Response(html)).text();
  return values.map(value => value.trim());
}

test("inquiry reports current fields and leaves processor answers for the recipient", async () => {
  const html = renderInquiry(input, decision, {});
  const values = await textAt(html, ".inquiry-fields dd");
  assert.deepEqual(values, [
    input.caseId, input.assessmentDate, input.polymer, input.process,
    input.contamination, "123.5 kg", input.region, input.description,
  ]);
  assert.match((await textAt(html, "[data-inquiry-contact]")).join(""), /미상 \(unknown\)/);
  const questions = await textAt(html, "[data-inquiry-question]");
  assert.equal(questions.length, 4);
  assert.ok(questions.every(question => question.endsWith("?") || question.endsWith("주세요.")),
    "permit, contamination, logistics and quote are requests, not findings");
  assert.match(questions[0] ?? "", /허가.*포함되나요\?/);
  assert.match(questions[3] ?? "", /VAT.*수락 조건/);
  const structure = { sheets: 0, replies: 0, photos: 0, forms: 0, scripts: [] as string[], back: "" };
  await new HTMLRewriter()
    .on("[data-inquiry-sheet]", { element() { structure.sheets++; } })
    .on("[data-inquiry-reply]", { element() { structure.replies++; } })
    .on("img", { element() { structure.photos++; } })
    .on("form", { element() { structure.forms++; } })
    .on("script", { element(element) { structure.scripts.push(element.getAttribute("src") ?? "inline"); } })
    .on('[aria-label="문의서 동작"] a', { element(element) { structure.back = element.getAttribute("href") ?? ""; } })
    .transform(new Response(html)).text();
  assert.deepEqual(structure, {
    sheets: 1, replies: 1, photos: 0, forms: 0, scripts: ["/app-feedback.js"],
    back: "/cases/inquiry-current-42",
  });
  assert.doesNotMatch(html, /PRIVATE_PHOTO_SENTINEL|PRIVATE_DECISION_SENTINEL/);
  assert.match((await textAt(html, "[data-inquiry-recipient]")).join(""), /수신자가 작성하는 공란/);
});

test("hostile and long current fields are escaped excerpts with an intact full input reference", async () => {
  const hostile = '<img src=x onerror="alert(1)">\'&' + "긴😀\n".repeat(5000) + "OMITTED_TAIL";
  const long: CaseInput = {
    ...input, caseId: 'id/<script>"&', description: hostile, process: hostile,
    polymer: hostile, contamination: hostile, region: hostile, hazardousContact: "yes",
  };
  const original = JSON.stringify(long);
  const html = renderInquiry(long, decision, { recipientName: hostile });
  const markup = { images: 0, scripts: 0, links: [] as string[] };
  await new HTMLRewriter()
    .on("img", { element() { markup.images++; } })
    .on("script", { element() { markup.scripts++; } })
    .on("[data-inquiry-full-input] a", { element(element) { markup.links.push(element.getAttribute("href") ?? ""); } })
    .transform(new Response(html)).text();
  assert.equal(markup.images, 0);
  assert.equal(markup.scripts, 1);
  assert.deepEqual(markup.links, ["/cases/" + encodeURIComponent(long.caseId)]);
  const fields = await textAt(html, ".inquiry-fields dd");
  for (const index of [2, 3, 4, 6, 7]) {
    assert.match(fields[index] ?? "", /\[발췌\]$/);
    assert.ok((fields[index] ?? "").length < 200, "visible fields remain bounded even with hostile text");
  }
  assert.match(html, /&lt;img src=x onerror=&quot;/);
  assert.doesNotMatch(html, /OMITTED_TAIL|\uFFFD/);
  assert.match((await textAt(html, "[data-inquiry-contact]")).join(""), /있음 \(yes\)/);
  assert.match((await textAt(html, "[data-inquiry-full-input]")).join(""), /발췌.*전체 입력 참조/s);
  assert.match((await textAt(html, "[data-inquiry-recipient]")).join(""), /허가 증빙 아님/);
  assert.equal(JSON.stringify(long), original);
});

test("null and blank reported fields remain unknown without inferred data", async () => {
  const html = renderInquiry({
    ...input, polymer: null, process: "", contamination: "  ", region: null,
    description: "", massKg: null, hazardousContact: "no",
  }, decision, {});
  assert.deepEqual(await textAt(html, ".inquiry-fields dd"), [
    input.caseId, input.assessmentDate, "미상", "미상", "미상", "미상 · 계량값 확인 필요", "미상", "미상",
  ]);
  assert.match((await textAt(html, "[data-inquiry-contact]")).join(""), /없음 \(no\)/);
});

for (const result of [
  decision,
  { ...decision, humanApproval: "approved" },
  { state: "needs-information", caseId: input.caseId, questions: ["OLD_RANKING_SENTINEL"], evidence: [] },
  { state: "needs-review", caseId: input.caseId, reasons: ["OLD_RANKING_SENTINEL"], evidence: [] },
] satisfies readonly DecisionResult[]) {
  test(`current ${result.state}/${"humanApproval" in result ? result.humanApproval : "held"} status and historical reevaluation stay distinct`, async () => {
    const current = renderInquiry(input, result, {});
    const historical = renderInquiry(input, result, { historical: true, permissionChanged: true });
    const expected = {
      compared: "인간 승인 대기", "needs-information": "추가 정보 필요", "needs-review": "검토 필요",
    } as const;
    const status = (await textAt(current, "[data-inquiry-status]")).join("");
    assert.ok(status.includes(result.state === "compared" && result.humanApproval === "approved"
      ? "인간 승인 기록 있음" : expected[result.state]));
    assert.deepEqual(await textAt(current, "[data-inquiry-historical],[data-inquiry-permission]"), []);
    assert.match((await textAt(historical, "[data-inquiry-status]")).join(""), /과거 평가.*재평가 필요.*실행 보류/);
    assert.doesNotMatch(historical, /OLD_RANKING_SENTINEL|인간 승인 기록 있음|인간 승인 대기/);
    assert.deepEqual(await textAt(historical, ".inquiry-fields dd"), await textAt(current, ".inquiry-fields dd"));
  });
}

test("permission warning is visible without disclosure and does not depend on historical mode", async () => {
  const html = renderInquiry(input, decision, { permissionChanged: true });
  let depth = 0;
  let warningDepth = -1;
  await new HTMLRewriter()
    .on("details", { element(element) { depth++; element.onEndTag(() => { depth--; }); } })
    .on("[data-inquiry-permission]", { element() { warningDepth = depth; } })
    .transform(new Response(html)).text();
  assert.equal(warningDepth, 0);
  assert.match((await textAt(html, "[data-inquiry-permission]")).join(""), /過去|과거 평가/);
  assert.match((await textAt(html, "[data-inquiry-permission]")).join(""), /이미 전송된 사진은 회수할 수 없습니다/);
});
