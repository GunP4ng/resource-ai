import { Type } from "typebox";
import { Value } from "typebox/value";
import type { Database } from "bun:sqlite";
import { OperationJournalError } from "./o-operation-storage.ts";
import { SUBSCRIPTION_ENDPOINT, SIWC_ENDPOINT, subscriptionEndpoint } from "./subscription-configuration.ts";

const strict = { additionalProperties: false } as const;
const id = Type.String({ pattern: "^[A-Za-z0-9_.-]{1,128}$" }), hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const integer = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const usage = Type.Union([Type.Null(), Type.Object({ input: integer, output: integer, cacheRead: integer, cacheWrite: integer, total: integer }, strict)]);
const binding = Type.Object({ leaseSha256: hash, actorSha256: hash, caseId: id, inputRevision: hash,
  artifact: Type.Union([Type.Null(), Type.Object({ hash, origin: Type.Union([Type.Literal("synthetic"), Type.Literal("field")]) }, strict)]) }, strict);
const audit = Type.Object({ phase: Type.Union([Type.Literal("start"), Type.Literal("dispatch"), Type.Literal("finish")]), runId: id, caseRevision: hash,
  at: Type.String({ maxLength: 30 }), elapsedMs: Type.Number({ minimum: 0 }), outcome: Type.Optional(Type.Union(["success", "not-configured", "provider", "timeout", "cancelled", "turn-limit", "authentication", "rate-limit", "invalid-model-output", "case-not-found", "case-busy", "capacity"].map(v => Type.Literal(v)))),
  requests: Type.Array(Type.Object({ attempt: Type.Integer({ minimum: 1, maximum: 10 }), approvalId: id, transportStarted: Type.Boolean(),
    status: Type.Union([Type.Null(), Type.Integer({ minimum: 100, maximum: 599 })]), requestId: Type.Union([Type.Null(), id]) }, strict), { maxItems: 10 }),
  usage, images: Type.Array(Type.Object({ photoRefSha256: hash, sha256: hash, mimeType: Type.String({ pattern: "^image/(png|jpeg)$" }) }, strict), { maxItems: 5 }),
}, strict);
export function checkOperationBinding(value: unknown) {
  if (!Value.Check(binding, value)) throw new OperationJournalError(); return value;
}
const payload = Type.Object({ outboundSha256: hash, intendedPhotoSha256: Type.Array(hash, { maxItems: 5 }) }, strict);
const response = Type.Object({ status: Type.Integer({ minimum: 100, maximum: 599 }), requestId: Type.Union([id, Type.Null()]) }, strict);
const endpoint = Type.Union([Type.Literal(SUBSCRIPTION_ENDPOINT), Type.Literal(SIWC_ENDPOINT)]);
const dispatch = Type.Object({ runId: id, caseRevision: hash, endpoint, deployment: Type.Literal(""), modelId: id,
  attempt: Type.Integer({ minimum: 1, maximum: 10 }), maxOutputTokens: Type.Integer({ minimum: 16, maximum: 8192 }),
  provider: Type.Literal("chatgpt-subscription"), outputLimitEnforced: Type.Literal(false) }, strict);
const policy = Type.Object({ target: Type.Object({ provider: Type.Literal("chatgpt-subscription"), endpoint, modelId: id, accountIdSha256: hash,
  route: Type.Optional(Type.Union([Type.Literal("codex"), Type.Literal("siwc")])), credentialSlot: Type.Optional(id) }, strict),
  purposeSha256: hash, validFrom: integer, validUntil: integer, requestAllowance: Type.Integer({ minimum: 1, maximum: 1000000 }), concurrentRuns: Type.Integer({ minimum: 1, maximum: 100 }),
  grants: Type.Array(Type.Object({ actorSha256: hash, caseId: id, inputRevision: hash, artifactSha256: Type.Union([hash, Type.Null()]) }, strict), { minItems: 1, maxItems: 100 }) }, strict);
export function checkOperationPolicy(value: unknown) { if (!Value.Check(policy, value) || value.target.endpoint !== subscriptionEndpoint(value.target)) throw new OperationJournalError(); return value; }
export function checkTransportEvidence(value: string | null, kind: "payload" | "response") {
  if (value !== null && !Value.Check(kind === "payload" ? payload : response, JSON.parse(value))) throw new OperationJournalError();
}
export function checkOperationalAudit(value: unknown) {
  if (!Value.Check(audit, value) || !Number.isFinite(Date.parse(value.at))) throw new OperationJournalError();
  return value;
}
/** Validate retained rows before recovery mutates anything; unknown/malformed state is never reset. */
export function validateOperationRows(db: Database, capacity: number) {
  const count = db.query<{ n: number }, []>("SELECT (SELECT count(*) FROM policy)+(SELECT count(*) FROM runs)+(SELECT count(*) FROM attempts)+(SELECT count(*) FROM events) AS n").get();
  if (!count || count.n > capacity) throw new OperationJournalError();
  for (const row of db.query<{ approval: string; digest: string; metadata: string }, []>("SELECT * FROM policy").iterate()) {
    if (!Value.Check(id, row.approval) || !Value.Check(hash, row.digest)) throw new OperationJournalError();
    checkOperationPolicy(JSON.parse(row.metadata));
  }
  for (const row of db.query<{ id: string; binding: string; terminal: string | null }, []>("SELECT * FROM runs").iterate()) {
    if (!Value.Check(id, row.id) || !Value.Check(binding, JSON.parse(row.binding))) throw new OperationJournalError();
    if (row.terminal !== null && row.terminal !== "recovered") {
      const terminal = checkOperationalAudit(JSON.parse(row.terminal));
      if (terminal.runId !== row.id || terminal.phase !== "finish") throw new OperationJournalError();
    }
  }
  for (const row of db.query<{ run: string; key: string; value: string }, []>("SELECT * FROM events").iterate()) {
    if (Buffer.byteLength(row.value) > 65536) throw new OperationJournalError();
    const value = checkOperationalAudit(JSON.parse(row.value));
    if (value.runId !== row.run || row.key !== (value.phase === "dispatch" ? `dispatch:${value.requests.at(-1)?.attempt ?? 0}` : value.phase)) throw new OperationJournalError();
  }
  for (const row of db.query<{ run: string; expires: number; attempt: number; request: string; payload: string | null; response: string | null; state: string }, []>("SELECT * FROM attempts").iterate()) {
    const request: unknown = JSON.parse(row.request);
    if (!Number.isSafeInteger(row.expires) || row.expires < 1 || !Value.Check(dispatch, request)
      || request.attempt !== row.attempt || request.runId !== row.run) throw new OperationJournalError();
    checkTransportEvidence(row.payload, "payload"); checkTransportEvidence(row.response, "response");
    if (["unresolved", "consumed"].includes(row.state) && row.payload === null || row.state === "consumed" && row.response === null) throw new OperationJournalError();
  }
}
