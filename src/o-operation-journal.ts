import { createHash } from "node:crypto";
import { zstdDecompressSync } from "node:zlib";
import type { FetchFunction } from "@earendil-works/pi-ai";
import type { DispatchRequest, OperationalAudit } from "./operations.ts";
import type { OperationBinding } from "./o-case-store.ts";
import { parseOperationalConfiguration, type OperationalConfiguration } from "./o-operations-config.ts";
import { canonical, revision } from "./o-validation.ts";
import { openOperationStorage, OperationJournalError } from "./o-operation-storage.ts";
import { checkOperationalAudit, validateOperationRows } from "./o-operation-validation.ts";

type Attempt = Readonly<{ run: string; attempt: number; request: string; expires: number; state: "reserved" | "dispatch" | "unresolved" | "consumed" | "released"; payload: string | null; response: string | null }>;
type Run = Readonly<{ id: string; approval: string; binding: string; terminal: string | null }>;
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const sanitizedBinding = (b: OperationBinding) => canonical({ leaseSha256: sha(b.leaseToken), actorSha256: sha(b.actorId), caseId: b.caseId, inputRevision: b.inputRevision, artifact: b.artifact });
const policyMetadata = (c: Readonly<OperationalConfiguration>) => {
  const { authPath: _auth, ...target } = c.target;
  return canonical({ target, purposeSha256: sha(c.purpose), validFrom: c.validFrom, validUntil: c.validUntil,
    requestAllowance: c.requestAllowance, concurrentRuns: c.concurrentRuns,
    grants: c.grants.map(g => ({ actorSha256: sha(g.actorId), caseId: g.caseId, inputRevision: g.inputRevision, artifactSha256: g.artifactSha256 })) });
};
/** No headers, raw case content, credentials, provider bodies or photo bytes enter SQLite. */
function payloadEvidence(init: RequestInit) {
  const bytes = typeof init.body === "string" ? Buffer.from(init.body) : init.body instanceof ArrayBuffer ? Buffer.from(init.body)
    : ArrayBuffer.isView(init.body) ? Buffer.from(init.body.buffer, init.body.byteOffset, init.body.byteLength) : null;
  if (!bytes || bytes.length > 67108864) throw new OperationJournalError();
  const encoding = new Headers(init.headers).get("content-encoding");
  if (encoding && encoding !== "zstd") throw new OperationJournalError();
  const body: unknown = JSON.parse((encoding ? zstdDecompressSync(bytes, { maxOutputLength: 67108864 }) : bytes).toString("utf8"));
  const photos: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { for (const child of value) visit(child); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "image_url") {
        if (typeof child !== "string" || !/^data:image\/(png|jpeg);base64,/.test(child)) throw new OperationJournalError();
        const encoded = child.slice(child.indexOf(",") + 1), image = Buffer.from(encoded, "base64");
        if (image.toString("base64") !== encoded) throw new OperationJournalError();
        photos.push(sha(image));
      } else visit(child);
    }
  };
  visit(body);
  if (photos.length > 5) throw new OperationJournalError();
  return canonical({ outboundSha256: sha(bytes), intendedPhotoSha256: photos });
}

export async function openOperationJournal(options: { readonly stateRoot: string; readonly configuration: Readonly<OperationalConfiguration>; readonly currentOperation: () => OperationBinding }) {
  let c = parseOperationalConfiguration(options.configuration);
  const storage = openOperationStorage(options.stateRoot), { db } = storage;
  const continuations = new Set<Promise<unknown>>();
  const inFlightRuns = new Set<string>();
  const run = (id: string) => db.query<Run, [string]>("SELECT * FROM runs WHERE id=?").get(id);
  const attempt = (id: string, n: number) => db.query<Attempt, [string, number]>("SELECT * FROM attempts WHERE run=? AND attempt=?").get(id, n);
  const atomic = <T>(work: () => T): T => {
    storage.assertReady(); return db.transaction(() => { const result = work(); storage.assertReady(); return result; }).immediate();
  };
  const capacity = () => {
    const count = db.query<{ total: number }, []>("SELECT (SELECT count(*) FROM policy)+(SELECT count(*) FROM runs)+(SELECT count(*) FROM attempts)+(SELECT count(*) FROM events) AS total").get();
    if (!count || count.total >= c.journalCapacity) throw new OperationJournalError();
  };
  const live = (captured?: Run, signal?: AbortSignal) => {
    signal?.throwIfAborted(); const binding = options.currentOperation();
    if (captured && captured.binding !== sanitizedBinding(binding)) throw new OperationJournalError();
    if (Date.now() < c.validFrom || Date.now() >= c.validUntil || !c.grants.some(g => g.actorId === binding.actorId && g.caseId === binding.caseId
      && g.inputRevision === binding.inputRevision && g.artifactSha256 === (binding.artifact?.hash ?? null))) throw new OperationJournalError();
    return binding;
  };
  try {
    atomic(() => {
      validateOperationRows(db, c.journalCapacity);
      const digest = revision(c), policy = db.query<{ digest: string }, [string]>("SELECT digest FROM policy WHERE approval=?").get(c.approvalId);
      if (policy && policy.digest !== digest) throw new OperationJournalError();
      if (!policy) { capacity(); db.query("INSERT INTO policy VALUES(?,?,?)").run(c.approvalId, digest, policyMetadata(c)); }
      // Lock is already held: no other live process can own these attempts.
      db.exec("UPDATE attempts SET state='released' WHERE state IN('reserved','dispatch'); UPDATE runs SET terminal='recovered' WHERE terminal IS NULL;");
    });
  } catch (error) { storage.close(); throw error; }
  const record = async (event: OperationalAudit, signal?: AbortSignal) => {
    checkOperationalAudit(event);
    atomic(() => {
      const key = event.phase === "dispatch" ? `dispatch:${event.requests.at(-1)?.attempt ?? 0}` : event.phase;
      const value = canonical(event), previous = db.query<{ value: string }, [string, string]>("SELECT value FROM events WHERE run=? AND key=?").get(event.runId, key);
      if (previous) { if (previous.value !== value) throw new OperationJournalError(); return; }
      if (Buffer.byteLength(value) > 65536 || !/^[A-Za-z0-9_.-]{1,128}$/.test(event.runId)) throw new OperationJournalError();
      let captured = run(event.runId);
      if (event.phase === "start") {
        const binding = live(undefined, signal);
        if (captured || binding.inputRevision !== event.caseRevision) throw new OperationJournalError();
        const active = new Set([...db.query<{ id: string }, []>("SELECT id FROM runs WHERE terminal IS NULL").all().map(r => r.id), ...inFlightRuns]);
        if (active.size >= c.concurrentRuns || db.query("SELECT 1 FROM runs WHERE binding=? AND terminal IS NULL").get(sanitizedBinding(binding))) throw new OperationJournalError();
        capacity(); db.query("INSERT INTO runs(id,approval,binding) VALUES(?,?,?)").run(event.runId, c.approvalId, sanitizedBinding(binding));
        captured = run(event.runId);
      }
      if (!captured || captured.approval !== c.approvalId || (event.phase !== "start" && captured.terminal !== null)) throw new OperationJournalError();
      if (event.caseRevision !== JSON.parse(captured.binding)["inputRevision"]
        || event.requests.some(r => r.approvalId !== captured.approval || !attempt(event.runId, r.attempt))) throw new OperationJournalError();
      if (event.phase === "dispatch") {
        live(captured, signal);
        const request = event.requests.at(-1), reserved = request && attempt(event.runId, request.attempt);
        if (!reserved || reserved.state !== "reserved" || request.approvalId !== c.approvalId) throw new OperationJournalError();
        db.query("UPDATE attempts SET state='dispatch' WHERE run=? AND attempt=?").run(event.runId, reserved.attempt);
      }
      capacity(); db.query("INSERT INTO events VALUES(?,?,?)").run(event.runId, key, value);
      if (event.phase === "finish") {
        // Terminal evidence uses the captured binding even after identity or lease revocation.
        db.query("UPDATE runs SET terminal=? WHERE id=?").run(value, event.runId);
        db.query("UPDATE attempts SET state='released' WHERE run=? AND state IN('reserved','dispatch')").run(event.runId);
      }
    });
  };
  const authorizeDispatch = async (request: DispatchRequest, signal: AbortSignal) => atomic(() => {
    const captured = run(request.runId);
    if (!captured || captured.terminal !== null || captured.approval !== c.approvalId) throw new OperationJournalError();
    live(captured, signal);
    if (request.caseRevision !== JSON.parse(captured.binding)["inputRevision"] || request.endpoint !== c.target.endpoint || request.provider !== c.target.provider
      || request.modelId !== c.target.modelId || request.deployment !== "" || request.outputLimitEnforced !== false || request.maxOutputTokens !== c.maxOutputTokens
      || !Number.isInteger(request.attempt) || request.attempt < 1 || request.attempt > c.maxTurns) throw new OperationJournalError();
    const serialized = canonical(request), previous = attempt(request.runId, request.attempt);
    if (previous) {
      if (previous.request !== serialized || previous.state !== "reserved" || previous.expires <= Date.now()) throw new OperationJournalError();
      return { approvalId: c.approvalId, expiresAt: previous.expires };
    }
    if (db.query("SELECT 1 FROM attempts WHERE run=? AND state IN('reserved','dispatch','unresolved')").get(request.runId)) throw new OperationJournalError();
    const n = db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM attempts a JOIN runs r ON a.run=r.id WHERE r.approval=? AND a.state!='released'").get(c.approvalId)?.n ?? c.requestAllowance;
    if (n >= c.requestAllowance) throw new OperationJournalError();
    capacity(); const expires = Math.min(Date.now() + c.permitLifetimeMs, c.validUntil);
    db.query("INSERT INTO attempts(run,attempt,request,expires,state) VALUES(?,?,?,?,'reserved')").run(request.runId, request.attempt, serialized, expires);
    return { approvalId: c.approvalId, expiresAt: expires };
  });
  const wrapTransport = (transport: FetchFunction): FetchFunction => (url, init) => {
    const work = async () => {
      const binding = sanitizedBinding(options.currentOperation());
      const candidates = db.query<Attempt, [string, string]>("SELECT a.* FROM attempts a JOIN runs r ON r.id=a.run WHERE r.binding=? AND r.approval=? AND r.terminal IS NULL AND a.state='dispatch'").all(binding, c.approvalId);
      const row = candidates[0];
      if (candidates.length !== 1 || !row || !init) throw new OperationJournalError();
      const captured = run(row.run);
      if (!captured) throw new OperationJournalError();
      const check = () => {
        live(captured, init.signal ?? undefined);
        if (row.expires <= Date.now() || String(url) !== c.target.endpoint) throw new OperationJournalError();
      };
      check(); const payload = payloadEvidence(init);
      atomic(() => {
        check();
        if (attempt(row.run, row.attempt)?.state !== "dispatch") throw new OperationJournalError();
        db.query("UPDATE attempts SET state='unresolved',payload=? WHERE run=? AND attempt=?").run(payload, row.run, row.attempt);
      });
      // No await between final guard, durable intent and invocation.
      try { check(); }
      catch (error) {
        // This frame proves the underlying transport has not been invoked. A failed
        // release write still leaves durable uncertainty rather than granting a refund.
        atomic(() => db.query("UPDATE attempts SET state='released' WHERE run=? AND attempt=? AND state='unresolved'").run(row.run, row.attempt));
        throw error;
      }
      inFlightRuns.add(row.run);
      try {
        const response = await transport(url, init);
        const id = response.headers.get("x-request-id") ?? response.headers.get("apim-request-id");
        atomic(() => db.query("UPDATE attempts SET state=?,response=? WHERE run=? AND attempt=?").run(response.ok ? "consumed" : "unresolved",
          canonical({ status: response.status, requestId: id && /^[A-Za-z0-9_-]{1,100}$/.test(id) ? id : null }), row.run, row.attempt));
        return response;
      } finally { inFlightRuns.delete(row.run); }
    };
    const pending = work(); continuations.add(pending);
    void pending.then(() => continuations.delete(pending), () => continuations.delete(pending)); return pending;
  };
  const settled = async () => { while (continuations.size) await Promise.allSettled([...continuations]); };
  return { authorizeDispatch, record, wrapTransport,
    reconfigure(configuration: Readonly<OperationalConfiguration>) {
      const next = parseOperationalConfiguration(configuration);
      const fixed = (value: Readonly<OperationalConfiguration>) => {
        const { approvalId: _approval, validFrom: _from, validUntil: _until, grants: _grants, ...rest } = value; return canonical(rest);
      };
      if (fixed(c) !== fixed(next) || continuations.size) throw new OperationJournalError();
      atomic(() => {
        if (db.query("SELECT 1 FROM runs WHERE terminal IS NULL").get()) throw new OperationJournalError();
        const digest = revision(next), previous = db.query<{ digest: string }, [string]>("SELECT digest FROM policy WHERE approval=?").get(next.approvalId);
        if (previous && previous.digest !== digest) throw new OperationJournalError();
        if (!previous) { capacity(); db.query("INSERT INTO policy VALUES(?,?,?)").run(next.approvalId, digest, policyMetadata(next)); }
      });
      c = next;
    },
    inspectPending(limit = 100) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new OperationJournalError(); storage.assertReady();
      return db.query<{ run: string; attempt: number; state: string; binding: string; payload: string | null; response: string | null }, [number]>(
        "SELECT a.run,a.attempt,a.state,r.binding,a.payload,a.response FROM attempts a JOIN runs r ON r.id=a.run WHERE a.state IN('reserved','dispatch','unresolved') ORDER BY a.run,a.attempt LIMIT ?").all(limit);
    }, settled,
    async close() { await settled(); storage.close(); },
  };
}
