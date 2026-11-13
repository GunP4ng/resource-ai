import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import manifest from "../data/candidates/j-2026-11-13/manifest.json" with { type: "json" };
import review from "../data/candidates/j-2026-11-13/peer-source-review.json" with { type: "json" };
import sources from "../data/candidates/j-2026-11-13/sources/commons-metadata.json" with { type: "json" };
import hManifest from "../data/h-candidates/2026-11-12/manifest.json" with { type: "json" };
import oManifest from "../data/candidates/oyeonseok-2026-11-10/manifest.json" with { type: "json" };
import { assessCase, decideCase } from "../src/assessment.ts";
import { parseCaseInput } from "../src/input.ts";

const root = new URL("../data/candidates/j-2026-11-13/", import.meta.url);
const sha256 = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");

test("J candidate sources preserve rights snapshots and distinct H/O source groups", async () => {
  const snapshot = await readFile(new URL("sources/commons-metadata.json", root));
  const hUrls = new Set(hManifest.entries.map((entry) => entry.photo.sourceUrl));

  assert.equal(manifest.candidates.length, 10);
  assert.equal(new Set(manifest.candidates.map((entry) => entry.sourcePage)).size, 10);
  assert.equal(new Set(manifest.candidates.map((entry) => entry.duplicateGroupId)).size, 10);
  assert.ok(oManifest.candidates.every((entry) => entry.sourceUrl === null));
  for (const entry of manifest.candidates) {
    const source = sources.files.find((file) => entry.sourceId === `commons-file-${file.pageId}`);
    if (source === undefined) throw new Error("J source metadata missing");
    assert.equal(source.filePage, entry.sourcePage);
    assert.equal(source.originalSha1, entry.originalImage.sha1);
    assert.equal(source.license, entry.license);
    assert.equal(entry.metadataSnapshot.sha256, sha256(snapshot));
    assert.equal(entry.originalImage.sha256, null);
    assert.equal(hUrls.has(entry.sourcePage), false);
    assert.equal(entry.independentLabels, null);
    assert.equal(entry.split, null);
  }
});

test("J candidate inputs remain unverified when evaluated by the real assessor", async () => {
  for (const entry of manifest.candidates) {
    const bytes = await readFile(new URL(entry.inputFile, root));
    assert.equal(sha256(bytes), entry.inputSha256);
    const parsed = parseCaseInput(JSON.parse(bytes.toString("utf8")));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) throw new Error("J candidate input did not parse");
    assert.equal(parsed.value.caseId, entry.candidateId);
    assert.deepEqual(parsed.value.photoRefs, []);
    assert.equal(parsed.value.massKg, null);
    assert.ok(assessCase(parsed.value).routes.every((route) => route.eligibility.state === "unknown"));
    assert.equal(decideCase(parsed.value).state, "needs-review");
  }
});

test("peer source review stays bound to H/O/J manifests and never allocates locked cases", async () => {
  for (const item of Object.values(review.manifests)) {
    assert.equal(sha256(await readFile(new URL("../" + item.path, import.meta.url))), item.sha256);
  }
  assert.equal(review.entries.length, 30);
  assert.equal(review.summary.lockedEvaluationCases, 0);
  assert.equal(review.summary.acceptedSplit, null);
  assert.equal(new Set(review.entries.map((entry) => entry.proposedGroup)).size, 17);
  assert.ok(review.entries.filter((entry) => entry.track === "O")
    .every((entry) => entry.proposedGroup === "oys-20261110-authoring-cohort"));
  assert.deepEqual(
    new Set(review.entries.map((entry) => entry.candidateId)),
    new Set([
      ...hManifest.entries.map((entry) => entry.candidateId),
      ...oManifest.candidates.map((entry) => entry.candidateId),
      ...manifest.candidates.map((entry) => entry.candidateId),
    ]),
  );
});
