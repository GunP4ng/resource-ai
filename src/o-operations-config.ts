import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { CASE_LEASE_MS } from "./o-case-store.ts";
import { SUBSCRIPTION_ENDPOINT, SIWC_ENDPOINT, subscriptionEndpoint } from "./subscription-configuration.ts";

export class OperationalConfigurationError extends Error {
  constructor() { super("invalid-operational-configuration"); this.name = "OperationalConfigurationError"; }
}
const strict = { additionalProperties: false } as const;
const id = Type.String({ pattern: "^[A-Za-z0-9_.-]{1,128}$" });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const integer = (minimum: number, maximum = Number.MAX_SAFE_INTEGER) => Type.Integer({ minimum, maximum });
const scope = Type.Object({ provider: Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" }), purpose: Type.String({ minLength: 1, maxLength: 500, pattern: "\\S" }) }, strict);
const target = Type.Object({ provider: Type.Literal("chatgpt-subscription"), endpoint: Type.Union([Type.Literal(SUBSCRIPTION_ENDPOINT), Type.Literal(SIWC_ENDPOINT)]), modelId: id, accountIdSha256: hash }, strict);
const execution = {
  approvalId: id, validFrom: integer(0), validUntil: integer(1),
  grants: Type.Array(Type.Object({ actorId: Type.String({ pattern: "^[A-Za-z0-9_-]{1,100}$" }), caseId: Type.String({ pattern: "^[A-Za-z0-9_-]{1,100}$" }),
    inputRevision: hash, artifactSha256: Type.Union([hash, Type.Null()]) }, strict), { minItems: 1, maxItems: 100 }),
  target: Type.Object({ ...target.properties, authPath: Type.String({ minLength: 1, maxLength: 4096 }),
    route: Type.Optional(Type.Union([Type.Literal("codex"), Type.Literal("siwc")])), credentialSlot: Type.Optional(id) }, strict),
  purpose: scope.properties.purpose,
  photos: Type.Object({ enabled: Type.Boolean(), mappings: Type.Array(Type.Object({ target, scope }, strict), { maxItems: 1 }) }, strict),
  requestAllowance: integer(1, 1000000), concurrentRuns: integer(1, 100), permitLifetimeMs: integer(1, 60000),
  runnerTimeoutMs: integer(1, 60000), requestTimeoutMs: integer(2, CASE_LEASE_MS - 1),
  maxTurns: integer(1, 10), maxOutputTokens: integer(16, 8192), shutdownGraceMs: integer(1, 120000),
  acknowledgeUncappedSubscription: Type.Literal(true), acknowledgeRequestQuotaIsNotMoney: Type.Literal(true),
};
const schema = Type.Object({ ...execution, journalCapacity: integer(10, 1000000) }, strict);
const hSchema = Type.Object({ ...execution, budget: Type.Object({
  mode: Type.Union([Type.Literal("financial"), Type.Literal("request-quota"), Type.Literal("test-only")]),
  policyReference: id, budgetReference: id,
}, strict) }, strict);
export type OperationalConfiguration = Static<typeof schema>;
export type HOperationalConfiguration = Static<typeof hSchema>;
export type ExecutionConfiguration = OperationalConfiguration | HOperationalConfiguration;
export function parseOperationalConfiguration(raw: unknown): Readonly<OperationalConfiguration> {
  if (!Value.Check(schema, raw)) throw new OperationalConfigurationError();
  return checkExecution(structuredClone(raw));
}
export function parseHOperationalConfiguration(raw: unknown): Readonly<HOperationalConfiguration> {
  if (!Value.Check(hSchema, raw)) throw new OperationalConfigurationError();
  return checkExecution(structuredClone(raw));
}
function checkExecution<C extends ExecutionConfiguration>(config: C): Readonly<C> {
  const t = config.target, mappings = config.photos.mappings;
  if (!isAbsolute(t.authPath) || resolve(t.authPath) !== t.authPath || t.authPath.includes("\0")
    || t.endpoint !== subscriptionEndpoint(t)
    || config.validFrom >= config.validUntil || config.runnerTimeoutMs > config.requestTimeoutMs
    || config.shutdownGraceMs < config.requestTimeoutMs || config.concurrentRuns > config.requestAllowance
    || config.photos.enabled !== (mappings.length === 1)
    || mappings.some(m => m.target.provider !== t.provider || m.target.endpoint !== t.endpoint || m.target.modelId !== t.modelId
      || m.target.accountIdSha256 !== t.accountIdSha256 || m.scope.provider !== t.provider || m.scope.purpose !== config.purpose)
    || new Set(config.grants.map(g => `${g.actorId}:${g.caseId}:${g.inputRevision}`)).size !== config.grants.length) throw new OperationalConfigurationError();
  return config;
}
/** Metadata checks only. Credential contents are read exclusively by the guarded SDK path. */
export function assertPrivateOperationalFile(path: string) {
  const info = lstatSync(path), parent = lstatSync(dirname(path));
  if (!isAbsolute(path) || resolve(path) !== path || realpathSync(path) !== path || !info.isFile() || info.isSymbolicLink()
    || info.nlink !== 1 || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o600
    || !parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== process.getuid?.() || (parent.mode & 0o777) !== 0o700) throw new OperationalConfigurationError();
  return info;
}
export function readOperationalConfiguration(path: string): Readonly<OperationalConfiguration> {
  try {
    const pinned = assertPrivateOperationalFile(path);
    if (pinned.size > 65536) throw new OperationalConfigurationError();
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = fstatSync(fd);
      if (info.ino !== pinned.ino || info.dev !== pinned.dev) throw new OperationalConfigurationError();
      const bytes = Buffer.alloc(65537); let offset = 0;
      while (offset < bytes.length) { const count = readSync(fd, bytes, offset, bytes.length - offset, offset); if (!count) break; offset += count; }
      if (offset !== info.size || offset > 65536) throw new OperationalConfigurationError();
      const result = parseOperationalConfiguration(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, offset))));
      const after = fstatSync(fd);
      const current = assertPrivateOperationalFile(path);
      if (after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs || current.ino !== info.ino || current.dev !== info.dev) throw new OperationalConfigurationError();
      assertPrivateOperationalFile(result.target.authPath);
      if (result.validFrom > Date.now() || result.validUntil <= Date.now()) throw new OperationalConfigurationError();
      return result;
    } finally { closeSync(fd); }
  } catch { throw new OperationalConfigurationError(); }
}
