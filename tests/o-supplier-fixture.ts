/** TEST ONLY. Durable technical quota ledger; no financial rates or production supplier. */
import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, realpathSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createOperationalAuditStore, processOperationalRecovery } from "../src/operational-audit-store.ts";
import type { OpenOperatorSuppliers, OperatorSupplierBundle } from "../src/o-operational-backend.ts";
import { parseHOperationalConfiguration, type OperationalConfiguration } from "../src/o-operations-config.ts";
import type { DispatchRequest, OperationalAudit } from "../src/operations.ts";
import type { RecoveryTask, Reservation } from "../src/operational-handoff.ts";
import { canonical, revision } from "../src/o-validation.ts";

export function hConfiguration(c: OperationalConfiguration) {
  const { journalCapacity: _capacity, ...shared } = c;
  return parseHOperationalConfiguration({ ...shared, budget: { mode: "test-only", policyReference: "test-technical-policy", budgetReference: "test-budget" } });
}
export interface SupplierHolds {
  readonly reserve?: (request: DispatchRequest) => Promise<void>;
  readonly audit?: (event: OperationalAudit, signal?: AbortSignal) => Promise<void>;
  readonly release?: (reservation: Reservation, signal?: AbortSignal) => Promise<void>;
  readonly reconcile?: (event: OperationalAudit, signal?: AbortSignal) => Promise<void>;
  readonly activate?: () => Promise<void>;
  readonly settled?: () => Promise<void>;
  readonly recovery?: (task: RecoveryTask) => Promise<void>;
}
export async function supplierFixture(root: string, holds: SupplierHolds = {}) {
  const folder = join(root, "test-h"); await mkdir(folder, { recursive: true, mode: 0o700 });
  const paths = { ledger: join(folder, "ledger.sqlite"), audit: join(folder, "audit.sqlite"), recovery: join(folder, "recovery.sqlite") };
  const openDb = (path: string) => { const db = new Database(path); chmodSync(path, 0o600); return db; };
  const ledger = openDb(paths.ledger), audit = openDb(paths.audit), recovery = openDb(paths.recovery);
  const pinned = new Map(Object.values(paths).map(path => [path, lstatSync(path)]));
  const guard = (path: string): true => {
    const parent = lstatSync(dirname(path)), file = lstatSync(path), initial = pinned.get(path);
    assert.ok(initial); assert.equal(realpathSync(path), path); assert.equal(file.ino, initial.ino); assert.equal(file.dev, initial.dev);
    assert.ok(file.isFile()); assert.equal(file.nlink, 1); assert.equal(file.uid, process.getuid?.()); assert.equal(file.mode & 0o777, 0o600);
    assert.ok(parent.isDirectory()); assert.equal(parent.uid, process.getuid?.()); assert.equal(parent.mode & 0o777, 0o700);
    for (const suffix of ["-wal", "-shm"]) if (existsSync(path + suffix)) {
      const side = lstatSync(path + suffix); assert.ok(side.isFile()); assert.equal(side.nlink, 1);
      assert.equal(side.uid, file.uid); assert.equal(side.mode & 0o777, 0o600);
    }
    return true;
  };
  ledger.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS policy(id TEXT PRIMARY KEY,digest TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reservations(id TEXT PRIMARY KEY,run TEXT,attempt INTEGER,policy TEXT,binding TEXT,state TEXT,expires INTEGER,UNIQUE(run,attempt));
    CREATE TABLE IF NOT EXISTS settlements(run TEXT PRIMARY KEY,usage TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS recovery_effects(task TEXT PRIMARY KEY);`);
  const store = createOperationalAuditStore({ auditDatabase: audit, recoveryDatabase: recovery,
    assertPrivateDatabase: guard, maxAuditEntries: 1000, maxRecoveryEntries: 1000, initialize: true });
  let opens = 0, closes = 0, closed = false, context: Parameters<OpenOperatorSuppliers>[0] | undefined;
  const calls = { reserve: 0, release: 0, reconcile: 0, start: 0, dispatch: 0, finish: 0 };
  const recoveryDrains = new Set<Promise<void>>();
  const count = (table: "reservations" | "settlements" | "policy" | "recovery_effects") => ledger.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()?.n ?? 0;
  // A separately opened recovery-only connection models independently owned supervisor access.
  const recover = async (options: { readonly signal?: AbortSignal } = {}) => {
    const db = new Database(paths.recovery);
    const recoveryStore = createOperationalAuditStore({ recoveryDatabase: db, recoveryOnly: true,
      assertPrivateDatabase: guard, maxAuditEntries: 1000, maxRecoveryEntries: 1000 });
    const independentLedger = new Database(paths.ledger);
    let raw: Promise<void> | undefined;
    try {
      // Independent ledger inspection also owns expired/lost reserve responses without an outbox row.
      independentLedger.query("UPDATE reservations SET state='unknown' WHERE state='reserved' AND expires<=?").run(Date.now());
      return await processOperationalRecovery(recoveryStore, task => {
        raw = (async () => {
          await holds.recovery?.(task);
          independentLedger.transaction(() => {
            const key = revision(task);
            if (independentLedger.query("SELECT 1 FROM recovery_effects WHERE task=?").get(key)) return;
            for (const row of task.reservations) independentLedger.query("UPDATE reservations SET state='unknown' WHERE id=? AND state='reserved'").run(row.approvalId);
            independentLedger.query("INSERT INTO recovery_effects VALUES(?)").run(key);
          }).immediate();
        })(); return raw;
      }, { leaseMs: 1000, retryDelayMs: 0, signal: options.signal ?? new AbortController().signal });
    } finally {
      const draining = (async () => { if (raw) await Promise.allSettled([raw]); recoveryStore.dispose(); db.close(); independentLedger.close(); })();
      recoveryDrains.add(draining); void draining.then(() => recoveryDrains.delete(draining), () => recoveryDrains.delete(draining));
    }
  };
  const open: OpenOperatorSuppliers = async supplied => {
    opens++; context = supplied;
    const bundle: OperatorSupplierBundle = {
      identity: { ledger: "TEST-ONLY-sqlite-quota-ledger", mode: "test-only", policyReference: supplied.configuration.budget.policyReference,
        auditDatabase: paths.audit, recoveryDatabase: paths.recovery, privateFileGuard: "TEST-ONLY-posix-inode-sidecar-guard",
        recoverySupervisor: "TEST-ONLY-independent-recovery-connection", retentionPolicy: "TEST-ONLY-retain-all-obligations", retentionOwner: "O-test-harness" },
      store: { ...store, appendAudit: async (event, signal) => { calls[event.phase]++; await holds.audit?.(event, signal); await store.appendAudit(event, signal); } },
      privateFileGuard: () => { for (const path of Object.values(paths)) guard(path); return true; },
      recoverySupervisor: { assertReady: async () => { const db = new Database(paths.recovery); try { assert.equal(db.query<{ quick_check: string }, []>("PRAGMA quick_check").get()?.quick_check, "ok"); } finally { db.close(); } } },
      retention: { assertReady: async () => { assert.equal(ledger.query("SELECT 1 FROM sqlite_master WHERE name='reservations'").all().length, 1); } },
      assertReady: async () => { for (const path of Object.values(paths)) guard(path); assert.equal(closed, false); },
      activatePolicy: async c => {
        await holds.activate?.();
        ledger.transaction(() => {
          const digest = revision(c), previous = ledger.query<{ digest: string }, [string]>("SELECT digest FROM policy WHERE id=?").get(c.approvalId);
          if (previous) assert.equal(previous.digest, digest, "approval cannot reset or change policy");
          else ledger.query("INSERT INTO policy VALUES(?,?)").run(c.approvalId, digest);
        }).immediate();
      },
      ledger: {
        reserve: async request => {
          calls.reserve++;
          const binding = supplied.binding(request.runId), c = binding.policy;
          // Reserve first, then hold acknowledgement to model lost/late responses.
          const permit = ledger.transaction(() => {
            const used = ledger.query<{ n: number }, [string]>("SELECT count(*) AS n FROM reservations WHERE policy=? AND state!='released'").get(c.approvalId)?.n ?? 0;
            if (used >= c.requestAllowance) return null;
            const active = ledger.query<{ n: number }, []>("SELECT count(DISTINCT run) AS n FROM reservations WHERE state IN ('reserved','unknown')").get()?.n ?? 0;
            if (active >= c.concurrentRuns) return null;
            const id = randomUUID();
            const expiresAt = Math.min(c.validUntil, Date.now() + c.permitLifetimeMs);
            ledger.query("INSERT INTO reservations VALUES(?,?,?,?,?,'reserved',?)").run(id, request.runId, request.attempt, c.approvalId, canonical(binding), expiresAt);
            return { approvalId: id, expiresAt };
          }).immediate();
          await holds.reserve?.(request); return permit;
        },
        release: async (row, signal) => { calls.release++; await holds.release?.(row, signal); ledger.query("UPDATE reservations SET state='released' WHERE id=? AND state='reserved'").run(row.approvalId); },
        reconcile: async (event, rows, signal) => {
          calls.reconcile++;
          await holds.reconcile?.(event, signal);
          ledger.transaction(() => {
            const previous = ledger.query<{ usage: string }, [string]>("SELECT usage FROM settlements WHERE run=?").get(event.runId);
            if (previous) { assert.equal(previous.usage, canonical(event.usage)); return; }
            ledger.query("INSERT INTO settlements VALUES(?,?)").run(event.runId, canonical(event.usage));
            for (const row of rows) ledger.query("UPDATE reservations SET state=? WHERE id=?").run(event.usage === null ? "unknown" : "consumed", row.approvalId);
          }).immediate();
        },
      },
      settled: async () => { await holds.settled?.(); },
      close: async () => { if (closed) return; closed = true; closes++; store.dispose(); audit.close(); recovery.close(); ledger.close(); },
    };
    return bundle;
  };
  return { open, paths, store, ledger, audit, recovery, count, recover, guard, calls, get opens() { return opens; }, get closes() { return closes; },
    async recoverySettled() { while (recoveryDrains.size) await Promise.all([...recoveryDrains]); },
    binding: (run: string) => context?.binding(run),
    dispose() { if (!closed) { closed = true; store.dispose(); audit.close(); recovery.close(); ledger.close(); } },
  };
}
