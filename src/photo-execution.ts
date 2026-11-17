import { randomUUID } from "node:crypto";
import { checkedConfiguration, type AzureConfiguration } from "./azure-configuration.ts";
import { checkedSubscriptionConfiguration, subscriptionEndpoint, type SubscriptionConfiguration } from "./subscription-configuration.ts";

export type ModelScope = Readonly<{ provider: string; purpose: string }>;
export type AzureTarget = Readonly<Pick<AzureConfiguration, "endpoint" | "deployment" | "modelId" | "apiVersion">>;
export type SubscriptionTarget = Readonly<{ provider: "chatgpt-subscription"; endpoint: ReturnType<typeof subscriptionEndpoint>; modelId: string; accountIdSha256: string }>;
type Target = AzureTarget | SubscriptionTarget;
type Configuration = AzureConfiguration | SubscriptionConfiguration;
export type ScopeMapping<T extends Target = AzureTarget> = Readonly<{ target: T; scope: ModelScope }>;
export type PhotoExecutionTicket<T extends Target = Target> = Readonly<{ generation: number; bindingId: string; target: T; scope: ModelScope }>;
export interface PhotoExecutionAuthority<C extends Configuration = Configuration, T extends Target = Target> {
  current(): PhotoExecutionTicket<T> | null;
  assertCurrent(ticket: PhotoExecutionTicket): void;
  configuration(ticket: PhotoExecutionTicket): Readonly<C>;
}
const sameTarget = (a: AzureTarget, b: AzureTarget) => a.endpoint === b.endpoint && a.deployment === b.deployment && a.modelId === b.modelId && a.apiVersion === b.apiVersion;
const validScope = (scope: ModelScope) => typeof scope?.provider === "string" && scope.provider.trim().length > 0 && scope.provider.length <= 200
  && typeof scope.purpose === "string" && scope.purpose.trim().length > 0 && scope.purpose.length <= 500;

/** H publishes one atomic snapshot. No mapping is supplied by default. */
export function createPhotoExecutionAuthority() {
  return createAuthority(checkedConfiguration,
    config => Object.freeze({ endpoint: config.endpoint, deployment: config.deployment, modelId: config.modelId, apiVersion: config.apiVersion }), sameTarget);
}

/** Uses the same O consent/lease contract; production mappings are never inferred. */
export function createSubscriptionPhotoExecutionAuthority() {
  return createAuthority(checkedSubscriptionConfiguration,
    config => Object.freeze({ provider: config.provider, endpoint: subscriptionEndpoint(config), modelId: config.modelId, accountIdSha256: config.accountIdSha256 }),
    (a, b) => a.provider === b.provider && a.endpoint === b.endpoint && a.modelId === b.modelId && a.accountIdSha256 === b.accountIdSha256);
}

function createAuthority<C extends Configuration, T extends Target>(check: (value: C | null) => Readonly<C>, targetOf: (config: Readonly<C>) => T, equal: (a: T, b: T) => boolean) {
  let generation = 0, ticket: PhotoExecutionTicket<T> | null = null, configuration: Readonly<C> | null = null;
  const assertCurrent = (candidate: PhotoExecutionTicket) => {
    if (!ticket || candidate !== ticket || candidate.generation !== generation) throw new Error("stale-photo-execution");
  };
  return {
    publish(value: C | null, mappings: readonly ScopeMapping<T>[] = []): void {
      // Build locally before publishing; rejected configuration leaves the old snapshot intact.
      const config = value === null ? null : check(value);
      const target = config && targetOf(config);
      const matching = target ? mappings.filter(row => row?.target && equal(row.target, target)) : [];
      const row = matching.length === 1 ? matching[0] : undefined;
      const scope = row && validScope(row.scope) ? Object.freeze({ provider: row.scope.provider, purpose: row.scope.purpose }) : null;
      const bindingId = ticket && target && scope && equal(ticket.target, target) && ticket.scope.provider === scope.provider && ticket.scope.purpose === scope.purpose
        ? ticket.bindingId : randomUUID();
      const nextGeneration = generation + 1;
      const next = target && scope ? Object.freeze({ generation: nextGeneration, bindingId, target, scope }) : null;
      configuration = config; generation = nextGeneration; ticket = next;
    },
    current: () => ticket,
    assertCurrent,
    configuration(candidate: PhotoExecutionTicket) { assertCurrent(candidate); return configuration!; },
  } satisfies PhotoExecutionAuthority<C, T> & { publish(value: C | null, mappings?: readonly ScopeMapping<T>[]): void };
}

/** Shared exact predicate. Callers must also assert the issued ticket is current. */
export function matchesPhotoConsent(consent: { readonly model: boolean; readonly visibleContentReviewed: boolean; readonly modelScope?: ModelScope; readonly modelBindingId?: string }, ticket: PhotoExecutionTicket | null | undefined): boolean {
  return !!ticket && consent.model === true && consent.visibleContentReviewed === true && consent.modelBindingId === ticket.bindingId
    && consent.modelScope?.provider === ticket.scope.provider && consent.modelScope?.purpose === ticket.scope.purpose;
}
