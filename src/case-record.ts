import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { createResourceDomain } from "./domain.ts";
import type { DomainResources } from "./domain.ts";
import { AssessmentInputError } from "./assessment.ts";
import { parseCaseInput } from "./input.ts";
import { revision } from "./o-validation.ts";
import { sourceManifest } from "./sources.ts";
import type { PhotoResolver } from "./session.ts";

export interface SnapshotRequest { readonly sourceId: string; readonly expectedSha256: string }
export type SnapshotReader = (request: SnapshotRequest, signal: AbortSignal) => Promise<Uint8Array | null>;
export interface SourceSnapshot extends SnapshotRequest {
  readonly role: "registered-source" | "review-facts";
  readonly state: "verified" | "unavailable" | "hash-mismatch" | "too-large";
  readonly actualSha256: string | null;
  readonly base64: string | null;
}
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const maxBytes = 8 * 1024 * 1024;
const cancelled = (signal: AbortSignal) => { if (signal.aborted) throw new Error("case-record:cancelled"); };

/** Read only J's registered, redistribution-verified local snapshots. Never fetch URLs. */
export function createBundledSnapshotReader(repositoryRoot: string): SnapshotReader {
  const root = resolve(repositoryRoot);
  return async (request, signal) => {
    cancelled(signal);
    const source = sourceManifest.find((entry) => entry.sourceId === request.sourceId && entry.sha256 === request.expectedSha256);
    if (!source?.localPath || !source.licenseVerified) return null;
    try {
      const base = await realpath(root), file = await realpath(resolve(base, source.localPath));
      const fromRoot = relative(base, file);
      if (isAbsolute(fromRoot) || fromRoot === ".." || fromRoot.startsWith("..\\") || fromRoot.startsWith("../")) return null;
      const info = await stat(file); if (!info.isFile() || info.size > maxBytes) return null;
      const bytes = await readFile(file); cancelled(signal); return bytes;
    } catch { cancelled(signal); return null; }
  };
}

/** Offline reproducibility record. It is neither a new decision contract nor field approval. */
export async function prepareCaseRecord(input: unknown, options: {
  readonly dataOrigin: { readonly kind: "synthetic" | "field"; readonly reference: string };
  readonly codeRevision: string;
  readonly signal: AbortSignal;
  readonly sources: SnapshotReader;
  readonly photos?: PhotoResolver;
  readonly resources?: DomainResources;
}) {
  const parsed = parseCaseInput(input); if (!parsed.ok) throw new AssessmentInputError(parsed.issues);
  if (!/^[a-f0-9]{40}$/.test(options.codeRevision) || !["synthetic", "field"].includes(options.dataOrigin.kind)
    || !options.dataOrigin.reference.trim()) throw new Error("case-record:invalid-provenance");
  // Hash the same JSON representation that the offline artifact persists.
  const resources: DomainResources = JSON.parse(JSON.stringify(options.resources ?? {}));
  const facts = parsed.value, origin = { ...options.dataOrigin };
  const caseRevision = revision(facts), signal = options.signal; cancelled(signal);
  const domain = createResourceDomain(facts, resources), assessment = domain.assess(), decision = await domain.decide();
  const images: { photoRef: string; sha256: string; mimeType: string }[] = [];
  if (facts.photoRefs.length > 5) throw new Error("case-record:image-limit");
  for (const photoRef of facts.photoRefs) {
    cancelled(signal);
    const photo = await options.photos?.({ caseId: facts.caseId, caseRevision, photoRef }, signal);
    if (!photo) throw new Error("case-record:photo-unavailable");
    const { caseId, caseRevision: photoRevision, photoRef: ref, approvedForModel, data, sha256, mimeType } = photo;
    if (caseId !== facts.caseId || photoRevision !== caseRevision || ref !== photoRef || approvedForModel !== true
      || !(data instanceof Uint8Array) || !data.byteLength || data.byteLength > 10 * 1024 * 1024
      || !["image/png", "image/jpeg"].includes(mimeType)) throw new Error("case-record:photo-unavailable");
    const owned = Buffer.from(data);
    if (sha256 !== hash(owned)) throw new Error("case-record:photo-unavailable");
    images.push({ photoRef, sha256, mimeType });
  }
  const requests = new Map<string, SnapshotRequest>();
  const add = (sourceId: string, expectedSha256: string) => requests.set(`${sourceId}:${expectedSha256}`, { sourceId, expectedSha256 });
  for (const record of [...assessment.legal.evidence, ...assessment.reviewEvidence, ...decision.evidence]) add(record.sourceId, record.sha256);
  // Retain both J's quotation snapshot and the original document hash.
  for (const citation of assessment.legal.citations) {
    if (citation.snapshotSha256) add(citation.sourceId, citation.snapshotSha256);
    if (citation.originalSourceId && citation.originalSha256) add(citation.originalSourceId, citation.originalSha256);
  }
  if (requests.size > 32) throw new Error("case-record:source-limit");
  const reviewDocuments = [...(resources.routeReviews?.documents ?? []), ...(resources.processors?.documents ?? []), ...(resources.calculations?.documents ?? [])];
  const sources: SourceSnapshot[] = []; let total = 0;
  for (const request of requests.values()) {
    cancelled(signal);
    // /facts snapshots are server review artifacts, not quotations from J's originals.
    const derived = sourceManifest.some((entry) => entry.sourceId === request.sourceId) ? undefined
      : reviewDocuments.find((doc) => doc.record.sourceId === request.sourceId && doc.record.sha256 === request.expectedSha256 && doc.record.licenseVerified);
    const role = derived ? "review-facts" as const : "registered-source" as const;
    let bytes: Uint8Array | null = null;
    try { bytes = derived ? Buffer.from(derived.snapshot, "utf8") : await options.sources(request, signal); } catch { cancelled(signal); }
    cancelled(signal);
    if (bytes === null) { sources.push({ ...request, role, state: "unavailable", actualSha256: null, base64: null }); continue; }
    if (bytes.byteLength > maxBytes || total + bytes.byteLength > 32 * 1024 * 1024) {
      sources.push({ ...request, role, state: "too-large", actualSha256: null, base64: null }); continue;
    }
    const owned = Buffer.from(bytes); total += owned.length;
    const actualSha256 = hash(owned), verified = actualSha256 === request.expectedSha256;
    sources.push({ ...request, role, state: verified ? "verified" : "hash-mismatch", actualSha256, base64: verified ? owned.toString("base64") : null });
  }
  cancelled(signal);
  const record = { version: 1 as const, execution: "offline-preparation" as const, release: "review-required" as const,
    dataOrigin: origin, codeRevision: options.codeRevision, recordedAt: new Date().toISOString(),
    caseRevision, input: facts, images, assessment, decision, sources,
    // Resources may contain private reviews/permits: this artifact belongs in private storage.
    resources, resourcesSha256: revision(resources),
    sourceIssues: sources.filter((source) => source.state !== "verified").map((source) => `${source.sourceId}:${source.state}`) };
  return { record, sha256: revision(record) };
}
