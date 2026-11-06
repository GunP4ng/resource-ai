import { AsyncLocalStorage } from "node:async_hooks";
import { SQLiteError } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { CaseInput } from "./contracts.ts";
import type { AssessmentEnvelope } from "./app.ts";
import type { ReportPresentation } from "./report.ts";
import type { prepareCaseRecord } from "./case-record.ts";
import type { PhotoReceipt, PhotoAuthorizer } from "./photos.ts";
import { parseCaseInput } from "./input.ts";
import { parseDecision } from "./o-decision.ts";
import { revision, requireValid } from "./o-validation.ts";
import { matchesPhotoConsent, type PhotoExecutionAuthority, type PhotoExecutionTicket } from "./photo-execution.ts";
import { createMemoryRuntimeDatabase, RuntimeStorageError, type RuntimeDatabase } from "./o-runtime-db.ts";

export class CaseConflict extends Error {}
type Artifact = Awaited<ReturnType<typeof prepareCaseRecord>>;
const instant = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const positive = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const digest = Type.String({ pattern: "^[a-f0-9]{64}$" });
const idSchema = Type.String({ pattern: "^[A-Za-z0-9_-]{1,100}$" });
const ownerSchema = Type.String({ minLength: 1, maxLength: 256, pattern: "\\S" });
const photoRef = Type.String({ pattern: "^[a-f0-9-]{36}$" });
const originSchema = Type.Object({ kind: Type.Union([Type.Literal("synthetic"), Type.Literal("field")]), reference: Type.String({ minLength: 1, maxLength: 10000, pattern: "\\S" }) }, { additionalProperties: false });
const executionSchema = Type.Object({ traceId: Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" }),
  usage: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 2000, pattern: "\\S" }), Type.Null()])) }, { additionalProperties: false });
const envelopeSchema = Type.Object({ decision: Type.Unknown(), execution: Type.Optional(executionSchema) }, { additionalProperties: false });
/** Shared HTTP/storage envelope parser; app's temporary copy may now import this export. */
export function parseAssessment(output: unknown): AssessmentEnvelope {
  if (typeof output !== "object" || output === null || !Object.hasOwn(output, "decision")) return { decision: parseDecision(output) };
  requireValid(Value.Check(envelopeSchema, output), "invalid-assessment-envelope");
  const decision = parseDecision(output.decision);
  return output.execution === undefined ? { decision } : { decision, execution: { traceId: output.execution.traceId, usage: output.execution.usage ?? null } };
}
const presentationSchema = Type.Object({ mode: Type.Union([Type.Literal("synthetic"), Type.Literal("offline"), Type.Literal("live"), Type.Literal("recording")]),
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
export interface CaseSnapshot {
  readonly owner: string;
  readonly input: CaseInput;
  readonly assessment: AssessmentEnvelope;
  readonly version: number;
  readonly expires: number;
  readonly editUntil: number;
  readonly photos: readonly PhotoReceipt[];
  readonly denied: readonly string[];
  readonly pendingCleanup: readonly string[];
  readonly permissionChanged: boolean;
  readonly evaluated: { readonly revision: string; readonly version: number; readonly committedAt: number };
  readonly review: { readonly hash: string; readonly origin: Artifact["record"]["dataOrigin"]; readonly caseRevision: string } | null;
  readonly presentation?: ReportPresentation;
}
export interface CleanupCursor {
  readonly queuedAt: number;
  readonly caseId: string;
  readonly photoRef: string;
}
interface CaseRow { case_id: string; owner: string; version: number; row_revision: number; notice_generation: number; expires: number; edit_until: number; snapshot: string; review_hash: string | null }
interface LeaseRow { case_id: string; token: string; owner: string; expected_version: number | null; notice_generation: number; created_at: number; expires: number }
interface Lease {
  readonly owner: string; readonly caseId: string; readonly base: number | null; readonly token: string; readonly notices: number;
  readonly controller: AbortController; input?: CaseInput; ticket?: PhotoExecutionTicket; artifact?: Artifact | null; presentation?: ReportPresentation; open: boolean;
}
const noGuard = () => undefined;
const maxSnapshot = 1048576, maxArtifact = 67108864, maxArtifacts = 536870912;
export const CASE_LEASE_MS = 65000;
const checkGuard = (guard: () => void) => { const result: unknown = guard(); requireValid(!(result instanceof Promise), "guard-must-be-synchronous"); };
const bytes = (value: unknown, limit: number) => { const json = JSON.stringify(value); requireValid(Buffer.byteLength(json) <= limit, "storage-byte-limit"); return json; };
function parseInput(value: unknown): CaseInput {
  const parsed = parseCaseInput(value); requireValid(parsed.ok, "invalid-stored-input");
  requireValid(Value.Check(idSchema, parsed.value.caseId) && parsed.value.photoRefs.length <= 5
    && parsed.value.photoRefs.every(ref => Value.Check(photoRef, ref)) && new Set(parsed.value.photoRefs).size === parsed.value.photoRefs.length, "invalid-stored-input");
  return parsed.value;
}
function validateReceipt(value: unknown, caseId: string): PhotoReceipt {
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
function validateArtifact(value: unknown) {
  requireValid(Value.Check(artifactSchema, value), "invalid-review-record");
  const record = value.record, input = parseInput(record.input);
  requireValid(revision(record) === value.sha256 && revision(input) === record.caseRevision && revision(record.resources) === record.resourcesSha256
    && Number.isFinite(Date.parse(record.recordedAt)) && new Date(record.recordedAt).toISOString() === record.recordedAt
    && parseDecision(record.decision).caseId === input.caseId, "invalid-review-hash-or-binding");
  let total = 0;
  for (const source of record.sources) {
    if (source.state === "verified") {
      requireValid(source.base64 !== null && source.actualSha256 === source.expectedSha256, "invalid-source-snapshot");
      const decoded = Buffer.from(source.base64, "base64"); total += decoded.length;
      requireValid(decoded.toString("base64") === source.base64 && decoded.length <= 8388608 && total <= 33554432
        && createHash("sha256").update(decoded).digest("hex") === source.expectedSha256, "invalid-source-hash");
    } else requireValid(source.base64 === null, "invalid-source-snapshot");
  }
  return { hash: value.sha256, origin: record.dataOrigin, caseRevision: record.caseRevision };
}

/** One SQLite algorithm in both modes. Only this process's live objects grant ALS authority. */
export function createCaseStore(now: () => number = Date.now, photoExecution?: PhotoExecutionAuthority, database?: RuntimeDatabase) {
  const runtime = database ?? createMemoryRuntimeDatabase(), db = runtime.database;
  const leases = new Map<string, Lease>(), context = new AsyncLocalStorage<Lease>(); let disposed = false;
  const ready = () => { if (disposed) throw new RuntimeStorageError(); runtime.assertReady(); };
  const clock = () => { const value = now(); requireValid(Value.Check(instant, value) && value <= Number.MAX_SAFE_INTEGER - 3600000, "invalid-clock"); return value; };
  const row = (id: string) => db.query<CaseRow, [string]>("SELECT * FROM cases WHERE case_id=?").get(id);
  const leaseRow = (id: string) => db.query<LeaseRow, [string]>("SELECT * FROM leases WHERE case_id=?").get(id);
  const transaction = <T>(work: () => T): T => {
    ready();
    try { return db.transaction(() => { const value = work(); ready(); return value; }).immediate(); }
    catch (error) {
      if (error instanceof Error && "code" in error && (error.code === "SQLITE_BUSY" || error.code === "SQLITE_LOCKED")) throw new CaseConflict("storage-busy");
      if (error instanceof SQLiteError) throw new RuntimeStorageError();
      throw error;
    }
  };
  const artifactFor = (hash: string) => {
    const stored = db.query<{ artifact: string; bytes: number }, [string]>("SELECT artifact,bytes FROM review_records WHERE hash=?").get(hash);
    requireValid(!!stored && Buffer.byteLength(stored.artifact) === stored.bytes && stored.bytes <= maxArtifact, "missing-or-invalid-review-record");
    const provenance = validateArtifact(JSON.parse(stored.artifact)); requireValid(provenance.hash === hash, "review-hash-mismatch"); return provenance;
  };
  const restore = (record: CaseRow): CaseSnapshot => {
    requireValid(Buffer.byteLength(record.snapshot) <= maxSnapshot, "storage-byte-limit");
    const value: unknown = JSON.parse(record.snapshot); requireValid(Value.Check(snapshotSchema, value), "invalid-case-snapshot");
    const input = parseInput(value.input), assessment = parseAssessment(value.assessment);
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
    if (value.review) requireValid(revision(artifactFor(value.review.hash)) === revision(value.review), "review-provenance-mismatch");
    return { ...value, input, assessment };
  };
  // Validate even expired rows and all retained artifacts; never reset malformed storage.
  ready();
  try { db.transaction(() => {
    const bounds = db.query<{ cases: number; reservations: number; artifacts: number; cleanup: number }, []>(
      "SELECT (SELECT count(*) FROM cases) AS cases,(SELECT count(*) FROM leases WHERE expected_version IS NULL) AS reservations,(SELECT coalesce(sum(bytes),0) FROM review_records) AS artifacts,(SELECT count(*) FROM photo_cleanup) AS cleanup").get();
    requireValid(!!bounds && bounds.cases + bounds.reservations <= 100 && bounds.artifacts <= maxArtifacts && bounds.cleanup <= 100000, "invalid-storage-capacity");
    for (const record of db.query<CaseRow, []>("SELECT * FROM cases").all()) {
      const snapshot = restore(record);
      if (snapshot.review) requireValid(revision(artifactFor(snapshot.review.hash)) === revision(snapshot.review), "review-provenance-mismatch");
    }
    for (const record of db.query<{ hash: string }, []>("SELECT hash FROM review_records").all()) artifactFor(record.hash);
    for (const item of db.query<{ owner: string; case_id: string; photo_ref: string; queued_at: number }, []>("SELECT * FROM photo_cleanup").all())
      requireValid(Value.Check(ownerSchema, item.owner) && Value.Check(idSchema, item.case_id) && Value.Check(photoRef, item.photo_ref) && Value.Check(instant, item.queued_at), "invalid-cleanup-row");
    for (const item of db.query<LeaseRow, []>("SELECT * FROM leases").all()) {
      requireValid(Value.Check(ownerSchema, item.owner) && Value.Check(idSchema, item.case_id) && /^[a-f0-9-]{36}$/.test(item.token)
        && Value.Check(instant, item.notice_generation) && Value.Check(instant, item.created_at) && Value.Check(instant, item.expires)
        && item.expires > item.created_at && item.expires <= item.created_at + CASE_LEASE_MS
        && (item.expected_version === null || Value.Check(positive, item.expected_version)), "invalid-lease-row");
      const current = row(item.case_id);
      requireValid(item.expected_version === null ? !current : !!current && current.owner === item.owner && current.version === item.expected_version
        && current.notice_generation >= item.notice_generation, "invalid-lease-binding");
    }
  }).deferred();
  } catch { if (!database) runtime.close(); throw new RuntimeStorageError(); }
  const enqueue = (owner: string, id: string, ref: string) => {
    requireValid(Value.Check(ownerSchema, owner) && Value.Check(idSchema, id) && Value.Check(photoRef, ref), "invalid-cleanup");
    const exists = db.query("SELECT 1 FROM photo_cleanup WHERE owner=? AND case_id=? AND photo_ref=?").get(owner, id, ref);
    if (!exists) requireValid((db.query<{ total: number }, []>("SELECT count(*) AS total FROM photo_cleanup").get()?.total ?? 100000) < 100000, "cleanup-capacity");
    db.query("INSERT OR IGNORE INTO photo_cleanup(owner,case_id,photo_ref,queued_at) VALUES(?,?,?,?)").run(owner, id, ref, clock());
  };
  const sweep = () => {
    const at = clock(); db.query("DELETE FROM leases WHERE expires<=?").run(at);
    for (const record of db.query<CaseRow, [number]>("SELECT * FROM cases WHERE expires<=?").all(at)) {
      const snapshot = restore(record);
      for (const ref of new Set([...snapshot.photos.map(p => p.photoRef), ...snapshot.pendingCleanup])) enqueue(snapshot.owner, record.case_id, ref);
      db.query("DELETE FROM leases WHERE case_id=?").run(record.case_id);
      db.query("DELETE FROM cases WHERE case_id=?").run(record.case_id);
    }
    db.exec("DELETE FROM review_records WHERE NOT EXISTS(SELECT 1 FROM cases WHERE review_hash=review_records.hash)");
  };
  const read = (owner: string, id: string) => {
    try {
      ready(); const record = row(id);
      if (!record || record.owner !== owner || record.expires <= clock()) return undefined;
      return restore(record);
    } catch { throw new RuntimeStorageError(); }
  };
  const check = (lease: Lease) => {
    ready(); const active = leaseRow(lease.caseId), current = row(lease.caseId);
    if (!lease.open || lease.controller.signal.aborted || leases.get(lease.caseId) !== lease || !active
      || active.token !== lease.token || active.owner !== lease.owner || active.expected_version !== lease.base || active.expires <= clock()
      || (current?.version ?? null) !== lease.base || (current && (current.owner !== lease.owner || current.expires <= clock() || current.edit_until <= clock()))) throw new CaseConflict("closed-or-stale-revision");
  };
  const closeLocal = (lease: Lease) => { lease.open = false; lease.controller.abort(); if (leases.get(lease.caseId) === lease) leases.delete(lease.caseId); };
  const rollback = (lease: Lease, guard: () => void = noGuard) => {
    // Publication already released this lease. A finally block must not perform
    // another SQLite write that can turn a confirmed commit into an HTTP failure.
    if (!lease.open || disposed) return;
    closeLocal(lease);
    transaction(() => { checkGuard(guard); db.query("DELETE FROM leases WHERE case_id=? AND token=?").run(lease.caseId, lease.token); checkGuard(guard); });
  };
  const assertTicket = (ticket?: PhotoExecutionTicket) => { if (!photoExecution || !ticket) throw new CaseConflict("photo-execution-required"); photoExecution.assertCurrent(ticket); };
  const eligible = (snapshot: CaseSnapshot, input: CaseInput, ticket?: PhotoExecutionTicket | null) => {
    ready();
    if (!input.photoRefs.length) return true;
    try { assertTicket(ticket ?? undefined); } catch { return false; }
    return input.photoRefs.every(ref => snapshot.photos.some(p => p.photoRef === ref && p.expiresAt > clock() && matchesPhotoConsent(p.consent, ticket)) && !snapshot.denied.includes(ref));
  };
  const live = () => { const lease = context.getStore(); if (!lease) throw new CaseConflict("no-private-stage"); check(lease); return lease; };
  const publish = (previous: CaseRow, snapshot: CaseSnapshot, noticeGeneration = previous.notice_generation) => {
    const serialized = bytes(snapshot, maxSnapshot);
    restore({ ...previous, version: snapshot.version, expires: snapshot.expires, edit_until: snapshot.editUntil, snapshot: serialized, review_hash: snapshot.review?.hash ?? null });
    const result = db.query("UPDATE cases SET version=?,row_revision=row_revision+1,notice_generation=?,expires=?,edit_until=?,snapshot=?,review_hash=? WHERE case_id=? AND owner=? AND version=? AND row_revision=?")
      .run(snapshot.version, noticeGeneration, snapshot.expires, snapshot.editUntil, serialized, snapshot.review?.hash ?? null, previous.case_id, previous.owner, previous.version, previous.row_revision);
    if (result.changes !== 1) throw new CaseConflict("write-conflict");
  };
  const finishWrite = (lease: Lease, version: number, guard: () => void) => {
    checkGuard(guard); if (lease.input?.photoRefs.length) assertTicket(lease.ticket);
    const active = leaseRow(lease.caseId), confirmed = row(lease.caseId);
    if (!lease.open || lease.controller.signal.aborted || leases.get(lease.caseId) !== lease || active?.token !== lease.token || active.owner !== lease.owner
      || active.expected_version !== lease.base || active.expires <= clock() || confirmed?.version !== version || confirmed.owner !== lease.owner) throw new CaseConflict("closed-or-stale-revision");
    if (lease.input?.photoRefs.length && !eligible(restore(confirmed), lease.input, lease.ticket)) throw new CaseConflict("photo-permissions-changed");
    if (db.query("DELETE FROM leases WHERE case_id=? AND token=?").run(lease.caseId, lease.token).changes !== 1) throw new CaseConflict("write-conflict");
  };
  const authorize: PhotoAuthorizer = async (actor, id, signal) => {
    if (signal.aborted) return null;
    const owner = `actor:${actor}`, snapshot = read(owner, id), lease = context.getStore();
    if (!snapshot) return null;
    if (lease?.caseId === id && lease.owner === owner) {
      check(lease);
      if (lease.input) return { ownerId: actor, caseRevision: revision(lease.input), read: true, sendToModel: eligible(snapshot, lease.input, lease.ticket) };
    }
    return { ownerId: actor, caseRevision: revision(snapshot.input), read: true, sendToModel: eligible(snapshot, snapshot.input, photoExecution?.current()) };
  };
  return { read, authorize, eligible,
    list(owner: string) {
      return transaction(() => { sweep(); return db.query<CaseRow, [string, number]>("SELECT * FROM cases WHERE owner=? AND expires>? ORDER BY expires DESC,case_id LIMIT 100").all(owner, clock())
        .map(record => { const snapshot = restore(record); return { caseId: record.case_id, version: record.version, expires: record.expires, editUntil: record.edit_until,
          state: snapshot.assessment.decision.state, evaluated: snapshot.evaluated, review: snapshot.review }; }); });
    },
    stageResources(artifact: Artifact | null) {
      const lease = live(); if (!lease.input) throw new CaseConflict("unstaged");
      if (lease.artifact !== undefined) throw new CaseConflict("resources-already-staged");
      if (artifact !== null) { bytes(artifact, maxArtifact); const provenance = validateArtifact(artifact); requireValid(provenance.caseRevision === revision(lease.input), "review-input-mismatch"); }
      lease.artifact = structuredClone(artifact);
    },
    stagePresentation(value: ReportPresentation) { const lease = live(); if (lease.presentation) throw new CaseConflict("presentation-already-staged"); requireValid(Value.Check(presentationSchema, value), "invalid-presentation"); lease.presentation = structuredClone(value); },
    currentPhotoTicket() { const lease = live(); assertTicket(lease.ticket); if (!lease.ticket) throw new CaseConflict("photo-execution-required"); return lease.ticket; },
    currentActor() { const lease = live(); if (!lease.owner.startsWith("actor:")) throw new CaseConflict("no-private-stage"); return lease.owner.slice(6); },
    canResolve(actor: string, caseId: string, ref: string, caseRevision: string) {
      const lease = context.getStore(), snapshot = read(`actor:${actor}`, caseId);
      if (!lease || !snapshot || lease.owner !== `actor:${actor}` || lease.caseId !== caseId || !lease.input) return false;
      check(lease); return revision(lease.input) === caseRevision && lease.input.photoRefs.includes(ref) && eligible(snapshot, lease.input, lease.ticket);
    },
    begin(owner: string, id: string, expected: number | null, guard: () => void = noGuard) {
      requireValid(Value.Check(ownerSchema, owner) && Value.Check(idSchema, id) && (expected === null || Value.Check(positive, expected)), "invalid-lease-request");
      const lease = transaction(() => {
        sweep(); const current = row(id), at = clock();
        if (leaseRow(id) || (current?.version ?? null) !== expected || (current && (current.owner !== owner || current.edit_until <= at))) throw new CaseConflict("occupied-or-stale-revision");
        const count = db.query<{ total: number }, []>("SELECT (SELECT count(*) FROM cases)+(SELECT count(*) FROM leases WHERE expected_version IS NULL) AS total").get();
        if (expected === null && (!count || count.total >= 100)) throw new CaseConflict("capacity");
        const lease: Lease = { owner, caseId: id, base: expected, token: randomUUID(), notices: current?.notice_generation ?? 0, controller: new AbortController(), open: true };
        db.query("INSERT INTO leases(case_id,token,owner,expected_version,notice_generation,created_at,expires) VALUES(?,?,?,?,?,?,?)")
          .run(id, lease.token, owner, expected, lease.notices, at, at + CASE_LEASE_MS);
        checkGuard(guard); return lease;
      });
      const old = leases.get(id); if (old) closeLocal(old); leases.set(id, lease); return lease;
    },
    run<T>(lease: Lease, input: CaseInput, work: (signal: AbortSignal) => Promise<T>, ticket?: PhotoExecutionTicket) {
      check(lease); const candidate = parseInput(structuredClone(input)); requireValid(candidate.caseId === lease.caseId, "case-id-mismatch");
      if (candidate.photoRefs.length) assertTicket(ticket);
      if (lease.input) throw new CaseConflict("already-staged");
      lease.input = candidate; lease.ticket = ticket; return context.run(lease, () => work(lease.controller.signal));
    },
    commit(lease: Lease, assessment: AssessmentEnvelope, guard: () => void) {
      const captured = parseAssessment(JSON.parse(bytes(assessment, maxSnapshot)));
      const stagedArtifact = lease.artifact ? { provenance: validateArtifact(lease.artifact), serialized: bytes(lease.artifact, maxArtifact) } : null;
      transaction(() => {
        check(lease); checkGuard(guard); if (!lease.input) throw new CaseConflict("unstaged");
        requireValid(captured.decision.caseId === lease.caseId, "assessment-case-mismatch");
        const previous = row(lease.caseId), old = previous ? restore(previous) : undefined;
        if (lease.input.photoRefs.length && (!old || !eligible(old, lease.input, lease.ticket))) throw new CaseConflict("photo-permissions-changed");
        const at = clock(), version = (lease.base ?? 0) + 1, review = stagedArtifact?.provenance ?? null;
        if (stagedArtifact) {
          const artifact = stagedArtifact.serialized, size = Buffer.byteLength(artifact);
          const existing = db.query<{ hash: string }, [string]>("SELECT hash FROM review_records WHERE hash=?").get(stagedArtifact.provenance.hash);
          if (existing) artifactFor(existing.hash);
          else {
            const total = db.query<{ bytes: number }, []>("SELECT coalesce(sum(bytes),0) AS bytes FROM review_records").get();
            requireValid(!!total && total.bytes + size <= maxArtifacts, "artifact-capacity");
            db.query("INSERT INTO review_records(hash,artifact,bytes) VALUES(?,?,?)").run(stagedArtifact.provenance.hash, artifact, size);
          }
        }
        const snapshot: CaseSnapshot = { owner: lease.owner, input: lease.input, assessment: captured, version, expires: at + 3600000, editUntil: at + 1800000,
          photos: old?.photos ?? [], denied: old?.denied ?? [], pendingCleanup: old?.pendingCleanup ?? [], permissionChanged: (previous?.notice_generation ?? 0) > lease.notices,
          evaluated: { revision: revision(lease.input), version, committedAt: at }, review, ...(lease.presentation ? { presentation: lease.presentation } : {}) };
        if (previous) publish(previous, snapshot);
        else {
          const record: CaseRow = { case_id: lease.caseId, owner: lease.owner, version, row_revision: 1, notice_generation: 0,
            expires: snapshot.expires, edit_until: snapshot.editUntil, snapshot: bytes(snapshot, maxSnapshot), review_hash: review?.hash ?? null };
          restore(record);
          if (db.query("INSERT INTO cases(case_id,owner,version,row_revision,notice_generation,expires,edit_until,snapshot,review_hash) VALUES(?,?,?,?,?,?,?,?,?)")
            .run(record.case_id, record.owner, version, 1, 0, record.expires, record.edit_until, record.snapshot, record.review_hash).changes !== 1) throw new CaseConflict("write-conflict");
        }
        finishWrite(lease, version, guard);
      }); closeLocal(lease);
    }, rollback,
    associate(lease: Lease, receipt: PhotoReceipt, guard: () => void) {
      const captured = structuredClone(validateReceipt(receipt, lease.caseId));
      transaction(() => {
        check(lease); const previous = row(lease.caseId); if (!previous) throw new CaseConflict("missing");
        const snapshot = restore(previous);
        requireValid(captured.expiresAt > clock() && captured.uploadRevision === revision(snapshot.input) && !snapshot.denied.includes(captured.photoRef)
          && !snapshot.photos.some(p => p.photoRef === captured.photoRef), "invalid-photo-association");
        checkGuard(guard); check(lease);
        publish(previous, { ...snapshot, version: snapshot.version + 1, photos: [...snapshot.photos, captured] });
        finishWrite(lease, snapshot.version + 1, guard);
      }); closeLocal(lease);
    },
    withdraw(owner: string, id: string, ref: string, storage: boolean, guard: () => void = noGuard) {
      transaction(() => {
        const previous = row(id); if (!previous || previous.owner !== owner || previous.expires <= clock()) throw new CaseConflict("missing");
        const snapshot = restore(previous); requireValid(Value.Check(photoRef, ref), "invalid-photo-ref");
        if (storage && !snapshot.photos.some(photo => photo.photoRef === ref)) { checkGuard(guard); return; }
        checkGuard(guard); if (storage) enqueue(owner, id, ref);
        publish(previous, { ...snapshot, version: snapshot.version + 1, input: { ...snapshot.input, photoRefs: snapshot.input.photoRefs.filter(p => p !== ref) },
          photos: storage ? snapshot.photos.filter(p => p.photoRef !== ref) : snapshot.photos,
          pendingCleanup: storage ? [...new Set([...snapshot.pendingCleanup, ref])] : snapshot.pendingCleanup,
          denied: [...new Set([...snapshot.denied, ref])], permissionChanged: true }, previous.notice_generation + 1);
        db.query("DELETE FROM leases WHERE case_id=?").run(id); checkGuard(guard);
      });
      const local = leases.get(id); if (local && !leaseRow(id)) closeLocal(local);
    },
    queueCleanup(owner: string, id: string, ref: string, guard: () => void = noGuard) {
      transaction(() => {
        const previous = row(id); if (previous && previous.owner !== owner) throw new CaseConflict("missing");
        enqueue(owner, id, ref);
        if (previous) { const snapshot = restore(previous); publish(previous, { ...snapshot, pendingCleanup: [...new Set([...snapshot.pendingCleanup, ref])],
          denied: [...new Set([...snapshot.denied, ref])], permissionChanged: true }, previous.notice_generation + 1); }
        checkGuard(guard);
      });
    },
    completeCleanup(owner: string, id: string, ref: string, guard: () => void = noGuard) {
      transaction(() => {
        const previous = row(id); if (previous && previous.owner !== owner) throw new CaseConflict("missing");
        db.query("DELETE FROM photo_cleanup WHERE owner=? AND case_id=? AND photo_ref=?").run(owner, id, ref);
        if (previous) { const snapshot = restore(previous); publish(previous, { ...snapshot, pendingCleanup: snapshot.pendingCleanup.filter(value => value !== ref) }); }
        checkGuard(guard);
      });
    },
    pendingCleanup(owner: string, limit = 100, after?: CleanupCursor) {
      requireValid(Number.isInteger(limit) && limit > 0 && limit <= 100, "invalid-cleanup-limit");
      if (after) requireValid(Value.Check(instant, after.queuedAt) && Value.Check(idSchema, after.caseId) && Value.Check(photoRef, after.photoRef), "invalid-cleanup-cursor");
      return transaction(() => {
        sweep();
        if (after) return db.query<CleanupCursor, [string, number, string, string, number]>(
          "SELECT case_id AS caseId,photo_ref AS photoRef,queued_at AS queuedAt FROM photo_cleanup WHERE owner=? AND (queued_at,case_id,photo_ref)>(?,?,?) ORDER BY queued_at,case_id,photo_ref LIMIT ?")
          .all(owner, after.queuedAt, after.caseId, after.photoRef, limit);
        return db.query<CleanupCursor, [string, number]>(
          "SELECT case_id AS caseId,photo_ref AS photoRef,queued_at AS queuedAt FROM photo_cleanup WHERE owner=? ORDER BY queued_at,case_id,photo_ref LIMIT ?").all(owner, limit);
      });
    },
    dispose() {
      if (disposed) return;
      try { for (const lease of [...leases.values()]) rollback(lease); }
      finally { for (const lease of leases.values()) closeLocal(lease); disposed = true; context.disable(); if (!database) runtime.close(); }
    },
  };
}
export type OCaseStore = ReturnType<typeof createCaseStore>;
