import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { candidatePath, loadHCandidates, sha256, verifyHCandidates } from "../scripts/h-candidates.ts";
import { assessCase, decideCase } from "../src/assessment.ts";
import { sanitizePhoto } from "../src/photo-codec.ts";

test("H candidate handoff preserves ten explicit inputs, photos, source/rights hashes and pending review", async () => {
  const pack = await loadHCandidates();
  assert.equal(new Set(pack.entries.map(row => row.duplicateGroupId)).size, 6);
  const report = await verifyHCandidates();
  assert.equal(report.caseCount, 10); assert.equal(report.externalModelCalls, 0);
  assert.equal(report.independentLabels, 0); assert.equal(report.fieldAcceptances, 0);
  assert.ok(report.results.every(row => row.output.decision.state === "needs-review"));
});

test("all ten shared PNGs fully decode within existing unchanged model limits", { timeout: 30000 }, async () => {
  for (const item of (await loadHCandidates()).entries) {
    const bytes = await readFile(candidatePath(item.photo.path));
    const clean = await sanitizePhoto(bytes, "image/png", new AbortController().signal);
    assert.ok(clean.data.length <= 5 * 1024 * 1024);
    assert.equal(sha256(clean.data), item.photo.sha256, item.candidateId);
  }
});

test("same photo candidates expose mixture and unresolved contamination questions without changing facts", async () => {
  const entries = (await loadHCandidates()).entries;
  for (const number of [2, 4]) {
    const row = entries[number]!;
    assert.ok(assessCase(row.input).questions.some(q => q.includes("층별")));
    assert.ok(!assessCase({ ...row.input, polymer: "PP" }).questions.some(q => q.includes("층별")));
  }
  for (const number of [3, 7]) {
    const row = entries[number]!, original = structuredClone(row.input);
    assert.ok(assessCase(row.input).questions.some(q => q.includes("SDS")));
    const resolved = { ...row.input, contamination: "이전 내용물과 세척·잔류 확인 완료 (합성 가정)" };
    assert.ok(!assessCase(resolved).questions.some(q => q.includes("SDS")));
    assert.deepEqual(row.input, original);
    assert.equal(decideCase({ ...resolved, hazardousContact: "yes" }).state, "needs-review");
  }
});
