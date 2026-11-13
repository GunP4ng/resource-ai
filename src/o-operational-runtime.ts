import { join } from "node:path";
import type { FetchFunction } from "@earendil-works/pi-ai";
import { createOperationalApp } from "./operations.ts";
import { openCaseSession } from "./session.ts";
import { openRuntimeDatabase } from "./o-runtime-db.ts";
import { createCaseStore } from "./o-case-store.ts";
import { createLocalAuth } from "./o-auth.ts";
import { createFileResourceProvider } from "./o-resources.ts";
import { createPhotoStore } from "./photos.ts";
import { createSubscriptionPhotoExecutionAuthority } from "./photo-execution.ts";
import { openOperationJournal } from "./o-operation-journal.ts";
import { openSupplierBackend, type OpenOperatorSuppliers } from "./o-operational-backend.ts";
import { canonical } from "./o-validation.ts";
import { assertPrivateOperationalFile, parseOperationalConfiguration, parseHOperationalConfiguration, OperationalConfigurationError,
  type OperationalConfiguration, type HOperationalConfiguration, type ExecutionConfiguration } from "./o-operations-config.ts";

export type OperatorBackend = { readonly kind: "o-journal" } | { readonly kind: "h-suppliers"; readonly open: OpenOperatorSuppliers };
interface RuntimeOptions {
  readonly origin: string;
  readonly stateRoot: string;
  readonly resourcesRoot: string;
  readonly privatePhotos: boolean;
  readonly transport?: FetchFunction;
}
type Journal = Awaited<ReturnType<typeof openOperationJournal>>;
type Runtime = Awaited<ReturnType<typeof assemble>>;
type SelectedRuntime<C extends ExecutionConfiguration> = Omit<Runtime, "journal" | "reloadConfiguration"> & {
  readonly reloadConfiguration: (configuration: Readonly<C>) => Promise<void>;
};
export function createOperatorRuntime(options: RuntimeOptions & { readonly configuration: Readonly<OperationalConfiguration>; readonly backend?: { readonly kind: "o-journal" } }, open?: typeof openCaseSession): Promise<SelectedRuntime<OperationalConfiguration> & { readonly journal: Journal }>;
export function createOperatorRuntime(options: RuntimeOptions & { readonly configuration: Readonly<HOperationalConfiguration>; readonly backend: { readonly kind: "h-suppliers"; readonly open: OpenOperatorSuppliers } }, open?: typeof openCaseSession): Promise<SelectedRuntime<HOperationalConfiguration>>;
export function createOperatorRuntime(options: RuntimeOptions & { readonly configuration: Readonly<ExecutionConfiguration>; readonly backend?: OperatorBackend }, open = openCaseSession) {
  return assemble(options, open);
}

/** Exactly one accounting backend. Injected transport always persists synthetic presentation. */
async function assemble(options: RuntimeOptions & { readonly configuration: Readonly<ExecutionConfiguration>; readonly backend?: OperatorBackend }, open: typeof openCaseSession) {
  const selection = options.backend === undefined ? { kind: "o-journal" as const } : options.backend;
  if (!selection || typeof selection !== "object") throw new OperationalConfigurationError();
  let parseConfiguration: (raw: unknown) => Readonly<ExecutionConfiguration>;
  switch (selection.kind) {
    case "o-journal":
      if (Object.keys(selection).some(key => key !== "kind")) throw new OperationalConfigurationError();
      parseConfiguration = parseOperationalConfiguration; break;
    case "h-suppliers":
      if (typeof selection.open !== "function" || Object.keys(selection).some(key => key !== "kind" && key !== "open")) throw new OperationalConfigurationError();
      parseConfiguration = parseHOperationalConfiguration; break;
    default: throw new OperationalConfigurationError();
  }
  let c = parseConfiguration(options.configuration);
  const authIdentity = assertPrivateOperationalFile(c.target.authPath);
  if (Date.now() < c.validFrom || Date.now() >= c.validUntil || c.photos.enabled && !options.privatePhotos) throw new OperationalConfigurationError();
  const runtime = await openRuntimeDatabase(options.stateRoot, { existingOnly: true });
  const authority = createSubscriptionPhotoExecutionAuthority();
  let startupCases: ReturnType<typeof createCaseStore> | undefined;
  let backend: Journal | Awaited<ReturnType<typeof openSupplierBackend>> | undefined;
  let admitting = false, closing = false, failed = false;
  const stopAdmissions = () => { failed = true; admitting = false; };
  try {
    authority.publish(c.target, c.photos.mappings);
    const caseStore = createCaseStore(Date.now, authority, runtime); startupCases = caseStore;
    const validate = (next: Readonly<ExecutionConfiguration>) => {
      const current = assertPrivateOperationalFile(next.target.authPath);
      if (current.ino !== authIdentity.ino || current.dev !== authIdentity.dev || Date.now() < next.validFrom || Date.now() >= next.validUntil) throw new OperationalConfigurationError();
      for (const grant of next.grants) if (!runtime.database.query("SELECT 1 FROM accounts WHERE actor_id=? AND disabled=0").get(grant.actorId)) throw new OperationalConfigurationError();
    };
    validate(c);
    let journal: Journal | undefined;
    let suppliers: Awaited<ReturnType<typeof openSupplierBackend>> | undefined;
    switch (selection.kind) {
      case "o-journal": {
        const configuration = parseOperationalConfiguration(c);
        journal = await openOperationJournal({ stateRoot: options.stateRoot, configuration, currentOperation: () => {
          const current = assertPrivateOperationalFile(configuration.target.authPath);
          if (current.ino !== authIdentity.ino || current.dev !== authIdentity.dev) throw new OperationalConfigurationError();
          return caseStore.currentOperation();
        } }); backend = journal; break;
      }
      case "h-suppliers": suppliers = await openSupplierBackend({ configuration: parseHOperationalConfiguration(c), open: selection.open,
        currentOperation: caseStore.currentOperation, authority, syntheticTransport: !!options.transport, stopAdmissions }); backend = suppliers; break;
      default: throw new OperationalConfigurationError();
    }
    const audit = backend;
    const localAuth = createLocalAuth(runtime, { origin: options.origin });
    const resources = await createFileResourceProvider({ root: options.resourcesRoot, caseStore });
    const retentionMs = 3600000;
    const photoStore = options.privatePhotos ? await createPhotoStore({ root: join(options.stateRoot, "photos"), authorize: caseStore.authorize,
      retentionMs, maxPhotos: 300, photoExecution: authority }) : undefined;
    const app = createOperationalApp({ origin: options.origin, localAuth, caseStore, resources, photoStore,
      photoPolicy: photoStore ? { retentionMs } : undefined,
      presentationMode: options.transport ? "synthetic" : "live",
      runtime: { identity: "local-operator", storage: "sqlite", runner: "subscription" }, timeoutMs: c.requestTimeoutMs,
      operations: { provider: "subscription", enabled: true, timeoutMs: c.runnerTimeoutMs, maxTurns: c.maxTurns, maxOutputTokens: c.maxOutputTokens,
        configuration: async () => c.target, photoExecution: authority, authorizeDispatch: audit.authorizeDispatch, record: audit.record,
        transport: audit.wrapTransport(options.transport ?? fetch) },
    }, open);
    const handlers = new Set<Promise<Response>>();
    const settled = async () => { while (handlers.size) await Promise.allSettled([...handlers]); await app.settled(); await audit.settled(); };
    let control = Promise.resolve(), closeWork: Promise<void> | undefined, reloads = 0;
    const serialize = (work: () => Promise<void>) => {
      const result = control.then(work); control = result.then(() => undefined, () => undefined); return result;
    };
    admitting = true;
    const facade = { ...app,
      dispose() { closing = true; admitting = false; app.dispose(); },
      fetch: (request: Request) => {
        if (!admitting) return Promise.resolve(new Response("Operational admissions stopped", { status: 503 }));
        const work = app.fetch(request); handlers.add(work);
        void work.then(() => handlers.delete(work), () => handlers.delete(work));
        return work;
      },
    };
    return { app: facade, runtime, caseStore, photoStore, localAuth, authority, ...(journal ? { journal } : {}), settled,
      reloadConfiguration(configuration: Readonly<ExecutionConfiguration>) {
        admitting = false; reloads++;
        return serialize(async () => {
          try {
            if (closing || failed) throw new OperationalConfigurationError();
            await settled();
            const next = parseConfiguration(configuration);
            const fixed = (value: Readonly<ExecutionConfiguration>) => {
              const { approvalId: _approval, validFrom: _from, validUntil: _until, grants: _grants, ...rest } = value; return canonical(rest);
            };
            if (fixed(c) !== fixed(next)) throw new OperationalConfigurationError();
            validate(next);
            // Each selected backend owns durable approval pinning and quota continuity.
            if (journal) journal.reconfigure(parseOperationalConfiguration(next));
            else if (suppliers) await suppliers.reconfigure(parseHOperationalConfiguration(next));
            else throw new OperationalConfigurationError();
            c = next;
          } catch (error) { stopAdmissions(); throw error; }
          finally { reloads--; if (reloads === 0 && !closing && !failed) admitting = true; }
        });
      },
      close() {
        if (closeWork) return closeWork;
        facade.dispose();
        closeWork = serialize(async () => { await app.close(); await settled(); await audit.close(); caseStore.dispose(); runtime.close(); });
        return closeWork;
      },
    };
  } catch (error) { await backend?.close(); startupCases?.dispose(); runtime.close(); throw error; }
}
