import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { FetchFunction } from "@earendil-works/pi-ai";
import type { CaseInput } from "./contracts.ts";
import { parseCaseInput } from "./input.ts";
import { revision } from "./o-validation.ts";
import { createAzureRunner, createResourceApp, openCaseSession, SessionFailure } from "./session.ts";
import type { CaseRunner, PhotoResolver, ResourceProvider, SessionFailureCode } from "./session.ts";
import type { createPhotoStore } from "./photos.ts";

/** Inject from the server secret store, never JSON/form input. No process.env fallback. */
export interface AzureConfiguration {
  readonly endpoint: string;
  readonly deployment: string;
  readonly modelId: string;
  readonly apiKey: string;
  readonly apiVersion: string;
}

/** H-owned composition used by the launcher. Missing operations keep local assessment only.
 * Actor/case ownership, consent collection and upload UI remain server integration responsibilities.
 * No environment variable can enable inference here; readiness never claims live verification.
 */
export function createOperationalApp(options: {
  readonly origin: string;
  readonly operations?: OperationalRunnerOptions;
  readonly resources?: ResourceProvider;
  readonly timeoutMs?: number;
  readonly photoStore?: Awaited<ReturnType<typeof createPhotoStore>>;
  readonly actorForRequest?: (request: Request, signal: AbortSignal) => Promise<string | null>;
}, open: typeof openCaseSession = openCaseSession) {
  if (options.photoStore && !options.actorForRequest) throw new RangeError("authenticated-photo-actor-required");
  const actors = new AsyncLocalStorage<string | null>();
  const actor = () => { const value = actors.getStore(); if (!value) throw new SessionFailure("authentication"); return value; };
  const binding: OperationalRunnerOptions["photos"] = options.photoStore ? {
    resolve: (request, signal) => options.photoStore!.resolver(actor())(request, signal),
    assertCanTransmit: (input, signal, expected) => options.photoStore!.assertCanTransmit(actor(), input, signal, expected),
  } : options.operations?.photos;
  const enabled = options.operations?.enabled === true;
  const runner = enabled ? createOperationalRunner({ ...options.operations!, photos: binding }, open) : undefined;
  // Keep the runner's deadline below both H and O adapter deadlines so its timeout is recorded first.
  const timeoutMs = options.timeoutMs ?? (enabled ? options.operations!.timeoutMs + 1500 : 10_000);
  if (enabled && timeoutMs <= options.operations!.timeoutMs + Math.min(options.operations!.timeoutMs, 1000)) throw new RangeError("app-deadline-must-allow-audit");
  const app = createResourceApp({ origin: options.origin, runner, resources: options.resources, timeoutMs });
  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (request.method === "GET" && url.origin === new URL(options.origin).origin && url.pathname === "/operations/readiness") {
        return Response.json({ mode: enabled ? "request-gated" : "local-only", azure: "not-verified",
          authorization: enabled ? "required-per-request" : "disabled", photos: binding && enabled ? "server-bound" : "reference-only",
          resources: options.resources ? "server-bound-unverified" : "unavailable", liveAzureVerified: false }, { headers: { "cache-control": "no-store" } });
      }
      if (!enabled || !options.photoStore) return app.fetch(request);
      let identity: string | null;
      const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
      let rejectAbort: () => void = () => {};
      const cancelled = new Promise<never>((_resolve, reject) => { rejectAbort = () => { controller.abort(); reject(new Error("cancelled")); }; });
      request.signal.addEventListener("abort", rejectAbort, { once: true });
      try {
        if (request.signal.aborted) rejectAbort();
        identity = await Promise.race([cancelled, options.actorForRequest!(request, controller.signal), new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error("authentication-timeout")); }, timeoutMs);
        })]);
      } catch { return new Response("Authentication unavailable", { status: request.signal.aborted ? 408 : 503 }); }
      finally { clearTimeout(timer); request.signal.removeEventListener("abort", rejectAbort); }
      if (!identity) return new Response("Authentication required", { status: 403 });
      return actors.run(identity, () => app.fetch(request));
    },
    dispose: app.dispose,
  };
}
export interface DispatchRequest {
  readonly runId: string;
  readonly caseRevision: string;
  readonly endpoint: string;
  readonly deployment: string;
  readonly modelId: string;
  readonly attempt: number;
  readonly maxOutputTokens: number;
}
export interface DispatchPermit { readonly approvalId: string; readonly expiresAt: number }
export interface OperationalAudit {
  readonly phase: "start" | "dispatch" | "finish";
  readonly runId: string;
  readonly caseRevision: string;
  readonly at: string;
  readonly elapsedMs: number;
  readonly outcome?: "success" | SessionFailureCode;
  readonly requests: readonly { readonly attempt: number; readonly approvalId: string; readonly status: number | null; readonly requestId: string | null }[];
  /** null means unavailable, including interrupted/failed calls; it never means zero cost. */
  readonly usage: Readonly<Record<"input" | "output" | "cacheRead" | "cacheWrite" | "total", number>> | null;
  /** Hashes of actual outbound image bytes; never raw refs, URLs or image content. */
  readonly images: readonly { readonly photoRefSha256: string; readonly sha256: string; readonly mimeType: string }[];
}
export interface OperationalRunnerOptions {
  readonly enabled: boolean;
  readonly timeoutMs: number;
  readonly maxTurns: number;
  readonly maxOutputTokens: number;
  readonly configuration: (signal: AbortSignal) => Promise<AzureConfiguration | null>;
  /** Must verify live approval and reserve budget atomically for EACH outbound request. */
  readonly authorizeDispatch: (request: DispatchRequest, signal: AbortSignal) => Promise<DispatchPermit | null>;
  /** Durable, access-controlled sink. A failed start/dispatch write blocks network dispatch. */
  readonly record: (event: OperationalAudit, signal?: AbortSignal) => Promise<void>;
  readonly photos?: { readonly resolve: PhotoResolver; readonly assertCanTransmit: (input: CaseInput, signal: AbortSignal, expected: readonly { photoRef: string; sha256: string }[]) => Promise<void> };
  readonly transport?: FetchFunction;
}

const safeId = /^[A-Za-z0-9_.-]{1,128}$/;
const isId = (value: unknown): value is string => typeof value === "string" && safeId.test(value);
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function checkedConfiguration(value: AzureConfiguration | null): AzureConfiguration {
  if (!value || !isId(value.deployment) || !isId(value.modelId) || !isId(value.apiVersion)
    || typeof value.apiKey !== "string" || !value.apiKey.trim()) throw new SessionFailure("not-configured");
  let url: URL;
  try { url = new URL(value.endpoint); } catch { throw new SessionFailure("not-configured"); }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".openai.azure.com") || url.port || url.username || url.password
    || url.search || url.hash || !["", "/", "/openai/v1"].includes(url.pathname)) throw new SessionFailure("not-configured");
  return { ...value };
}
function usageOf(text: string | null | undefined): OperationalAudit["usage"] {
  if (text == null) return null;
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    const result = { input: data["input"], output: data["output"], cacheRead: data["cacheRead"], cacheWrite: data["cacheWrite"], total: data["total"] };
    return Object.values(result).every((v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0)
      ? result as NonNullable<OperationalAudit["usage"]> : null;
  } catch { return null; }
}

/** Reuses PR23's runner and its public failure codes. This does not install an app route. */
export function createOperationalRunner(options: OperationalRunnerOptions, open: typeof openCaseSession = openCaseSession): CaseRunner {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 300_000
    || !Number.isInteger(options.maxTurns) || options.maxTurns < 1 || options.maxTurns > 10
    || !Number.isInteger(options.maxOutputTokens) || options.maxOutputTokens < 16 || options.maxOutputTokens > 8192) throw new RangeError("invalid-operational-limits");
  return async (input, signal, resources) => {
    const parsed = parseCaseInput(input);
    if (!parsed.ok) throw new SessionFailure("provider");
    const facts = parsed.value, runId = randomUUID(), caseRevision = revision(facts), started = Date.now();
    const controller = new AbortController();
    const requests: { attempt: number; approvalId: string; status: number | null; requestId: string | null }[] = [];
    const resolved: { photoRef: string; sha256: string; mimeType: "image/png" | "image/jpeg" }[] = [];
    let sentImages: OperationalAudit["images"] = [];
    let usage: OperationalAudit["usage"] = null, outcome: NonNullable<OperationalAudit["outcome"]> = "provider";
    let stop: SessionFailure | undefined, dispatchFailure: SessionFailure | undefined;
    let rejectStop: (error: SessionFailure) => void = () => {};
    const interrupted = new Promise<never>((_resolve, reject) => { rejectStop = reject; });
    const abort = (code: "cancelled" | "timeout") => {
      if (stop) return; stop = new SessionFailure(code); rejectStop(stop); controller.abort(stop);
    };
    const cancel = () => abort("cancelled");
    signal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => abort("timeout"), options.timeoutMs);
    const check = () => { if (stop) throw stop; };
    const event = (phase: OperationalAudit["phase"]): OperationalAudit => ({ phase, runId, caseRevision,
      at: new Date().toISOString(), elapsedMs: Math.max(0, Date.now() - started), ...(phase === "finish" ? { outcome } : {}),
      requests: structuredClone(requests), images: structuredClone(sentImages), usage });
    const photos: PhotoResolver = async (request, imageSignal) => {
      const photo = await options.photos!.resolve(request, imageSignal);
      if (!photo) return null;
      const { data, mimeType, sha256, caseId, caseRevision: photoRevision, photoRef, approvedForModel } = photo;
      if (!(data instanceof Uint8Array) || data.length > 10 * 1024 * 1024) throw new SessionFailure("provider");
      const bytes = Buffer.from(data);
      if (sha(bytes) !== sha256) throw new SessionFailure("provider");
      resolved.push({ photoRef, sha256, mimeType });
      return { data: bytes, mimeType, sha256, caseId, caseRevision: photoRevision, photoRef, approvedForModel };
    };
    const run = async () => {
      await options.record(event("start"), controller.signal); check();
      if (options.enabled !== true) throw new SessionFailure("not-configured");
      const config = checkedConfiguration(await options.configuration(controller.signal)); check();
      if (facts.photoRefs.length && !options.photos) throw new SessionFailure("provider");
      const transport: FetchFunction = async (request, init) => {
        try {
          check();
          // Defense against redirects/SDK endpoint changes before any billable dispatch.
          const actual = new URL(typeof request === "string" ? request : request instanceof URL ? request.href : request.url);
          if (actual.origin !== new URL(config.endpoint).origin) throw new SessionFailure("not-configured");
          const attempt = requests.length + 1;
          if (attempt > options.maxTurns) throw new SessionFailure("turn-limit");
          const permit = await options.authorizeDispatch({ runId, caseRevision, endpoint: config.endpoint,
            deployment: config.deployment, modelId: config.modelId, attempt, maxOutputTokens: options.maxOutputTokens }, controller.signal);
          check();
          if (!permit || !isId(permit.approvalId) || !Number.isSafeInteger(permit.expiresAt) || permit.expiresAt <= Date.now()) throw new SessionFailure("not-configured");
          const row = { attempt, approvalId: permit.approvalId, status: null as number | null, requestId: null as string | null };
          requests.push(row);
          await options.record(event("dispatch"), controller.signal); check();
          if (facts.photoRefs.length) {
            // Re-resolve to reject byte/MIME changes as well as revoked permissions.
            for (const expected of resolved) {
              const latest = await options.photos!.resolve({ caseId: facts.caseId, caseRevision, photoRef: expected.photoRef }, controller.signal);
              if (!latest || latest.approvedForModel !== true || latest.caseId !== facts.caseId || latest.caseRevision !== caseRevision
                || latest.photoRef !== expected.photoRef || latest.mimeType !== expected.mimeType || latest.sha256 !== expected.sha256
                || !(latest.data instanceof Uint8Array) || sha(latest.data) !== expected.sha256) throw new SessionFailure("provider");
            }
            // Verify the SDK's serialized payload too; a resize/substitution must not silently change the evidence SHA.
            const body = JSON.parse(typeof init?.body === "string" ? init.body : "null") as { input?: { content?: { type?: string; image_url?: string }[] }[] } | null;
            const urls = body?.input?.flatMap((message) => Array.isArray(message.content) ? message.content.filter((part) => part.type === "input_image").map((part) => part.image_url) : []) ?? [];
            if (urls.length !== resolved.length || urls.some((url, index) => {
              const expected = resolved[index]!; const prefix = `data:${expected.mimeType};base64,`;
              if (typeof url !== "string" || !url.startsWith(prefix)) return true;
              const encoded = url.slice(prefix.length), bytes = Buffer.from(encoded, "base64");
              return bytes.toString("base64") !== encoded || sha(bytes) !== expected.sha256;
            })) throw new SessionFailure("provider");
            await options.photos!.assertCanTransmit(facts, controller.signal, resolved);
          }
          check();
          if (permit.expiresAt <= Date.now()) throw new SessionFailure("not-configured");
          sentImages = resolved.map((image) => ({ photoRefSha256: sha(image.photoRef), sha256: image.sha256, mimeType: image.mimeType }));
          const response = await (options.transport ?? fetch)(request, { ...init, signal: controller.signal, redirect: "error" });
          row.status = response.status;
          const id = response.headers.get("x-request-id") ?? response.headers.get("apim-request-id");
          if (id && /^[A-Za-z0-9_-]{1,100}$/.test(id)) row.requestId = id;
          return response;
        } catch (error) {
          dispatchFailure = error instanceof SessionFailure ? error : new SessionFailure("provider");
          throw dispatchFailure;
        }
      };
      const runner = createAzureRunner({ enabled: true, modelId: config.modelId, maxTurns: options.maxTurns,
        maxOutputTokens: options.maxOutputTokens, transport, photos: options.photos ? photos : undefined,
        env: { AZURE_OPENAI_API_KEY: config.apiKey, AZURE_OPENAI_BASE_URL: config.endpoint,
          AZURE_OPENAI_DEPLOYMENT_NAME_MAP: `${config.modelId}=${config.deployment}`, AZURE_OPENAI_API_VERSION: config.apiVersion } }, open);
      try { return await runner(facts, controller.signal, resources); }
      catch (error) { throw dispatchFailure ?? error; }
    };
    try {
      if (signal.aborted) cancel();
      const result = await Promise.race([interrupted, run()]); check();
      usage = usageOf(result.execution?.usage); outcome = "success"; return result;
    } catch (error) {
      const failure = stop ?? (error instanceof SessionFailure ? error : new SessionFailure("provider"));
      outcome = failure.code; throw failure;
    } finally {
      clearTimeout(timer); signal.removeEventListener("abort", cancel);
      // Never log raw cases, images, credentials, URLs or exception/provider bodies.
      const auditController = new AbortController(); let auditTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([options.record(event("finish"), auditController.signal), new Promise<never>((_resolve, reject) => {
          auditTimer = setTimeout(() => { auditController.abort(); reject(new SessionFailure("provider")); }, Math.min(options.timeoutMs, 1000));
        })]);
      } catch { throw new SessionFailure("provider"); } finally { clearTimeout(auditTimer); }
    }
  };
}
