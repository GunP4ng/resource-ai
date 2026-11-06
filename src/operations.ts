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

/** Monotonic scheduling boundary; injectable for deterministic deadline regressions. */
export interface OperationalClock {
  readonly now: () => number;
  readonly schedule: (callback: () => void, delayMs: number) => () => void;
}
const monotonicClock: OperationalClock = {
  now: () => performance.now(),
  schedule(callback, delayMs) { const timer = setTimeout(callback, Math.max(0, Math.ceil(delayMs))); return () => clearTimeout(timer); },
};
function requestDeadline(clock: OperationalClock, end: number, parent: AbortSignal, cancellation: () => "timeout" | "cancelled" = () => "cancelled") {
  const controller = new AbortController(); let failure: SessionFailure | undefined, closed = false;
  let reject!: (error: SessionFailure) => void, clearTimer = () => {};
  const interrupted = new Promise<never>((_resolve, no) => { reject = no; });
  // A pre-aborted caller is valid even before the operation attaches its race handler.
  void interrupted.catch(() => {});
  const stop = (code: "timeout" | "cancelled") => {
    if (failure || closed) return;
    failure = new SessionFailure(code); reject(failure); controller.abort(failure);
  };
  const remaining = () => Math.max(0, end - clock.now());
  const check = () => {
    if (!closed && !failure && remaining() === 0) stop("timeout");
    if (failure) throw failure;
    if (closed) throw new SessionFailure("cancelled");
  };
  const cancel = () => stop(cancellation());
  const expire = () => { if (remaining() === 0) stop("timeout"); else clearTimer = clock.schedule(expire, remaining()); };
  parent.addEventListener("abort", cancel, { once: true });
  if (parent.aborted) cancel(); else clearTimer = clock.schedule(expire, remaining());
  return { clock, end, signal: controller.signal, interrupted, remaining, check, stop,
    get failure() { return failure; },
    close() { closed = true; clearTimer(); parent.removeEventListener("abort", cancel); controller.abort(failure ?? new SessionFailure("cancelled")); },
  };
}
const requestBudgets = new AsyncLocalStorage<ReturnType<typeof requestDeadline>>();

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
  readonly clock?: OperationalClock;
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
  // Set once at fetch entry. Every later stage consumes this same absolute budget.
  const timeoutMs = options.timeoutMs ?? (enabled ? options.operations!.timeoutMs + 1500 : 10_000);
  const clock = options.clock ?? monotonicClock;
  const active = new Set<ReturnType<typeof requestDeadline>>(); let disposed = false;
  const app = createResourceApp({ origin: options.origin, runner, timeoutMs,
    checkRequest: () => requestBudgets.getStore()?.check(),
    resources: async (input, signal) => {
      requestBudgets.getStore()?.check();
      const resources = await options.resources?.(input, signal) ?? {};
      requestBudgets.getStore()?.check(); return resources;
    },
  });
  return {
    async fetch(request: Request): Promise<Response> {
      const budget = requestDeadline(clock, clock.now() + timeoutMs, request.signal); active.add(budget);
      try {
        if (disposed) budget.stop("cancelled"); budget.check();
        // Forward the same body stream; cloning a Request may tee it and leave the
        // original branch alive when O4 cancels its reader (notably on Bun).
        const forwarded = new Request(request.url, { method: request.method, headers: request.headers,
          body: request.body, signal: budget.signal, duplex: "half" } as RequestInit & { duplex: "half" });
        const work = async () => {
          budget.check(); const url = new URL(forwarded.url);
          if (forwarded.method === "GET" && url.origin === new URL(options.origin).origin && url.pathname === "/operations/readiness") {
            return Response.json({ mode: enabled ? "request-gated" : "local-only", azure: "not-verified",
              authorization: enabled ? "required-per-request" : "disabled", photos: binding && enabled ? "server-bound" : "reference-only",
              resources: options.resources ? "server-bound-unverified" : "unavailable", liveAzureVerified: false }, { headers: { "cache-control": "no-store" } });
          }
          if (!enabled || !options.photoStore) return app.fetch(forwarded);
          let identity: string | null;
          try { identity = await options.actorForRequest!(forwarded, budget.signal); }
          catch { budget.check(); return new Response("Authentication unavailable", { status: 503 }); }
          budget.check();
          if (!identity) return new Response("Authentication required", { status: 403 });
          return actors.run(identity, () => app.fetch(forwarded));
        };
        const response = await requestBudgets.run(budget, () => Promise.race([budget.interrupted, work()]));
        budget.check(); return response;
      } catch (error) {
        const failure = budget.failure ?? (error instanceof SessionFailure ? error : undefined);
        return new Response(failure?.code === "timeout" ? "Request deadline exceeded" : failure?.code === "cancelled" ? "Request cancelled" : "Execution failed",
          { status: failure?.code === "timeout" ? 504 : failure?.code === "cancelled" ? 408 : 502, headers: { "cache-control": "no-store" } });
      } finally { budget.close(); active.delete(budget); }
    },
    dispose() { disposed = true; for (const budget of active) budget.stop("cancelled"); app.dispose(); },
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
  readonly requests: readonly { readonly attempt: number; readonly approvalId: string; readonly transportStarted: boolean; readonly status: number | null; readonly requestId: string | null }[];
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
    const parent = requestBudgets.getStore(), clock = parent?.clock ?? monotonicClock;
    const facts = parsed.value, runId = randomUUID(), caseRevision = revision(facts), started = clock.now();
    const end = parent?.end ?? started + options.timeoutMs;
    // Reserve terminal audit time WITHIN the existing deadline, never after a fresh timeout.
    const reserve = Math.min(1000, Math.max(0, end - started) * 0.1);
    const work = requestDeadline(clock, Math.min(started + options.timeoutMs, end - reserve), signal,
      () => parent?.failure?.code === "timeout" ? "timeout" : "cancelled");
    const controller = { signal: work.signal };
    const requests: { attempt: number; approvalId: string; transportStarted: boolean; status: number | null; requestId: string | null }[] = [];
    const resolved: { photoRef: string; sha256: string; mimeType: "image/png" | "image/jpeg" }[] = [];
    let sentImages: OperationalAudit["images"] = [];
    let usage: OperationalAudit["usage"] = null, outcome: NonNullable<OperationalAudit["outcome"]> = "provider";
    let dispatchFailure: SessionFailure | undefined;
    const check = () => { parent?.check(); work.check(); };
    const event = (phase: OperationalAudit["phase"]): OperationalAudit => ({ phase, runId, caseRevision,
      at: new Date().toISOString(), elapsedMs: Math.max(0, clock.now() - started), ...(phase === "finish" ? { outcome } : {}),
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
      check();
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
          const row = { attempt, approvalId: permit.approvalId, transportStarted: false, status: null as number | null, requestId: null as string | null };
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
          row.transportStarted = true; // Invocation evidence, not proof of provider processing or billing.
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
      const result = await Promise.race([work.interrupted, run()]); check();
      usage = usageOf(result.execution?.usage); outcome = "success"; return result;
    } catch (error) {
      const failure = parent?.failure ?? work.failure ?? (error instanceof SessionFailure ? error : new SessionFailure("provider"));
      outcome = failure.code; throw failure;
    } finally {
      work.close(); // Also blocks late continuations of callbacks which ignored their AbortSignal.
      // Never log raw cases, images, credentials, URLs or exception/provider bodies.
      const auditController = new AbortController(); let clearAudit = () => {};
      try {
        const remaining = Math.max(0, Math.min(end - clock.now(), 1000));
        const expired = new Promise<never>((_resolve, reject) => {
          const stopAudit = () => { auditController.abort(); reject(new SessionFailure("provider")); };
          if (!remaining) stopAudit(); else clearAudit = clock.schedule(stopAudit, remaining);
        });
        await Promise.race([expired, options.record(event("finish"), auditController.signal)]);
        if (clock.now() >= end) throw new SessionFailure("provider");
      } catch { throw new SessionFailure("provider"); } finally { clearAudit(); auditController.abort(); }
    }
  };
}
