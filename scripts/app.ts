import { createServer } from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import { Readable } from "node:stream";
import { isAbsolute, join, resolve } from "node:path";
import { createOperationalApp } from "../src/operations.ts";
import { createAzureRunner, createSubscriptionRunner } from "../src/session.ts";
import { createMemoryRuntimeDatabase, openRuntimeDatabase } from "../src/o-runtime-db.ts";
import { createCaseStore } from "../src/o-case-store.ts";
import { createLocalAuth } from "../src/o-auth.ts";
import { createFileResourceProvider } from "../src/o-resources.ts";
import { createPhotoStore } from "../src/photos.ts";
import { PhotoStorageError } from "../src/photo-codec.ts";
// Run with Bun 1.4.2. Node HTTP keeps launch types within existing dependencies.
/** Streaming bridge shared by the launcher and task-local synthetic QA harness. */
export function requestBridge(origin: string, fetchRequest: (request: Request) => Promise<Response>) {
  return async (incoming: Readable & { readonly headers: IncomingHttpHeaders; readonly method?: string; readonly url?: string }, outgoing: {
    readonly writableEnded: boolean;
    once(event: "close", listener: () => void): unknown;
    writeHead(status: number, headers?: Record<string, string>): unknown;
    end(bytes: string | Uint8Array): unknown;
  }) => {
    const controller = new AbortController();
    incoming.once("aborted", () => controller.abort());
    outgoing.once("close", () => { if (!outgoing.writableEnded) controller.abort(); });
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    try {
      const hasBody = incoming.method !== "GET" && incoming.method !== "HEAD";
      const request = new Request(new URL(incoming.url ?? "/", origin), { method: incoming.method, headers, signal: controller.signal,
        ...(hasBody ? { body: Readable.toWeb(incoming), duplex: "half" } : {}) } as RequestInit & { duplex?: "half" });
      const result = await fetchRequest(request);
      outgoing.writeHead(result.status, Object.fromEntries(result.headers));
      outgoing.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      if (error instanceof Error) { outgoing.writeHead(502); outgoing.end("Execution failed"); return; }
      throw error;
    }
  };
}

async function startApp() {
const port = Number(process.env["PORT"] ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError("Invalid PORT");
const origin = `http://localhost:${port}`;
const mode = process.env["RESOURCE_MODEL_RUNNER"] ?? "subscription";
if (mode !== "subscription" && mode !== "azure" && mode !== "local") throw new RangeError("Invalid RESOURCE_MODEL_RUNNER");
const authMode = process.env["RESOURCE_APP_AUTH"] ?? "anonymous";
const state = process.env["RESOURCE_STATE_DIR"], resourcesRoot = process.env["RESOURCE_RESOURCES_DIR"];
const privatePhotos = process.env["RESOURCE_PRIVATE_PHOTOS"] ?? "off";
if (authMode !== "anonymous" && authMode !== "local-operator" || privatePhotos !== "off" && privatePhotos !== "on") throw new RangeError("Invalid runtime mode");
if (authMode === "anonymous" && (state !== undefined || resourcesRoot !== undefined || privatePhotos === "on")) throw new RangeError("Private state requires local-operator mode");
if (authMode === "local-operator" && (!state || !isAbsolute(state) || resolve(state) !== state)
  || resourcesRoot !== undefined && (!resourcesRoot || !isAbsolute(resourcesRoot) || resolve(resourcesRoot) !== resourcesRoot)) throw new RangeError("Runtime directories must be absolute private paths");
const runtime = state ? await openRuntimeDatabase(state) : createMemoryRuntimeDatabase();
let startupStore: ReturnType<typeof createCaseStore> | undefined;
try {
const caseStore = createCaseStore(Date.now, undefined, runtime); startupStore = caseStore;
const localAuth = authMode === "local-operator" ? createLocalAuth(runtime, { origin }) : undefined;
const resources = resourcesRoot === undefined ? undefined : await createFileResourceProvider({ root: resourcesRoot, caseStore });
const retentionMs = 3_600_000;
const photoStore = privatePhotos === "on" && state ? await createPhotoStore({ root: join(state, "photos"), authorize: caseStore.authorize, retentionMs, maxPhotos: 300 }) : undefined;
const runner = mode === "subscription"
  ? createSubscriptionRunner({ enabled: true, modelId: process.env["RESOURCE_MODEL_ID"], authPath: process.env["RESOURCE_AUTH_PATH"] })
  : mode === "azure" ? createAzureRunner({ enabled: true, modelId: process.env["RESOURCE_MODEL_ID"] }) : undefined;
const app = createOperationalApp({ origin, runner, resources, localAuth, caseStore, photoStore,
  photoPolicy: photoStore ? { retentionMs } : undefined,
  runtime: { identity: localAuth ? "local-operator" : "anonymous", storage: localAuth ? "sqlite" : "ephemeral", runner: mode }, timeoutMs: 10000 });
const cleanupAbort = new AbortController();
let cleaning: Promise<void> | undefined;
const cleanup = () => {
  if (cleaning || !photoStore || cleanupAbort.signal.aborted) return cleaning;
  const work = async () => {
    // Queue owners survive case expiry. Bound each pass without inventing an
    // account/session or clearing an obligation before filesystem confirmation.
    runtime.assertReady();
    const owners = runtime.database.query<{ owner: string }, []>("SELECT DISTINCT owner FROM photo_cleanup ORDER BY owner LIMIT 100").all();
    for (const { owner } of owners) {
      if (!owner.startsWith("actor:") || cleanupAbort.signal.aborted) continue;
      for (const item of caseStore.pendingCleanup(owner, 10)) {
        if (cleanupAbort.signal.aborted) return;
        try { await photoStore.revoke(owner.slice(6), item.photoRef, cleanupAbort.signal); }
        catch (error) {
          if (!(error instanceof PhotoStorageError)) throw error;
          if (cleanupAbort.signal.aborted) return;
          console.error("Private photo cleanup deferred; obligation retained.");
          continue;
        }
        caseStore.completeCleanup(owner, item.caseId, item.photoRef);
      }
    }
  };
  cleaning = work().catch(() => { if (!cleanupAbort.signal.aborted) console.error("Private photo cleanup deferred; obligations retained."); }).finally(() => { cleaning = undefined; });
  return cleaning;
};
// Sweep expired cases even when the queue starts empty; this enqueues their photos.
if (photoStore) {
  caseStore.pendingCleanup("startup-sweep", 1);
  await cleanup();
}
const cleanupTimer = photoStore ? setInterval(() => {
  try { caseStore.pendingCleanup("interval-sweep", 1); void cleanup(); }
  catch { console.error("Private photo cleanup deferred; storage unavailable."); }
}, 30000) : undefined;
cleanupTimer?.unref();
const handlers = new Set<Promise<void>>();
const bridge = requestBridge(origin, app.fetch);
const server = createServer((incoming, outgoing) => {
  const work = bridge(incoming, outgoing); handlers.add(work);
  void work.then(() => handlers.delete(work), () => { handlers.delete(work); outgoing.destroy(); });
});
server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
let shuttingDown = false;
function shutdown(exitCode: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(cleanupTimer); cleanupAbort.abort();
  const stopped = new Promise<void>(done => server.close(() => done()));
  app.dispose();
  const deadline = setTimeout(() => {
    server.closeAllConnections();
    process.exit(exitCode);
  }, 1000);
  deadline.unref();
  const finish = async () => {
    await stopped;
    await Promise.allSettled([...handlers]);
    await app.close(); await cleaning;
    caseStore.dispose(); runtime.close();
    clearTimeout(deadline); process.exitCode = exitCode;
  };
  void finish().catch(() => { console.error("Re:Source shutdown failed; process stopping."); process.exit(1); });
}
process.once("SIGTERM", () => shutdown(0));
process.once("SIGINT", () => shutdown(0));
server.once("error", () => {
  console.error("Re:Source app startup failed; local assessment stopped.");
  shutdown(1);
});
try {
  server.listen(port, "127.0.0.1", () => console.log(`Re:Source app: ${origin} (auth=${authMode}; runner=${mode}; resources=${resources ? "configured-review-required" : "unavailable"}; photos=${privatePhotos}; live provider not verified)`));
} catch (error) {
  shutdown(1);
  if (error instanceof Error) {
    console.error("Re:Source app startup failed; local assessment stopped.");
    process.exitCode = 1;
  } else throw error;
}
} catch (error) { try { startupStore?.dispose(); } finally { runtime.close(); } throw error; }
}
if (import.meta.main) {
  try { await startApp(); }
  catch { console.error("Re:Source startup failed; check explicit runtime configuration and private storage."); process.exitCode = 1; }
}
