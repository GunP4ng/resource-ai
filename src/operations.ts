import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { zstdDecompressSync } from "node:zlib";
import type { FetchFunction } from "@earendil-works/pi-ai";
import type { CaseInput } from "./contracts.ts";
import { parseCaseInput } from "./input.ts";
import { revision } from "./o-validation.ts";
import { createAzureRunner, createSubscriptionRunner, createResourceApp, openCaseSession, SessionFailure } from "./session.ts";
import type { CaseRunner, PhotoResolver, ResourceProvider, SessionFailureCode } from "./session.ts";
import type { createPhotoStore } from "./photos.ts";
import { createCaseStore } from "./o-case-store.ts";
import type { OCaseStore } from "./o-case-store.ts";
import type { AppDependencies } from "./app.ts";
import { checkedConfiguration, AzureConfigurationError } from "./azure-configuration.ts";
import type { AzureConfiguration } from "./azure-configuration.ts";
import type { PhotoExecutionAuthority, PhotoExecutionTicket } from "./photo-execution.ts";
import { checkedSubscriptionConfiguration, subscriptionCredentials, SubscriptionConfigurationError, SUBSCRIPTION_ENDPOINT, type SubscriptionConfiguration } from "./subscription-configuration.ts";
export type { AzureConfiguration } from "./azure-configuration.ts";

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
  const controller = new AbortController(); let failure: SessionFailure | undefined, closed = false, committed = false;
  let reject!: (error: SessionFailure) => void, clearTimer = () => {};
  const interrupted = new Promise<never>((_resolve, no) => { reject = no; });
  // A pre-aborted caller is valid even before the operation attaches its race handler.
  void interrupted.catch(() => {});
  const stop = (code: "timeout" | "cancelled") => {
    if (failure || closed || committed) return;
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
    commit() { committed = true; clearTimer(); },
    get committed() { return committed; },
    get failure() { return failure; },
    close() { closed = true; clearTimer(); parent.removeEventListener("abort", cancel); controller.abort(failure ?? new SessionFailure("cancelled")); },
  };
}
const requestBudgets = new AsyncLocalStorage<ReturnType<typeof requestDeadline>>();

/** H/O composition used by the launcher. Without operations or a runner, assessment is local.
 * Identity verification and storage policy are injected by the server owner.
 * No environment variable can enable inference here; readiness never claims live verification.
 */
export function createOperationalApp(options: {
  readonly origin: string;
  readonly operations?: OperationalRunnerOptions | SubscriptionOperationalRunnerOptions;
  /** Local launcher integration; mutually exclusive with request-gated operations. */
  readonly runner?: CaseRunner;
  readonly resources?: ResourceProvider;
  readonly timeoutMs?: number;
  readonly photoStore?: Awaited<ReturnType<typeof createPhotoStore>>;
  readonly actorForRequest?: AppDependencies["actorForRequest"];
  readonly clock?: OperationalClock;
  readonly caseStore?: OCaseStore;
  readonly photoPolicy?: AppDependencies["photoPolicy"];
}, open: typeof openCaseSession = openCaseSession) {
  if (options.photoStore && !options.actorForRequest) throw new RangeError("authenticated-photo-actor-required");
  if (options.runner && options.operations) throw new RangeError("conflicting-runner-configuration");
  const enabled = options.operations?.enabled === true;
  const photoExecution = enabled ? options.operations?.photoExecution : undefined;
  const caseStore = options.caseStore ?? createCaseStore(Date.now, photoExecution);
  const actor = () => caseStore.currentActor();
  const binding: OperationalRunnerOptions["photos"] = options.photoStore ? {
    resolve: (request, signal, ticket) => {
      if (!caseStore.canResolve(actor(), request.caseId, request.photoRef, request.caseRevision)) throw new SessionFailure("provider");
      return options.photoStore!.resolver(actor(), ticket)(request, signal);
    },
    assertCanTransmit: (input, signal, expected, ticket) => {
      if (!input.photoRefs.every(ref => caseStore.canResolve(actor(), input.caseId, ref, revision(input)))) throw new SessionFailure("provider");
      return options.photoStore!.assertCanTransmit(actor(), input, signal, expected, ticket);
    },
  } : options.operations?.photos;
  const runner = enabled ? createOperationalRunner({ ...options.operations!, photos: binding,
    photoTicket: () => caseStore.currentPhotoTicket() }, open) : options.runner;
  // Set once at fetch entry. Every later stage consumes this same absolute budget.
  const timeoutMs = options.timeoutMs ?? (enabled ? options.operations!.timeoutMs + 1500 : 10_000);
  const clock = options.clock ?? monotonicClock;
  const active = new Set<ReturnType<typeof requestDeadline>>(); let disposed = false;
  const app = createResourceApp({ origin: options.origin, runner, timeoutMs,
    caseStore, photoStore: options.photoStore, photoExecution,
    photoPolicy: options.photoPolicy,
    committed: () => requestBudgets.getStore()?.commit(),
    actorForRequest: options.actorForRequest,
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
            return Response.json({ mode: enabled ? "request-gated" : runner ? "model-runner" : "local-only", azure: "not-verified",
              authorization: enabled ? "required-per-request" : "disabled", photos: binding && enabled ? "server-bound" : "reference-only",
              identity: options.actorForRequest ? "server-resolver" : "anonymous-session", privatePhotoStorage: !!(options.actorForRequest && options.photoStore && options.photoPolicy),
              guardedModelPhotos: !!(enabled && binding && options.photoStore && photoExecution?.current()),
              resources: options.resources ? "server-bound-unverified" : "unavailable", liveAzureVerified: false,
              modelProvider: enabled ? options.operations?.provider === "subscription" ? "chatgpt-subscription" : "azure-openai-responses" : null,
              liveModelVerified: false }, { headers: { "cache-control": "no-store" } });
          }
          return app.fetch(forwarded);
        };
        const response = await requestBudgets.run(budget, () => Promise.race([budget.interrupted, work()]));
        if (!budget.committed) budget.check(); return response;
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
  readonly provider?: "azure-openai-responses" | "chatgpt-subscription";
  /** Subscription SSE currently does NOT serialize a provider-enforced output token cap. */
  readonly outputLimitEnforced?: boolean;
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
interface OperationalRunnerCommon {
  readonly enabled: boolean;
  readonly timeoutMs: number;
  readonly maxTurns: number;
  readonly maxOutputTokens: number;
  /** Must verify live approval and reserve budget atomically for EACH outbound request. */
  readonly authorizeDispatch: (request: DispatchRequest, signal: AbortSignal) => Promise<DispatchPermit | null>;
  /** Durable, access-controlled sink. A failed start/dispatch write blocks network dispatch. */
  readonly record: (event: OperationalAudit, signal?: AbortSignal) => Promise<void>;
  /** Composition pins this in the private case lease before resources. Direct runners pin current at entry. */
  readonly photoTicket?: () => PhotoExecutionTicket;
  readonly photos?: { readonly resolve: (request: Parameters<PhotoResolver>[0], signal: AbortSignal, ticket?: PhotoExecutionTicket) => ReturnType<PhotoResolver>; readonly assertCanTransmit: (input: CaseInput, signal: AbortSignal, expected: readonly { photoRef: string; sha256: string }[], ticket?: PhotoExecutionTicket) => Promise<void> };
  readonly transport?: FetchFunction;
}
export type OperationalRunnerOptions = OperationalRunnerCommon & {
  readonly provider?: "azure";
  readonly configuration: (signal: AbortSignal) => Promise<AzureConfiguration | null>;
  readonly photoExecution?: PhotoExecutionAuthority<AzureConfiguration>;
};
export type SubscriptionOperationalRunnerOptions = OperationalRunnerCommon & {
  readonly provider: "subscription";
  readonly configuration: (signal: AbortSignal) => Promise<SubscriptionConfiguration | null>;
  readonly photoExecution?: PhotoExecutionAuthority<SubscriptionConfiguration>;
};

const safeId = /^[A-Za-z0-9_.-]{1,128}$/;
const isId = (value: unknown): value is string => typeof value === "string" && safeId.test(value);
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const isSubscription = (config: AzureConfiguration | SubscriptionConfiguration): config is SubscriptionConfiguration => "provider" in config;
function matchesExecutionTarget(config: AzureConfiguration | SubscriptionConfiguration, target: PhotoExecutionTicket["target"]): boolean {
  if (isSubscription(config)) return "provider" in target && target.provider === config.provider
    && target.endpoint === SUBSCRIPTION_ENDPOINT && target.modelId === config.modelId && target.accountIdSha256 === config.accountIdSha256;
  return "deployment" in target && target.endpoint === config.endpoint && target.deployment === config.deployment
    && target.modelId === config.modelId && target.apiVersion === config.apiVersion;
}
/** Snapshot and inspect the exact SDK SSE payload, including its bounded zstd encoding. */
function subscriptionPayload(init: RequestInit) {
  const headers = new Headers(init.headers), limit = 64 * 1024 * 1024;
  const bytes = typeof init.body === "string" ? Buffer.from(init.body) : init.body instanceof ArrayBuffer ? Buffer.from(new Uint8Array(init.body))
    : ArrayBuffer.isView(init.body) ? Buffer.from(new Uint8Array(init.body.buffer, init.body.byteOffset, init.body.byteLength)) : null;
  if (!bytes || bytes.length > limit) throw new SessionFailure("not-configured");
  const encoding = headers.get("content-encoding");
  if (encoding && encoding !== "zstd") throw new SessionFailure("not-configured");
  const decoded = encoding === "zstd" ? zstdDecompressSync(bytes, { maxOutputLength: limit }) : bytes;
  const body: unknown = JSON.parse(decoded.toString("utf8"));
  // Keep the copied compressed bytes intact; the approved bytes are the bytes dispatched.
  return { init: { ...init, headers, body: new Uint8Array(bytes).buffer }, body };
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
export function createOperationalRunner(options: OperationalRunnerOptions | SubscriptionOperationalRunnerOptions, open: typeof openCaseSession = openCaseSession): CaseRunner {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 300_000
    || !Number.isInteger(options.maxTurns) || options.maxTurns < 1 || options.maxTurns > 10
    || !Number.isInteger(options.maxOutputTokens) || options.maxOutputTokens < 16 || options.maxOutputTokens > 8192) throw new RangeError("invalid-operational-limits");
  return async (input, signal, resources) => {
    const parsed = parseCaseInput(input);
    if (!parsed.ok) throw new SessionFailure("provider");
    const parent = requestBudgets.getStore(), clock = parent?.clock ?? monotonicClock;
    const facts = parsed.value, runId = randomUUID(), caseRevision = revision(facts), started = clock.now();
    const ticket = facts.photoRefs.length ? (options.photoTicket?.() ?? options.photoExecution?.current()) : undefined;
    const assertPhotoExecution = () => {
      if (!facts.photoRefs.length) return;
      if (!options.photoExecution || !ticket) throw new SessionFailure("not-configured");
      options.photoExecution.assertCurrent(ticket);
    };
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
      assertPhotoExecution();
      const photo = await options.photos!.resolve(request, imageSignal, ticket ?? undefined);
      assertPhotoExecution();
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
      assertPhotoExecution();
      const supplied = ticket ? options.photoExecution!.configuration(ticket) : await options.configuration(controller.signal); check();
      const config = options.provider === "subscription"
        ? checkedSubscriptionConfiguration(supplied as SubscriptionConfiguration | null)
        : checkedConfiguration(supplied as AzureConfiguration | null);
      // A miswired authority must not move an issued consent to another target.
      if (ticket && !matchesExecutionTarget(config, ticket.target)) throw new SessionFailure("not-configured");
      const endpoint = isSubscription(config) ? SUBSCRIPTION_ENDPOINT : config.endpoint;
      if (facts.photoRefs.length && !options.photos) throw new SessionFailure("provider");
      const transport: FetchFunction = async (request, init) => {
        try {
          check();
          assertPhotoExecution();
          let dispatchInit = { ...init };
          let serialized: unknown;
          // Defense against redirects/SDK endpoint changes before any billable dispatch.
          const actual = new URL(typeof request === "string" ? request : request instanceof URL ? request.href : request.url);
          if (actual.origin !== new URL(endpoint).origin) throw new SessionFailure("not-configured");
          if (isSubscription(config)) {
            const snapshot = subscriptionPayload(dispatchInit); dispatchInit = snapshot.init; serialized = snapshot.body;
            const account = new Headers(dispatchInit.headers).get("chatgpt-account-id");
            if (actual.href !== SUBSCRIPTION_ENDPOINT || dispatchInit.method !== "POST" || !account || sha(account) !== config.accountIdSha256
              || typeof serialized !== "object" || !serialized || !("model" in serialized) || serialized.model !== config.modelId) throw new SessionFailure("not-configured");
          } else if (ticket) {
            serialized = JSON.parse(typeof dispatchInit.body === "string" ? dispatchInit.body : "null");
            if (actual.pathname !== "/openai/v1/responses" || actual.hash || actual.username || actual.password
              || actual.searchParams.size !== 1 || actual.searchParams.get("api-version") !== config.apiVersion
              || dispatchInit.method !== "POST" || typeof serialized !== "object" || serialized === null || !("model" in serialized) || serialized.model !== config.deployment) throw new SessionFailure("not-configured");
          }
          check();
          const attempt = requests.length + 1;
          if (attempt > options.maxTurns) throw new SessionFailure("turn-limit");
          const permit = await options.authorizeDispatch({ runId, caseRevision, endpoint,
            deployment: isSubscription(config) ? "" : config.deployment, modelId: config.modelId, attempt, maxOutputTokens: options.maxOutputTokens,
            provider: isSubscription(config) ? "chatgpt-subscription" : "azure-openai-responses", outputLimitEnforced: !isSubscription(config) }, controller.signal);
          check();
          if (!permit || !isId(permit.approvalId) || !Number.isSafeInteger(permit.expiresAt) || permit.expiresAt <= Date.now()) throw new SessionFailure("not-configured");
          const row = { attempt, approvalId: permit.approvalId, transportStarted: false, status: null as number | null, requestId: null as string | null };
          requests.push(row);
          await options.record(event("dispatch"), controller.signal); check();
          if (facts.photoRefs.length) {
            // Re-resolve to reject byte/MIME changes as well as revoked permissions.
            for (const expected of resolved) {
              const latest = await options.photos!.resolve({ caseId: facts.caseId, caseRevision, photoRef: expected.photoRef }, controller.signal, ticket ?? undefined);
              if (!latest || latest.approvedForModel !== true || latest.caseId !== facts.caseId || latest.caseRevision !== caseRevision
                || latest.photoRef !== expected.photoRef || latest.mimeType !== expected.mimeType || latest.sha256 !== expected.sha256
                || !(latest.data instanceof Uint8Array) || sha(latest.data) !== expected.sha256) throw new SessionFailure("provider");
            }
            // Verify the SDK's serialized payload too; a resize/substitution must not silently change the evidence SHA.
            const body = serialized as { input?: { content?: { type?: string; image_url?: string }[] }[] } | null;
            const urls = body?.input?.flatMap((message) => Array.isArray(message.content) ? message.content.filter((part) => part.type === "input_image").map((part) => part.image_url) : []) ?? [];
            if (urls.length !== resolved.length || urls.some((url, index) => {
              const expected = resolved[index]!; const prefix = `data:${expected.mimeType};base64,`;
              if (typeof url !== "string" || !url.startsWith(prefix)) return true;
              const encoded = url.slice(prefix.length), bytes = Buffer.from(encoded, "base64");
              return bytes.toString("base64") !== encoded || sha(bytes) !== expected.sha256;
            })) throw new SessionFailure("provider");
            await options.photos!.assertCanTransmit(facts, controller.signal, resolved, ticket ?? undefined);
          }
          check();
          if (permit.expiresAt <= Date.now()) throw new SessionFailure("not-configured");
          assertPhotoExecution();
          sentImages = resolved.map((image) => ({ photoRefSha256: sha(image.photoRef), sha256: image.sha256, mimeType: image.mimeType }));
          row.transportStarted = true; // Invocation evidence, not proof of provider processing or billing.
          const response = await (options.transport ?? fetch)(ticket || isSubscription(config) ? actual.href : request, { ...dispatchInit, signal: controller.signal, redirect: "error" });
          row.status = response.status;
          const id = response.headers.get("x-request-id") ?? response.headers.get("apim-request-id");
          if (id && /^[A-Za-z0-9_-]{1,100}$/.test(id)) row.requestId = id;
          return response;
        } catch (error) {
          dispatchFailure = error instanceof SessionFailure ? error : new SessionFailure("provider");
          throw dispatchFailure;
        }
      };
      const common = { enabled: true, modelId: config.modelId, maxTurns: options.maxTurns,
        maxOutputTokens: options.maxOutputTokens, transport, photos: options.photos ? photos : undefined };
      const runner = isSubscription(config)
        ? createSubscriptionRunner({ ...common, authPath: config.authPath }, async (facts, settings) => {
          let credentials;
          try { credentials = subscriptionCredentials(config, check); }
          catch (error) { if (error instanceof SubscriptionConfigurationError) throw new SessionFailure("not-configured"); throw error; }
          const owned = await open(facts, { ...settings, credentials });
          try {
            check();
            if (owned.session.model?.api !== "openai-codex-responses") throw new SessionFailure("not-configured");
            return owned;
          } catch (error) { await owned.close(); throw error; }
        })
        : createAzureRunner({ ...common, env: { AZURE_OPENAI_API_KEY: config.apiKey, AZURE_OPENAI_BASE_URL: config.endpoint,
          AZURE_OPENAI_DEPLOYMENT_NAME_MAP: `${config.modelId}=${config.deployment}`, AZURE_OPENAI_API_VERSION: config.apiVersion } }, open);
      try { return await runner(facts, controller.signal, resources); }
      catch (error) { throw dispatchFailure ?? error; }
    };
    try {
      const result = await Promise.race([work.interrupted, run()]); check(); assertPhotoExecution();
      usage = usageOf(result.execution?.usage); outcome = "success"; return result;
    } catch (error) {
      const failure = parent?.failure ?? work.failure ?? (error instanceof SessionFailure ? error : new SessionFailure(error instanceof AzureConfigurationError || error instanceof SubscriptionConfigurationError ? "not-configured" : "provider"));
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
        if (outcome === "success") assertPhotoExecution();
      } catch { throw new SessionFailure("provider"); } finally { clearAudit(); auditController.abort(); }
    }
  };
}
