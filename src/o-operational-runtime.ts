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
import { assertPrivateOperationalFile, parseOperationalConfiguration, OperationalConfigurationError, type OperationalConfiguration } from "./o-operations-config.ts";

/** Explicit server assembly. Injecting a transport always persists synthetic presentation. */
export async function createOperatorRuntime(options: {
  readonly origin: string;
  readonly stateRoot: string;
  readonly resourcesRoot: string;
  readonly configuration: Readonly<OperationalConfiguration>;
  readonly privatePhotos: boolean;
  readonly transport?: FetchFunction;
}, open: typeof openCaseSession = openCaseSession) {
  const c = parseOperationalConfiguration(options.configuration);
  const authIdentity = assertPrivateOperationalFile(c.target.authPath);
  if (Date.now() < c.validFrom || Date.now() >= c.validUntil || c.photos.enabled && !options.privatePhotos) throw new OperationalConfigurationError();
  const runtime = await openRuntimeDatabase(options.stateRoot, { existingOnly: true });
  const authority = createSubscriptionPhotoExecutionAuthority();
  authority.publish(c.target, c.photos.mappings);
  let startupCases: ReturnType<typeof createCaseStore> | undefined;
  let journal: Awaited<ReturnType<typeof openOperationJournal>> | undefined;
  try {
    const caseStore = createCaseStore(Date.now, authority, runtime); startupCases = caseStore;
    for (const grant of c.grants) {
      const account = runtime.database.query("SELECT 1 FROM accounts WHERE actor_id=? AND disabled=0").get(grant.actorId);
      if (!account) throw new OperationalConfigurationError();
    }
    journal = await openOperationJournal({ stateRoot: options.stateRoot, configuration: c, currentOperation: () => {
      const current = assertPrivateOperationalFile(c.target.authPath);
      if (current.ino !== authIdentity.ino || current.dev !== authIdentity.dev) throw new OperationalConfigurationError();
      return caseStore.currentOperation();
    } });
    const audit = journal;
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
    const settled = async () => { await app.settled(); await audit.settled(); };
    let admitting = true;
    const facade = { ...app, fetch: (request: Request) => admitting ? app.fetch(request) : Promise.resolve(new Response("Operational admissions stopped", { status: 503 })) };
    return { app: facade, runtime, caseStore, photoStore, localAuth, authority, journal: audit, settled,
      async reloadConfiguration(configuration: Readonly<OperationalConfiguration>) {
        admitting = false;
        await settled();
        const next = parseOperationalConfiguration(configuration);
        assertPrivateOperationalFile(next.target.authPath);
        if (Date.now() < next.validFrom || Date.now() >= next.validUntil) throw new OperationalConfigurationError();
        for (const grant of next.grants) if (!runtime.database.query("SELECT 1 FROM accounts WHERE actor_id=? AND disabled=0").get(grant.actorId)) throw new OperationalConfigurationError();
        audit.reconfigure(next); admitting = true;
      },
      async close() { admitting = false; app.dispose(); await app.close(); await audit.close(); caseStore.dispose(); runtime.close(); },
    };
  } catch (error) { await journal?.close(); startupCases?.dispose(); runtime.close(); throw error; }
}
