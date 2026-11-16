import { AsyncLocalStorage } from "node:async_hooks";
import { SQLiteError } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { Value } from "typebox/value";
import type { CaseInput } from "./contracts.ts";
import type { AssessmentEnvelope } from "./app.ts";
import type { ReportPresentation } from "./report.ts";
import type { PhotoReceipt, PhotoAuthorizer } from "./photos.ts";
import { revision, requireValid } from "./o-validation.ts";
import { type PhotoExecutionAuthority, type PhotoExecutionTicket } from "./photo-execution.ts";
import { createMemoryRuntimeDatabase, RuntimeStorageError, type RuntimeDatabase } from "./o-runtime-db.ts";

import type { CaseArtifact } from "./o-case-artifact.ts";
import { CaseConflict, CASE_LEASE_MS, maxSnapshot, maxArtifact, maxArtifacts, type CaseRow, type LeaseRow, type Lease, type CaseSnapshot, type OperationBinding } from "./o-case-store-types.ts";
import { assertStoredReviewTarget, bytes, checkGuard, createCaseRecordValidation, idSchema, noGuard, ownerSchema, parseAssessment, parseInput, positive, presentationSchema, validateClock, validateStoredArtifact } from "./o-case-record-validation.ts";
import { createCasePhotoState } from "./o-case-photo-state.ts";
export { CaseConflict, CASE_LEASE_MS } from "./o-case-store-types.ts";
export type { CaseSnapshot, CaseReport, CleanupCursor, OperationBinding } from "./o-case-store-types.ts";
export { parseAssessment } from "./o-case-record-validation.ts";

/** One SQLite algorithm in both modes. Only this process's live objects grant ALS authority. */
export function createCaseStore(now: () => number = Date.now, photoExecution?: PhotoExecutionAuthority, database?: RuntimeDatabase) {
  const runtime = database ?? createMemoryRuntimeDatabase(), db = runtime.database;
  const leases = new Map<string, Lease>(), context = new AsyncLocalStorage<Lease>();
  let disposed = false;
  const ready = () => {
    if (disposed) throw new RuntimeStorageError();
    runtime.assertReady();
  };
  const clock = () => validateClock(now());
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
  const { artifactFor, restore, restoreReport, validateRetained } = createCaseRecordValidation(db);
  ready();
  try { db.transaction(validateRetained).deferred(); }
  catch {
    if (!database) runtime.close();
    throw new RuntimeStorageError();
  }
  const readReport = (owner: string, id: string) => {
    try {
      ready();
      return db.transaction(() => {
        const record = row(id);
        if (!record || record.owner !== owner || record.expires <= clock()) return undefined;
        return restoreReport(record);
      }).deferred();
    } catch { throw new RuntimeStorageError(); }
  };
  const read = (owner: string, id: string) => readReport(owner, id)?.snapshot;
  const check = (lease: Lease) => {
    ready();
    const active = leaseRow(lease.caseId), current = row(lease.caseId);
    if (!lease.open || lease.controller.signal.aborted || leases.get(lease.caseId) !== lease || !active
      || active.token !== lease.token || active.owner !== lease.owner || active.expected_version !== lease.base || active.expires <= clock()
      || (current?.version ?? null) !== lease.base || (current && (current.owner !== lease.owner || current.expires <= clock() || current.edit_until <= clock()))) throw new CaseConflict("closed-or-stale-revision");
    return current;
  };
  const closeLocal = (lease: Lease) => {
    lease.open = false;
    lease.controller.abort();
    if (leases.get(lease.caseId) === lease) leases.delete(lease.caseId);
  };
  const rollback = (lease: Lease, guard: () => void = noGuard) => {
    // Publication already released this lease. A finally block must not perform
    // another SQLite write that can turn a confirmed commit into an HTTP failure.
    if (!lease.open || disposed) return;
    closeLocal(lease);
    transaction(() => { checkGuard(guard); db.query("DELETE FROM leases WHERE case_id=? AND token=?").run(lease.caseId, lease.token); checkGuard(guard); });
  };
  const live = () => {
    const lease = context.getStore();
    if (!lease) throw new CaseConflict("no-private-stage");
    check(lease);
    return lease;
  };
  const publish = (previous: CaseRow, snapshot: CaseSnapshot, noticeGeneration = previous.notice_generation) => {
    const serialized = bytes(snapshot, maxSnapshot);
    restore({ ...previous, version: snapshot.version, expires: snapshot.expires, edit_until: snapshot.editUntil, snapshot: serialized, review_hash: snapshot.review?.hash ?? null });
    const result = db.query("UPDATE cases SET version=?,row_revision=row_revision+1,notice_generation=?,expires=?,edit_until=?,snapshot=?,review_hash=? WHERE case_id=? AND owner=? AND version=? AND row_revision=?")
      .run(snapshot.version, noticeGeneration, snapshot.expires, snapshot.editUntil, serialized, snapshot.review?.hash ?? null, previous.case_id, previous.owner, previous.version, previous.row_revision);
    if (result.changes !== 1) throw new CaseConflict("write-conflict");
  };
  const finishWrite = (lease: Lease, version: number, guard: () => void) => {
    checkGuard(guard);
    if (lease.input?.photoRefs.length) assertTicket(lease.ticket);
    const active = leaseRow(lease.caseId), confirmed = row(lease.caseId);
    if (!lease.open || lease.controller.signal.aborted || leases.get(lease.caseId) !== lease || active?.token !== lease.token || active.owner !== lease.owner
      || active.expected_version !== lease.base || active.expires <= clock() || confirmed?.version !== version || confirmed.owner !== lease.owner) throw new CaseConflict("closed-or-stale-revision");
    if (lease.input?.photoRefs.length && !eligible(restore(confirmed), lease.input, lease.ticket)) throw new CaseConflict("photo-permissions-changed");
    if (db.query("DELETE FROM leases WHERE case_id=? AND token=?").run(lease.caseId, lease.token).changes !== 1) throw new CaseConflict("write-conflict");
  };
  const photos = createCasePhotoState({ db, ready, clock, transaction, row, restore, publish, checkLease: check, finishWrite }, photoExecution);
  const { assertTicket, eligible, sweep } = photos;
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
  return { read, readReport, authorize, eligible,
    list(owner: string) {
      return transaction(() => { sweep(); return db.query<CaseRow, [string, number]>("SELECT * FROM cases WHERE owner=? AND expires>? ORDER BY expires DESC,case_id LIMIT 100").all(owner, clock())
        .map(record => { const snapshot = restore(record); return { caseId: record.case_id, version: record.version, expires: record.expires, editUntil: record.edit_until,
          state: snapshot.assessment.decision.state, evaluated: snapshot.evaluated, review: snapshot.review }; }); });
    },
    stageResources(artifact: CaseArtifact | null) {
      const lease = live();
      if (!lease.input) throw new CaseConflict("unstaged");
      if (lease.artifact !== undefined) throw new CaseConflict("resources-already-staged");
      if (artifact !== null) assertStoredReviewTarget(validateStoredArtifact(artifact),
        { owner: lease.owner, caseId: lease.caseId, inputRevision: revision(lease.input) });
      lease.artifact = structuredClone(artifact);
    },
    stagePresentation(value: ReportPresentation) {
      const lease = live();
      if (lease.presentation) throw new CaseConflict("presentation-already-staged");
      requireValid(Value.Check(presentationSchema, value), "invalid-presentation");
      lease.presentation = structuredClone(value);
    },
    currentPhotoTicket() {
      const lease = live();
      assertTicket(lease.ticket);
      if (!lease.ticket) throw new CaseConflict("photo-execution-required");
      return lease.ticket;
    },
    currentActor() {
      const lease = live();
      if (!lease.owner.startsWith("actor:")) throw new CaseConflict("no-private-stage");
      return lease.owner.slice(6);
    },
    currentOperation(): OperationBinding {
      const lease = context.getStore();
      if (!lease) throw new CaseConflict("no-private-stage");
      const current = check(lease);
      checkGuard(lease.identityGuard ?? noGuard);
      if (!lease.owner.startsWith("actor:") || !lease.input) throw new CaseConflict("no-private-stage");
      // Check the staged selection against the same committed row validated above.
      if (lease.input.photoRefs.length && (!current || !eligible(restore(current), lease.input, lease.ticket))) throw new CaseConflict("photo-permissions-changed");
      return Object.freeze({ leaseToken: lease.token, actorId: lease.owner.slice(6), caseId: lease.caseId, inputRevision: revision(lease.input),
        artifact: lease.artifact ? Object.freeze({ hash: lease.artifact.sha256, origin: lease.artifact.record.dataOrigin.kind }) : null });
    },
    canResolve(actor: string, caseId: string, ref: string, caseRevision: string) {
      const lease = context.getStore(), snapshot = read(`actor:${actor}`, caseId);
      if (!lease || !snapshot || lease.owner !== `actor:${actor}` || lease.caseId !== caseId || !lease.input) return false;
      check(lease);
      return revision(lease.input) === caseRevision && lease.input.photoRefs.includes(ref) && eligible(snapshot, lease.input, lease.ticket);
    },
    begin(owner: string, id: string, expected: number | null, guard: () => void = noGuard) {
      requireValid(Value.Check(ownerSchema, owner) && Value.Check(idSchema, id) && (expected === null || Value.Check(positive, expected)), "invalid-lease-request");
      const lease = transaction(() => {
        sweep();
        const current = row(id), at = clock();
        if (leaseRow(id) || (current?.version ?? null) !== expected || (current && (current.owner !== owner || current.edit_until <= at))) throw new CaseConflict("occupied-or-stale-revision");
        const count = db.query<{ total: number }, []>("SELECT (SELECT count(*) FROM cases)+(SELECT count(*) FROM leases WHERE expected_version IS NULL) AS total").get();
        if (expected === null && (!count || count.total >= 100)) throw new CaseConflict("capacity");
        const lease: Lease = { owner, caseId: id, base: expected, token: randomUUID(), notices: current?.notice_generation ?? 0, controller: new AbortController(), open: true };
        db.query("INSERT INTO leases(case_id,token,owner,expected_version,notice_generation,created_at,expires) VALUES(?,?,?,?,?,?,?)")
          .run(id, lease.token, owner, expected, lease.notices, at, at + CASE_LEASE_MS);
        checkGuard(guard);
        return lease;
      });
      const old = leases.get(id);
      if (old) closeLocal(old);
      leases.set(id, lease);
      return lease;
    },
    run<T>(lease: Lease, input: CaseInput, work: (signal: AbortSignal) => Promise<T>, ticket?: PhotoExecutionTicket, identityGuard?: () => void) {
      check(lease);
      const candidate = parseInput(structuredClone(input)); requireValid(candidate.caseId === lease.caseId, "case-id-mismatch");
      if (candidate.photoRefs.length) assertTicket(ticket);
      if (lease.input) throw new CaseConflict("already-staged");
      lease.input = candidate;
      lease.ticket = ticket;
      lease.identityGuard = identityGuard;
      return context.run(lease, () => work(lease.controller.signal));
    },
    commit(lease: Lease, assessment: AssessmentEnvelope, guard: () => void) {
      const captured = parseAssessment(JSON.parse(bytes(assessment, maxSnapshot)));
      const stagedArtifact = lease.artifact ? { provenance: validateStoredArtifact(lease.artifact).provenance, serialized: bytes(lease.artifact, maxArtifact) } : null;
      transaction(() => {
        check(lease);
        checkGuard(guard);
        if (!lease.input) throw new CaseConflict("unstaged");
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
      });
      closeLocal(lease);
    }, rollback,
    associate(lease: Lease, receipt: PhotoReceipt, guard: () => void) {
      photos.associate(lease, receipt, guard);
      closeLocal(lease);
    },
    withdraw(owner: string, id: string, ref: string, storage: boolean, guard: () => void = noGuard) {
      photos.withdraw(owner, id, ref, storage, guard);
      const local = leases.get(id);
      if (local && !leaseRow(id)) closeLocal(local);
    },
    queueCleanup: photos.queueCleanup,
    completeCleanup: photos.completeCleanup,
    pendingCleanup: photos.pendingCleanup,
    dispose() {
      if (disposed) return;
      try { for (const lease of [...leases.values()]) rollback(lease); }
      finally { for (const lease of leases.values()) closeLocal(lease); disposed = true; context.disable(); if (!database) runtime.close(); }
    },
  };
}
export type OCaseStore = ReturnType<typeof createCaseStore>;
