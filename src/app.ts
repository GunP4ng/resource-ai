import { randomBytes } from "node:crypto";
import type { AppDependencies, StoredAssessment } from "./app-types.ts";
export type { AppDependencies, AssessmentAdapter, AssessmentEnvelope } from "./app-types.ts";
import { HttpFailure, bounded, body, errorResponse, idPattern, redirect, response } from "./app-http.ts";
import { form, loginPage, caseListPage, inputPage } from "./app-views.ts";
import { caseRoute } from "./app-case-routes.ts";
import { demo } from "./o-demo.ts";
import { referencePage } from "./o-reference.ts";
import { escapeHtml, renderReport } from "./report.ts";
import { requireValid } from "./o-validation.ts";
import { CaseConflict, createCaseStore, parseAssessment } from "./o-case-store.ts";
import type { OCaseStore } from "./o-case-store.ts";
import { LocalAuthError } from "./o-auth.ts";
import { RuntimeStorageError } from "./o-runtime-db.ts";
import { feedbackPath, feedbackScript } from "./app-feedback.ts";
export function createApp(dependencies: AppDependencies) {
  const origin = new URL(dependencies.origin).origin;
  requireValid(["http:", "https:"].includes(new URL(origin).protocol), "invalid-app-origin");
  const timeoutMs = dependencies.timeoutMs ?? 10000;
  const maxBodyBytes = dependencies.maxBodyBytes ?? 16384;
  const now = dependencies.now ?? Date.now;
  const caseStore = dependencies.caseStore ?? createCaseStore(now, dependencies.photoExecution);
  const preparer = dependencies.preparer;
  const cancelLease = (lease: Parameters<OCaseStore["rollback"]>[0]) => {
    try {
      caseStore.rollback(lease);
    }
    catch (error) {
      // Rollback invalidates the local lease before attempting SQL. A busy or
      // unavailable database leaves only the existing bounded reservation.
      if (!(error instanceof CaseConflict) && !(error instanceof RuntimeStorageError)) throw error;
    }
  };
  const photoEnabled = !!((dependencies.actorForRequest || dependencies.localAuth) && dependencies.photoStore && dependencies.photoPolicy);
  const checkRequest = (signal: AbortSignal) => {
    dependencies.checkRequest?.();
    signal.throwIfAborted();
  };
  requireValid(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000 && Number.isInteger(maxBodyBytes) && maxBodyBytes > 0 && maxBodyBytes <= 1048576, "invalid-http-limits");
  // Per-app in-memory sessions, one hour TTL, bounded capacity. Reports never shared by ID alone.
  const sessions = new Map<string, { readonly created: number; readonly cases: Map<string, StoredAssessment> }>();
  const actorReports = new Map<string, { readonly created: number; readonly cases: Map<string, StoredAssessment> }>();
  const owners = new Map<string, string>();
  const secure = origin.startsWith("https:");
  const pending = new Set<Promise<unknown>>();
  const fetch = async (request: Request): Promise<Response> => {
    const deadline = performance.now() + timeoutMs;
    let recovery = '<p><a href="/cases">내 사례에서 마지막 저장 결과 확인</a> · <a href="/">사례 입력</a></p>';
    try {
      return await bounded(async (signal) => {
        const guard = (signal: AbortSignal) => {
          if (performance.now() >= deadline) throw new HttpFailure(504, "처리 시간이 초과되었습니다. 다시 시도해 주세요.");
          checkRequest(signal);
        };
        const url = new URL(request.url);
        if (url.origin !== origin) throw new HttpFailure(400, "앱 주소가 일치하지 않습니다.");
        if (request.method === "GET" && url.pathname === feedbackPath) return response(feedbackScript, 200, { "content-type": "text/javascript; charset=utf-8" });
        const sameOrigin = () => {
          if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") throw new HttpFailure(403, "같은 앱에서 제출해 주세요.");
        };
        if (dependencies.localAuth && url.pathname === "/login") {
          if (request.method === "GET") return response(loginPage());
          if (request.method === "POST") {
            sameOrigin();
            const raw = await body(request, Math.min(maxBodyBytes, 8192), signal);
            guard(signal);
            if (typeof raw !== "object" || raw === null || !("username" in raw) || !("password" in raw) || typeof raw.username !== "string" || typeof raw.password !== "string" || Object.keys(raw).length !== 2) throw new HttpFailure(400, "로그인 입력을 확인해 주세요.");
            const result = redirect("/cases");
            const logged = await dependencies.localAuth.login(raw.username, raw.password, signal, () => guard(signal))
              .catch(error => {
                guard(signal);
                throw error;
              });
            dependencies.committed?.();
            result.headers.set("set-cookie", logged.setCookie);
            return result;
          }
        }
        if (dependencies.localAuth && request.method === "POST" && url.pathname === "/logout") {
          sameOrigin();
          const result = redirect("/login");
          const identity = dependencies.localAuth.resolve(request, signal);
          if (!identity) throw new HttpFailure(403, "인증이 필요합니다.");
          identity.assertCurrent();
          const logged = dependencies.localAuth.logout(request, signal, () => guard(signal));
          dependencies.committed?.();
          result.headers.set("set-cookie", logged.setCookie);
          return result;
        }
        let actor: string | null = null;
        let validUntil = Infinity;
        let assertCurrent: (() => void) | undefined;
        if ((dependencies.localAuth || dependencies.actorForRequest) && (url.pathname === "/" || url.pathname.startsWith("/cases"))) {
          try {
            const identity = dependencies.localAuth ? dependencies.localAuth.resolve(request, signal) : await dependencies.actorForRequest?.(request, signal);
            actor = typeof identity === "string" ? identity : identity?.actorId ?? null;
            if (identity && typeof identity === "object") {
              validUntil = Number.isSafeInteger(identity.validUntil) ? identity.validUntil : 0;
              assertCurrent = identity.assertCurrent;
            }
          }
          catch (error) {
            guard(signal);
            if (error instanceof LocalAuthError) throw error;
            throw new HttpFailure(503, "인증 서비스를 사용할 수 없습니다.");
          }
          guard(signal);
          if (!actor || !/^[A-Za-z0-9_-]{1,128}$/.test(actor) || validUntil <= now() || Number.isNaN(validUntil)) throw new HttpFailure(403, "인증이 필요합니다.");
        }
        const privateGuard = () => {
          guard(signal);
          if (validUntil <= now()) throw new HttpFailure(403, "인증 유효기간이 지났습니다.");
          assertCurrent?.();
        };
        for (const [token, session] of sessions) if (now() - session.created > 3600000) {
          sessions.delete(token);
          for (const caseId of session.cases.keys()) owners.delete(caseId);
        }
        for (const [id, reports] of actorReports) if (now() - reports.created > 3600000) {
          actorReports.delete(id);
          for (const caseId of reports.cases.keys()) owners.delete(caseId);
        }
        const cookie = request.headers.get("cookie")?.split(";").map((v) => v.trim()).find((v) => v.startsWith("resource_session="))?.slice("resource_session=".length);
        const session = cookie === undefined ? undefined : sessions.get(cookie);
        const owner = actor ? `actor:${actor}` : cookie && session ? `session:${cookie}` : undefined;
        const reports = actor ? actorReports.get(actor)?.cases : session?.cases;
        if (request.method === "GET" && url.pathname === "/cases" && preparer) {
          if (!owner) throw new HttpFailure(403, "인증이 필요합니다.");
          const rows = caseStore.list(owner).map(item => `<tr><td data-label="사례"><a href="/cases/${item.caseId}">${escapeHtml(caseStore.read(owner, item.caseId)?.input.description ?? item.caseId)}</a></td><td data-label="버전">${item.version}</td><td data-label="보관 만료 (UTC)">${escapeHtml(new Date(item.expires).toISOString())}</td><td data-label="결과"><a href="/cases/${item.caseId}/report">보고서</a></td></tr>`).join("");
          const result = response(caseListPage(rows, !!dependencies.localAuth));
          privateGuard();
          return result;
        }
        if (request.method === "GET" && url.pathname === "/health") {
          dependencies.localAuth?.resolve(request, signal);
          return new Response(JSON.stringify({ app: "ready", backend: dependencies.adapter ? "adapter-connected" : "unavailable", azure: "not-verified", ...(dependencies.runtime ? { runtime: dependencies.runtime } : {}) }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
        }
        if (request.method === "GET" && url.pathname === "/") {
          if (actor && dependencies.localAuth) {
            const result = response(inputPage({ authenticated: true, localAuth: true, connected: !!dependencies.adapter, photoEnabled, runner: dependencies.runtime?.runner }));
            privateGuard();
            return result;
          }
          if (session === undefined && sessions.size >= 1000) throw new HttpFailure(503, "현재 새 세션을 열 수 없습니다.");
          const token = cookie !== undefined && session !== undefined ? cookie : randomBytes(32).toString("hex");
          if (session === undefined) sessions.set(token, { created: now(), cases: new Map() });
          const homeResponse = response(inputPage({ authenticated: !!actor, localAuth: !!dependencies.localAuth, connected: !!dependencies.adapter, photoEnabled, runner: dependencies.runtime?.runner }), 200, { "set-cookie": `resource_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600${secure ? "; Secure" : ""}` });
          privateGuard();
          return homeResponse;
        }
        if (request.method === "GET" && url.pathname === "/reference") return response(referencePage());
        const fixtureMatch = /^\/demo\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
        if (request.method === "GET" && fixtureMatch) {
          if (fixtureMatch[1] === "evidence") {
            const generated = await demo("normal", origin);
            const document = generated?.documents?.[0];
            if (document === undefined) throw new HttpFailure(404, "합성 근거를 찾을 수 없습니다.");
            return new Response(document.snapshot, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; frame-ancestors 'none'" } });
          }
          const fixture = await demo(fixtureMatch[1] ?? "", origin);
          if (fixture === null) throw new HttpFailure(404, "데모를 찾을 수 없습니다.");
          return response(renderReport(fixture.result, fixture.presentation, { audience: "commercial" }, {
            editing: '<p class="screen-only"><a href="/demo/review">합성 위험·검토 예시</a></p>',
          }));
        }
        const caseMatch = /^\/cases\/([A-Za-z0-9_-]{1,100})(?:\/(answers|report|input))?$/.exec(url.pathname);
        const caseId = caseMatch?.[1];
        const suffix = caseMatch?.[2];
        if (caseId) recovery = `<p>실패한 시도는 이전 저장 결과와 다릅니다. <a href="/cases/${caseId}">이 사례의 마지막 저장 결과 확인</a> · <a href="/cases">내 사례</a></p>`;
        const photoMatch = /^\/cases\/([A-Za-z0-9_-]{1,100})\/photos(?:\/([a-f0-9-]{36})(?:\/(withdraw-model|withdraw-storage))?)?$/.exec(url.pathname);
        if (preparer && (caseMatch || photoMatch || url.pathname === "/cases")) {
          if (!owner) throw new HttpFailure(403, "인증이 필요합니다.");
          return caseRoute({ dependencies, origin, now, caseStore, maxBodyBytes, photoEnabled, cancelLease },
            { request, url, signal, guard, privateGuard, actor, owner, caseMatch, photoMatch });
        }
        if (request.method === "GET" && caseId && suffix !== "answers" && suffix !== "input") {
          if (suffix === "report" && url.searchParams.get("purpose") === "research" && !actor) throw new HttpFailure(403, "연구용 보고서는 인증된 비공개 사례에서만 확인할 수 있습니다.");
          const stored = reports?.get(caseId);
          if (stored === undefined) throw new HttpFailure(404, "사례를 찾을 수 없습니다.");
          const result = stored.decision;
          const extra = suffix === "report" ? "" : `<p class="screen-only"><a href="/cases/${caseId}/report">인쇄용 보고서</a></p>${form(`/cases/${caseId}/answers`, true)}`;
           const reportResponse = response(renderReport(result, { mode: "live", ...(stored.execution ? { execution: { traceId: stored.execution.traceId, usage: stored.execution.usage ?? null } } : {}) }, { audience: "commercial" }, { editing: extra, ...(suffix === "report" ? {} : { answerTarget: "#answers" as const }) }));
          privateGuard();
          return reportResponse;
        }
        if (request.method === "POST" && (url.pathname === "/cases" || (caseId && suffix === "answers"))) {
          if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") throw new HttpFailure(403, "같은 앱에서 제출해 주세요.");
          if (owner === undefined) throw new HttpFailure(403, "입력 화면에서 세션을 시작해 주세요.");
          if (caseId && !reports?.has(caseId)) throw new HttpFailure(404, "사례를 찾을 수 없습니다.");
          const adapter = dependencies.adapter;
          if (adapter === undefined) throw new HttpFailure(503, "입력·세션 연결 준비 중 · H1/H4 어댑터가 없어 검토를 실행하지 않았습니다.");
          if (((reports?.size ?? 0) >= 100 || owners.size >= 100) && !caseId) throw new HttpFailure(429, "저장 가능한 사례 제한에 도달했습니다.");
          const stored = await (async () => {
            const raw = await body(request, maxBodyBytes, signal);
            if (signal.aborted) throw new HttpFailure(408, "요청이 취소되었습니다.");
            const output = caseId ? await adapter.answer(caseId, raw, signal) : await adapter.submit(raw, signal);
            if (Buffer.byteLength(JSON.stringify(output), "utf-8") > 524288) throw new HttpFailure(502, "검토 결과 크기 제한을 초과했습니다.");
            return parseAssessment(output);
          })();
          const result = stored.decision;
          if (!idPattern.test(result.caseId) || (caseId && result.caseId !== caseId) || (owners.has(result.caseId) && owners.get(result.caseId) !== owner)) throw new HttpFailure(502, "사례 식별 정보를 확인할 수 없습니다.");
          if (!caseId && reports?.has(result.caseId)) throw new HttpFailure(409, "이미 존재하는 사례입니다.");
          const owned = structuredClone(stored);
          const resultResponse = redirect(`/cases/${result.caseId}`);
          privateGuard();
          if (actor) {
            const collection = actorReports.get(actor) ?? { created: now(), cases: new Map<string, StoredAssessment>() };
            collection.cases.set(result.caseId, owned);
            actorReports.set(actor, collection);
          } else session?.cases.set(result.caseId, owned);
          owners.set(result.caseId, owner);
          dependencies.committed?.();
          return resultResponse;
        }
        throw new HttpFailure(404, "페이지를 찾을 수 없습니다.");
      }, request, timeoutMs, pending);
    } catch (error) {
      return errorResponse(error, recovery, dependencies);
    }
  };
  return Object.assign(fetch, {
    async settled() {
      while (pending.size) await Promise.allSettled([...pending]);
    },
    dispose() {
      if (!dependencies.caseStore) caseStore.dispose();
    },
  });
}
