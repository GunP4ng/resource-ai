import { openOperationStorage, OperationJournalError } from "../src/o-operation-storage.ts";
import { checkOperationBinding, checkOperationalAudit, checkOperationPolicy, checkTransportEvidence } from "../src/o-operation-validation.ts";

/** Offline, exclusive, bounded inspection. Opening here does not run recovery. */
export function inspectOperationJournal(stateRoot: string, limit = 100, afterRun = "", afterAttempt = 0) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(afterAttempt) || afterAttempt < 0
    || afterRun !== "" && !/^[A-Za-z0-9_.-]{1,128}$/.test(afterRun)) throw new OperationJournalError();
  const storage = openOperationStorage(stateRoot, true);
  try {
    storage.assertReady();
    const rows = storage.db.query<{ run: string; approval: string; policy: string; binding: string; terminal: string | null; attempt: number; state: string; payload: string | null; response: string | null }, [string, number, number]>(
      `SELECT r.id AS run,r.approval,p.metadata AS policy,r.binding,r.terminal,coalesce(a.attempt,0) AS attempt,coalesce(a.state,'no-attempt') AS state,a.payload,a.response
       FROM runs r JOIN policy p ON p.approval=r.approval LEFT JOIN attempts a ON a.run=r.id WHERE (r.id,coalesce(a.attempt,0))>(?,?) ORDER BY r.id,coalesce(a.attempt,0) LIMIT ?`).all(afterRun, afterAttempt, limit);
    for (const row of rows) {
      if (!/^[A-Za-z0-9_.-]{1,128}$/.test(row.run) || !/^[A-Za-z0-9_.-]{1,128}$/.test(row.approval)) throw new OperationJournalError();
      checkOperationBinding(JSON.parse(row.binding));
      checkOperationPolicy(JSON.parse(row.policy));
      if (row.terminal && row.terminal !== "recovered") checkOperationalAudit(JSON.parse(row.terminal));
      checkTransportEvidence(row.payload, "payload"); checkTransportEvidence(row.response, "response");
    }
    return rows;
  } finally { storage.close(); }
}
if (import.meta.main) {
  try {
    const args = process.argv.slice(2), values = new Map<string, string>();
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i], value = args[i + 1];
      if (!key || !["--state-dir", "--limit", "--after-run", "--after-attempt"].includes(key) || !value || values.has(key)) throw new OperationJournalError();
      values.set(key, value);
    }
    const state = values.get("--state-dir"); if (!state) throw new OperationJournalError();
    console.log(JSON.stringify(inspectOperationJournal(state, Number(values.get("--limit") ?? 100), values.get("--after-run") ?? "", Number(values.get("--after-attempt") ?? 0))));
  } catch { console.error("Operation journal unavailable; stop the runtime and check private paths and inspection arguments."); process.exitCode = 1; }
}
