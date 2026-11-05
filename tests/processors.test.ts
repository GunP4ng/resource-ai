import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findProcessorsWithDiagnostics } from "../src/processors.ts";
import { readSanitizedProcessorSnapshot, sourceManifest } from "../src/sources.ts";
import { caseInput, route, processorFixture } from "../src/o-synthetic-evidence.ts";
test("verified facility preserves actual permit verification; acceptance defaults unconfirmed", () => {
  const result = findProcessorsWithDiagnostics(caseInput, route, processorFixture());
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.verifiedAt, "2026-11-05T00:00:00Z");
  assert.equal(result.candidates[0]?.acceptance, "unconfirmed");
  assert.deepEqual(result.candidates[0]?.permitEvidenceIds, ["synthetic-evidence"]);
});
for (const [change, reason] of [
  [{ codes: ["different"] }, "waste-code-mismatch"], [{ status: "revoked" }, "permit-invalid"],
  [{ regions: ["elsewhere"] }, "region-mismatch"], [{ regions: [] }, "region-unverified"],
  [{ identity: "office" }, "facility-identity-unverified"], [{ observedOn: "2026-09-01" }, "permit-stale"],
  [{ effectiveTo: null, openEnded: false }, "permit-invalid"], [{ conditions: ["pending"] }, "permit-conditions-unresolved"],
] satisfies readonly [Parameters<typeof processorFixture>[0], string][]) {
  test(`excludes facility: ${reason}`, () => {
    const result = findProcessorsWithDiagnostics(caseInput, route, processorFixture(change));
    assert.deepEqual(result.candidates, []); assert.equal(result.diagnostics[0]?.reason, reason);
  });
}
test("expired acceptance remains unconfirmed with diagnostic", () => {
  const result = findProcessorsWithDiagnostics(caseInput, route, processorFixture({}, true));
  assert.equal(result.candidates[0]?.acceptance, "unconfirmed");
  assert.equal(result.diagnostics[0]?.reason, "acceptance-unverified-or-expired");
});
test("case revision change never reuses classification", () => {
  assert.equal(findProcessorsWithDiagnostics({ ...caseInput, massKg: 1 }, route, processorFixture()).diagnostics[0]?.reason, "waste-code-unverified");
});
test("real directory's 31 listings yield zero verified candidates", () => {
  const source = sourceManifest.find((s) => s.sourceId === "ulsan-processors-2025-12-sanitized");
  assert.ok(source);
  const loaded = readSanitizedProcessorSnapshot(readFileSync(new URL("../data/reference/ulsan-processors-2025-12.sanitized.csv", import.meta.url)), source);
  assert.equal(loaded.state, "available");
  if (loaded.state !== "available") throw new Error("snapshot failed");
  assert.equal(loaded.rows.length, 31);
  const result = findProcessorsWithDiagnostics(caseInput, route, { version: "real-unverified", directory: loaded.rows, documents: [], scopes: [], permits: [], acceptance: [] });
  assert.deepEqual(result, { candidates: [], diagnostics: [{ processorId: null, reason: "waste-code-unverified" }] });
});
test("forged snapshot and impossible dates rejected structurally", () => {
  const context = processorFixture();
  assert.throws(() => findProcessorsWithDiagnostics({ ...caseInput, assessmentDate: "2026-02-30" }, route, context), /invalid-date/);
  assert.throws(() => findProcessorsWithDiagnostics(caseInput, route, { ...context, documents: context.documents.map((d) => ({ ...d, snapshot: "{}" })) }), /snapshot-hash-mismatch/);
});
test("current case-specific acceptance is confirmed; documented open-ended permit remains valid", () => {
  const result = findProcessorsWithDiagnostics(caseInput, route, processorFixture({ effectiveTo: null, openEnded: true }, true, "2026-11-05"));
  assert.equal(result.candidates[0]?.acceptance, "confirmed");
});
test("ineligible and unknown routes cannot produce verified processors", () => {
  for (const eligibility of [{ state: "unknown", missingFacts: ["code"] }, { state: "ineligible", evidenceIds: ["synthetic-evidence"], reasons: ["blocked"] }] as const) {
    assert.deepEqual(findProcessorsWithDiagnostics(caseInput, { ...route, eligibility }, processorFixture()).candidates, []);
    assert.equal(findProcessorsWithDiagnostics(caseInput, { ...route, eligibility }, processorFixture()).diagnostics[0]?.reason, "route-not-eligible");
  }
});
test("reversed permit periods are rejected even if permit is inactive", () => {
  assert.throws(() => findProcessorsWithDiagnostics(caseInput, route, processorFixture({ status: "revoked", effectiveFrom: "2026-11-05", effectiveTo: "2026-01-01" })), /reversed-period/);
});

test("inactive and out-of-scope permits still validate timestamps and observation dates", () => {
  for (const change of [{ verifiedAt: "invalid" }, { observedOn: "2026-02-30" }]) {
    const context = processorFixture({ status: "revoked", ...change });
    assert.throws(() => findProcessorsWithDiagnostics(caseInput, { ...route, routeId: "absent" }, context), /invalid-(timestamp|date)/);
  }
});
