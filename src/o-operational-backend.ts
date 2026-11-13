import type { FetchFunction } from "@earendil-works/pi-ai";
import type { OperationBinding } from "./o-case-store.ts";
import type { DispatchPermit, DispatchRequest, OperationalAudit } from "./operations.ts";
import { createOperationalHandoff, type OperationalSuppliers } from "./operational-handoff.ts";
import type { createOperationalAuditStore } from "./operational-audit-store.ts";
import type { PhotoExecutionAuthority, PhotoExecutionTicket } from "./photo-execution.ts";
import { assertPrivateOperationalFile, OperationalConfigurationError, type HOperationalConfiguration } from "./o-operations-config.ts";
import { canonical } from "./o-validation.ts";

export interface OperatorRunBinding extends OperationBinding {
  readonly runId: string;
  readonly approvalId: string;
  readonly policy: Readonly<HOperationalConfiguration>;
  readonly photoTicket: PhotoExecutionTicket | null;
}
/** Trusted server injection only. Ledger owns atomic quotas, durable policy pinning,
 * unresolved reservations and idempotent settlement. Supervisor survives this process.
 * settled covers work continuing beyond callback acknowledgements, including recovery.
 */
export interface OperatorSupplierBundle {
  readonly identity: Readonly<{
    ledger: string; mode: HOperationalConfiguration["budget"]["mode"]; policyReference: string;
    auditDatabase: string; recoveryDatabase: string; privateFileGuard: string;
    recoverySupervisor: string; retentionPolicy: string; retentionOwner: string;
  }>;
  readonly ledger: Pick<OperationalSuppliers, "reserve" | "release" | "reconcile">;
  readonly store: ReturnType<typeof createOperationalAuditStore>;
  readonly privateFileGuard: () => true;
  readonly recoverySupervisor: { readonly assertReady: () => Promise<void> };
  readonly retention: { readonly assertReady: () => Promise<void> };
  readonly assertReady: () => Promise<void>;
  readonly activatePolicy: (configuration: Readonly<HOperationalConfiguration>) => Promise<void>;
  readonly settled: (runId?: string) => Promise<void>;
  readonly close: () => Promise<void>;
}
export type OpenOperatorSuppliers = (context: Readonly<{
  configuration: Readonly<HOperationalConfiguration>;
  binding: (runId: string) => Readonly<OperatorRunBinding>;
}>) => Promise<OperatorSupplierBundle>;

function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
export async function openSupplierBackend(options: {
  readonly configuration: Readonly<HOperationalConfiguration>;
  readonly open: OpenOperatorSuppliers;
  readonly currentOperation: () => OperationBinding;
  readonly authority: PhotoExecutionAuthority;
  readonly syntheticTransport: boolean;
  readonly stopAdmissions: () => void;
}) {
  let c = freeze(structuredClone(options.configuration));
  const auth = assertPrivateOperationalFile(c.target.authPath);
  // Mutable lifecycle state; captured source/policy objects themselves are immutable.
  const runs = new Map<string, { binding: OperatorRunBinding; finished: boolean; request?: DispatchRequest; permit?: DispatchPermit; dispatched: boolean }>();
  const pending = new Map<Promise<unknown>, string>();
  const cleanups = new Set<Promise<void>>();
  const track = <T>(id: string, work: Promise<T>): Promise<T> => {
    pending.set(work, id); void work.then(() => pending.delete(work), () => pending.delete(work)); return work;
  };
  const binding = (id: string) => {
    const run = runs.get(id); if (!run) throw new OperationalConfigurationError(); return run.binding;
  };
  const bundle = await options.open(Object.freeze({ configuration: c, binding }));
  try {
    const identity = freeze(bundle.identity);
    if (!identity || Object.values(identity).some(value => typeof value !== "string" || !value.trim())
      || identity.mode !== c.budget.mode || identity.policyReference !== c.budget.policyReference
      || identity.auditDatabase === identity.recoveryDatabase || identity.auditDatabase === ":memory:" || identity.recoveryDatabase === ":memory:"
      || identity.mode === "test-only" && !options.syntheticTransport
      || [bundle.assertReady, bundle.activatePolicy, bundle.settled, bundle.close, bundle.ledger?.reserve, bundle.ledger?.release,
        bundle.ledger?.reconcile, bundle.store?.appendAudit, bundle.store?.enqueueRecovery, bundle.privateFileGuard,
        bundle.recoverySupervisor?.assertReady, bundle.retention?.assertReady].some(fn => typeof fn !== "function")) throw new OperationalConfigurationError();
    for (const key of ["ledger", "mode", "policyReference", "auditDatabase", "recoveryDatabase", "privateFileGuard", "recoverySupervisor", "retentionPolicy", "retentionOwner"] as const) {
      if (!identity[key]) throw new OperationalConfigurationError();
    }
    if (bundle.privateFileGuard() !== true) throw new OperationalConfigurationError();
    bundle.store.readAudit("startup-readiness");
    await bundle.recoverySupervisor.assertReady(); await bundle.retention.assertReady();
    await bundle.assertReady(); await bundle.activatePolicy(c);
  } catch (error) { if (typeof bundle.close === "function") { await bundle.settled?.(); await bundle.close(); } throw error; }
  // Pin implementations without freezing supplier-owned mutable resource state.
  const services = Object.freeze({
    reserve: bundle.ledger.reserve.bind(bundle.ledger), release: bundle.ledger.release.bind(bundle.ledger),
    reconcile: bundle.ledger.reconcile.bind(bundle.ledger), appendAudit: bundle.store.appendAudit.bind(bundle.store),
    enqueueRecovery: bundle.store.enqueueRecovery.bind(bundle.store), guard: bundle.privateFileGuard.bind(bundle),
    ready: bundle.assertReady.bind(bundle), activate: bundle.activatePolicy.bind(bundle),
    settled: bundle.settled.bind(bundle), close: bundle.close.bind(bundle),
    supervisorReady: bundle.recoverySupervisor.assertReady.bind(bundle.recoverySupervisor),
    retentionReady: bundle.retention.assertReady.bind(bundle.retention),
  });
  const live = (id?: string, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (services.guard() !== true) throw new OperationalConfigurationError();
    const current = options.currentOperation(), pinned = assertPrivateOperationalFile(c.target.authPath);
    if (pinned.ino !== auth.ino || pinned.dev !== auth.dev || Date.now() < c.validFrom || Date.now() >= c.validUntil
      || !c.grants.some(g => g.actorId === current.actorId && g.caseId === current.caseId && g.inputRevision === current.inputRevision
        && g.artifactSha256 === (current.artifact?.hash ?? null))) throw new OperationalConfigurationError();
    if (id) {
      const captured = binding(id);
      const { runId: _run, approvalId: _approval, policy: _policy, photoTicket, ...source } = captured;
      if (canonical(source) !== canonical(current)) throw new OperationalConfigurationError();
      if (photoTicket) options.authority.assertCurrent(photoTicket);
    }
    return current;
  };
  const hooks = createOperationalHandoff({
    reserve: (request, signal) => { live(request.runId, signal); return track(request.runId, services.reserve(request, signal)); },
    appendAudit: (event, signal) => track(event.runId, services.appendAudit(event, signal)),
    release: (reservation, signal) => track(reservation.runId, services.release(reservation, signal)),
    reconcile: (event, reservations, signal) => track(event.runId, services.reconcile(event, reservations, signal)),
    enqueueRecovery: task => {
      try {
        if (services.enqueueRecovery(task) !== true) throw new OperationalConfigurationError();
        return true;
      }
      catch (error) { options.stopAdmissions(); throw error; }
    },
  });
  const rawSettled = async (id?: string) => {
    for (;;) {
      const work = [...pending].filter(([, run]) => id === undefined || run === id).map(([promise]) => promise);
      if (!work.length) return; await Promise.allSettled(work);
    }
  };
  const settled = async () => {
    await hooks.settled(); await rawSettled(); await services.settled();
    await hooks.settled(); await rawSettled();
    while (cleanups.size) await Promise.allSettled([...cleanups]);
    for (const [id, run] of runs) if (run.finished) runs.delete(id);
  };
  let closing: Promise<void> | undefined;
  return {
    async authorizeDispatch(request: DispatchRequest, signal: AbortSignal) {
      live(request.runId, signal);
      if (request.caseRevision !== binding(request.runId).inputRevision || request.endpoint !== c.target.endpoint || request.provider !== c.target.provider
        || request.modelId !== c.target.modelId || request.deployment !== "" || request.outputLimitEnforced !== false
        || request.maxOutputTokens !== c.maxOutputTokens || !Number.isInteger(request.attempt) || request.attempt < 1 || request.attempt > c.maxTurns) throw new OperationalConfigurationError();
      const permit = await hooks.authorizeDispatch(request, signal);
      live(request.runId, signal);
      const run = runs.get(request.runId);
      if (!run || run.finished) throw new OperationalConfigurationError();
      if (permit && (permit.approvalId === c.approvalId || permit.expiresAt > c.validUntil || permit.expiresAt > Date.now() + c.permitLifetimeMs)) throw new OperationalConfigurationError();
      if (permit) { run.request = freeze(structuredClone(request)); run.permit = freeze(structuredClone(permit)); run.dispatched = false; }
      return permit;
    },
    async record(event: OperationalAudit, signal?: AbortSignal) {
      if (event.phase === "start") {
        const source = live(undefined, signal);
        if (source.inputRevision !== event.caseRevision || runs.has(event.runId)) throw new OperationalConfigurationError();
        runs.set(event.runId, { binding: freeze({ ...source, runId: event.runId, approvalId: c.approvalId, policy: c,
          photoTicket: options.authority.current() }), finished: false, dispatched: false });
      } else if (event.phase === "dispatch") {
        live(event.runId, signal);
        const run = runs.get(event.runId), row = event.requests.at(-1);
        if (!run || !row || row.attempt !== run.request?.attempt || row.approvalId !== run.permit?.approvalId || run.dispatched) throw new OperationalConfigurationError();
      } else if (!runs.has(event.runId)) throw new OperationalConfigurationError();
      try { await hooks.record(event, signal); if (event.phase !== "finish") live(event.runId, signal); }
      finally {
        if (event.phase === "finish") {
          const run = runs.get(event.runId); if (run) run.finished = true;
          const cleanup = (async () => {
            await hooks.settled(event.runId); await rawSettled(event.runId); await services.settled(event.runId);
            await hooks.settled(event.runId); await rawSettled(event.runId); runs.delete(event.runId);
          })();
          cleanups.add(cleanup);
          void cleanup.then(() => cleanups.delete(cleanup), () => { cleanups.delete(cleanup); options.stopAdmissions(); });
        }
      }
    },
    wrapTransport: (transport: FetchFunction): FetchFunction => (url, init) => {
      const current = live(undefined, init?.signal ?? undefined);
      const matches = [...runs].filter(([, run]) => !run.finished && run.binding.leaseToken === current.leaseToken && run.permit && !run.dispatched);
      const entry = matches[0];
      if (!entry || matches.length !== 1 || !init) throw new OperationalConfigurationError();
      const [id, run] = entry;
      live(id, init.signal ?? undefined);
      if (!run.permit || run.permit.expiresAt <= Date.now() || String(url) !== c.target.endpoint) throw new OperationalConfigurationError();
      run.dispatched = true;
      // H already validated serialized account/model/images. No await after this
      // final live O guard and before invoking the underlying transport.
      return track(id, transport(url, init));
    },
    settled,
    async reconfigure(next: Readonly<HOperationalConfiguration>) {
      if (services.guard() !== true) throw new OperationalConfigurationError();
      await services.ready(); await services.supervisorReady(); await services.retentionReady();
      await services.activate(freeze(structuredClone(next))); c = freeze(structuredClone(next));
    },
    close() { closing ??= (async () => { await settled(); await services.close(); })(); return closing; },
  };
}
