import assert from "node:assert/strict";
import { test } from "node:test";
import { Value } from "typebox/value";
import type { Type } from "typebox";
import { HistoryPackageSchema, HISTORY_SOURCE_BYTES } from "../src/o-history-schema.ts";
import { acceptHistoryPackage, historyReceipt, receiveHistory } from "../src/o-history.ts";
import { revision } from "../src/o-validation.ts";
import { syntheticHistory, syntheticDocuments } from "./o-history-fixture.ts";

function receive(e: unknown) {
  const d = syntheticDocuments(e);
  return receiveHistory(d.commentBytes, d.evidenceBytes);
}
test("receiver retains exact JSON, reconciles cached views, and distinguishes shared content from transmissions", () => {
  const d = syntheticDocuments(), a = receiveHistory(d.commentBytes, d.evidenceBytes), r = historyReceipt(acceptHistoryPackage(a));
  assert.equal(a.record.source.evidenceJson, d.evidenceJson);
  assert.equal(a.sha256, revision(a.record));
  assert.deepEqual(r.usage, { api: { input: 112, output: 42, cachedInput: 42, total: 154 },
    sdk: { input: 70, output: 42, cacheRead: 42, cacheWrite: 0, total: 154 },
    cases: 14, requests: 28, distinctModelImageHashes: 1, repeatedModelImageHashes: 13 });
  assert.equal(JSON.stringify(a).includes("discard-this-synthetic-profile"), false);
  assert.equal(r.cases.length, 14);
  assert.equal(r.receiverModelCalls, 0);
});
test("source byte bounds reject over-limit sources before parsing and retain exact-limit evidence", () => {
  const d = syntheticDocuments();
  const padded = Buffer.concat([d.evidenceBytes, Buffer.alloc(HISTORY_SOURCE_BYTES - d.evidenceBytes.length, " ")]);
  assert.equal(Buffer.byteLength(receiveHistory(d.commentBytes, padded).record.source.evidenceJson), HISTORY_SOURCE_BYTES);
  assert.throws(() => receiveHistory(Buffer.alloc(HISTORY_SOURCE_BYTES + 1), d.evidenceBytes), { message: "history-size" });
  assert.throws(() => receiveHistory(d.commentBytes, Buffer.alloc(HISTORY_SOURCE_BYTES + 1)), { message: "history-size" });
});
test("acceptance detaches and freezes evidence/package against later caller mutation", () => {
  const editable = Value.Parse(HistoryPackageSchema, structuredClone(receive(syntheticHistory())));
  const accepted = acceptHistoryPackage(editable);
  editable.record.source.evidenceJson = "changed";
  assert.equal(accepted.package.record.source.evidenceJson.startsWith("{"), true);
  assert.equal(Object.isFrozen(accepted.evidence.cases[0]?.input), true);
  assert.equal(Object.isFrozen(accepted.package.record.source), true);
});
type Evidence = ReturnType<typeof syntheticHistory>;
const mutations: readonly [string, (e: Evidence) => void, string][] = [
  ["case binding with resealed input revision", e => { const c = e.cases[0]; assert.ok(c); c.input.caseId = "synthetic-other"; c.inputRevision = revision(c.input); }, "history-input-binding"],
  ["photo binding with resealed input revision", e => { const c = e.cases[0]; assert.ok(c); c.input.photoRefs[0] = "synthetic-other"; c.inputRevision = revision(c.input); }, "history-input-binding"],
  ["input revision", e => { const c = e.cases[0]; assert.ok(c); c.input.description = "changed"; }, "history-input-revision"],
  ["duplicate case", e => { const c = e.cases[0], other = e.cases[1]; assert.ok(c && other); other.caseId = c.caseId; }, "history-duplicate-caseId"],
  ["duplicate request", e => { const c = e.cases[0]; assert.ok(c); c.requests[0].requestId = c.requests[1].requestId; }, "history-duplicate-request"],
  ["duplicate trace", e => { const c = e.cases[0], other = e.cases[1]; assert.ok(c && other); other.execution.traceId = c.execution.traceId; }, "history-duplicate-trace"],
  ["calendar date", e => { const c = e.cases[0]; assert.ok(c); c.input.assessmentDate = "2021-02-29"; c.inputRevision = revision(c.input); }, "invalid-date"],
  ["future assessment", e => { const c = e.cases[0]; assert.ok(c); c.input.assessmentDate = "2021-03-01"; c.inputRevision = revision(c.input); }, "history-case-date"],
  ["template hash", e => { const t = Object.values(e.decisionTemplates)[0]; assert.ok(t); t.reasons.push("Synthetic additional missing fact"); }, "history-template-hash"],
  ["template membership", e => { const c = e.cases[0]; assert.ok(c); c.decisionTemplateSha256 = "0".repeat(64); }, "history-template-membership"],
  ["SDK JSON", e => { const c = e.cases[0]; assert.ok(c); c.execution.usage = "{private-invalid"; }, "history-json"],
  ["SDK cache arithmetic", e => { const c = e.cases[0]; assert.ok(c); c.execution.usage = c.execution.usage.replace('"input":5', '"input":8'); }, "history-sdk-usage"],
  ["SDK model", e => { const c = e.cases[0]; assert.ok(c); c.execution.usage = c.execution.usage.replace('gpt-6-sol', 'synthetic-other'); }, "history-sdk-schema"],
  ["SDK image", e => { const c = e.cases[0]; assert.ok(c); c.execution.usage = c.execution.usage.replace(c.modelImageSha256, "0".repeat(64)); }, "history-image-lineage"],
  ["request image", e => { const c = e.cases[0]; assert.ok(c); c.requests[0].imageSha256 = "0".repeat(64); }, "history-image-lineage"],
  ["trace final request", e => { const c = e.cases[0]; assert.ok(c); c.execution.traceId += "wrong"; }, "history-trace"],
  ["API total", e => { const c = e.cases[0]; assert.ok(c); c.requests[0].usage.total_tokens++; }, "history-request-usage"],
  ["API cached subset", e => { const c = e.cases[0]; assert.ok(c); c.requests[0].usage.cached_input_tokens = 4; }, "history-request-usage"],
  ["aggregate", e => { e.aggregate.usage.input++; }, "history-aggregate-usage"],
  ["category cohort", e => { const c = e.cases[0]; assert.ok(c); c.category = "금속스크랩"; }, "history-cohort"],
  ["fingerprint", e => { e.photoObservationAudit.sourceFingerprint = "0".repeat(64); }, "history-fingerprint"],
  ["negative counter", e => { const c = e.cases[0]; assert.ok(c); c.elapsedMs = -1; }, "history-evidence-schema"],
  ["unsafe counter", e => { e.aggregate.usage.input = Number.MAX_SAFE_INTEGER + 1; }, "history-evidence-schema"],
  ["sum overflow", e => { const c = e.cases[0]; assert.ok(c); c.requests[0].usage.input_tokens = Number.MAX_SAFE_INTEGER; }, "history-overflow"],
];
for (const [name, mutate, reason] of mutations) test("receiver rejects forged " + name, () => {
  const e = syntheticHistory(); mutate(e);
  assert.throws(() => receive(e), { message: reason });
});
for (const [name, mutate] of [
  ["approval", (e: Evidence) => Reflect.set(e, "approved", true)],
  ["accuracy", (e: Evidence) => Reflect.set(e.scope, "accuracyMeasured", true)],
  ["rights", (e: Evidence) => Reflect.set(e, "commercialRights", "approved")],
  ["candidate", (e: Evidence) => Reflect.set(e.photoObservationAudit, "candidatePresentation", "confirmed")],
  ["observation loss", (e: Evidence) => Reflect.set(e.photoObservationAudit, "confirmedObservationLoss", true)],
  ["scope", (e: Evidence) => Reflect.set(e.scope, "actualModelHttp", 27)],
  ["compared", (e: Evidence) => Reflect.set(e.aggregate, "compared", 1)],
  ["decision", (e: Evidence) => { const t = Object.values(e.decisionTemplates)[0]; assert.ok(t); Reflect.set(t, "state", "approved"); }],
] as const) test("receiver rejects stronger " + name + " claim", () => {
  const e = syntheticHistory(); mutate(e); assert.throws(() => receive(e), { message: "history-evidence-schema" });
});
for (const field of ["photoRef", "sourcePhotoId", "workbookRow", "index"] as const)
  test("receiver rejects duplicate " + field + " independently of shared actor/content", () => {
    const e = syntheticHistory(), first = e.cases[0], second = e.cases[1]; assert.ok(first && second);
    Reflect.set(second, field, first[field]);
    assert.throws(() => receive(e), { message: "history-duplicate-" + field });
  });
test("template digest checks original property order even when canonical revision is unchanged", () => {
  const e = syntheticHistory(), t = Object.values(e.decisionTemplates)[0]; assert.ok(t);
  const c = e.cases[0]; assert.ok(c);
  e.decisionTemplates[c.decisionTemplateSha256] = { state: t.state, evidence: t.evidence, reasons: t.reasons, preExecutionChecks: t.preExecutionChecks };
  assert.equal(revision(t), revision(e.decisionTemplates[c.decisionTemplateSha256]));
  assert.throws(() => receive(e), { message: "history-template-hash" });
});
test("source fences, repository/issue/comment URLs and exact evidence bytes must correspond", () => {
  const original = syntheticDocuments();
  const edits: readonly ((c: typeof original.comment) => void)[] = [
    c => { c.body += '\n```json\n{}\n```\n'; }, c => { c.body = "no fence"; },
    c => { c.html_url = c.html_url.replace("123456", "123457"); },
    c => { c.issue_url = c.issue_url.replace("synthetic-owner", "other-owner"); },
    c => { c.url = c.url.replace("comments/123456", "comments/999999"); },
    c => { c.created_at = "2020-02-30T00:00:00Z"; }, c => { c.updated_at = "2020-02-01T00:00:00Z"; },
    c => { c.body = c.body.replace('"elapsedMs": 10', '"elapsedMs": 11'); },
  ];
  for (const edit of edits) {
    const c = structuredClone(original.comment); edit(c);
    assert.throws(() => receiveHistory(Buffer.from(JSON.stringify(c)), original.evidenceBytes));
  }
});
type Package = Type.Static<typeof HistoryPackageSchema>;
for (const [name, mutate, reseal] of [
  ["seal", (a: Package) => { a.sha256 = "0".repeat(64); }, false],
  ["bytes", (a: Package) => { a.record.source.evidenceJson += "\n"; }, true],
  ["identity", (a: Package) => Reflect.set(a.record.use, "identity", "current"), true],
  ["redistribution", (a: Package) => Reflect.set(a.record.use, "redistribution", "authorized"), true],
  ["execution", (a: Package) => Reflect.set(a.record.use, "executionAuthority", "granted"), true],
] as const) test("loading rejects forged package " + name, () => {
  const a = Value.Parse(HistoryPackageSchema, structuredClone(receive(syntheticHistory()))); mutate(a);
  if (reseal) a.sha256 = revision(a.record);
  assert.throws(() => acceptHistoryPackage(a));
});
