import type { DispatchPermit, DispatchRequest, OperationalAudit } from "./operations.ts";

export interface Reservation extends DispatchPermit {
  readonly runId: string;
  readonly caseRevision: string;
  readonly attempt: number;
}
export interface RecoveryTask {
  readonly reason: "late-reservation" | "invalid-reservation" | "terminal-failure";
  readonly reservations: readonly Reservation[];
  readonly event: OperationalAudit | null;
}
/** Operator-owned, durable dependencies. No prices, quota policy or storage are inferred here.
 * reserve must atomically persist the approval/reservation before acknowledging it.
 * release/reconcile are idempotent by runId/approvalId. reconcile receives aggregate run
 * usage once, never the same tokens separately charged to every transport attempt.
 * enqueueRecovery synchronously acknowledges durable recovery, independent of the audit
 * sink; it must return true after acknowledgement or throw on failure. A worker
 * must also recover expired/crashed reservations, including a lost reserve response.
 */
export interface OperationalSuppliers {
  readonly reserve: (request: DispatchRequest, signal: AbortSignal) => Promise<DispatchPermit | null>;
  readonly appendAudit: (event: OperationalAudit, signal?: AbortSignal) => Promise<void>;
  readonly release: (reservation: Reservation, signal?: AbortSignal) => Promise<void>;
  readonly reconcile: (event: OperationalAudit, reservations: readonly Reservation[], signal?: AbortSignal) => Promise<void>;
  readonly enqueueRecovery: (task: RecoveryTask) => true;
}

/** H's authorizeDispatch/record composition. Pass these callbacks to existing operations.
 * This is a lifecycle adapter, not a durable ledger implementation or financial approval.
 * It adds no timer: the existing request/audit deadline still bounds HTTP completion.
 */
export function createOperationalHandoff(suppliers: OperationalSuppliers) {
  type Run = { closed: boolean; caseRevision: string; reservations: Reservation[]; finish: OperationalAudit | null };
  const runs = new Map<string, Run>();
  const recover = (reason: RecoveryTask["reason"], reservations: readonly Reservation[], event: OperationalAudit | null) => {
    if (suppliers.enqueueRecovery(structuredClone({ reason, reservations, event })) !== true) throw new Error("recovery-not-acknowledged");
  };
  return {
    async authorizeDispatch(request: DispatchRequest, signal: AbortSignal): Promise<DispatchPermit | null> {
      const owned = structuredClone(request), run = runs.get(owned.runId);
      if (!run || run.closed || run.caseRevision !== owned.caseRevision || signal.aborted) throw new Error("operation-not-active");
      const permit = await suppliers.reserve(structuredClone(owned), signal);
      if (permit === null) return null;
      const reservation: Reservation = Object.freeze({ approvalId: permit.approvalId, expiresAt: permit.expiresAt,
        runId: owned.runId, caseRevision: owned.caseRevision, attempt: owned.attempt });
      // reserve may ignore abort and return after finish removed the map entry.
      // The captured run remains closed; late work cannot authorize model dispatch.
      if (run.closed || signal.aborted) {
        recover("late-reservation", [reservation], run.finish);
        throw new Error("late-reservation");
      }
      if (typeof reservation.approvalId !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(reservation.approvalId) || !Number.isSafeInteger(reservation.expiresAt)
        || reservation.expiresAt <= Date.now() || run.reservations.some(row => row.approvalId === reservation.approvalId)) {
        // Invalid/duplicate IDs require ledger inspection, not a blind refund:
        // that ID may already belong to an in-flight attempt.
        recover("invalid-reservation", [reservation], null);
        throw new Error("invalid-reservation");
      }
      run.reservations.push(reservation);
      return { approvalId: reservation.approvalId, expiresAt: reservation.expiresAt };
    },
    async record(event: OperationalAudit, signal?: AbortSignal): Promise<void> {
      const snapshot = structuredClone(event);
      if (snapshot.phase === "start") {
        if (runs.has(snapshot.runId)) throw new Error("operation-already-active");
        runs.set(snapshot.runId, { closed: false, caseRevision: snapshot.caseRevision, reservations: [], finish: null });
        await suppliers.appendAudit(snapshot, signal); return;
      }
      const run = runs.get(snapshot.runId);
      if (!run || run.closed || snapshot.caseRevision !== run.caseRevision) throw new Error("operation-not-active");
      if (snapshot.phase !== "finish") { await suppliers.appendAudit(snapshot, signal); return; }
      run.closed = true; run.finish = snapshot;
      let active = true;
      const check = () => { if (!active || signal?.aborted) throw new Error("operation-audit-interrupted"); };
      let cancel = () => {};
      const interrupted = new Promise<never>((_resolve, reject) => {
        cancel = () => reject(new Error("operation-audit-interrupted"));
        if (signal?.aborted) cancel(); else signal?.addEventListener("abort", cancel, { once: true });
      });
      const finalize = async () => {
        check();
        // Durable terminal evidence precedes release/settlement acknowledgements.
        await suppliers.appendAudit(structuredClone(snapshot), signal); check();
        const transmitted: Reservation[] = [];
        for (const reservation of run.reservations) {
          const row = snapshot.requests.find(row => row.approvalId === reservation.approvalId && row.attempt === reservation.attempt);
          if (row?.transportStarted) transmitted.push(reservation);
          else { await suppliers.release(structuredClone(reservation), signal); check(); }
        }
        if (transmitted.length) { await suppliers.reconcile(structuredClone(snapshot), structuredClone(transmitted), signal); check(); }
      };
      try {
        await Promise.race([interrupted, finalize()]);
      } catch (error) {
        try { recover("terminal-failure", run.reservations, snapshot); }
        catch (recoveryError) { throw new AggregateError([error, recoveryError], "operation-recovery-failed"); }
        throw error;
      } finally { active = false; signal?.removeEventListener("abort", cancel); runs.delete(snapshot.runId); }
    },
  };
}
