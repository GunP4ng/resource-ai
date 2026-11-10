import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import type { Stats } from "node:fs";
import { isAbsolute, join, parse, resolve } from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { prepareCaseRecord } from "./case-record.ts";
import type { createCaseStore } from "./o-case-store.ts";
import type { ResourceProvider } from "./session.ts";
import type { DomainResources } from "./domain.ts";
import { createResourceDomain } from "./domain.ts";
import { parseCaseInput } from "./input.ts";
import { parseDecision } from "./o-decision.ts";
import { createComparisonCalculator } from "./cost.ts";
import { validateCalculation } from "./o-calculation.ts";
import { findProcessorsWithDiagnostics } from "./processors.ts";
import { canonical, revision, validateDocuments, requireValid } from "./o-validation.ts";
import { sourceManifest } from "./sources.ts";

type Artifact = Awaited<ReturnType<typeof prepareCaseRecord>>;
type Store = Pick<ReturnType<typeof createCaseStore>, "currentActor" | "stageResources">;
/** Sanitized public error: no path, source contents, underlying cause or OS error. */
export class ResourceUnavailableError extends Error {
  readonly code = "resource-unavailable";
  constructor(readonly reason: "configuration" | "filesystem" | "artifact" | "cancelled") {
    super("resource-unavailable"); this.name = "ResourceUnavailableError";
  }
}
const limit = 64 * 1024 * 1024;
const digest = Type.String({ pattern: "^[a-f0-9]{64}$" });
const text = Type.String({ minLength: 1, pattern: "\\S" });
const strict = { additionalProperties: false } as const;
const artifactSchema = Type.Object({ record: Type.Object({
  version: Type.Literal(1), execution: Type.Literal("offline-preparation"), release: Type.Literal("review-required"),
  dataOrigin: Type.Object({ kind: Type.Union([Type.Literal("synthetic"), Type.Literal("field")]), reference: text }, strict),
  codeRevision: Type.String({ pattern: "^[a-f0-9]{40}$" }), recordedAt: text, caseRevision: digest,
  input: Type.Unknown(), assessment: Type.Unknown(), decision: Type.Unknown(), resources: Type.Unknown(), resourcesSha256: digest,
  images: Type.Array(Type.Object({ photoRef: text, sha256: digest, mimeType: Type.Union([Type.Literal("image/png"), Type.Literal("image/jpeg")]) }, strict), { maxItems: 5 }),
  sources: Type.Array(Type.Object({ sourceId: text, expectedSha256: digest,
    role: Type.Union([Type.Literal("registered-source"), Type.Literal("review-facts")]),
    state: Type.Union([Type.Literal("verified"), Type.Literal("unavailable"), Type.Literal("hash-mismatch"), Type.Literal("too-large")]),
    actualSha256: Type.Union([digest, Type.Null()]), base64: Type.Union([Type.String(), Type.Null()]) }, strict), { maxItems: 32 }),
  sourceIssues: Type.Array(text, { maxItems: 32 }),
}, strict), sha256: digest }, strict);
const resourcesSchema = Type.Object({ assessmentOptions: Type.Optional(Type.Object({
  intendedUse: Type.Optional(Type.Union([Type.Literal("general-resin"), Type.Literal("food-container")])) }, strict)),
  routeReviews: Type.Optional(Type.Object({ documents: Type.Array(Type.Unknown()), reviews: Type.Array(Type.Unknown()) }, strict)),
  processors: Type.Optional(Type.Object({ version: text, documents: Type.Array(Type.Unknown()), directory: Type.Array(Type.Unknown()),
    scopes: Type.Array(Type.Unknown()), permits: Type.Array(Type.Unknown()), acceptance: Type.Array(Type.Unknown()) }, strict)),
  calculations: Type.Optional(Type.Object({ version: text, documents: Type.Array(Type.Unknown()), vatBasis: Type.Union([Type.Literal("included"), Type.Literal("excluded")]),
    caseMass: Type.Optional(Type.Unknown()), routes: Type.Array(Type.Unknown()), quotes: Type.Array(Type.Unknown()),
    factors: Type.Array(Type.Unknown()), activities: Type.Array(Type.Unknown()) }, strict)),
  comparison: Type.Optional(Type.Unknown()), comparisonEvidenceIds: Type.Optional(Type.Array(text)),
}, strict);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const cancelled = (signal: AbortSignal) => { if (signal.aborted) throw new ResourceUnavailableError("cancelled"); };
const same = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino;
const unchanged = (a: Stats, b: Stats) => same(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
function privateEntry(info: Stats, directory: boolean) {
  requireValid(!info.isSymbolicLink() && (directory ? info.isDirectory() : info.isFile() && info.nlink === 1)
    && typeof process.getuid === "function" && info.uid === process.getuid() && (info.mode & 0o077) === 0, "private-entry-required");
}
async function directory(path: string) {
  const info = await lstat(path); privateEntry(info, true);
  requireValid(await realpath(path) === path, "directory-escape"); return info;
}

export async function validateResourceArtifact(value: unknown, input: Parameters<ResourceProvider>[0]): Promise<{ artifact: Artifact; resources: DomainResources }> {
  requireValid(Value.Check(artifactSchema, value), "invalid-artifact");
  const artifact = value as Artifact, r = artifact.record;
  const parsed = parseCaseInput(r.input);
  requireValid(parsed.ok && canonical(r.input) === canonical(parsed.value) && canonical(r.input) === canonical(input)
    && r.caseRevision === revision(input) && artifact.sha256 === revision(r) && r.resourcesSha256 === revision(r.resources), "artifact-binding");
  requireValid(Number.isFinite(Date.parse(r.recordedAt)) && new Date(r.recordedAt).toISOString() === r.recordedAt, "recorded-at");
  requireValid(r.images.length === input.photoRefs.length && new Set(r.images.map(i => i.photoRef)).size === r.images.length
    && r.images.every((image, i) => image.photoRef === input.photoRefs[i]), "image-binding");
  requireValid(Value.Check(resourcesSchema, r.resources), "invalid-resources");
  const resources: DomainResources = r.resources;
  const documents = [resources.routeReviews, resources.processors, resources.calculations].flatMap(context => {
    if (!context) return []; validateDocuments(context); return context.documents;
  });
  const domain = createResourceDomain(input, resources), assessment = domain.assess();
  // assess() deliberately converts malformed route reviews to holds; reject malformed configuration here.
  requireValid(!assessment.reviewIssues.some(issue => ["invalid-route-reviews", "invalid-documents", "duplicate-route-review"].includes(issue)), "invalid-route-context");
  for (const route of assessment.routes) if (resources.processors) findProcessorsWithDiagnostics(input, route, resources.processors);
  if (resources.calculations) {
    const comparison = resources.comparison ?? { caseId: input.caseId, assessmentDate: input.assessmentDate,
      functionalUnit: "validation-only", boundary: "validation-only", baselineRouteId: null, factorRegistryVersion: "validation-only", routes: [], factors: [], evidence: [] };
    validateCalculation(comparison, resources.calculations);
    if (resources.comparison) {
      requireValid(comparison.caseId === input.caseId && comparison.assessmentDate === input.assessmentDate, "comparison-case-binding");
      await createComparisonCalculator(resources.calculations)(comparison, assessment.routes);
    }
  } else requireValid(resources.comparison === undefined && resources.comparisonEvidenceIds === undefined, "comparison-context-missing");
  const decision = await domain.decide();
  // Validate cached envelopes against fresh public domain execution; they never authorize execution.
  requireValid(canonical(parseDecision(r.decision)) === canonical(decision) && canonical(r.assessment) === canonical(assessment), "cached-envelope-invalid");
  const requests = new Map<string, { sourceId: string; expectedSha256: string }>();
  const add = (sourceId: string, expectedSha256: string) => requests.set(`${sourceId}:${expectedSha256}`, { sourceId, expectedSha256 });
  for (const e of [...assessment.legal.evidence, ...assessment.reviewEvidence, ...decision.evidence]) add(e.sourceId, e.sha256);
  for (const c of assessment.legal.citations) {
    if (c.snapshotSha256) add(c.sourceId, c.snapshotSha256);
    if (c.originalSourceId && c.originalSha256) add(c.originalSourceId, c.originalSha256);
  }
  requireValid(r.sources.length === requests.size, "source-set-mismatch");
  const seen = new Set<string>(); let total = 0;
  for (const s of r.sources) {
    const key = `${s.sourceId}:${s.expectedSha256}`;
    requireValid(requests.has(key) && !seen.has(key), "source-binding"); seen.add(key);
    const registered = sourceManifest.filter(entry => entry.sourceId === s.sourceId);
    const docs = documents.filter(doc => doc.record.sourceId === s.sourceId && doc.record.sha256 === s.expectedSha256);
    const derived = registered.length === 0 && docs.find(doc => doc.record.licenseVerified);
    requireValid(s.role === (derived ? "review-facts" : "registered-source"), "source-role");
    if (registered.length) requireValid(registered.some(entry => entry.sha256 === s.expectedSha256), "registered-hash");
    else requireValid(docs.length > 0, "unexpressed-source-lineage");
    if (s.state === "verified") {
      requireValid(s.base64 !== null && s.base64.length <= Math.ceil(8388608 / 3) * 4 && s.actualSha256 === s.expectedSha256, "source-size-or-hash");
      const bytes = Buffer.from(s.base64, "base64"); total += bytes.length;
      requireValid(bytes.toString("base64") === s.base64 && bytes.length <= 8388608 && total <= 33554432 && sha(bytes) === s.expectedSha256, "source-bytes");
      if (derived) requireValid(docs.every(doc => doc.record.locator === "/facts" && Buffer.from(doc.snapshot).equals(bytes)), "derived-identity");
      else requireValid(registered.some(entry => entry.licenseVerified && !!entry.license && entry.sha256 === s.expectedSha256), "source-rights");
    } else {
      requireValid(s.base64 === null && (s.state === "hash-mismatch" ? s.actualSha256 !== null && s.actualSha256 !== s.expectedSha256 : s.actualSha256 === null), "source-state");
    }
  }
  requireValid(canonical(r.sourceIssues) === canonical(r.sources.filter(s => s.state !== "verified").map(s => `${s.sourceId}:${s.state}`)), "source-issues");
  // An unrepresented document cannot silently supply facts, even when the cached decision held.
  const supported = documents.every(doc => r.sources.some(s => s.sourceId === doc.record.sourceId && s.expectedSha256 === doc.record.sha256
    && s.state === "verified") && doc.record.licenseVerified && !!doc.record.license?.trim());
  return { artifact, resources: supported && r.sourceIssues.length === 0 ? structuredClone(resources) : {} };
}

/** Async factory validates/pins an operator-configured private root. Never creates directories.
 * Root/nested directories and files must belong to this UID with no group/other permissions.
 * Integrity is not human approval: origin, offline-preparation and review-required remain intact.
 * Pre/post identity checks rely on private directories; same-UID hostile writers are outside this boundary.
 */
export async function createFileResourceProvider({ root, caseStore }: { readonly root: string; readonly caseStore: Store }): Promise<ResourceProvider> {
  let base: string, rootInfo: Stats;
  try {
    requireValid(isAbsolute(root), "absolute-root-required"); base = resolve(root);
    // Check each ancestor, including ancestors hidden by lexical normalization.
    let current = parse(root).root;
    for (const part of root.slice(current.length).split("/").filter(Boolean)) {
      requireValid(part !== "." && part !== "..", "noncanonical-root"); current = join(current, part);
      const info = await lstat(current); requireValid(info.isDirectory() && !info.isSymbolicLink(), "linked-root");
    }
    rootInfo = await directory(base);
  } catch { throw new ResourceUnavailableError("configuration"); }
  return async (raw, signal) => {
    cancelled(signal); let phase: "filesystem" | "artifact" = "filesystem";
    let file: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const parsed = parseCaseInput(raw); requireValid(parsed.ok, "invalid-input"); const input = parsed.value;
      const actor = caseStore.currentActor();
      requireValid(/^[A-Za-z0-9_-]{1,256}$/.test(actor) && /^[A-Za-z0-9_-]{1,100}$/.test(input.caseId), "invalid-path-component");
      const pinned: { path: string; info: Stats }[] = [{ path: base, info: rootInfo }];
      const recheck = async () => { for (const entry of pinned) { cancelled(signal); requireValid(same(entry.info, await directory(entry.path)), "replaced-directory"); } };
      await recheck(); cancelled(signal);
      const missing = async () => { await recheck(); cancelled(signal); caseStore.stageResources(null); return {}; };
      let path = base;
      for (const part of [actor, input.caseId]) {
        path = join(path, part);
        try { pinned.push({ path, info: await directory(path) }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return await missing(); throw error; }
        cancelled(signal);
      }
      path = join(path, `${revision(input)}.json`);
      let before: Stats;
      try { before = await lstat(path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return await missing(); throw error; }
      privateEntry(before, false); requireValid(before.size <= limit, "file-too-large"); cancelled(signal);
      file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); cancelled(signal);
      const opened = await file.stat(); privateEntry(opened, false); requireValid(unchanged(before, opened), "replaced-file");
      const bytes = Buffer.alloc(before.size + 1); let offset = 0;
      while (offset < bytes.length) {
        cancelled(signal); const read = await file.read(bytes, offset, Math.min(65536, bytes.length - offset), offset);
        cancelled(signal); if (!read.bytesRead) break; offset += read.bytesRead;
      }
      requireValid(offset === before.size, "changed-size");
      phase = "artifact";
      const accepted = await validateResourceArtifact(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, offset))), input);
      cancelled(signal); phase = "filesystem";
      await recheck();
      const after = await file.stat(), named = await lstat(path); privateEntry(named, false); privateEntry(after, false);
      requireValid(unchanged(before, after) && unchanged(before, named), "replaced-file");
      await file.close(); file = undefined;
      cancelled(signal); caseStore.stageResources(accepted.artifact); return structuredClone(accepted.resources);
    } catch (error) {
      cancelled(signal); if (error instanceof ResourceUnavailableError) throw error;
      throw new ResourceUnavailableError(phase);
    } finally { if (file) await file.close().catch(() => undefined); }
  };
}
