import { AsyncLocalStorage } from "node:async_hooks";
import type { CaseInput } from "./contracts.ts";
import type { AssessmentEnvelope } from "./app.ts";
import type { PhotoReceipt, PhotoAuthorizer } from "./photos.ts";
import { revision } from "./o-validation.ts";

export class CaseConflict extends Error {}
export interface CaseSnapshot {
  readonly owner: string;
  readonly input: CaseInput;
  readonly assessment: AssessmentEnvelope;
  readonly version: number;
  readonly expires: number;
  readonly editUntil: number;
  readonly photos: readonly PhotoReceipt[];
  readonly denied: readonly string[];
  readonly permissionChanged: boolean;
}
interface Lease { readonly owner: string; readonly caseId: string; readonly base: number | null; readonly controller: AbortController; input?: CaseInput; open: boolean }
/** One process owns committed snapshots. ALS exposes candidates only to their live lease. */
export function createCaseStore(now: () => number = Date.now) {
  const records = new Map<string, CaseSnapshot>(), leases = new Map<string, Lease>();
  const context = new AsyncLocalStorage<Lease>();
  const read = (owner: string, id: string) => {
    const value = records.get(id);
    return value?.owner === owner && value.expires > now() ? structuredClone(value) : undefined;
  };
  const check = (lease: Lease) => {
    if (!lease.open || lease.controller.signal.aborted || leases.get(lease.caseId) !== lease
      || (records.get(lease.caseId)?.version ?? null) !== lease.base) throw new CaseConflict("closed-or-stale-revision");
  };
  const rollback = (lease: Lease) => { lease.open = false; lease.controller.abort(); if (leases.get(lease.caseId) === lease) leases.delete(lease.caseId); };
  const eligible = (snapshot: CaseSnapshot, input: CaseInput) => input.photoRefs.every(ref => snapshot.photos.some(p => p.photoRef === ref && p.expiresAt > now() && p.consent.model && p.consent.visibleContentReviewed) && !snapshot.denied.includes(ref));
  const authorize: PhotoAuthorizer = async (actor, id, signal) => {
    if (signal.aborted) return null;
    const owner = `actor:${actor}`, snapshot = read(owner, id), lease = context.getStore();
    if (!snapshot) return null;
    if (lease?.caseId === id && lease.owner === owner) {
      check(lease);
      if (lease.input) return { ownerId: actor, caseRevision: revision(lease.input), read: true, sendToModel: eligible(snapshot, lease.input) };
    }
    return { ownerId: actor, caseRevision: revision(snapshot.input), read: true, sendToModel: eligible(snapshot, snapshot.input) };
  };
  return { read, authorize, eligible,
    currentActor() { const lease = context.getStore(); if (!lease || !lease.owner.startsWith("actor:")) throw new CaseConflict("no-private-stage"); check(lease); return lease.owner.slice(6); },
    canResolve(actor: string, caseId: string, ref: string, caseRevision: string) {
      const lease = context.getStore(), snapshot = read(`actor:${actor}`, caseId);
      if (!lease || !snapshot || lease.owner !== `actor:${actor}` || lease.caseId !== caseId || !lease.input) return false;
      check(lease);
      return revision(lease.input) === caseRevision && lease.input.photoRefs.includes(ref) && eligible(snapshot, lease.input);
    },
    begin(owner: string, id: string, expected: number | null) {
      for (const [id, value] of records) if (value.expires <= now() && !leases.has(id)) records.delete(id);
      const snapshot = read(owner, id);
      if (leases.has(id) || (records.get(id)?.version ?? null) !== expected || (expected !== null && (!snapshot || snapshot.editUntil <= now()))) throw new CaseConflict("occupied-or-stale-revision");
      if (expected === null && records.size + [...leases.values()].filter(value => value.base === null).length >= 100) throw new CaseConflict("capacity");
      const lease: Lease = { owner, caseId: id, base: expected, controller: new AbortController(), open: true };
      leases.set(id, lease); return lease;
    },
    run<T>(lease: Lease, input: CaseInput, work: (signal: AbortSignal) => Promise<T>) { check(lease); lease.input = structuredClone(input); return context.run(lease, () => work(lease.controller.signal)); },
    commit(lease: Lease, assessment: AssessmentEnvelope, guard: () => void) {
      check(lease); guard();
      if (!lease.input) throw new CaseConflict("unstaged");
      const previous = records.get(lease.caseId);
      if (lease.input.photoRefs.length && (!previous || !eligible(previous, lease.input))) throw new CaseConflict("photo-permissions-changed");
      const snapshot: CaseSnapshot = structuredClone({ owner: lease.owner, input: lease.input, assessment, version: (lease.base ?? 0) + 1,
        expires: now() + 3600000, editUntil: now() + 1800000, photos: previous?.photos ?? [], denied: previous?.denied ?? [], permissionChanged: false });
      guard(); check(lease); records.set(lease.caseId, snapshot); rollback(lease);
    }, rollback,
    associate(lease: Lease, receipt: PhotoReceipt, guard: () => void) {
      check(lease); const previous = records.get(lease.caseId); if (!previous) throw new CaseConflict("missing");
      const next = structuredClone({ ...previous, version: previous.version + 1, photos: [...previous.photos, receipt] });
      guard(); check(lease); records.set(lease.caseId, next); rollback(lease);
    },
    withdraw(owner: string, id: string, ref: string, storage: boolean) {
      const previous = read(owner, id); if (!previous) throw new CaseConflict("missing");
      const lease = leases.get(id); if (lease) rollback(lease);
      records.set(id, { ...previous, version: previous.version + 1, input: { ...previous.input, photoRefs: previous.input.photoRefs.filter(p => p !== ref) },
        photos: storage ? previous.photos.filter(p => p.photoRef !== ref) : previous.photos,
        denied: [...new Set([...previous.denied, ref])], permissionChanged: true });
    },
  };
}
export type OCaseStore = ReturnType<typeof createCaseStore>;
