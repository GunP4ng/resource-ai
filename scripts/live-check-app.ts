import { randomBytes } from "node:crypto";
import { createOperationalApp } from "../src/operations.ts";
import { createSubscriptionRunner, providerRequestId, SessionFailure } from "../src/session.ts";
import { createMemoryRuntimeDatabase } from "../src/o-runtime-db.ts";
import { createCaseStore } from "../src/o-case-store.ts";
import { createLocalAuth } from "../src/o-auth.ts";
import { createResourceDomain } from "../src/domain.ts";
import { canonical } from "../src/o-validation.ts";
import { renderReport } from "../src/report.ts";
import { buildPublicCaseProgress } from "../src/o-case-guidance.ts";
import { caseInputSummary } from "../src/app-views.ts";
import { syntheticCase, syntheticReviewed } from "./live-check-fixtures.ts";
import { boundedResponse } from "./live-check-wire.ts";
import { checkedSubscriptionConfiguration, type SubscriptionRoute } from "../src/subscription-configuration.ts";

const origin = "http://localhost:3148";
const tokenKeys = ["input", "output", "cacheRead", "cacheWrite", "total"] as const;
export function safeUsage(raw: string | null | undefined): Record<typeof tokenKeys[number], number> | null {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const read = (key: typeof tokenKeys[number]): number => {
      const v: unknown = Reflect.get(value, key);
      if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw new RangeError("usage");
      return v;
    };
    return { input: read("input"), output: read("output"), cacheRead: read("cacheRead"), cacheWrite: read("cacheWrite"), total: read("total") };
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof RangeError) return null;
    throw error;
  }
}
/** Mutable per-case telemetry accumulator, finalized before persistence. */
export interface CaseResult {
  name: "normal" | "missing-information" | "app-logout";
  passed: boolean;
  state: "compared" | "needs-information" | "needs-review" | null;
  recommendationCount: number | null;
  preExecutionChecksPresent: boolean | null;
  failure: string | null;
  httpStatus: number | null;
  requestIds: string[];
  traceId: string | null;
  usage: ReturnType<typeof safeUsage>;
  dispatches: number;
  elapsedMs: number;
  reportVerified: boolean;
  priorStatePreserved: boolean | null;
}
export const emptyCase = (name: CaseResult["name"]): CaseResult => ({ name, passed: false, state: null, failure: null,
  recommendationCount: null, preExecutionChecksPresent: null,
  httpStatus: null, requestIds: [], traceId: null, usage: null, dispatches: 0, elapsedMs: 0,
  reportVerified: false, priorStatePreserved: null });

/** Same app composition as startApp; only temporary app identity/state is created here. */
export async function checkApp(options: { readonly authPath?: string; readonly timeoutMs: number; readonly route?: SubscriptionRoute; readonly accountIdSha256?: string; readonly credentialSlot?: string },
  results: readonly [CaseResult, CaseResult, CaseResult]) {
  const subscription = options.route === "siwc" ? checkedSubscriptionConfiguration({ provider: "chatgpt-subscription", route: "siwc", modelId: "gpt-6-sol",
    authPath: options.authPath ?? "", accountIdSha256: options.accountIdSha256 ?? "", credentialSlot: options.credentialSlot }) : undefined;
  const runtime = createMemoryRuntimeDatabase(), store = createCaseStore(Date.now, undefined, runtime);
  const auth = createLocalAuth(runtime, { origin });
  const [normal, missing, logout] = results;
  let active = normal;
  let totalDispatches = 0;
  const usageResponses = new Map<CaseResult, number>();
  const runner = createSubscriptionRunner({ enabled: true, modelId: "gpt-6-sol", authPath: options.authPath, route: options.route, subscription,
    maxTurns: 3, maxOutputTokens: 1500,
    transport: async (url, init) => {
      const result = active;
      if (active.dispatches >= 3 || ++totalDispatches > 6) throw new SessionFailure("turn-limit");
      active.dispatches++;
      const response = await fetch(url, init);
      const id = providerRequestId(response.headers);
      if (id) active.requestIds.push(id);
      return boundedResponse(response, () => usageResponses.set(result, (usageResponses.get(result) ?? 0) + 1),
        () => { result.failure ??= "response-stream"; });
    } });
  const app = createOperationalApp({ origin, localAuth: auth, caseStore: store, timeoutMs: options.timeoutMs,
    presentationMode: "synthetic", resources: input => input.massKg === null ? {} : syntheticReviewed(input),
    runner: async (...args) => {
      const result = active;
      try { return await runner(...args); }
      catch (error) { result.failure ??= error instanceof SessionFailure ? error.code : "execution"; throw error; }
    } });
  let cookie = "";
  const request = (path: string, body?: unknown) => app.fetch(new Request(origin + path, { method: body === undefined ? "GET" : "POST",
    headers: { origin, cookie, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  try {
    const password = randomBytes(24).toString("hex"), username = "synthetic-live-check";
    const { actorId } = await auth.create(username, password);
    const login = await request("/login", { username, password });
    cookie = login.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    if (login.status !== 303 || !cookie) throw new Error("app-setup");
    const owner = `actor:${actorId}`;
    let priorPath: string | null = null;
    for (const { result, massKg } of [{ result: normal, massKg: 2000 }, { result: missing, massKg: null }]) {
      active = result;
      const started = performance.now();
      try {
        const { caseId: _id, ...fields } = { ...syntheticCase, massKg, polymer: massKg === null ? null : syntheticCase.polymer };
        const submitted = await request("/cases", fields);
        active.httpStatus = submitted.status;
        if (submitted.status !== 303) {
          active.failure = submitted.status === 504 ? "timeout" : active.failure ?? "app-rejected";
          continue;
        }
        const path = submitted.headers.get("location");
        if (!path || !/^\/cases\/[A-Za-z0-9_-]{1,100}$/.test(path)) { active.failure = "case-location"; continue; }
        const snapshot = store.read(owner, path.slice(7));
        if (!snapshot) { active.failure = "case-not-saved"; continue; }
        priorPath ??= path;
        const decision = snapshot.assessment.decision;
        active.state = decision.state;
        if (decision.state === "compared") {
          active.recommendationCount = decision.recommendations?.length ?? 0;
          active.preExecutionChecksPresent = decision.preExecutionChecks !== undefined;
        }
        const execution = snapshot.assessment.execution;
        active.usage = usageResponses.get(active) === active.dispatches ? safeUsage(execution?.usage) : null;
        const trace = execution?.traceId;
        const id = trace?.startsWith("chatgpt-subscription:") ? providerRequestId({ "x-request-id": trace.slice(21) }) : undefined;
        active.traceId = id ? `chatgpt-subscription:${id}` : null;
        const host = await createResourceDomain(snapshot.input, massKg === null ? {} : syntheticReviewed(snapshot.input)).decide();
        const expected = host.state === "needs-information" ? { ...host, questions: [...host.questions,
          '추가 답변은 필드별 JSON으로 입력해 주세요. 예: {"massKg":100,"process":"사출"}. 숫자에는 따옴표를 붙이지 않습니다.'] } : host;
        const report = await request(path + "/report");
        active.reportVerified = report.status === 200 && await report.text() === renderReport(expected, {
          mode: "synthetic", review: snapshot.review, historical: false,
          execution: execution ? { traceId: execution.traceId, usage: execution.usage ?? null } : undefined },
        { audience: "commercial" }, { progress: buildPublicCaseProgress(snapshot.input, expected), caseReturnTarget: path,
          evaluatedInput: snapshot.input, caseRegion: snapshot.input.region,
          inputSummary: caseInputSummary(snapshot.input) });
        const expectedState = massKg === null ? "needs-information" : "compared";
        const validComparison = decision.state !== "compared" || decision.humanApproval === "pending"
          && (decision.recommendations?.length ?? 0) > 0 && decision.preExecutionChecks !== undefined
          && decision.scenarios.length > 0 && decision.processors.length > 0
          && decision.scenarios.every(s => s.netCost.state === "available" && s.netEmissions.state === "available");
        active.passed = active.failure === null && decision.state === expectedState && canonical(decision) === canonical(expected)
          && validComparison && active.reportVerified && active.dispatches > 0 && active.requestIds.length === active.dispatches
          && active.traceId !== null && id === active.requestIds.at(-1) && active.usage !== null;
        if (!active.passed) active.failure ??= "required-result-unverified";
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        active.failure ??= "app-check";
      }
      finally { await app.settled(); active.elapsedMs = Math.round(performance.now() - started); }
    }
    active = logout;
    const started = performance.now(), beforeCalls = totalDispatches;
    try {
      const before = priorPath ? store.read(owner, priorPath.slice(7)) : undefined;
      const loggedOut = await request("/logout", {});
      // Deliberately reuse the revoked cookie to test server-side session revocation.
      const rejected = await request((priorPath ?? "/cases/synthetic-absent") + "/answers", { baseVersion: before?.version ?? 1, patch: { massKg: 999 } });
      active.httpStatus = rejected.status;
      active.priorStatePreserved = before !== undefined && canonical(before) === canonical(store.read(owner, before.input.caseId));
      active.passed = loggedOut.status === 303 && rejected.status === 403 && totalDispatches === beforeCalls
        && active.dispatches === 0 && active.priorStatePreserved;
      if (!active.passed) active.failure = "logout-unverified";
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      active.failure = "logout-check";
    }
    finally { active.elapsedMs = Math.round(performance.now() - started); }
  } finally { app.dispose(); await app.close(); store.dispose(); runtime.close(); }
}
