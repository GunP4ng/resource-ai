import { randomUUID } from "node:crypto";
import { checkedConfiguration, type AzureConfiguration } from "./azure-configuration.ts";

export type ModelScope = Readonly<{ provider: string; purpose: string }>;
export type AzureTarget = Readonly<Pick<AzureConfiguration, "endpoint" | "deployment" | "modelId" | "apiVersion">>;
export type ScopeMapping = Readonly<{ target: AzureTarget; scope: ModelScope }>;
export type PhotoExecutionTicket = Readonly<{ generation: number; bindingId: string; target: AzureTarget; scope: ModelScope }>;
export interface PhotoExecutionAuthority {
  current(): PhotoExecutionTicket | null;
  assertCurrent(ticket: PhotoExecutionTicket): void;
  configuration(ticket: PhotoExecutionTicket): Readonly<AzureConfiguration>;
}
const sameTarget = (a: AzureTarget, b: AzureTarget) => a.endpoint === b.endpoint && a.deployment === b.deployment && a.modelId === b.modelId && a.apiVersion === b.apiVersion;
const validScope = (scope: ModelScope) => typeof scope?.provider === "string" && scope.provider.trim().length > 0 && scope.provider.length <= 200
  && typeof scope.purpose === "string" && scope.purpose.trim().length > 0 && scope.purpose.length <= 500;

/** H publishes one atomic snapshot. No mapping is supplied by default. */
export function createPhotoExecutionAuthority() {
  let generation = 0, ticket: PhotoExecutionTicket | null = null, configuration: Readonly<AzureConfiguration> | null = null;
  const assertCurrent = (candidate: PhotoExecutionTicket) => {
    if (!ticket || candidate !== ticket || candidate.generation !== generation) throw new Error("stale-photo-execution");
  };
  return {
    publish(value: AzureConfiguration | null, mappings: readonly ScopeMapping[] = []): void {
      // Build locally before publishing; rejected configuration leaves the old snapshot intact.
      const config = value === null ? null : checkedConfiguration(value);
      const target = config && Object.freeze({ endpoint: config.endpoint, deployment: config.deployment, modelId: config.modelId, apiVersion: config.apiVersion });
      const matching = target ? mappings.filter(row => row?.target && sameTarget(row.target, target)) : [];
      const row = matching.length === 1 ? matching[0] : undefined;
      const scope = row && validScope(row.scope) ? Object.freeze({ provider: row.scope.provider, purpose: row.scope.purpose }) : null;
      const bindingId = ticket && target && scope && sameTarget(ticket.target, target) && ticket.scope.provider === scope.provider && ticket.scope.purpose === scope.purpose
        ? ticket.bindingId : randomUUID();
      const nextGeneration = generation + 1;
      const next = target && scope ? Object.freeze({ generation: nextGeneration, bindingId, target, scope }) : null;
      configuration = config; generation = nextGeneration; ticket = next;
    },
    current: () => ticket,
    assertCurrent,
    configuration(candidate: PhotoExecutionTicket) { assertCurrent(candidate); return configuration!; },
  } satisfies PhotoExecutionAuthority & { publish(value: AzureConfiguration | null, mappings?: readonly ScopeMapping[]): void };
}

/** Shared exact predicate. Callers must also assert the issued ticket is current. */
export function matchesPhotoConsent(consent: { readonly model: boolean; readonly visibleContentReviewed: boolean; readonly modelScope?: ModelScope; readonly modelBindingId?: string }, ticket: PhotoExecutionTicket | null | undefined): boolean {
  return !!ticket && consent.model === true && consent.visibleContentReviewed === true && consent.modelBindingId === ticket.bindingId
    && consent.modelScope?.provider === ticket.scope.provider && consent.modelScope?.purpose === ticket.scope.purpose;
}
