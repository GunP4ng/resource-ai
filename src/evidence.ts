import registryJson from "../data/sources/evidence-candidates.json" with { type: "json" };
import type { CaseInput, EvidenceRecord } from "./contracts.ts";
import { sourceManifest } from "./sources.ts";
import { loadEvidenceRegistry } from "./evidence-registry.ts";
import { canonicalMaterial, isDeclaredCleanMaterial, materialFamily, materialStream } from "./material-context.ts";
import type { MaterialFamily, MaterialStream } from "./material-context.ts";
import { isUnknownCaseText } from "./o-validation.ts";
export { loadEvidenceRegistry } from "./evidence-registry.ts";

export interface EvidenceProvenance {
  readonly quote: string;
  readonly snapshotPath: string;
  readonly snapshotSha256: string;
  readonly originalSourceId?: string;
  readonly originalPath?: string;
  readonly originalSha256?: string;
  readonly reviewedBy: string;
  readonly reviewedAt: string;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly verifiedThrough: string | null;
}

export interface EvidenceCandidate {
  readonly materialFamily?: MaterialFamily;
  readonly materialStream?: MaterialStream;
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
  readonly versionFamily?: string;
  readonly verifiedThrough?: string;
  readonly requireSafeContext?: boolean;
  readonly intendedUse?: "food-container";
  readonly reviewRequirements?: readonly string[];
  readonly provenance?: EvidenceProvenance;
}

export type SearchIssueKind =
  | "currentness-unverified"
  | "hazardous-contact-unconfirmed"
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

export interface EvidenceCitation extends Partial<EvidenceProvenance> {
  readonly claim: string;
  readonly kind: EvidenceCandidate["kind"];
  readonly sourceId: string;
  readonly locator: string;
}

export interface EvidenceLookup {
  readonly evidence: readonly EvidenceRecord[];
  readonly citations: readonly EvidenceCitation[];
  readonly reviewRequirements: readonly string[];
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

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko");
}

function contextMatch(value: string | null, terms: readonly string[], context: "process" | "polymer" | "contamination"): "match" | "missing" | "ambiguous" | "unrelated" {
  if (terms.length === 0) return "match";
  const input = normalized(value ?? "");
  if (context === "contamination" ? input === "" : isUnknownCaseText(input)) return "missing";
  let ambiguous = false;
  for (const term of terms) {
    const expected = normalized(term);
    if (input === expected || input.replace(/ /g, "") === expected.replace(/ /g, "")) return "match";
    if (context === "polymer") {
      const inputPolymer = canonicalMaterial(input);
      const expectedPolymer = canonicalMaterial(expected);
      if (inputPolymer !== null && expectedPolymer !== null) {
        if (inputPolymer === expectedPolymer) return "match";
        continue;
      }
    }
    if (context === "process") {
      if (input === `${expected} 성형`) return "match";
    }
    if (context === "contamination") {
      // Whole phrases only: do not turn "없음" inside an uncertain or oily
      // description into a clean declaration.
      const clean = /^(?:세척(?:완료|후),?)?(?:오염|잔류물)?없(?:음|습니다|다)$/u;
      if (clean.test(input.replace(/ /g, "")) && clean.test(expected.replace(/ /g, ""))) return "match";
    }
    if (input.includes(expected) || expected.includes(input)) ambiguous = true;
  }
  return ambiguous ? "ambiguous" : "unrelated";
}

function candidateIssue(input: CaseInput, candidate: EvidenceCandidate): SearchIssueKind | null {
  if (candidate.siteSpecific) return "site-specific";
  if (candidate.requireSafeContext && input.hazardousContact !== "no") return "hazardous-contact-unconfirmed";
  const record = candidate.record;
  if (record.effectiveFrom === null || !validDate(record.effectiveFrom) || input.assessmentDate < record.effectiveFrom) return "out-of-period";
  if (record.effectiveTo !== null && (!validDate(record.effectiveTo) || input.assessmentDate > record.effectiveTo)) return "stale";
  if (record.locator.trim() === "" || candidate.claim.trim() === ""
    || (candidate.provenance !== undefined && candidate.provenance.quote.trim() === "")) return "invalid-candidate";
  return null;
}

const registry = loadEvidenceRegistry(registryJson);

export function lookupLegalEvidence(input: CaseInput, candidates?: readonly EvidenceCandidate[], options?: { readonly intendedUse?: "general-resin" | "food-container"; readonly includeWeakContext?: boolean }): EvidenceLookup {
  if (!validDate(input.assessmentDate)) return { evidence: [], citations: [], reviewRequirements: [], issues: [{ kind: "invalid-date", sourceId: null }] };
  const family = materialFamily(input);
  const contaminationContext = family !== null && isDeclaredCleanMaterial(input, family)
    ? "없음" : input.contamination;
  const selected = (candidates ?? registry.candidates).filter(candidate =>
    ((candidates !== undefined && candidate.materialFamily === undefined) || (family === null ? candidate.materialFamily === undefined
      : candidate.materialFamily === family || (candidate.materialFamily === undefined && candidate.versionFamily === "waste-rule-article4-2"))
    )
    && (candidate.materialStream === undefined || candidate.materialStream === materialStream(input))
    && (candidate.intendedUse === undefined || candidate.intendedUse === options?.intendedUse));
  const loadIssues = candidates === undefined ? registry.issues : [];
  if (selected.length === 0) return { evidence: [], citations: [], reviewRequirements: [], issues: [...loadIssues, { kind: "no-results", sourceId: null }] };
  const activeFamilies = new Set(selected.flatMap((candidate) => {
    const { effectiveFrom, effectiveTo } = candidate.record;
    return candidate.versionFamily !== undefined && effectiveFrom !== null && validDate(effectiveFrom)
      && effectiveFrom <= input.assessmentDate && (effectiveTo === null || (validDate(effectiveTo) && effectiveTo >= input.assessmentDate))
      ? [candidate.versionFamily] : [];
  }));
  const applicable = selected.filter((candidate) => candidate.versionFamily === undefined || !activeFamilies.has(candidate.versionFamily)
    || (candidate.record.effectiveFrom !== null && candidate.record.effectiveFrom <= input.assessmentDate
      && (candidate.record.effectiveTo === null || candidate.record.effectiveTo >= input.assessmentDate)));
  const evidence = new Map<string, EvidenceRecord>();
  const citations: EvidenceCitation[] = [];
  const issues: SearchIssue[] = [...loadIssues];
  const reviewRequirements = new Set<string>();
  for (const candidate of applicable) {
    const context = [contextMatch(input.process, candidate.processTerms, "process"),
      contextMatch(input.polymer, candidate.polymerTerms, "polymer"),
      contextMatch(contaminationContext, candidate.contaminationTerms, "contamination")];
    const [process, polymer, contamination] = context;
    const contextIssue = context.includes("unrelated") ? "unrelated"
      : context.includes("ambiguous") ? "context-ambiguous"
      : context.includes("missing") ? "context-missing" : null;
    const validityIssue = candidateIssue(input, candidate);
    // Weak context never bypasses citation applicability or supporting text.
    const issue = options?.includeWeakContext ? validityIssue ?? contextIssue : contextIssue ?? validityIssue;
    if (issue !== null) {
      issues.push({ kind: issue, sourceId: candidate.record.sourceId });
      // A weak generating process is advisory only; negation, material and condition remain gates.
      const advisoryProcess = (issue === "unrelated" && process === "unrelated")
        || (issue === "context-ambiguous" && process === "ambiguous"
          && !/아님|아니|않|\b(?:not|no)\b/iu.test(input.process ?? ""));
      if (!options?.includeWeakContext || !advisoryProcess
        || polymer !== "match" || contamination !== "match") continue;
    }
    const record = candidate.record;
    if (!candidate.originalVerified) issues.push({ kind: "original-unverified", sourceId: record.sourceId });
    if (!/^[a-f0-9]{64}$/i.test(record.sha256)) issues.push({ kind: "hash-mismatch", sourceId: record.sourceId });
    if (!record.licenseVerified || record.license === null) issues.push({ kind: "reuse-unverified", sourceId: record.sourceId });
    if (candidate.access === "failed") issues.push({ kind: "access-failed", sourceId: record.sourceId });
    if (!candidate.claimVerified) issues.push({ kind: "claim-unverified", sourceId: record.sourceId });
    evidence.set(candidate.record.sourceId, candidate.record);
    for (const requirement of candidate.reviewRequirements ?? []) reviewRequirements.add(requirement);
    citations.push({ ...candidate.provenance, claim: candidate.claim, kind: candidate.kind, sourceId: candidate.record.sourceId, locator: candidate.record.locator });
  }
  return { evidence: [...evidence.values()], citations, issues, reviewRequirements: [...reviewRequirements] };
}

export function findEvidenceForCase(input: CaseInput, candidates: readonly EvidenceCandidate[] = registry.candidates): readonly EvidenceRecord[] {
  return lookupLegalEvidence(input, candidates).evidence;
}

export function pendingLegalSources(input: CaseInput): PendingLegalLookup {
  if (!validDate(input.assessmentDate)) return { pending: [], issues: [{ kind: "invalid-date", sourceId: null }] };
  const versions = sourceManifest.filter((source) => source.legalFamily === "waste-rule" && source.effectiveFrom !== null && source.effectiveFrom <= input.assessmentDate && (source.effectiveTo === null || source.effectiveTo >= input.assessmentDate));
  const pending: PendingLegalSource[] = versions
    .filter((source) => source.localPath === null)
    .map((source) => ({ state: "needs-review", sourceId: source.sourceId, title: source.title, url: source.url,
      version: source.datasetVersion, missing: source.missing }));
  return { pending, issues: versions.length === 0 ? [{ kind: "version-not-registered", sourceId: null }] : [] };
}
