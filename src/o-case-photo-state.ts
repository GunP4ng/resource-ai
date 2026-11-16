import { Value } from "typebox/value";
import type { CaseInput } from "./contracts.ts";
import type { PhotoReceipt } from "./photos.ts";
import type { RuntimeDatabase } from "./o-runtime-db.ts";
import { matchesPhotoConsent, type PhotoExecutionAuthority, type PhotoExecutionTicket } from "./photo-execution.ts";
import { CaseConflict, type CaseRow, type CaseSnapshot, type CleanupCursor, type Lease } from "./o-case-store-types.ts";
import { checkGuard, idSchema, instant, noGuard, ownerSchema, photoRef, validateReceipt } from "./o-case-record-validation.ts";
import { revision, requireValid } from "./o-validation.ts";

export interface CasePhotoStateContext {
  readonly db: RuntimeDatabase["database"];
  ready(): void;
  clock(): number;
  transaction<T>(work: () => T): T;
  row(caseId: string): CaseRow | null;
  restore(record: CaseRow): CaseSnapshot;
  publish(previous: CaseRow, snapshot: CaseSnapshot, noticeGeneration?: number): void;
  checkLease(lease: Lease): CaseRow | null;
  finishWrite(lease: Lease, version: number, guard: () => void): void;
}
export function createCasePhotoState(context: CasePhotoStateContext, photoExecution?: PhotoExecutionAuthority) {
  const { db, ready, clock, transaction, row, restore, publish, checkLease: check, finishWrite } = context;
  const enqueue = (owner: string, id: string, ref: string) => {
    requireValid(Value.Check(ownerSchema, owner) && Value.Check(idSchema, id) && Value.Check(photoRef, ref), "invalid-cleanup");
    const exists = db.query("SELECT 1 FROM photo_cleanup WHERE owner=? AND case_id=? AND photo_ref=?").get(owner, id, ref);
    if (!exists) requireValid((db.query<{ total: number }, []>("SELECT count(*) AS total FROM photo_cleanup").get()?.total ?? 100000) < 100000, "cleanup-capacity");
    db.query("INSERT OR IGNORE INTO photo_cleanup(owner,case_id,photo_ref,queued_at) VALUES(?,?,?,?)").run(owner, id, ref, clock());
  };
  const sweep = () => {
    const at = clock();
    db.query("DELETE FROM leases WHERE expires<=?").run(at);
    for (const record of db.query<CaseRow, [number]>("SELECT * FROM cases WHERE expires<=?").all(at)) {
      const snapshot = restore(record);
      for (const ref of new Set([...snapshot.photos.map(p => p.photoRef), ...snapshot.pendingCleanup])) enqueue(snapshot.owner, record.case_id, ref);
      db.query("DELETE FROM leases WHERE case_id=?").run(record.case_id);
      db.query("DELETE FROM cases WHERE case_id=?").run(record.case_id);
    }
    db.exec("DELETE FROM review_records WHERE NOT EXISTS(SELECT 1 FROM cases WHERE review_hash=review_records.hash)");
  };
  const assertTicket = (ticket?: PhotoExecutionTicket) => {
    if (!photoExecution || !ticket) throw new CaseConflict("photo-execution-required");
    photoExecution.assertCurrent(ticket);
  };
  const eligible = (snapshot: CaseSnapshot, input: CaseInput, ticket?: PhotoExecutionTicket | null) => {
    ready();
    if (!input.photoRefs.length) return true;
    try { assertTicket(ticket ?? undefined); } catch { return false; }
    return input.photoRefs.every(ref => snapshot.photos.some(p => p.photoRef === ref && p.expiresAt > clock() && matchesPhotoConsent(p.consent, ticket)) && !snapshot.denied.includes(ref));
  };
  return { assertTicket, eligible, sweep,
    associate(lease: Lease, receipt: PhotoReceipt, guard: () => void) {
      const captured = structuredClone(validateReceipt(receipt, lease.caseId));
      transaction(() => {
        check(lease);
        const previous = row(lease.caseId);
        if (!previous) throw new CaseConflict("missing");
        const snapshot = restore(previous);
        requireValid(captured.expiresAt > clock() && captured.uploadRevision === revision(snapshot.input) && !snapshot.denied.includes(captured.photoRef)
          && !snapshot.photos.some(p => p.photoRef === captured.photoRef), "invalid-photo-association");
        checkGuard(guard);
        check(lease);
        publish(previous, { ...snapshot, version: snapshot.version + 1, photos: [...snapshot.photos, captured] });
        finishWrite(lease, snapshot.version + 1, guard);
      });
    },
    withdraw(owner: string, id: string, ref: string, storage: boolean, guard: () => void = noGuard) {
      transaction(() => {
        const previous = row(id);
        if (!previous || previous.owner !== owner || previous.expires <= clock()) throw new CaseConflict("missing");
        const snapshot = restore(previous);
        requireValid(Value.Check(photoRef, ref), "invalid-photo-ref");
        if (storage && !snapshot.photos.some(photo => photo.photoRef === ref)) { checkGuard(guard); return; }
        checkGuard(guard);
        if (storage) enqueue(owner, id, ref);
        publish(previous, { ...snapshot, version: snapshot.version + 1, input: { ...snapshot.input, photoRefs: snapshot.input.photoRefs.filter(p => p !== ref) },
          photos: storage ? snapshot.photos.filter(p => p.photoRef !== ref) : snapshot.photos,
          pendingCleanup: storage ? [...new Set([...snapshot.pendingCleanup, ref])] : snapshot.pendingCleanup,
          denied: [...new Set([...snapshot.denied, ref])], permissionChanged: true }, previous.notice_generation + 1);
        db.query("DELETE FROM leases WHERE case_id=?").run(id);
        checkGuard(guard);
      });
    },
    queueCleanup(owner: string, id: string, ref: string, guard: () => void = noGuard) {
      transaction(() => {
        const previous = row(id);
        if (previous && previous.owner !== owner) throw new CaseConflict("missing");
        enqueue(owner, id, ref);
        if (previous) {
          const snapshot = restore(previous);
          publish(previous, { ...snapshot, pendingCleanup: [...new Set([...snapshot.pendingCleanup, ref])],
          denied: [...new Set([...snapshot.denied, ref])], permissionChanged: true }, previous.notice_generation + 1);
        }
        checkGuard(guard);
      });
    },
    completeCleanup(owner: string, id: string, ref: string, guard: () => void = noGuard) {
      transaction(() => {
        const previous = row(id);
        if (previous && previous.owner !== owner) throw new CaseConflict("missing");
        db.query("DELETE FROM photo_cleanup WHERE owner=? AND case_id=? AND photo_ref=?").run(owner, id, ref);
        if (previous) {
          const snapshot = restore(previous);
          publish(previous, { ...snapshot, pendingCleanup: snapshot.pendingCleanup.filter(value => value !== ref) });
        }
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
  };
}
