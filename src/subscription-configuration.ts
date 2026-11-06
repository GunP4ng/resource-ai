import { isAbsolute } from "node:path";
import { readStoredCredential } from "@code-yeongyu/senpi";
import type { CredentialStore } from "@earendil-works/pi-ai";

export const SUBSCRIPTION_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
/** Server-owned configuration. No environment fallback or automatic account selection. */
export interface SubscriptionConfiguration {
  readonly provider: "chatgpt-subscription";
  readonly modelId: string;
  readonly authPath: string;
  /** SHA-256 of the operator-approved account ID, checked against SDK request headers. */
  readonly accountIdSha256: string;
}
export class SubscriptionConfigurationError extends Error {}
export function checkedSubscriptionConfiguration(value: SubscriptionConfiguration | null): Readonly<SubscriptionConfiguration> {
  if (!value || value.provider !== "chatgpt-subscription" || typeof value.modelId !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(value.modelId)
    || typeof value.authPath !== "string" || !isAbsolute(value.authPath) || value.authPath.includes("\0")
    || typeof value.accountIdSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.accountIdSha256)) throw new SubscriptionConfigurationError();
  return Object.freeze({ provider: value.provider, modelId: value.modelId, authPath: value.authPath, accountIdSha256: value.accountIdSha256 });
}

/** SDK credential-store injection: no login, pool rotation, refresh or writes in a case request. */
export function subscriptionCredentials(config: SubscriptionConfiguration, check: () => void): CredentialStore {
  check();
  const credential = readStoredCredential("chatgpt-subscription", config.authPath);
  const deny = () => { throw new SubscriptionConfigurationError(); };
  const valid = () => {
    check();
    // The installed SDK refreshes within five minutes. Recheck at every read, and
    // reject its refresh lock before any refresh callback can perform network I/O.
    if (!credential || credential.type !== "oauth" || typeof credential.access !== "string" || !credential.access
      || !Number.isFinite(credential.expires) || credential.expires <= Date.now() + 300000
      || credential["accounts"] !== undefined || credential["signedOut"] === true) deny();
  };
  valid();
  return {
    async read(provider) { valid(); return provider === "chatgpt-subscription" ? structuredClone(credential) : undefined; },
    async readSlot() { return deny(); },
    async list() { valid(); return [{ providerId: "chatgpt-subscription", type: "oauth" }]; },
    async withRefreshLock() { return deny(); },
    async modify() { return deny(); },
    async delete() { return deny(); },
  };
}
