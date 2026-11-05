import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Type } from "typebox";
import { Value } from "typebox/value";
import registryJson from "../data/sources/evidence-candidates.json" with { type: "json" };
import type { CaseInput, EvidenceRecord } from "./contracts.ts";
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
  reviewedBy: Type.String({ minLength: 1 }),
  reviewedAt: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$" }),
});

export interface EvidenceCandidate {
  readonly record: EvidenceRecord;
  readonly kind: "waste-code" | "recycling-type" | "annex" | "other";
  readonly claim: string;
  readonly claimVerified: boolean;
  readonly originalVerified: boolean;
  readonly access: "available" | "failed";
  readonly processTerms: readonly string[];
  readonly polymerTerms: readonly string[];
  readonly contaminationTerms: readonly string[];
  readonly siteSpecific: boolean;
}

export type SearchIssueKind =
  | "no-results"
  | "invalid-date"
  | "context-missing"
  | "context-ambiguous"
  | "unrelated"
  | "site-specific"
  | "out-of-period"
  | "stale"
  | "original-unverified"
  | "reuse-unverified"
  | "access-failed"
  | "claim-unverified"
  | "version-not-registered"
  | "source-not-registered"
  | "hash-mismatch"
  | "quote-not-in-snapshot"
  | "snapshot-unavailable"
  | "invalid-candidate"
  | "invalid-option";

export interface SearchIssue {
  readonly kind: SearchIssueKind;
  readonly sourceId: string | null;
}

export interface EvidenceCitation {
  readonly claim: string;
  readonly kind: EvidenceCandidate["kind"];
  readonly sourceId: string;
  readonly locator: string;
}

export interface EvidenceLookup {
  readonly evidence: readonly EvidenceRecord[];
  readonly citations: readonly EvidenceCitation[];
  readonly issues: readonly SearchIssue[];
}

export interface PendingLegalSource {
  readonly state: "needs-review";
  readonly sourceId: string;
  readonly title: string;
  readonly url: string;
  readonly version: string;
  readonly missing: readonly string[];
}

export interface PendingLegalLookup {
  readonly pending: readonly PendingLegalSource[];
  readonly issues: readonly SearchIssue[];
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

const polymerAliases = {
  pp: ["pp", "폴리프로필렌"], pe: ["pe", "폴리에틸렌"],
  pet: ["pet", "폴리에틸렌테레프탈레이트"], ps: ["ps", "폴리스티렌"],
  abs: ["abs", "아크릴로니트릴부타디엔스티렌"], pvc: ["pvc", "폴리염화비닐"],
  eps: ["eps", "발포폴리스티렌"],
} as const;

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko");
}

function polymerKey(value: string): string | null {
  const key = normalized(value).replace(/ /g, "");
  for (const [polymer, aliases] of Object.entries(polymerAliases)) {
    if (aliases.some((alias) => alias === key)) return polymer;
  }
  return null;
}

function contextMatch(value: string | null, terms: readonly string[], context: "process" | "polymer" | "contamination"): "match" | "missing" | "ambiguous" | "unrelated" {
  if (terms.length === 0) return "match";
  if (value === null || value.trim() === "") return "missing";
  const input = normalized(value);
  let ambiguous = false;
  for (const term of terms) {
    const expected = normalized(term);
    if (input === expected || input.replace(/ /g, "") === expected.replace(/ /g, "")) return "match";
    if (context === "polymer") {
      const inputPolymer = polymerKey(input);
      const expectedPolymer = polymerKey(expected);
      if (inputPolymer !== null && expectedPolymer !== null) {
        if (inputPolymer === expectedPolymer) return "match";
        continue;
      }
    }
    if (context === "process") {
      const inputTokens = input.split(" ");
      const expectedTokens = expected.split(" ");
      if (inputTokens.some((_, index) => expectedTokens.every((token, offset) => inputTokens[index + offset] === token))) return "match";
    }
    if (input.includes(expected) || expected.includes(input)) ambiguous = true;
  }
  return ambiguous ? "ambiguous" : "unrelated";
}

function candidateIssue(input: CaseInput, candidate: EvidenceCandidate, maxSnapshotAgeDays: number): SearchIssueKind | null {
  const process = contextMatch(input.process, candidate.processTerms, "process");
  const polymer = contextMatch(input.polymer, candidate.polymerTerms, "polymer");
  const contamination = contextMatch(input.contamination, candidate.contaminationTerms, "contamination");
  if (process === "unrelated" || polymer === "unrelated" || contamination === "unrelated") return "unrelated";
  if (process === "ambiguous" || polymer === "ambiguous" || contamination === "ambiguous") return "context-ambiguous";
  if (process === "missing" || polymer === "missing" || contamination === "missing") return "context-missing";
  if (candidate.siteSpecific) return "site-specific";
  const record = candidate.record;
  if (record.effectiveFrom === null || !validDate(record.effectiveFrom) || input.assessmentDate < record.effectiveFrom) return "out-of-period";
  if (record.effectiveTo !== null && (!validDate(record.effectiveTo) || input.assessmentDate > record.effectiveTo)) return "stale";
  if (!validDate(record.retrievedAt.slice(0, 10))) return "stale";
  const ageDays = (Date.parse(`${input.assessmentDate}T00:00:00Z`) - Date.parse(`${record.retrievedAt.slice(0, 10)}T00:00:00Z`)) / 86_400_000;
  if (ageDays > maxSnapshotAgeDays) return "stale";
  if (!candidate.originalVerified || record.locator.trim() === "" || !/^[a-f0-9]{64}$/i.test(record.sha256)) return "original-unverified";
  if (!record.licenseVerified || record.license === null) return "reuse-unverified";
  if (candidate.access === "failed") return "access-failed";
  if (!candidate.claimVerified || candidate.claim.trim() === "") return "claim-unverified";
  return null;
}

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
    candidates.push({
      record: { sourceId: source.sourceId, title: source.title, publisher: source.publisher, url: source.url,
        locator: entry.locator, retrievedAt: source.retrievedAt, effectiveFrom: source.effectiveFrom,
        effectiveTo: source.effectiveTo, datasetVersion: source.datasetVersion, sha256: entry.sha256,
        license: source.license, licenseVerified: source.licenseVerified },
      kind: entry.kind, claim: entry.claim, claimVerified: true, originalVerified: true, access: "available",
      processTerms: entry.processTerms, polymerTerms: entry.polymerTerms, contaminationTerms: entry.contaminationTerms,
      siteSpecific: entry.siteSpecific,
    });
  }
  return { candidates, issues };
}

const registry = loadEvidenceRegistry(registryJson);

export function lookupLegalEvidence(input: CaseInput, candidates?: readonly EvidenceCandidate[], options?: { readonly maxSnapshotAgeDays?: number }): EvidenceLookup {
  if (!validDate(input.assessmentDate)) return { evidence: [], citations: [], issues: [{ kind: "invalid-date", sourceId: null }] };
  const maxSnapshotAgeDays = options?.maxSnapshotAgeDays ?? 30;
  if (!Number.isInteger(maxSnapshotAgeDays) || maxSnapshotAgeDays < 0) return { evidence: [], citations: [], issues: [{ kind: "invalid-option", sourceId: null }] };
  const selected = candidates ?? registry.candidates;
  const loadIssues = candidates === undefined ? registry.issues : [];
  if (selected.length === 0) return { evidence: [], citations: [], issues: [...loadIssues, { kind: "no-results", sourceId: null }] };
  const evidence = new Map<string, EvidenceRecord>();
  const citations: EvidenceCitation[] = [];
  const issues: SearchIssue[] = [...loadIssues];
  for (const candidate of selected) {
    const issue = candidateIssue(input, candidate, maxSnapshotAgeDays);
    if (issue !== null) {
      issues.push({ kind: issue, sourceId: candidate.record.sourceId });
      continue;
    }
    evidence.set(candidate.record.sourceId, candidate.record);
    citations.push({ claim: candidate.claim, kind: candidate.kind, sourceId: candidate.record.sourceId, locator: candidate.record.locator });
  }
  return { evidence: [...evidence.values()], citations, issues };
}

export function findEvidenceForCase(input: CaseInput, candidates: readonly EvidenceCandidate[] = registry.candidates): readonly EvidenceRecord[] {
  return lookupLegalEvidence(input, candidates).evidence;
}

export function pendingLegalSources(input: CaseInput): PendingLegalLookup {
  if (!validDate(input.assessmentDate)) return { pending: [], issues: [{ kind: "invalid-date", sourceId: null }] };
  const pending: PendingLegalSource[] = sourceManifest
    .filter((source) => source.category === "law" && source.effectiveFrom !== null && source.effectiveFrom <= input.assessmentDate && (source.effectiveTo === null || source.effectiveTo >= input.assessmentDate))
    .map((source) => ({ state: "needs-review", sourceId: source.sourceId, title: source.title, url: source.url,
      version: source.datasetVersion, missing: source.missing }));
  return { pending, issues: pending.length === 0 ? [{ kind: "version-not-registered", sourceId: null }] : [] };
}
