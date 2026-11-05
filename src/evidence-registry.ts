import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { EvidenceCandidate, SearchIssue } from "./evidence.ts";
import { sourceManifest } from "./sources.ts";

const RegistryEntrySchema = Type.Object({
  sourceId: Type.String(),
  kind: Type.Union([Type.Literal("waste-code"), Type.Literal("recycling-type"), Type.Literal("annex"), Type.Literal("other")]),
  claim: Type.String({ minLength: 1 }),
  quote: Type.String({ minLength: 1 }),
  locator: Type.String({ minLength: 1 }),
  sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  processTerms: Type.Array(Type.String()),
  polymerTerms: Type.Array(Type.String()),
  contaminationTerms: Type.Array(Type.String()),
  siteSpecific: Type.Boolean(),
  originalSourceId: Type.Optional(Type.String()),
  verifiedThrough: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
  requireSafeContext: Type.Optional(Type.Boolean()),
  intendedUse: Type.Optional(Type.Literal("food-container")),
  reviewRequirements: Type.Optional(Type.Array(Type.String())),
  reviewedBy: Type.String({ minLength: 1 }),
  reviewedAt: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$" }),
});

export function loadEvidenceRegistry(entries: readonly unknown[]): { readonly candidates: readonly EvidenceCandidate[]; readonly issues: readonly SearchIssue[] } {
  const candidates: EvidenceCandidate[] = [];
  const issues: SearchIssue[] = [];
  for (const raw of entries) {
    if (!Value.Check(RegistryEntrySchema, raw)) { issues.push({ kind: "invalid-candidate", sourceId: null }); continue; }
    const entry = raw;
    const source = sourceManifest.find((item) => item.sourceId === entry.sourceId);
    if (source === undefined) { issues.push({ kind: "source-not-registered", sourceId: entry.sourceId }); continue; }
    if (source.sha256 === null || entry.sha256 !== source.sha256) { issues.push({ kind: "hash-mismatch", sourceId: entry.sourceId }); continue; }
    if (source.localPath === null) { issues.push({ kind: "snapshot-unavailable", sourceId: entry.sourceId }); continue; }
    let bytes: Uint8Array;
    try { bytes = readFileSync(new URL(`../${source.localPath}`, import.meta.url)); }
    catch (error) {
      if (!(error instanceof Error)) throw error;
      issues.push({ kind: "snapshot-unavailable", sourceId: entry.sourceId }); continue;
    }
    if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) { issues.push({ kind: "hash-mismatch", sourceId: entry.sourceId }); continue; }
    let snapshot: string;
    try { snapshot = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch (error) {
      if (!(error instanceof TypeError)) throw error;
      issues.push({ kind: "snapshot-unavailable", sourceId: entry.sourceId }); continue;
    }
    if (!snapshot.includes(entry.quote)) { issues.push({ kind: "quote-not-in-snapshot", sourceId: entry.sourceId }); continue; }
    if (source.license === null) { issues.push({ kind: "reuse-unverified", sourceId: entry.sourceId }); continue; }
    const original = entry.originalSourceId === undefined ? source : sourceManifest.find((item) => item.sourceId === entry.originalSourceId);
    if (original === undefined || original.sha256 === null || original.localPath === null) { issues.push({ kind: "snapshot-unavailable", sourceId: entry.sourceId }); continue; }
    if (!original.licenseVerified) { issues.push({ kind: "reuse-unverified", sourceId: entry.sourceId }); continue; }
    if (entry.originalSourceId !== undefined && source.derivedFrom !== original.sha256) { issues.push({ kind: "hash-mismatch", sourceId: entry.sourceId }); continue; }
    try {
      if (createHash("sha256").update(readFileSync(new URL(`../${original.localPath}`, import.meta.url))).digest("hex") !== original.sha256) {
        issues.push({ kind: "hash-mismatch", sourceId: entry.sourceId }); continue;
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      issues.push({ kind: "snapshot-unavailable", sourceId: entry.sourceId }); continue;
    }
    candidates.push({
      record: { sourceId: source.sourceId, title: source.title, publisher: source.publisher, url: source.url,
        locator: entry.locator, retrievedAt: source.retrievedAt, effectiveFrom: source.effectiveFrom,
        effectiveTo: source.effectiveTo, datasetVersion: source.datasetVersion, sha256: entry.sha256,
        license: source.license, licenseVerified: source.licenseVerified },
      kind: entry.kind, claim: entry.claim, claimVerified: true, originalVerified: true, access: "available",
      processTerms: entry.processTerms, polymerTerms: entry.polymerTerms, contaminationTerms: entry.contaminationTerms,
      siteSpecific: entry.siteSpecific,
      verifiedThrough: entry.verifiedThrough, requireSafeContext: entry.requireSafeContext,
      intendedUse: entry.intendedUse, reviewRequirements: entry.reviewRequirements,
      provenance: { quote: entry.quote, snapshotPath: source.localPath, snapshotSha256: entry.sha256,
        originalSourceId: original.sourceId, originalPath: original.localPath, originalSha256: original.sha256,
        reviewedBy: entry.reviewedBy, reviewedAt: entry.reviewedAt,
        effectiveFrom: source.effectiveFrom, effectiveTo: source.effectiveTo, verifiedThrough: entry.verifiedThrough ?? null },
    });
  }
  return { candidates, issues };
}
