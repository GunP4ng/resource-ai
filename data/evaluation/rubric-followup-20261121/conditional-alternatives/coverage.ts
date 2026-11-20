import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import baseline from "./baseline.json" with { type: "json" };
import development from "../../development.json" with { type: "json" };
import registry from "../../../sources/evidence-candidates.json" with { type: "json" };
import { createResourceDomain } from "../../../../src/domain.ts";
import { parseCaseInput } from "../../../../src/input.ts";
import { parseDecision } from "../../../../src/o-decision.ts";
import { canonical } from "../../../../src/o-validation.ts";
import { sourceManifest } from "../../../../src/sources.ts";
import type { CaseInput, ConditionalAlternative, DecisionResult, RouteAssessment } from "../../../../src/contracts.ts";

const directory = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(directory, "../../../..");
const sha256 = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const sourceFiles = ["data/sources/evidence-candidates.json", "data/sources/manifest.json"];
const protectedBefore = await Promise.all(sourceFiles.map(async path => ({ path, sha256: sha256(await readFile(resolve(root, path))) })));
const sourceAudit = new Map<string, { readonly sourceId: string; readonly locator: string; readonly claim: string;
  readonly quote: string; readonly snapshotPath: string; readonly snapshotSha256: string;
  readonly originalPath: string; readonly originalSha256: string; readonly versionFamily: string | null }>();
async function auditCitation(citation: { readonly sourceId: string; readonly locator: string; readonly claim: string; readonly quote?: string },
  decision: DecisionResult, assessmentDate: string): Promise<void> {
  const entry = registry.find(item => item.sourceId === citation.sourceId);
  const source = sourceManifest.find(item => item.sourceId === citation.sourceId);
  const record = decision.evidence.find(item => item.sourceId === citation.sourceId);
  assert.ok(entry && source?.localPath && record, citation.sourceId);
  assert.equal(citation.locator, entry.locator);
  assert.equal(citation.claim, entry.claim);
  if (citation.quote !== undefined) assert.equal(citation.quote, entry.quote);
  assert.equal(record.locator, entry.locator);
  assert.equal(record.sha256, entry.sha256);
  assert.equal(record.url, source.url);
  assert.equal(record.datasetVersion, source.datasetVersion);
  assert.ok(source.effectiveFrom && source.effectiveFrom <= assessmentDate);
  assert.ok(source.effectiveTo === null || source.effectiveTo >= assessmentDate);
  if (sourceAudit.has(citation.sourceId)) return;
  const bytes = await readFile(resolve(root, source.localPath));
  assert.equal(sha256(bytes), source.sha256);
  assert.equal(sha256(bytes), entry.sha256);
  assert.ok(bytes.toString("utf8").includes(entry.quote));
  const original = sourceManifest.find(item => item.sourceId === (entry.originalSourceId ?? entry.sourceId));
  assert.ok(original?.localPath && original.sha256);
  const originalHash = sha256(await readFile(resolve(root, original.localPath)));
  assert.equal(originalHash, original.sha256);
  if (entry.originalSourceId !== undefined) assert.equal(source.derivedFrom, originalHash);
  sourceAudit.set(citation.sourceId, { sourceId: citation.sourceId, locator: entry.locator, claim: entry.claim,
    quote: entry.quote, snapshotPath: source.localPath, snapshotSha256: sha256(bytes), originalPath: original.localPath,
    originalSha256: originalHash, versionFamily: entry.versionFamily ?? null });
}

assert.equal(development.cases.length, 18);
assert.equal(new Set(development.cases.map(item => item.caseId)).size, 18);
const rows: {
  readonly caseId: string; readonly inputRef: string; readonly inputSha256: string; readonly assessmentDate: string;
  readonly stateBefore: string; readonly stateAfter: DecisionResult["state"]; readonly recommended: boolean;
  readonly hasAlternative: boolean; readonly hasSupportedAlternative: boolean; readonly informationalUnion: boolean;
  readonly routeSupportedUnion: boolean; readonly uncoveredReasons: readonly string[];
  readonly input: CaseInput; readonly strictRoutes: readonly RouteAssessment[]; readonly result: DecisionResult;
}[] = [];
for (const item of development.cases) {
  const path = resolve(root, "data/evaluation", item.inputRef);
  const bytes = await readFile(path);
  const before = baseline.cases.find(row => row.caseId === item.caseId);
  assert.ok(before);
  assert.equal(sha256(bytes), before.originalSha256);
  assert.equal(sha256(bytes), item.sourceHash);
  const raw: unknown = JSON.parse(bytes.toString("utf8"));
  const parsed = parseCaseInput(raw);
  assert.ok(parsed.ok);
  const input = { ...parsed.value, photoRefs: [] };
  assert.equal(input.caseId, item.caseId);
  assert.equal(input.assessmentDate, before.assessmentDate);
  assert.equal(sha256(canonical(input)), before.executionInputSha256);
  const domain = createResourceDomain(input);
  const result = await domain.decide();
  assert.equal(result.state, before.state);
  assert.equal(result.caseId, input.caseId);
  assert.deepEqual(parseDecision(result), result);
  const strictRoutes = await domain.assessRoutes(input);
  assert.ok(strictRoutes.every(route => route.eligibility.state === "unknown"));
  let alternatives: readonly ConditionalAlternative[] = [];
  let recommended = false;
  if (result.state === "compared") {
    assert.equal(sha256(canonical(result)), before.decisionSha256, `${input.caseId}: compared output changed`);
    assert.equal(result.humanApproval, "pending");
    assert.ok(result.recommendations?.length);
    for (const recommendation of result.recommendations) {
      assert.ok(recommendation.legalCitations.length);
      for (const citation of recommendation.legalCitations) await auditCitation(citation, result, input.assessmentDate);
    }
    recommended = true;
  } else {
    alternatives = result.conditionalAlternatives ?? [];
    for (const alternative of alternatives) {
      assert.equal(alternative.state, "informational");
      assert.equal(alternative.executable, false);
      assert.equal("rank" in alternative || "eligibility" in alternative, false);
      assert.ok(alternative.citations.length);
      for (const citation of alternative.citations) await auditCitation(citation, result, input.assessmentDate);
      const families = alternative.citations.map(citation => sourceAudit.get(citation.sourceId)?.versionFamily);
      if (alternative.support.state === "route-supported") {
        assert.equal(alternative.routeId, "mechanical-recycling");
        assert.equal(alternative.condition.code, "clean-separated");
        assert.deepEqual([...families].sort(), ["waste-rule-annex4-code", "waste-rule-annex4-2-r3-3",
          "waste-rule-annex4-3-types", "waste-rule-annex5-3-common"].sort());
        assert.equal(alternative.citations.filter(citation => citation.scope === "route-specific").length, 3);
      } else {
        assert.ok(alternative.support.missingEvidence.length);
        assert.ok(alternative.citations.every(citation => citation.scope === "general-requirement"));
      }
    }
  }
  const hasAlternative = alternatives.length > 0;
  const hasSupportedAlternative = alternatives.some(alternative => alternative.support.state === "route-supported");
  const missingRouteEvidence = recommended || hasSupportedAlternative ? [] : alternatives.flatMap(alternative => alternative.support.missingEvidence);
  rows.push({ caseId: input.caseId, inputRef: item.inputRef, inputSha256: before.originalSha256,
    assessmentDate: input.assessmentDate, stateBefore: before.state, stateAfter: result.state,
    recommended, hasAlternative, hasSupportedAlternative, informationalUnion: recommended || hasAlternative,
    routeSupportedUnion: recommended || hasSupportedAlternative,
    uncoveredReasons: missingRouteEvidence.length ? [...new Set(missingRouteEvidence)]
      : recommended || hasAlternative ? [] : ["No registered source applicable to the original assessment date and case context."],
    input, strictRoutes, result });
  assert.equal(sha256(await readFile(path)), before.originalSha256);
}
for (const item of protectedBefore) assert.equal(sha256(await readFile(resolve(root, item.path))), item.sha256);
const count = (predicate: (row: typeof rows[number]) => boolean) => rows.filter(predicate).length;
const summary = {
  schemaVersion: 1, scope: "18 exposed original development inputs, deterministic host execution; no model/provider, human labels or photographs",
  baselineRecommended: baseline.baselineRecommended, total: rows.length,
  recommended: count(row => row.recommended),
  held: count(row => !row.recommended),
  heldWithRegisteredAlternative: count(row => row.hasAlternative),
  heldWithRouteSupportedAlternative: count(row => row.hasSupportedAlternative),
  informationalUnion: count(row => row.informationalUnion),
  routeSupportedUnion: count(row => row.routeSupportedUnion),
  stateChanges: count(row => row.stateBefore !== row.stateAfter),
  sourceAudit: { distinctCitations: sourceAudit.size, status: "pass", originalInputHashesPreserved: 18,
    comparedOutputsByteEquivalentByCanonicalSha256: count(row => row.recommended), protectedBefore },
  interpretation: "Informational coverage includes unavailable verification questions. Route-supported coverage requires the four-source conditional recycling chain or an unchanged cited recommendation. Neither is measured legal correctness, executable eligibility or independent held-out accuracy.",
  cases: rows.map(({ input: _input, strictRoutes: _routes, result: _result, ...row }) => row),
  implementationHashes: await Promise.all(["src/contracts.ts", "src/domain.ts", "src/assessment.ts", "src/o-decision.ts",
    "src/conditional-alternatives.ts", "tests/assessment.test.ts", "tests/recommendation.test.ts",
    relative(root, fileURLToPath(import.meta.url))].map(async path => ({ path, sha256: sha256(await readFile(resolve(root, path))) }))),
};
await writeFile(resolve(directory, "results.json"), `${JSON.stringify(rows, null, 2)}\n`);
await writeFile(resolve(directory, "source-audit.json"), `${JSON.stringify([...sourceAudit.values()], null, 2)}\n`);
await writeFile(resolve(directory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ ...summary, cases: summary.cases.map(({ caseId, stateAfter, hasAlternative, hasSupportedAlternative }) =>
  ({ caseId, stateAfter, hasAlternative, hasSupportedAlternative })), implementationHashes: undefined }, null, 2));
