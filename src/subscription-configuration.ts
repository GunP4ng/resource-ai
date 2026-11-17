import { isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { readStoredCredential } from "@code-yeongyu/senpi";
import type { CredentialStore } from "@earendil-works/pi-ai";

export const SUBSCRIPTION_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
export const SIWC_ENDPOINT = "https://api.openai.com/v1/responses";
export type SubscriptionRoute = "codex" | "siwc";
export function subscriptionRoute(value: unknown = "codex"): SubscriptionRoute {
  switch (value) {
    case "codex": case "siwc": return value;
    default: throw new SubscriptionConfigurationError();
  }
}
export function subscriptionEndpoint(config: { readonly route?: SubscriptionRoute }) {
  switch (subscriptionRoute(config.route)) {
    case "codex": return SUBSCRIPTION_ENDPOINT;
    case "siwc": return SIWC_ENDPOINT;
  }
}
/** Server-owned configuration. No environment fallback or automatic account selection. */
export interface SubscriptionConfiguration {
  readonly provider: "chatgpt-subscription";
  readonly modelId: string;
  readonly authPath: string;
  /** Codex: account-ID SHA. SiWC: SHA-256(JSON.stringify([issuer, subject, clientId])). */
  readonly accountIdSha256: string;
  readonly route?: SubscriptionRoute;
  /** Required to select a managed pool slot; never follows the pool pin/order. */
  readonly credentialSlot?: string;
}
export class SubscriptionConfigurationError extends Error {}
export function checkedSubscriptionConfiguration(value: SubscriptionConfiguration | null): Readonly<SubscriptionConfiguration> {
  if (!value || value.provider !== "chatgpt-subscription" || typeof value.modelId !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(value.modelId)
    || typeof value.authPath !== "string" || !isAbsolute(value.authPath) || value.authPath.includes("\0")
    || typeof value.accountIdSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.accountIdSha256)) throw new SubscriptionConfigurationError();
  subscriptionRoute(value.route);
  if (value.credentialSlot !== undefined && !/^[A-Za-z0-9_.-]{1,128}$/.test(value.credentialSlot)) throw new SubscriptionConfigurationError();
  return Object.freeze({ provider: value.provider, modelId: value.modelId, authPath: value.authPath, accountIdSha256: value.accountIdSha256,
    ...(value.route === undefined ? {} : { route: value.route }), ...(value.credentialSlot === undefined ? {} : { credentialSlot: value.credentialSlot }) });
}

/** A SiWC connection binds the selected verified account and issued registration.
 * Legacy Codex account-header identity is enforced separately. */
export function siwcAccessToken(config: SubscriptionConfiguration): string {
  const credential = selectedCredential(config);
  if (!credential || credential.type !== "oauth" || credential["signedOut"] === true
    || credential["route"] !== "siwc" || credential.planUsageEnabled !== true
    || !credential.scopes?.includes("chatgpt.tokens.use.direct") || !credential.access
    || !Number.isFinite(credential.expires) || credential.expires <= Date.now() + 300000) throw new SubscriptionConfigurationError();
  if (credential.issuer !== "https://auth.openai.com" || typeof credential.subject !== "string" || !credential.subject.trim()
    || typeof credential.clientId !== "string" || !credential.clientId.trim()
    || credential.clientId === "dynamic_agent_client") throw new SubscriptionConfigurationError();
  const connection = JSON.stringify([credential.issuer, credential.subject, credential.clientId]);
  if (createHash("sha256").update(connection).digest("hex") !== config.accountIdSha256) throw new SubscriptionConfigurationError();
  return credential.access;
}

function selectedCredential(config: SubscriptionConfiguration): Exclude<ReturnType<typeof readStoredCredential>, { type: "api_key" } | undefined> {
  const stored = readStoredCredential("chatgpt-subscription", config.authPath);
  if (!stored || stored.type !== "oauth" || stored["signedOut"] === true) throw new SubscriptionConfigurationError();
  if (config.route !== "siwc") return stored;
  if (stored["accounts"] === undefined) {
    if (config.credentialSlot !== undefined && config.credentialSlot !== "default") throw new SubscriptionConfigurationError();
    return stored;
  }
  const accounts: unknown = stored["accounts"];
  if (!config.credentialSlot || !Array.isArray(accounts)) throw new SubscriptionConfigurationError();
  const matches: unknown[] = accounts.filter((slot: unknown) => slot && typeof slot === "object" && Reflect.get(slot, "name") === config.credentialSlot);
  const slot = matches.length === 1 ? matches[0] : undefined;
  if (!slot || typeof slot !== "object") throw new SubscriptionConfigurationError();
  const access: unknown = Reflect.get(slot, "access"), refresh: unknown = Reflect.get(slot, "refresh"), expires: unknown = Reflect.get(slot, "expires");
  const scopes: unknown = Reflect.get(slot, "scopes");
  const subject: unknown = Reflect.get(slot, "subject"), issuer: unknown = Reflect.get(slot, "issuer"), clientId: unknown = Reflect.get(slot, "clientId");
  if (typeof access !== "string" || typeof refresh !== "string" || typeof expires !== "number"
    || !Array.isArray(scopes) || !scopes.every((scope: unknown) => typeof scope === "string")
    || typeof subject !== "string" || typeof issuer !== "string" || typeof clientId !== "string") throw new SubscriptionConfigurationError();
  return { type: "oauth" as const, access, refresh, expires, scopes: scopes.filter((scope: unknown): scope is string => typeof scope === "string"),
    subject, issuer, clientId,
    route: Reflect.get(slot, "route"), planUsageEnabled: Reflect.get(slot, "planUsageEnabled") === true,
    signedOut: Reflect.get(slot, "signedOut") };
}

/** SDK credential-store injection: no login, pool rotation, refresh or writes in a case request. */
export function subscriptionCredentials(config: SubscriptionConfiguration, check: () => void): CredentialStore {
  check();
  const credential = selectedCredential(config);
  const deny = () => { throw new SubscriptionConfigurationError(); };
  const valid = () => {
    check();
    if (config.route === "siwc" && siwcAccessToken(config) !== credential.access) deny();
    // The installed SDK refreshes within five minutes. Recheck at every read, and
    // reject its refresh lock before any refresh callback can perform network I/O.
    if (!credential || credential.type !== "oauth" || typeof credential.access !== "string" || !credential.access
      || !Number.isFinite(credential.expires) || credential.expires <= Date.now() + 300000
      || credential["accounts"] !== undefined || credential["signedOut"] === true) deny();
  };
  valid();
  return {
    async read(provider) { valid(); return provider === "openai" && config.route === "siwc" ? { type: "api_key", key: credential.access }
      : provider === "chatgpt-subscription" ? structuredClone(credential) : undefined; },
    async readSlot() { return deny(); },
    async list() { valid(); return config.route === "siwc" ? [{ providerId: "openai", type: "api_key" }, { providerId: "chatgpt-subscription", type: "oauth" }]
      : [{ providerId: "chatgpt-subscription", type: "oauth" }]; },
    async withRefreshLock() { return deny(); },
    async modify() { return deny(); },
    async delete() { return deny(); },
  };
}
