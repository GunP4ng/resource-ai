import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { candidatePath, loadHCandidates, sha256, verifyHCandidates } from "../scripts/h-candidates.ts";
import { assessCase, decideCase } from "../src/assessment.ts";
import { sanitizePhoto } from "../src/photo-codec.ts";
import { parseCaseInput } from "../src/input.ts";
import { revision } from "../src/o-validation.ts";

test("H candidate handoff preserves ten explicit inputs, photos, source/rights hashes and pending review", async () => {
  const pack = await loadHCandidates();
  assert.equal(new Set(pack.entries.map(row => row.duplicateGroupId)).size, 6);
  const report = await verifyHCandidates();
  assert.equal(report.caseCount, 10); assert.equal(report.externalModelCalls, 0);
  assert.equal(report.independentLabels, 0); assert.equal(report.fieldAcceptances, 0);
  assert.deepEqual(report.results.map(row => row.output.decision.state), [
    "needs-review", "needs-review", "needs-review", "needs-review", "needs-review",
    "needs-review", "needs-review", "needs-review", "needs-information", "needs-information",
  ]);
});

// R: the executable evidence producer owns this serialization contract. Core and
// session tests do not run this CLI; lost injection or input-only reassessment
// would silently remove its observation evidence. No test-only production seam.
test("offline CLI preserves legacy evidence and carries synthetic SDK observations into host questions and gates", { timeout: 120000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "h-offline-cli-test-")), output = join(root, "evidence.json");
  try {
    const child = promisify(execFile)(process.execPath, ["scripts/h-photo-offline.ts", output], {
      cwd: fileURLToPath(new URL("..", import.meta.url)), timeout: 110000,
      env: { ...process.env, RESOURCE_MODEL_RUNNER: "local",
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: process.env["BUN_RUNTIME_TRANSPILER_CACHE_PATH"],
        BUN_INSTALL_CACHE_DIR: process.env["BUN_INSTALL_CACHE_DIR"], TMPDIR: process.env["TMPDIR"] },
    });
    child.child.stdin?.end();
    await child;
    const candidates = Type.Object({ photoInference: Type.String(), resins: Type.Array(Type.Object({ value: Type.String(), basis: Type.String() })),
      wasteCodes: Type.Array(Type.Unknown()), photoResins: Type.Optional(Type.Array(Type.Object({ value: Type.String(), basis: Type.String(), photoRef: Type.String(), sha256: Type.String() }))) });
    const row = Type.Object({ input: Type.Unknown(), caseRevision: Type.String(), transmittedImageSha256: Type.String(), inputUnchanged: Type.Boolean(),
      candidates, photoObservations: Type.Union([Type.Null(), Type.Object({ caseId: Type.String(), caseRevision: Type.String(), images: Type.Array(Type.Object({
        photoRef: Type.String(), sha256: Type.String(), usable: Type.Boolean(), resinCandidates: Type.Array(Type.String()) })) })]),
      questions: Type.Array(Type.String()), assessment: Type.Object({ legal: Type.Unknown(), pendingLegal: Type.Unknown(),
        routes: Type.Array(Type.Object({ eligibility: Type.Object({ state: Type.String(), missingFacts: Type.Array(Type.String()) }) })) }),
      decision: Type.Object({ state: Type.String(), questions: Type.Optional(Type.Array(Type.String())), reasons: Type.Optional(Type.Array(Type.String())) }),
      execution: Type.Object({ usage: Type.String() }), providerRequestId: Type.Null(), realProviderUsage: Type.Null(), responseOrigin: Type.String(), usageOrigin: Type.String() });
    const schema = Type.Object({ complete: Type.Boolean(), externalModelCalls: Type.Number(), syntheticTransportCalls: Type.Number(),
      realProviderUsage: Type.Null(), realRequestId: Type.Null(), publicPhotos: Type.Number(), rows: Type.Array(row),
      observationMatrix: Type.Array(Type.Intersect([row, Type.Object({ scenario: Type.String(), scope: Type.String(), addedQuestions: Type.Array(Type.String()),
        baseline: Type.Object({ candidates, legal: Type.Unknown(), pendingLegal: Type.Unknown(), questions: Type.Array(Type.String()) }) })])),
      lifecycle: Type.Object({ modelWithdrawalDenied: Type.Boolean(), previewPreserved: Type.Boolean(), storageRevocationDenied: Type.Boolean(), expiryPurged: Type.Number() }),
      http: Type.Object({ createStatus: Type.Number(), answerStatus: Type.Number(), otherSessionStatus: Type.Number(), mixedQuestionShown: Type.Boolean(), resolvedQuestionRemoved: Type.Boolean() }),
      samePhotoConditionVariants: Type.Array(row), historicalSyntheticBoundaryControl: Type.Object({ variants: Type.Array(row) }),
      fieldAccuracy: Type.String(), humanAcceptance: Type.String(), operationalAcceptance: Type.String() });
    const report: unknown = JSON.parse(await readFile(output, "utf8")); assert.ok(Value.Check(schema, report));
    assert.equal(report.complete, true); assert.equal(report.publicPhotos, 10); assert.equal(report.externalModelCalls, 0);
    assert.equal(report.syntheticTransportCalls, 21); assert.equal(report.rows.length, 10);
    assert.deepEqual(report.lifecycle, { modelWithdrawalDenied: true, previewPreserved: true, storageRevocationDenied: true, expiryPurged: 9 });
    assert.equal(report.http.createStatus, 303); assert.equal(report.http.answerStatus, 303); assert.equal(report.http.otherSessionStatus, 404);
    assert.equal(report.http.mixedQuestionShown, true); assert.equal(report.http.resolvedQuestionRemoved, true);
    assert.deepEqual([report.fieldAccuracy, report.humanAcceptance, report.operationalAcceptance], ["unclaimed", "unclaimed", "unclaimed"]);
    const pack = await loadHCandidates();
    for (const [index, legacy] of report.rows.entries()) {
      assert.equal(legacy.transmittedImageSha256, pack.entries[index]?.photo.sha256);
      assert.equal(legacy.photoObservations, null); assert.equal(legacy.candidates.photoInference, "not-performed");
      assert.equal(legacy.candidates.photoResins, undefined);
    }
    assert.equal(report.samePhotoConditionVariants.length, 3); assert.equal(report.historicalSyntheticBoundaryControl.variants.length, 4);
    assert.deepEqual(report.observationMatrix.map(item => item.scenario), ["matching-reported-resin", "conflicting-resin", "unknown-reported-resin", "unusable-photo"]);
    const expectedResins = [["PP"], ["PET"], ["PET"], []], expectedQuestions = [0, 1, 1, 1];
    for (const [index, item] of report.observationMatrix.entries()) {
      assert.match(item.scope, /SYNTHETIC/); assert.ok(item.photoObservations);
      const parsed = parseCaseInput(item.input); assert.ok(parsed.ok); const input = parsed.value;
      assert.equal(item.inputUnchanged, true); assert.equal(item.caseRevision, revision(input));
      assert.equal(item.photoObservations.caseId, input.caseId); assert.equal(item.photoObservations.caseRevision, revision(input));
      assert.equal(item.transmittedImageSha256, pack.entries[2]?.photo.sha256);
      assert.deepEqual(item.photoObservations.images.map(image => [image.photoRef, image.sha256, image.usable, image.resinCandidates]),
        [[input.photoRefs[0], item.transmittedImageSha256, index !== 3, expectedResins[index]]]);
      assert.equal(item.candidates.photoInference, "unverified-model-observations");
      assert.deepEqual(item.candidates.photoResins?.map(candidate => [candidate.value, candidate.basis, candidate.photoRef, candidate.sha256]),
        expectedResins[index]?.map(value => [value, "unverified-photo", input.photoRefs[0], item.transmittedImageSha256]));
      assert.deepEqual(item.candidates.resins, input.polymer === null ? [] : [{ value: input.polymer, basis: "reported-input" }]);
      assert.deepEqual(item.candidates.wasteCodes, item.baseline.candidates.wasteCodes);
      assert.deepEqual(item.assessment.legal, item.baseline.legal); assert.deepEqual(item.assessment.pendingLegal, item.baseline.pendingLegal);
      assert.equal(input.hazardousContact, "no"); assert.equal(input.polymer, index === 2 ? null : "PP");
      assert.equal(item.addedQuestions.length, expectedQuestions[index]);
      assert.deepEqual(item.questions, [...item.baseline.questions, ...item.addedQuestions]);
      for (const question of item.addedQuestions) {
        assert.match(question, index === 3 ? /재촬영/ : /PET/);
        assert.ok((item.decision.questions ?? item.decision.reasons ?? []).includes(question));
        assert.ok(item.assessment.routes.every(route => route.eligibility.missingFacts.includes(question)));
      }
      assert.deepEqual(item.assessment.routes.map(route => route.eligibility.state), ["unknown", "unknown", "unknown", "unknown"]);
      assert.equal(item.decision.state, index === 0 ? "needs-review" : "needs-information");
      const usage: unknown = JSON.parse(item.execution.usage);
      assert.ok(Value.Check(Type.Object({ imageSha256: Type.Array(Type.String()) }), usage));
      assert.deepEqual(usage.imageSha256, [item.transmittedImageSha256]);
      assert.match(item.responseOrigin, /synthetic injected SSE/); assert.match(item.usageOrigin, /synthetic fixture/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
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
