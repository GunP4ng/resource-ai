import { createHash } from "node:crypto";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { CaseInput } from "./contracts.ts";
import type { AssessmentEnvelope } from "./app.ts";
import type { PhotoReceipt } from "./photos.ts";
import type { RuntimeDatabase } from "./o-runtime-db.ts";
import type { CaseRow, LeaseRow, CaseSnapshot, CaseReport, StoredReview, StoredReviewTarget } from "./o-case-store-types.ts";
import { maxSnapshot, maxArtifact, maxArtifacts, CASE_LEASE_MS } from "./o-case-store-types.ts";
import { parseCaseInput } from "./input.ts";
import { parseDecision } from "./o-decision.ts";
import { canonical, date, revision, requireValid } from "./o-validation.ts";
import { ResearchCaseArtifactSchema } from "./o-case-artifact.ts";
import { ModelHostAuditSchema } from "./o-model-audit-schema.ts";
import { parseModelHostAudit } from "./o-model-audit.ts";

export const instant = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
export const positive = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const digest = Type.String({ pattern: "^[a-f0-9]{64}$" });
export const idSchema = Type.String({ pattern: "^[A-Za-z0-9_-]{1,100}$" });
export const ownerSchema = Type.String({ minLength: 1, maxLength: 256, pattern: "\\S" });
export const photoRef = Type.String({ pattern: "^[a-f0-9-]{36}$" });
const originSchema = Type.Object({ kind: Type.Union([Type.Literal("synthetic"), Type.Literal("field")]), reference: Type.String({ minLength: 1, maxLength: 10000, pattern: "\\S" }) }, { additionalProperties: false });
const executionSchema = Type.Object({ traceId: Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" }),
  usage: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 2000, pattern: "\\S" }), Type.Null()])) }, { additionalProperties: false });
const envelopeSchema = Type.Object({ decision: Type.Unknown(), execution: Type.Optional(executionSchema),
  modelAudit: Type.Optional(ModelHostAuditSchema) }, { additionalProperties: false });
/** Shared HTTP/storage envelope parser; app's temporary copy may now import this export. */
export function parseAssessment(output: unknown): AssessmentEnvelope {
  if (typeof output !== "object" || output === null || !Object.hasOwn(output, "decision")) return { decision: parseDecision(output) };
  requireValid(Value.Check(envelopeSchema, output), "invalid-assessment-envelope");
  const decision = parseDecision(output.decision);
  return { decision, ...(output.execution === undefined ? {} : { execution: { traceId: output.execution.traceId, usage: output.execution.usage ?? null } }),
    ...(output.modelAudit === undefined ? {} : { modelAudit: parseModelHostAudit(output.modelAudit, decision) }) };
}
export const presentationSchema = Type.Object({ mode: Type.Union([Type.Literal("synthetic"), Type.Literal("offline"), Type.Literal("live"), Type.Literal("recording")]),
  scenarioLabels: Type.Optional(Type.Array(Type.String({ maxLength: 2000 }), { maxItems: 100 })), execution: Type.Optional(Type.Object({ traceId: executionSchema.properties.traceId,
    usage: Type.Union([Type.String({ minLength: 1, maxLength: 2000, pattern: "\\S" }), Type.Null()]) }, { additionalProperties: false })),
  calculationVersion: Type.Optional(Type.String({ maxLength: 2000 })), sourceVersion: Type.Optional(Type.String({ maxLength: 2000 })),
  runtime: Type.Optional(Type.Object({ identity: Type.Union([Type.Literal("anonymous"), Type.Literal("trusted"), Type.Literal("local-operator")]),
    storage: Type.Union([Type.Literal("ephemeral"), Type.Literal("sqlite")]), runner: Type.Union([Type.Literal("local"), Type.Literal("subscription"), Type.Literal("azure"), Type.Literal("unspecified")]) }, { additionalProperties: false })),
  review: Type.Optional(Type.Union([Type.Object({ hash: digest, origin: originSchema, caseRevision: digest }, { additionalProperties: false }), Type.Null()])),
  historical: Type.Optional(Type.Boolean()) }, { additionalProperties: false });
const consentSchema = Type.Object({ recordId: Type.String({ pattern: "^[A-Za-z0-9_-]{1,128}$" }), store: Type.Literal(true), model: Type.Boolean(),
  modelBindingId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  modelScope: Type.Optional(Type.Object({ provider: Type.String({ minLength: 1, maxLength: 200 }), purpose: Type.String({ minLength: 1, maxLength: 500 }) }, { additionalProperties: false })),
  visibleContentReviewed: Type.Boolean(), expiresAt: instant }, { additionalProperties: false });
const receiptSchema = Type.Object({ version: Type.Literal(1), photoRef, caseId: idSchema, uploadRevision: digest, originalSha256: digest, sha256: digest,
  width: Type.Integer({ minimum: 1, maximum: 8192 }), height: Type.Integer({ minimum: 1, maximum: 8192 }), createdAt: instant, expiresAt: instant,
  consent: consentSchema }, { additionalProperties: false });
const reviewSchema = Type.Object({ hash: digest, origin: originSchema, caseRevision: digest }, { additionalProperties: false });
const snapshotSchema = Type.Object({ owner: ownerSchema, input: Type.Unknown(), assessment: Type.Unknown(), version: positive, expires: instant, editUntil: instant,
  photos: Type.Array(receiptSchema, { maxItems: 100 }), denied: Type.Array(photoRef, { maxItems: 10000 }), pendingCleanup: Type.Array(photoRef, { maxItems: 10000 }),
  permissionChanged: Type.Boolean(), evaluated: Type.Object({ revision: digest, version: positive, committedAt: instant }, { additionalProperties: false }),
  review: Type.Union([reviewSchema, Type.Null()]), presentation: Type.Optional(presentationSchema) }, { additionalProperties: false });
export const noGuard = () => undefined;
export const checkGuard = (guard: () => void) => { const result: unknown = guard(); requireValid(!(result instanceof Promise), "guard-must-be-synchronous"); };
export const bytes = (value: unknown, limit: number) => { const json = JSON.stringify(value); requireValid(Buffer.byteLength(json) <= limit, "storage-byte-limit"); return json; };
export function parseInput(value: unknown): CaseInput {
  const parsed = parseCaseInput(value); requireValid(parsed.ok, "invalid-stored-input");
  requireValid(Value.Check(idSchema, parsed.value.caseId) && parsed.value.photoRefs.length <= 5
    && parsed.value.photoRefs.every(ref => Value.Check(photoRef, ref)) && new Set(parsed.value.photoRefs).size === parsed.value.photoRefs.length, "invalid-stored-input");
  return parsed.value;
}
export function validateReceipt(value: unknown, caseId: string): PhotoReceipt {
  requireValid(Value.Check(receiptSchema, value), "invalid-photo-receipt");
  requireValid(value.caseId === caseId && value.createdAt < value.expiresAt && value.expiresAt <= value.consent.expiresAt
    && value.width * value.height <= 12000000, "invalid-photo-receipt");
  return value;
}
const artifactSchema = Type.Object({ record: Type.Object({ version: Type.Literal(1), execution: Type.Literal("offline-preparation"), release: Type.Literal("review-required"),
  dataOrigin: originSchema, codeRevision: Type.String({ pattern: "^[a-f0-9]{40}$" }), recordedAt: Type.String(), caseRevision: digest,
  input: Type.Unknown(), images: Type.Array(Type.Object({ photoRef, sha256: digest, mimeType: Type.Union([Type.Literal("image/png"), Type.Literal("image/jpeg")]) }), { maxItems: 5 }),
  assessment: Type.Unknown(), decision: Type.Unknown(), resources: Type.Unknown(), resourcesSha256: digest, sourceIssues: Type.Array(Type.String(), { maxItems: 32 }),
  sources: Type.Array(Type.Object({ sourceId: Type.String({ minLength: 1 }), expectedSha256: digest,
    role: Type.Union([Type.Literal("registered-source"), Type.Literal("review-facts")]),
    state: Type.Union([Type.Literal("verified"), Type.Literal("unavailable"), Type.Literal("hash-mismatch"), Type.Literal("too-large")]),
    actualSha256: Type.Union([digest, Type.Null()]), base64: Type.Union([Type.String(), Type.Null()]) }, { additionalProperties: false }), { maxItems: 32 }) }, { additionalProperties: false }), sha256: digest }, { additionalProperties: false });
export function validateStoredArtifact(value: unknown): StoredReview {
  bytes(value, maxArtifact);
  requireValid(Value.Check(artifactSchema, value) || Value.Check(ResearchCaseArtifactSchema, value), "invalid-review-record");
  const record = value.record, input = parseInput(record.input);
  let research: StoredReview["research"] = null;
  if (record.version === 2) {
    const binding = record.research.binding;
    date(binding.assessmentDate);
    requireValid(binding.caseId === input.caseId && binding.inputRevision === record.caseRevision
      && binding.assessmentDate === input.assessmentDate, "invalid-research-binding");
    research = { artifactSha256: value.sha256, attachment: record.research };
  }
  requireValid(revision(record) === value.sha256 && revision(input) === record.caseRevision && revision(record.resources) === record.resourcesSha256
    && Number.isFinite(Date.parse(record.recordedAt)) && new Date(record.recordedAt).toISOString() === record.recordedAt
    && parseDecision(record.decision).caseId === input.caseId, "invalid-review-hash-or-binding");
  let total = 0;
  for (const source of record.sources) {
    if (source.state === "verified") {
      requireValid(source.base64 !== null && source.base64.length <= Math.ceil(8388608 / 3) * 4 && source.actualSha256 === source.expectedSha256, "invalid-source-snapshot");
      const decoded = Buffer.from(source.base64, "base64"); total += decoded.length;
      requireValid(decoded.toString("base64") === source.base64 && decoded.length <= 8388608 && total <= 33554432
        && createHash("sha256").update(decoded).digest("hex") === source.expectedSha256, "invalid-source-hash");
    } else requireValid(source.base64 === null, "invalid-source-snapshot");
  }
  return { provenance: { hash: value.sha256, origin: record.dataOrigin, caseRevision: record.caseRevision }, input, research };
}

export function assertStoredReviewTarget(review: StoredReview, target: StoredReviewTarget): void {
  requireValid(review.input.caseId === target.caseId && review.provenance.caseRevision === target.inputRevision, "review-input-mismatch");
  if (review.research) requireValid(target.owner === "actor:" + review.research.attachment.binding.actorId, "review-owner-mismatch");
}
export function validateClock(value: number): number {
  requireValid(Value.Check(instant, value) && value <= Number.MAX_SAFE_INTEGER - 3600000, "invalid-clock");
  return value;
}
export function createCaseRecordValidation(db: RuntimeDatabase["database"]) {
  const artifactFor = (hash: string) => {
    const stored = db.query<{ artifact: string; bytes: number }, [string]>("SELECT artifact,bytes FROM review_records WHERE hash=?").get(hash);
    requireValid(!!stored && Buffer.byteLength(stored.artifact) === stored.bytes && stored.bytes <= maxArtifact, "missing-or-invalid-review-record");
    const review = validateStoredArtifact(JSON.parse(stored.artifact));
    requireValid(review.provenance.hash === hash, "review-hash-mismatch");
    return review;
  };
  const restoreReport = (record: CaseRow): CaseReport => {
    requireValid(Buffer.byteLength(record.snapshot) <= maxSnapshot, "storage-byte-limit");
    const value: unknown = JSON.parse(record.snapshot); requireValid(Value.Check(snapshotSchema, value), "invalid-case-snapshot");
    const input = parseInput(value.input), assessment = parseAssessment(value.assessment);
    requireValid(assessment.modelAudit === undefined || assessment.modelAudit.inputRevision === value.evaluated.revision, "model-audit-input-mismatch");
    requireValid(input.caseId === record.case_id && assessment.decision.caseId === record.case_id && value.owner === record.owner
      && value.version === record.version && value.expires === record.expires && value.editUntil === record.edit_until
      && Value.Check(positive, record.row_revision) && Value.Check(instant, record.notice_generation)
      && value.evaluated.version <= value.version && value.evaluated.committedAt + 3600000 === value.expires
      && value.evaluated.committedAt + 1800000 === value.editUntil
      && (value.evaluated.version !== value.version || value.evaluated.revision === revision(input))
      && (value.review?.hash ?? null) === record.review_hash
      && (!value.review || value.review.caseRevision === value.evaluated.revision), "invalid-case-metadata");
    for (const receipt of value.photos) validateReceipt(receipt, record.case_id);
    for (const refs of [value.photos.map(p => p.photoRef), value.denied, value.pendingCleanup]) requireValid(new Set(refs).size === refs.length, "duplicate-photo-metadata");
    requireValid(input.photoRefs.every(ref => value.photos.some(p => p.photoRef === ref)), "invalid-photo-selection");
    const review = value.review ? artifactFor(value.review.hash) : null;
    if (review) {
      requireValid(canonical(review.provenance) === canonical(value.review), "review-provenance-mismatch");
      assertStoredReviewTarget(review, { owner: record.owner, caseId: record.case_id, inputRevision: value.evaluated.revision });
    }
    return { snapshot: { ...value, input, assessment }, research: review?.research ?? null };
  };
  const restore = (record: CaseRow): CaseSnapshot => restoreReport(record).snapshot;
  const validateRetained = () => {
    const bounds = db.query<{ cases: number; reservations: number; artifacts: number; cleanup: number }, []>(
      "SELECT (SELECT count(*) FROM cases) AS cases,(SELECT count(*) FROM leases WHERE expected_version IS NULL) AS reservations,(SELECT coalesce(sum(bytes),0) FROM review_records) AS artifacts,(SELECT count(*) FROM photo_cleanup) AS cleanup").get();
    requireValid(!!bounds && bounds.cases + bounds.reservations <= 100 && bounds.artifacts <= maxArtifacts && bounds.cleanup <= 100000, "invalid-storage-capacity");
    for (const record of db.query<CaseRow, []>("SELECT * FROM cases").all()) restore(record);
    for (const record of db.query<{ hash: string }, []>("SELECT hash FROM review_records").all()) artifactFor(record.hash);
    for (const item of db.query<{ owner: string; case_id: string; photo_ref: string; queued_at: number }, []>("SELECT * FROM photo_cleanup").all())
      requireValid(Value.Check(ownerSchema, item.owner) && Value.Check(idSchema, item.case_id) && Value.Check(photoRef, item.photo_ref) && Value.Check(instant, item.queued_at), "invalid-cleanup-row");
    for (const item of db.query<LeaseRow, []>("SELECT * FROM leases").all()) {
      requireValid(Value.Check(ownerSchema, item.owner) && Value.Check(idSchema, item.case_id) && /^[a-f0-9-]{36}$/.test(item.token)
        && Value.Check(instant, item.notice_generation) && Value.Check(instant, item.created_at) && Value.Check(instant, item.expires)
        && item.expires > item.created_at && item.expires <= item.created_at + CASE_LEASE_MS
        && (item.expected_version === null || Value.Check(positive, item.expected_version)), "invalid-lease-row");
      const current = db.query<CaseRow, [string]>("SELECT * FROM cases WHERE case_id=?").get(item.case_id);
      requireValid(item.expected_version === null ? !current : !!current && current.owner === item.owner && current.version === item.expected_version
        && current.notice_generation >= item.notice_generation, "invalid-lease-binding");
    }
  };
  return { artifactFor, restore, restoreReport, validateRetained };
}
