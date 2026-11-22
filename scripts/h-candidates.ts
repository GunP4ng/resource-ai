import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { CaseInput } from "../src/contracts.ts";
import { parseCaseInput } from "../src/input.ts";
import { assessCase } from "../src/assessment.ts";
import { createResourceDomain } from "../src/domain.ts";
import { presentAssessmentDecision } from "../src/o-verification-plan-candidates.ts";

// This is a private reproduction-file shape, not a new application input contract.
interface Candidate {
  candidateId: string; stratum: string; input: CaseInput; inputFile: string;
  duplicateGroupId: string; independentLabels: null; reviewers: null; split: null; acceptance: null;
  photo: { path: string; sha256: string; mimeType: "image/png"; bytes: number;
    modelTransmissionApproval: false; operatorConsent: false;
    sourceSnapshot: { path: string; sha256: string; sourceId: string; locator: string };
    licenseSnapshot: string; licenseSnapshotSha256: string };
}
export const candidateRoot = fileURLToPath(new URL("../data/h-candidates/2026-11-12/", import.meta.url));
export const sha256 = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex");
export function candidatePath(path: string): string {
  const file = resolve(candidateRoot, path);
  assert.ok(file.startsWith(resolve(candidateRoot) + sep), "candidate path must stay inside pack");
  return file;
}

export async function loadHCandidates(): Promise<{ version: string; entries: Candidate[]; manifestSha256: string }> {
  const bytes = await readFile(candidatePath("manifest.json"));
  const pack = JSON.parse(bytes.toString("utf8")) as { version: string; entries: Candidate[]; modelTransmissionApproval: boolean };
  assert.equal(pack.modelTransmissionApproval, false);
  assert.ok(Array.isArray(pack.entries)); assert.equal(pack.entries.length, 10);
  assert.equal(new Set(pack.entries.map(item => item.candidateId)).size, 10);
  for (const item of pack.entries) {
    const parsed = parseCaseInput(item.input); assert.ok(parsed.ok, item.candidateId);
    if (!parsed.ok) throw new Error("invalid candidate input");
    assert.equal(parsed.value.caseId, item.candidateId); assert.deepEqual(parsed.value.photoRefs, []);
    assert.match(parsed.value.description, /SYNTHETIC/);
    assert.deepEqual(JSON.parse(await readFile(candidatePath(item.inputFile), "utf8")), parsed.value);
    assert.equal(item.photo.mimeType, "image/png");
    const photo = await readFile(candidatePath(item.photo.path));
    assert.equal(photo.length, item.photo.bytes); assert.equal(sha256(photo), item.photo.sha256);
    assert.equal(item.photo.modelTransmissionApproval, false); assert.equal(item.photo.operatorConsent, false);
    for (const [path, hash] of [[item.photo.sourceSnapshot.path, item.photo.sourceSnapshot.sha256],
      [item.photo.licenseSnapshot, item.photo.licenseSnapshotSha256]]) {
      assert.ok(path && hash); assert.equal(sha256(await readFile(candidatePath(path))), hash);
    }
    assert.equal(item.independentLabels, null); assert.equal(item.reviewers, null);
    assert.equal(item.split, null); assert.equal(item.acceptance, null);
  }
  return { version: pack.version, entries: pack.entries, manifestSha256: sha256(bytes) };
}

/** Deterministic host engine measurement; no runner/authentication/model or external URLs. */
export async function verifyHCandidates() {
  const pack = await loadHCandidates();
  const results = [];
  for (const item of pack.entries) {
    const before = structuredClone(item.input), assessment = assessCase(item.input);
    const output = { decision: presentAssessmentDecision(await createResourceDomain(item.input).decide()) };
    assert.deepEqual(item.input, before);
    assert.equal(assessment.candidates.photoInference, "not-performed");
    assert.ok(assessment.routes.every(route => route.eligibility.state === "unknown"));
    if (output.decision.state === "compared") {
      assert.equal(output.decision.humanApproval, "pending");
      assert.ok(output.decision.recommendations?.every(item => item.grade === "public-conditional"));
      assert.ok(output.decision.routes.some(route => route.eligibility.state === "conditional"));
    }
    results.push({ candidateId: item.candidateId, stratum: item.stratum,
      input: item.input, duplicateGroupId: item.duplicateGroupId,
      photoSha256: item.photo.sha256, source: item.photo.sourceSnapshot,
      questions: assessment.questions, candidates: assessment.candidates,
      legalIssues: assessment.legal.issues, pendingLegal: assessment.pendingLegal,
      output, assessment });
  }
  const sourceHashes = Object.fromEntries(await Promise.all([
    "src/input.ts", "src/assessment.ts", "src/domain.ts", "src/session.ts",
    "src/evidence.ts", "src/evidence-registry.ts", "scripts/h-candidates.ts",
  ].map(async file => [file, sha256(await readFile(new URL("../" + file, import.meta.url)))])));
  return { corpusVersion: pack.version, manifestSha256: pack.manifestSha256, sourceHashes,
    caseCount: results.length, sourceGroupCount: new Set(pack.entries.map(item => item.duplicateGroupId)).size,
    externalModelCalls: 0, independentLabels: 0, fieldAcceptances: 0,
    scope: "Public photo assets with synthetic case assumptions. Actual local H APIs; not image inference, independent labels, field acceptance or the team's 18-case experiment.", results };
}

if (import.meta.main) {
  const result = await verifyHCandidates();
  const output = resolve(process.argv[2] ?? "artifacts/h-candidates.json");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ output, cases: result.caseCount, sourceGroups: result.sourceGroupCount,
    externalModelCalls: 0, rows: result.results.map(row => ({ id: row.candidateId,
      questions: row.questions.length, state: row.output.decision.state })) }, null, 2));
}
