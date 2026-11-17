import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { acceptHistoryPackage, receiveHistory } from "../src/o-history.ts";
import { revision } from "../src/o-validation.ts";
import { historyIndexPage, historyCasePage } from "../src/report-history.ts";
import { syntheticDocuments, syntheticHistory } from "./o-history-fixture.ts";

function archive() {
  const evidence = syntheticHistory();
  const template = { state: "needs-review", evidence: [], reasons: [
    '질량은 얼마인가요? <img src=x onerror="bad()"> & 미상',
    "currentness-unverified (legal-synthetic-one)", "currentness-unverified (waste-rule-synthetic-two)",
  ], preExecutionChecks: ['현장 확인 <script>bad()</script>'] } as const;
  const hash = createHash("sha256").update(JSON.stringify(template)).digest("hex");
  evidence.decisionTemplates = { [hash]: { ...template, evidence: [], reasons: [...template.reasons], preExecutionChecks: [...template.preExecutionChecks] } };
  for (const item of evidence.cases) {
    item.decisionTemplateSha256 = hash;
    item.input.description = '합성 입력 <b>원문</b> & "설명"';
    item.inputRevision = revision(item.input);
    item.sourceSha256 = createHash("sha256").update(`synthetic source ${item.index}`).digest("hex");
    item.preparedUploadSha256 = createHash("sha256").update(`synthetic prepared ${item.index}`).digest("hex");
  }
  const docs = syntheticDocuments(evidence);
  docs.comment.body += '\n[DO-NOT-RENDER](https://example.invalid) <iframe src="https://example.invalid">';
  return acceptHistoryPackage(receiveHistory(Buffer.from(JSON.stringify(docs.comment)), docs.evidenceBytes));
}
async function texts(html: string, selector: string) {
  const values: string[] = [];
  await new HTMLRewriter().on(selector, {
    element() { values.push(""); },
    text(chunk) { values[values.length - 1] += chunk.text; },
  }).transform(new Response(html)).text();
  const entities: Readonly<Record<string, string>> = { "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&amp;": "&" };
  return values.map(value => value.replace(/&(?:lt|gt|quot|#39|amp);/g, entity => entities[entity] ?? entity)
    .replace(/\s+/g, " ").trim());
}
async function attrs(html: string, selector: string, name: string) {
  const values: (string | null)[] = [];
  await new HTMLRewriter().on(selector, { element(el) { values.push(el.getAttribute(name)); } })
    .transform(new Response(html)).text();
  return values;
}
const accepted = archive();
const item = accepted.evidence.cases[0];
assert.ok(item);

test("index exposes every accepted record via ordinary GET navigation", async () => {
  // Given a received synthetic cohort; when rendered; then all fourteen targets remain navigable.
  const html = historyIndexPage(accepted);
  assert.deepEqual(await attrs(html, ".case-list a", "href"), Array.from({ length: 14 }, (_, i) => `/research/history/cases/${i + 1}`));
  assert.equal((await attrs(html, "a.primary-action:not(.secondary-action)", "href")).length, 1);
  const rows = await texts(html, ".case-list tbody tr");
  for (const record of accepted.evidence.cases) {
    assert.ok(rows[record.index - 1]?.includes(record.category));
    assert.ok(rows[record.index - 1]?.includes(record.input.assessmentDate));
  }
});

test("detail retains original questions and checks as escaped text, with unknown input reasons", async () => {
  // Given accepted text containing markup; when rendered; then text survives without executable markup.
  const html = historyCasePage(accepted, item);
  const reasons = await texts(html, "#history-reasons details li");
  const checks = await texts(html, "#history-checks details li");
  const template = Object.values(accepted.evidence.decisionTemplates)[0];
  assert.ok(template);
  assert.deepEqual(reasons, template.reasons);
  assert.deepEqual(checks, template.preExecutionChecks);
  assert.ok((await texts(html, "#history-input dd")).includes(item.input.description));
  const unknowns = await texts(html, "#history-input dd[data-unknown]");
  assert.equal(unknowns.length, 6);
  assert.deepEqual(await attrs(html, "#history-input dd[data-unknown]", "data-unknown"),
    ["process", "polymer", "contamination", "hazardousContact", "massKg", "region"]);
  for (const unknown of unknowns) {
    assert.match(unknown, /미상/);
    assert.match(unknown, /미기록|미확인/);
    assert.doesNotMatch(unknown, /0|null|unknown/i);
  }
  assert.equal((await attrs(html, "main img, main iframe, main script", "src")).length, 0);
  assert.equal((await attrs(html, "a.primary-action:not(.secondary-action)", "href")).length, 1);
});

for (const [name, render, expected] of [
  ["cohort", () => historyIndexPage(accepted), ["112", "42", "42", "154", "70", "42", "0", "42", "154"]],
  ["case", () => historyCasePage(accepted, item), ["8", "3", "3", "11", "5", "3", "0", "3", "11"]],
] as const) {
  test(`${name} usage keeps API inclusive input and SDK uncached input separate`, async () => {
    // Given nonzero cache; when rendered; then two independent views keep their own boundaries.
    const html = render();
    assert.deepEqual(await texts(html, "[data-usage] dd"), expected);
    assert.deepEqual(await attrs(html, "[data-usage]", "data-usage"), ["api", "sdk"]);
    if (name === "cohort") assert.deepEqual(await texts(html, "#history-counts dd"), ["14", "28", "1", "13"]);
  });
}

test("historical legal identifiers have no hydrated snapshot, quote or legal link", async () => {
  // Given two retained legal diagnostics; when rendered; then both stay unverified historical records.
  const html = historyCasePage(accepted, item);
  const legal = await texts(html, "#history-legal li");
  assert.equal(legal.length, 2);
  assert.ok(legal[0]?.includes("legal-synthetic-one"));
  assert.ok(legal[1]?.includes("waste-rule-synthetic-two"));
  for (const state of legal) assert.match(state, /currentness-unverified/);
  assert.equal((await attrs(html, "#history-legal a, #history-legal blockquote", "href")).length, 0);
});

test("source receipt is a safe link and never a rendered comment document", async () => {
  // Given an accepted comment projection; when rendered; then only its source reference is linked.
  const html = historyCasePage(accepted, item);
  assert.deepEqual(await attrs(html, "[data-history-source]", "href"), [accepted.package.record.source.comment.htmlUrl]);
  assert.doesNotMatch((await texts(html, "main")).join(""), /DO-NOT-RENDER|h56-real-photo-evidence-v1/);
  assert.equal((await attrs(html, "[src]", "src")).filter(src => src !== "/app-feedback.js").length, 0);
});

test("native disclosures retain execution and declared lineage metadata", async () => {
  // Given distinct source/prepared/model declarations; when rendered; then none is substituted or lost.
  const html = historyCasePage(accepted, item);
  const values = await texts(html, "details dd");
  for (const value of [item.caseId, item.actorId, item.execution.traceId, item.sourcePhotoId, item.photoRef,
    item.inputRevision, item.decisionTemplateSha256, item.sourceSha256, item.preparedUploadSha256,
    item.modelImageSha256, String(item.elapsedMs), String(item.workbookRow),
    ...item.requests.map(request => request.requestId), accepted.evidence.provider, accepted.evidence.route,
    accepted.evidence.model, accepted.evidence.sourceWorkbookSha256, accepted.evidence.baseGitSha,
    accepted.evidence.trackedPatchSha256, accepted.evidence.untrackedPatchSha256, accepted.evidence.codeFingerprint,
    accepted.package.sha256, accepted.package.record.source.suppliedCommentBytesSha256,
    accepted.package.record.source.suppliedEvidenceBytesSha256]) assert.ok(values.includes(value), value);
  assert.deepEqual(await texts(html, "#history-source li"), [
    ...accepted.evidence.limitations, ...accepted.evidence.photoObservationAudit.source,
  ]);
});

for (const render of [historyIndexPage, (a: typeof accepted) => historyCasePage(a, item)]) {
  test("archive is read-only and its sensitive body is separated from generic print output", async () => {
    // Given an accepted archive; when rendered; then no mutation/export controls or printable archive metadata exist.
    const html = render(accepted);
    assert.equal((await attrs(html, "form, input, button, textarea, select, a[download]", "action")).length, 0);
    const links = await attrs(html, "a", "href");
    assert.ok(links.every(href => !/edit|upload|export|download|reassess/.test(href ?? "")));
    const printable = (await texts(html, ".print-only")).join("");
    assert.ok(printable.length > 0);
    for (const secret of [item.caseId, item.execution.traceId, accepted.package.sha256, "112", "API", "SDK", "issuecomment-"]) {
      assert.ok(!printable.includes(secret));
    }
    const body = (await texts(html, "main > .screen-only")).join("");
    assert.ok(body.includes("과거 실행 기록 · 비공개 연구용 · 읽기 전용"));
    assert.ok(body.includes("실행·반출·계약 승인 아님"));
    assert.ok(body.includes("! 검토 필요"));
    const outside = await new HTMLRewriter().on(".screen-only", { element(el) { el.remove(); } })
      .transform(new Response(html)).text();
    assert.ok(!outside.includes(item.caseId));
    assert.match(html, /@media print\{[\s\S]*?\.screen-only[^}]*display:none/);
  });
}
