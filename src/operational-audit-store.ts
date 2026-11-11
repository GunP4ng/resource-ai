import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { revision } from "./o-validation.ts";
import type { OperationalAudit } from "./operations.ts";
import type { RecoveryTask } from "./operational-handoff.ts";

export class OperationalStorageError extends Error {
  constructor(readonly code: string) { super(`operational-storage:${code}`); }
}
const id = Type.String({ pattern: "^[A-Za-z0-9_.-]{1,128}$" });
const digest = Type.String({ pattern: "^[a-f0-9]{64}$" });
const integer = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const nullableId = Type.Union([id, Type.Null()]);
const usage = Type.Union([Type.Null(), Type.Object({ input: integer, output: integer, cacheRead: integer, cacheWrite: integer, total: integer }, { additionalProperties: false })]);
const auditSchema = Type.Object({ phase: Type.Union([Type.Literal("start"), Type.Literal("dispatch"), Type.Literal("finish")]),
  runId: id, caseRevision: digest, at: Type.String({ maxLength: 40 }), elapsedMs: Type.Number({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  outcome: Type.Optional(Type.Union(["success", "cancelled", "timeout", "authentication", "rate-limit", "provider", "not-configured", "invalid-model-output", "case-not-found", "case-busy", "capacity", "turn-limit"].map(value => Type.Literal(value)))),
  requests: Type.Array(Type.Object({ attempt: Type.Integer({ minimum: 1, maximum: 10 }), approvalId: id, transportStarted: Type.Boolean(),
    status: Type.Union([Type.Null(), Type.Integer({ minimum: 100, maximum: 599 })]), requestId: nullableId }, { additionalProperties: false }), { maxItems: 10 }),
  usage, images: Type.Array(Type.Object({ photoRefSha256: digest, sha256: digest,
    mimeType: Type.Union([Type.Literal("image/png"), Type.Literal("image/jpeg")]) }, { additionalProperties: false }), { maxItems: 5 }),
}, { additionalProperties: false });
const reservationSchema = Type.Object({ approvalId: id, expiresAt: integer, runId: id, caseRevision: digest,
  attempt: Type.Integer({ minimum: 1, maximum: 10 }) }, { additionalProperties: false });
const recoverySchema = Type.Object({ reason: Type.Union([Type.Literal("late-reservation"), Type.Literal("invalid-reservation"), Type.Literal("terminal-failure")]),
  reservations: Type.Array(reservationSchema, { maxItems: 10 }), event: Type.Union([auditSchema, Type.Null()]) }, { additionalProperties: false });
const auditSQL = `CREATE TABLE audit_events(event_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,phase TEXT NOT NULL,
 payload TEXT NOT NULL,payload_sha TEXT NOT NULL CHECK(length(payload_sha)=64)) STRICT`;
const recoverySQL = `CREATE TABLE recovery_tasks(task_id TEXT PRIMARY KEY CHECK(length(task_id)=64),payload TEXT NOT NULL,
 payload_sha TEXT NOT NULL CHECK(length(payload_sha)=64),state TEXT NOT NULL CHECK(state IN('pending','leased','done')),
 available_at INTEGER NOT NULL CHECK(available_at>=0),token TEXT,lease_until INTEGER,attempts INTEGER NOT NULL CHECK(attempts>=0),
 CHECK((state='leased' AND token IS NOT NULL AND lease_until IS NOT NULL) OR (state!='leased' AND token IS NULL AND lease_until IS NULL))) STRICT`;
const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
type Payload = { payload: string; payload_sha: string };
type Row = Payload & { task_id: string; state: string; available_at: number; token: string | null; lease_until: number | null; attempts: number };
export interface RecoveryLease { readonly id: string; readonly token: string; readonly leaseUntil: number; readonly attempts: number; readonly task: RecoveryTask }

/** Real file-backed SQLite audit + independent recovery outbox. No financial policy.
 * The caller owns both connections and must provision/guard private canonical files,
 * parent identity, owner/ACL, links and SQLite sidecars for the supported OS.
 * The synchronous private-file guard must return true after verification.
 * No file is opened implicitly, no memory fallback and no existing O schema is changed.
 * initialize is explicit and only accepts empty databases. FULL/WAL is mandatory.
 */
export function createOperationalAuditStore(options: {
  readonly auditDatabase?: Database; readonly recoveryDatabase: Database;
  readonly assertPrivateDatabase: (absolutePath: string) => true;
  readonly maxAuditEntries: number; readonly maxRecoveryEntries: number;
  readonly initialize?: boolean; readonly now?: () => number;
  /** Dedicated recovery worker can start even while the audit DB is unavailable. */
  readonly recoveryOnly?: boolean;
}) {
  const audit = options.auditDatabase, recovery = options.recoveryDatabase, now = options.now ?? Date.now;
  const maxAuditEntries = options.maxAuditEntries, maxRecoveryEntries = options.maxRecoveryEntries, assertPrivateDatabase = options.assertPrivateDatabase;
  let disposed = false, configured = false;
  const fail = (code: string): never => { throw new OperationalStorageError(code); };
  for (const limit of [maxAuditEntries, maxRecoveryEntries]) if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000_000) fail("invalid-capacity");
  const filename = (db: Database) => {
    const rows = db.query<{ name: string; file: string }, []>("PRAGMA database_list").all();
    const main = rows.find(row => row.name === "main");
    if (!main || !isAbsolute(main.file) || rows.some(row => row.name !== "main" && !(row.name === "temp" && row.file === ""))) return fail("file-database-required");
    // quick_check creates an empty SQLite temp schema. User temp objects could
    // shadow unqualified durable tables, so only the empty internal schema is allowed.
    if (rows.some(row => row.name === "temp") && db.query("SELECT 1 FROM sqlite_temp_master WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get()) fail("temporary-schema-unverified");
    return main.file;
  };
  const auditPath = options.recoveryOnly ? null : filename(audit ?? fail("audit-database-required")), recoveryPath = filename(recovery);
  if (auditPath === recoveryPath) fail("independent-recovery-required");
  const check = (db: Database, path: string) => {
    if (disposed) fail("closed");
    if (filename(db) !== path) fail("database-changed");
    if (assertPrivateDatabase(path) !== true) fail("private-store-unverified");
    if (configured && (db.query<{ synchronous: number }, []>("PRAGMA synchronous").get()?.synchronous !== 2
      || db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode !== "wal")) fail("durability-required");
  };
  const time = () => { const value = now(); if (!Number.isSafeInteger(value) || value < 0) return fail("invalid-clock"); return value; };
  const checked = <T>(db: Database, path: string, work: () => T): T => {
    try { check(db, path); return work(); } catch (error) { if (error instanceof OperationalStorageError) throw error; return fail("unavailable"); }
  };
  const configure = (db: Database, schema: string) => {
    db.exec("PRAGMA busy_timeout=0; PRAGMA synchronous=FULL;");
    if (db.query<{ journal_mode: string }, []>("PRAGMA journal_mode=WAL").get()?.journal_mode !== "wal") fail("durability-required");
    const tables = () => db.query<{ sql: string }, []>("SELECT sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY sql").all();
    const version = () => db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version;
    if (options.initialize && version() === 0 && !tables().length) db.transaction(() => { db.exec(schema); db.exec("PRAGMA user_version=1"); }).immediate();
    if (version() !== 1 || JSON.stringify(tables().map(row => normalize(row.sql))) !== JSON.stringify([normalize(schema)])
      || db.query<{ quick_check: string }, []>("PRAGMA quick_check").get()?.quick_check !== "ok") fail("schema-unverified");
  };
  checked(recovery, recoveryPath, () => { if (audit && auditPath) { check(audit, auditPath); configure(audit, auditSQL); } configure(recovery, recoverySQL); configured = true; });
  const requireAudit = () => { if (!audit || !auditPath) return fail("audit-disabled"); return { database: audit, path: auditPath }; };
  const validateAudit = (value: unknown): OperationalAudit => {
    if (!Value.Check(auditSchema, value)) return fail("invalid-audit");
    const event = value as OperationalAudit;
    if (!Number.isFinite(Date.parse(event.at)) || new Date(event.at).toISOString() !== event.at
      || (event.phase === "finish") !== (event.outcome !== undefined)
      || event.requests.some((row, index) => row.attempt !== index + 1)
      || (event.phase === "dispatch" && !event.requests.length)) return fail("invalid-audit");
    // approvalId may name a policy shared by multiple requests. Event identity
    // is run/phase/attempt; recording evidence must not invent reservation rules.
    return event;
  };
  const validateTask = (value: unknown): RecoveryTask => {
    if (!Value.Check(recoverySchema, value)) return fail("invalid-recovery");
    const task = value as RecoveryTask, first = task.reservations[0];
    if (!first && !task.event) return fail("invalid-recovery");
    if (task.event) { validateAudit(task.event); if (task.event.phase !== "finish") return fail("invalid-recovery"); }
    const runId = task.event?.runId ?? first!.runId, caseRevision = task.event?.caseRevision ?? first!.caseRevision;
    if (task.reservations.some(row => row.runId !== runId || row.caseRevision !== caseRevision)) return fail("invalid-recovery");
    return task;
  };
  const encode = (value: unknown) => { const payload = JSON.stringify(value); if (Buffer.byteLength(payload) > 131072) return fail("entry-limit"); return { payload, payload_sha: revision(value) }; };
  const decode = (row: Payload) => { const value: unknown = JSON.parse(row.payload); if (revision(value) !== row.payload_sha) return fail("hash-mismatch"); return value; };
  const capacity = (db: Database, table: "audit_events" | "recovery_tasks", max: number) => {
    if ((db.query<{ count: number }, []>(`SELECT count(*) AS count FROM ${table}`).get()?.count ?? max) >= max) fail("capacity");
  };
  return {
    async appendAudit(event: OperationalAudit, signal?: AbortSignal): Promise<void> {
      const { database: audit, path: auditPath } = requireAudit();
      checked(audit, auditPath, () => {
        if (signal?.aborted) fail("cancelled"); const value = validateAudit(structuredClone(event)), encoded = encode(value);
        const key = `${value.runId}:${value.phase}:${value.phase === "dispatch" ? value.requests.at(-1)!.attempt : 0}`;
        audit.transaction(() => {
          check(audit, auditPath); if (signal?.aborted) fail("cancelled");
          const existing = audit.query<Payload, [string]>("SELECT payload,payload_sha FROM audit_events WHERE event_id=?").get(key);
          if (existing) { decode(existing); if (existing.payload_sha !== encoded.payload_sha) fail("audit-conflict"); return; }
          if (value.phase !== "start") {
            const start = audit.query<Payload, [string]>("SELECT payload,payload_sha FROM audit_events WHERE event_id=?").get(`${value.runId}:start:0`);
            if (!start) fail("start-required");
            const initial = validateAudit(decode(start!));
            if (initial.runId !== value.runId || initial.caseRevision !== value.caseRevision) fail("start-required");
          }
          if (audit.query("SELECT 1 FROM audit_events WHERE event_id=?").get(`${value.runId}:finish:0`)) fail("already-finished");
          capacity(audit, "audit_events", maxAuditEntries);
          audit.query("INSERT INTO audit_events VALUES(?,?,?,?,?)").run(key, value.runId, value.phase, encoded.payload, encoded.payload_sha);
        }).immediate();
      });
    },
    enqueueRecovery(task: RecoveryTask): true {
      return checked(recovery, recoveryPath, () => {
        const value = validateTask(structuredClone(task)), encoded = encode(value), key = encoded.payload_sha;
        recovery.transaction(() => {
          check(recovery, recoveryPath);
          const old = recovery.query<Payload, [string]>("SELECT payload,payload_sha FROM recovery_tasks WHERE task_id=?").get(key);
          if (old) { decode(old); return; }
          capacity(recovery, "recovery_tasks", maxRecoveryEntries);
          recovery.query("INSERT INTO recovery_tasks VALUES(?,?,?,'pending',?,NULL,NULL,0)").run(key, encoded.payload, encoded.payload_sha, time());
        }).immediate();
        return true as const;
      });
    },
    readAudit(runId: string): readonly OperationalAudit[] {
      const { database: audit, path: auditPath } = requireAudit();
      return checked(audit, auditPath, () => audit.query<Payload & { event_id: string; run_id: string; phase: string }, [string]>("SELECT * FROM audit_events WHERE run_id=? ORDER BY rowid").all(runId).map(row => {
        const value = validateAudit(decode(row));
        const key = `${value.runId}:${value.phase}:${value.phase === "dispatch" ? value.requests.at(-1)!.attempt : 0}`;
        if (value.runId !== runId || row.run_id !== value.runId || row.phase !== value.phase || row.event_id !== key) fail("audit-routing-mismatch");
        return value;
      }));
    },
    claimRecovery(leaseMs: number, signal?: AbortSignal): RecoveryLease | null {
      return checked(recovery, recoveryPath, () => {
        if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 60000) return fail("invalid-lease");
        return recovery.transaction(() => {
          check(recovery, recoveryPath); if (signal?.aborted) return fail("cancelled"); const at = time();
          const row = recovery.query<Row, [number, number]>("SELECT * FROM recovery_tasks WHERE (state='pending' AND available_at<=?) OR (state='leased' AND lease_until<=?) ORDER BY available_at,task_id LIMIT 1").get(at, at);
          if (!row) return null;
          const task = validateTask(decode(row));
          if (row.payload_sha !== row.task_id || !Number.isSafeInteger(row.attempts) || row.attempts < 0 || row.attempts >= Number.MAX_SAFE_INTEGER
            || !Number.isSafeInteger(row.available_at) || at + leaseMs > Number.MAX_SAFE_INTEGER) return fail("invalid-recovery");
          const token = randomUUID(), leaseUntil = at + leaseMs;
          recovery.query("UPDATE recovery_tasks SET state='leased',token=?,lease_until=?,attempts=attempts+1 WHERE task_id=?").run(token, leaseUntil, row.task_id);
          return { id: row.task_id, token, leaseUntil, attempts: row.attempts + 1, task };
        }).immediate();
      });
    },
    completeRecovery(id: string, token: string): boolean {
      return checked(recovery, recoveryPath, () => recovery.transaction(() => { check(recovery, recoveryPath); return recovery.query("UPDATE recovery_tasks SET state='done',token=NULL,lease_until=NULL WHERE task_id=? AND state='leased' AND token=? AND lease_until>?").run(id, token, time()).changes === 1; }).immediate());
    },
    retryRecovery(id: string, token: string, delayMs: number): boolean {
      return checked(recovery, recoveryPath, () => {
        if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 3600000) return fail("invalid-delay");
        const at = time(); if (at + delayMs > Number.MAX_SAFE_INTEGER) return fail("invalid-clock");
        return recovery.transaction(() => { check(recovery, recoveryPath); return recovery.query("UPDATE recovery_tasks SET state='pending',available_at=?,token=NULL,lease_until=NULL WHERE task_id=? AND state='leased' AND token=? AND lease_until>?").run(at + delayMs, id, token, at).changes === 1; }).immediate();
      });
    },
    /** Caller must drain work before disposing, then close its owned connections. */
    dispose() { disposed = true; },
  };
}

/** One bounded, at-least-once recovery attempt, outside the HTTP request budget.
 * The operator's handler MUST be idempotent and inspect the reservation ledger;
 * late completion/unknown usage never proves zero charge or permits blind refund.
 */
export async function processOperationalRecovery(store: ReturnType<typeof createOperationalAuditStore>,
  handler: (task: RecoveryTask, signal: AbortSignal) => Promise<void>, options: {
    readonly leaseMs: number; readonly retryDelayMs: number; readonly signal: AbortSignal;
  }): Promise<{ state: "empty" | "completed" | "retry-pending" | "lease-lost"; taskId?: string; reason?: "cancelled" | "lease-expired" | "handler-failed" }> {
  if (!Number.isSafeInteger(options.retryDelayMs) || options.retryDelayMs < 0 || options.retryDelayMs > 3600000) throw new OperationalStorageError("invalid-delay");
  const lease = store.claimRecovery(options.leaseMs, options.signal);
  if (!lease) return { state: "empty" };
  const controller = new AbortController(); let reason: "cancelled" | "lease-expired" | "handler-failed" = "handler-failed";
  let reject!: (error: Error) => void;
  const interrupted = new Promise<never>((_resolve, no) => { reject = no; });
  const stop = (cause: "cancelled" | "lease-expired") => { reason = cause; controller.abort(); reject(new OperationalStorageError(cause)); };
  const cancel = () => stop("cancelled");
  options.signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => stop("lease-expired"), options.leaseMs);
  if (options.signal.aborted) cancel();
  try {
    const work = async () => { controller.signal.throwIfAborted(); await handler(structuredClone(lease.task), controller.signal); controller.signal.throwIfAborted(); };
    await Promise.race([interrupted, work()]);
    return { state: store.completeRecovery(lease.id, lease.token) ? "completed" : "lease-lost", taskId: lease.id };
  } catch {
    return { state: store.retryRecovery(lease.id, lease.token, options.retryDelayMs) ? "retry-pending" : "lease-lost", taskId: lease.id, reason };
  } finally { clearTimeout(timer); options.signal.removeEventListener("abort", cancel); controller.abort(); }
}
