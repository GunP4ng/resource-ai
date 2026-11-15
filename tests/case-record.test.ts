import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { prepareCaseRecord, createBundledSnapshotReader } from "../src/case-record.ts";
import { syntheticCase, syntheticReviewed } from "./h-fixtures.ts";
import { revision } from "../src/o-validation.ts";
import { collectMissingQuestions } from "../src/input.ts";
import type { PhotoResolver } from "../src/session.ts";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const codeRevision = "497fdb0144ddcbb36fd0974d616dfdb78e435750";
const options = () => ({ dataOrigin: { kind: "synthetic" as const, reference: "generated regression inputs, not field evidence" },
  codeRevision, signal: new AbortController().signal, sources: createBundledSnapshotReader(process.cwd()) });

test("records actual J snapshot bytes and their SHA without turning a synthetic case into approval", async () => {
  const result = await prepareCaseRecord(syntheticCase, options());
  assert.equal(result.record.dataOrigin.kind, "synthetic"); assert.equal(result.record.release, "review-required");
  assert.equal(result.record.execution, "offline-preparation"); assert.equal(result.sha256, revision(result.record));
  assert.ok(result.record.sources.length > 0);
  assert.ok(result.record.sources.some((s) => s.sourceId.includes("pdf") && s.state === "verified"));
  for (const source of result.record.sources.filter((s) => s.state === "verified")) {
    assert.equal(sha(Buffer.from(source.base64!, "base64")), source.expectedSha256);
    assert.equal(source.actualSha256, source.expectedSha256);
  }
  assert.ok(result.record.assessment.routes.every((r) => r.eligibility.state === "unknown"));
  assert.equal(result.record.decision.state, "compared");
  if (result.record.decision.state === "compared") assert.equal(result.record.decision.humanApproval, "pending");
});

test("missing and changed snapshots are explicit, never replaced with fabricated verified data", async () => {
  for (const [bytes, state] of [[null, "unavailable"], [new Uint8Array([1,2,3]), "hash-mismatch"]] as const) {
    const result = await prepareCaseRecord(syntheticCase, { ...options(), sources: async () => bytes });
    assert.ok(result.record.sourceIssues.length > 0);
    assert.ok(result.record.sources.every((s) => s.state === state && s.base64 === null));
    assert.equal(result.record.release, "review-required");
  }
});

test("record and resource hashes survive JSON storage with optional values omitted", async () => {
  const result = await prepareCaseRecord(syntheticCase, { ...options(),
    resources: { assessmentOptions: undefined, processors: undefined } });
  const restored = JSON.parse(JSON.stringify(result));
  assert.equal(revision(restored.record.resources), result.record.resourcesSha256);
  assert.equal(revision(restored.record), result.sha256);
  assert.deepEqual(restored.record.decision, result.record.decision);
});

test("same synthetic photo retains SHA while changed process/contamination removes eligibility and changes questions", async () => {
  const bytes = new Uint8Array([1,2,3]);
  const photos: PhotoResolver = async (request) => ({ ...request, data: bytes, sha256: sha(bytes), mimeType: "image/png", approvedForModel: true });
  const original = { ...syntheticCase, photoRefs: ["synthetic-photo"] }, resources = syntheticReviewed(original);
  const baseline = await prepareCaseRecord(original, { ...options(), photos, resources });
  assert.equal(baseline.record.decision.state, "compared"); // Only with synthetic reviewed permits, quotes and factors.
  const derived = baseline.record.sources.find((source) => source.role === "review-facts");
  assert.equal(derived?.state, "verified");
  assert.ok(JSON.parse(Buffer.from(derived!.base64!, "base64").toString("utf8")).facts);
  const incomplete = { ...original, process: null, contamination: null };
  const changed = await prepareCaseRecord(incomplete, { ...options(), photos, resources });
  assert.equal(changed.record.images[0]?.sha256, baseline.record.images[0]?.sha256);
  assert.notEqual(changed.record.caseRevision, baseline.record.caseRevision);
  assert.equal(changed.record.decision.state, "needs-review");
  for (const question of collectMissingQuestions(incomplete)) assert.ok(changed.record.assessment.questions.includes(question));
  assert.ok(changed.record.assessment.routes.every((route) => route.eligibility.state === "unknown"));
  const revised = await prepareCaseRecord({ ...original, process: "압출" }, { ...options(), photos, resources });
  assert.equal(revised.record.decision.state, "needs-review");
  assert.ok(revised.record.assessment.reviewIssues.length > 0); // Old review cannot authorize changed facts.
  const risk = await prepareCaseRecord({ ...original, contamination: "기름 오염", hazardousContact: "yes" }, { ...options(), photos });
  assert.equal(risk.record.images[0]?.sha256, baseline.record.images[0]?.sha256);
  assert.equal(risk.record.decision.state, "needs-review");
  assert.ok(risk.record.assessment.routes.every((route) => route.eligibility.state === "unknown"));
  assert.ok(risk.record.assessment.reviewReasons.some((reason) => reason.includes("유해물질")));
});

test("strict input, missing photos, cancellation and unlabelled provenance cannot produce an execution record", async () => {
  await assert.rejects(prepareCaseRecord({ ...syntheticCase, massKg: "2000" }, options()));
  await assert.rejects(prepareCaseRecord({ ...syntheticCase, photoRefs: ["missing"] }, options()), /photo-unavailable/);
  await assert.rejects(prepareCaseRecord(syntheticCase, { ...options(), codeRevision: "unknown" }), /invalid-provenance/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(prepareCaseRecord(syntheticCase, { ...options(), signal: controller.signal }), /cancelled/);
});

test("H2 exposes reported resin and conditional code candidates without photo chemistry inference", async () => {
  const record = (await prepareCaseRecord(syntheticCase, options())).record;
  assert.deepEqual(record.assessment.candidates.resins, [{ value: "PP", basis: "reported-input" }]);
  const code = record.assessment.candidates.wasteCodes.find((candidate) => candidate.value === "51-03-01");
  assert.ok(code); assert.equal(code.state, "conditional");
  assert.ok(code.locator.includes("별표 4"));
  assert.ok(record.sources.some((source) => source.sourceId === code.sourceId && source.expectedSha256 === code.sha256 && source.state === "verified"));
  assert.ok(record.assessment.routes.every((route) => route.eligibility.state === "unknown"));
  const missing = (await prepareCaseRecord({ ...syntheticCase, polymer: null }, options())).record;
  assert.deepEqual(missing.assessment.candidates.resins, []);
  assert.ok(missing.assessment.questions.some((question) => question.includes("수지")));
  assert.equal(missing.assessment.candidates.photoInference, "not-performed");
});

test("photo proof uses one owned snapshot of resolver values", async () => {
  const bytes = new Uint8Array([1,2,3]), expected = sha(bytes); let reads = 0;
  const photos: PhotoResolver = async (request) => ({ ...request, data: bytes, mimeType: "image/png", approvedForModel: true,
    get sha256() { return ++reads === 1 ? expected : "0".repeat(64); } });
  const result = await prepareCaseRecord({ ...syntheticCase, photoRefs: ["synthetic-getter"] }, { ...options(), photos });
  assert.equal(result.record.images[0]?.sha256, expected); assert.equal(reads, 1);
});
