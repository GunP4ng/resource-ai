import { randomBytes } from "node:crypto";
import type { AppDependencies, StoredAssessment } from "./app-types.ts";
export type { AppDependencies, AssessmentAdapter, AssessmentEnvelope } from "./app-types.ts";
import { HttpFailure, bounded, body, caseBody, defaultBodyBytes, errorResponse, idPattern, redirect, response } from "./app-http.ts";
import { caseInputSummary, form, loginPage, caseListPage, inputPage } from "./app-views.ts";
import { caseRoute } from "./app-case-routes.ts";
import { demo } from "./o-demo.ts";
import { referencePage } from "./o-reference.ts";
import { escapeHtml, renderReport } from "./report.ts";
import { page } from "./report-html.ts";
import type { ReportContext } from "./report.ts";
import { requireValid, revision } from "./o-validation.ts";
import { readCaseResearchCatalog, buildCaseResearchAttachment } from "./o-case-research.ts";
import { createResourceDomain } from "./domain.ts";
import { CaseConflict, createCaseStore, parseAssessment } from "./o-case-store.ts";
import type { OCaseStore } from "./o-case-store.ts";
import { LocalAuthError } from "./o-auth.ts";
import { RuntimeStorageError } from "./o-runtime-db.ts";
import { feedbackPath, feedbackScript } from "./app-feedback.ts";
import { reviewProgressStore } from "./app-progress.ts";
import { buildCaseGuidance } from "./o-case-guidance.ts";
import recyclingDirectory from "../data/reference/public-recycling-candidates-20261121.json" with { type: "json" };
export function createApp(dependencies: AppDependencies) {
  const origin = new URL(dependencies.origin).origin;
  requireValid(["http:", "https:"].includes(new URL(origin).protocol), "invalid-app-origin");
  const timeoutMs = dependencies.timeoutMs ?? 10000;
  const maxBodyBytes = dependencies.maxBodyBytes ?? defaultBodyBytes;
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
  const sessionLifetimeMs = 3_600_000;
  const sessions = new Map<string, { readonly deadline: number; readonly cases: Map<string, StoredAssessment> }>();
  const actorReports = new Map<string, { readonly created: number; readonly cases: Map<string, StoredAssessment> }>();
  const owners = new Map<string, string>();
  const reviewProgress = reviewProgressStore();
  const secure = origin.startsWith("https:");
  const pending = new Set<Promise<unknown>>();
  const fetch = async (request: Request): Promise<Response> => {
    const deadline = performance.now() + timeoutMs;
    let recovery = '<p><a href="/cases">내 사례에서 마지막 결과 보기</a> · <a href="/">사례 입력</a></p>';
    try {
      return await bounded(async (signal) => {
        const guard = (signal: AbortSignal) => {
          if (performance.now() >= deadline) throw new HttpFailure(504, "처리 시간이 초과되었습니다. 다시 시도해 주세요.");
          checkRequest(signal);
        };
        const url = new URL(request.url);
        if (url.origin !== origin) throw new HttpFailure(400, "앱 주소가 다릅니다. 앱 첫 화면에서 다시 시작해 주세요.");
        if (request.method === "GET" && url.pathname === feedbackPath) return response(feedbackScript, 200, { "content-type": "text/javascript; charset=utf-8" });
        const sameOrigin = () => {
          if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") throw new HttpFailure(403, "이 앱 화면에서 다시 제출해 주세요.");
        };
        if (dependencies.localAuth && url.pathname === "/login") {
          if (request.method === "GET") return response(loginPage());
          if (request.method === "POST") {
            sameOrigin();
            const raw = await body(request, Math.min(maxBodyBytes, 8192), signal);
            guard(signal);
            if (typeof raw !== "object" || raw === null || !("username" in raw) || !("password" in raw) || typeof raw.username !== "string" || typeof raw.password !== "string" || Object.keys(raw).length !== 2) throw new HttpFailure(400, "사용자 이름과 비밀번호를 확인해 주세요.");
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
          if (!identity) throw new HttpFailure(403, "로그인해 주세요.");
          identity.assertCurrent();
          const logged = dependencies.localAuth.logout(request, signal, () => guard(signal));
          dependencies.committed?.();
          result.headers.set("set-cookie", logged.setCookie);
          return result;
        }
        let actor: string | null = null;
        let validUntil = Infinity;
        let assertCurrent: (() => void) | undefined;
        const normalDemo = request.method === "GET" && url.pathname === "/demo/normal";
        const reportDemo = request.method === "GET" && /^\/demo\/(?:normal|held|review)$/.test(url.pathname);
        if ((dependencies.localAuth || dependencies.actorForRequest) && (url.pathname === "/" || url.pathname.startsWith("/cases") || reportDemo)) {
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
            throw new HttpFailure(503, "로그인 서비스에 연결하지 못했습니다.");
          }
          guard(signal);
          if ((!actor && !reportDemo) || (actor && !/^[A-Za-z0-9_-]{1,128}$/.test(actor)) || validUntil <= now() || Number.isNaN(validUntil)) throw new HttpFailure(403, "로그인해 주세요.");
        }
        const identityGuard = () => {
          guard(signal);
          const at = now();
          if (validUntil <= at) throw new HttpFailure(403, "로그인이 만료되었습니다. 다시 로그인해 주세요.");
          assertCurrent?.();
          return at;
        };
        for (const [token, session] of sessions) if (now() > session.deadline) {
          sessions.delete(token);
          for (const caseId of session.cases.keys()) owners.delete(caseId);
        }
        for (const [id, reports] of actorReports) if (now() - reports.created > 3600000) {
          actorReports.delete(id);
          for (const caseId of reports.cases.keys()) owners.delete(caseId);
        }
        const cookie = request.headers.get("cookie")?.split(";").map((v) => v.trim()).find((v) => v.startsWith("resource_session="))?.slice("resource_session=".length);
        const session = cookie === undefined ? undefined : sessions.get(cookie);
        const sessionDeadline = actor ? undefined : session?.deadline;
        const privateGuard = () => {
          const at = identityGuard();
          if (sessionDeadline !== undefined && at > sessionDeadline) {
            throw new HttpFailure(403, "로그인이 만료되었습니다. 다시 로그인해 주세요.");
          }
        };
        const owner = actor ? `actor:${actor}` : cookie && session ? `session:${cookie}` : undefined;
        const progressPath = /^\/cases\/progress\/([a-f0-9]{32})$/.exec(url.pathname);
        if (request.method === "GET" && progressPath) {
          if (!owner) throw new HttpFailure(404, "페이지를 찾을 수 없습니다.");
          privateGuard();
          return response(JSON.stringify({ step: reviewProgress.read(owner, progressPath[1]!) ?? null }), 200,
            { "content-type": "application/json; charset=utf-8" });
        }
        const reports = actor ? actorReports.get(actor)?.cases : session?.cases;
        const anonymousPage = (html: string) => {
          if (session === undefined && sessions.size >= 1000) throw new HttpFailure(503, "접속자가 많습니다. 잠시 후 다시 시도해 주세요.");
          const token = cookie !== undefined && session !== undefined ? cookie : randomBytes(32).toString("hex");
          const at = now();
          const cookieDeadline = session?.deadline ?? at + sessionLifetimeMs;
          const maxAge = Math.max(0, Math.floor((cookieDeadline - at) / 1000));
          const result = response(html, 200, { "set-cookie": `resource_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}` });
          privateGuard();
          if (session === undefined) sessions.set(token, { deadline: cookieDeadline, cases: new Map() });
          return result;
        };
        if (request.method === "GET" && url.pathname === "/cases" && preparer) {
          if (!owner) throw new HttpFailure(403, "로그인해 주세요.");
          const deadlineLabel = actor ? "보관 기한" : "열람 기한";
          const rows = caseStore.list(owner).map(item => {
            const deadline = Math.min(item.expires, sessionDeadline ?? Infinity);
            const snapshot = caseStore.read(owner, item.caseId);
            const state: "compared" | "needs-information" | "needs-review" | "unknown" = snapshot?.assessment.decision.state ?? "unknown";
            return {
              caseId: item.caseId,
              title: snapshot?.input.description.trim() || item.caseId,
              deadline,
              state,
            };
          });
          const result = response(caseListPage(rows, !!dependencies.localAuth, { deadlineLabel, status: url.searchParams.get("status") }));
          privateGuard();
          return result;
        }
        if (request.method === "GET" && url.pathname === "/health") {
          dependencies.localAuth?.resolve(request, signal);
          return new Response(JSON.stringify({ app: "ready", backend: dependencies.adapter ? "adapter-connected" : "unavailable", azure: "not-verified", ...(dependencies.runtime ? { runtime: dependencies.runtime } : {}) }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
        }
        if (request.method === "GET" && url.pathname === "/") {
          const connected = dependencies.reviewConfigured ?? !!dependencies.adapter;
          if (actor && dependencies.localAuth) {
            const result = response(inputPage({ authenticated: true, localAuth: true, connected, photoEnabled }));
            privateGuard();
            return result;
          }
          return anonymousPage(inputPage({ authenticated: !!actor, localAuth: !!dependencies.localAuth, connected, photoEnabled }));
        }
        if (request.method === "GET" && url.pathname === "/help") return response(page("도움말",
          `<article class="help-content"><h1>도움말</h1>
          <section><h2>검토 시작하기</h2><p>재질과 발생 공정, 오염 상태를 아는 만큼 적어 주세요. 질량을 모르면 비워 두세요. 입력이 어떤 모습인지 보려면 ‘예시로 채우기’를 눌러 보세요.</p><p><a href="/#case-intake">새 검토 열기</a></p></section>
          <section><h2>결과 확인하기</h2><p>결과 맨 위에서 다음에 할 일을 확인하세요. ‘근거 보기’를 열면 참고한 자료와 원문 위치를 찾을 수 있습니다. 보류된 사례는 필요한 정보를 확인하기 전까지 처리·반출·계약하지 마세요.</p></section>
          <section><h2>저장한 사례 찾기</h2><p>로그인한 사례는 최대 1시간 동안 다시 볼 수 있습니다. 로그인하지 않은 사례는 현재 브라우저에서만 열 수 있고, 서버가 재시작되거나 열람 기한이 지나면 다시 열 수 없습니다.</p><p><a href="/cases">내 사례 보기</a></p></section></article>`));
        if (request.method === "GET" && url.pathname === "/reference") return response(referencePage());
        const fixtureMatch = /^\/demo\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
        if (request.method === "GET" && fixtureMatch) {
          if (fixtureMatch[1] === "evidence") {
            const generated = await demo("normal", origin);
            const document = generated?.documents?.[0];
            if (document === undefined) throw new HttpFailure(404, "예시 근거를 찾을 수 없습니다.");
            return new Response(document.snapshot, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; frame-ancestors 'none'" } });
          }
          const fixture = await demo(fixtureMatch[1] ?? "", origin);
          if (fixture === null) throw new HttpFailure(404, "예시를 찾을 수 없습니다.");
          let decision = fixture.result, presentation = fixture.presentation;
          let context: ReportContext = { audience: "commercial" };
          let actions = "";
          if (normalDemo) {
            if (url.searchParams.get("purpose") === "research" && !actor) throw new HttpFailure(403, "연구 계산은 로그인 후 열람할 수 있습니다.");
            if (actor && url.searchParams.get("purpose") !== "commercial") {
              actions = '<nav class="cluster screen-only" aria-label="공개 시나리오 계산"><a href="/demo/normal?purpose=research">PET 비용·탄소</a><a href="/demo/normal?purpose=research&amp;material=HDPE">HDPE 비용·탄소</a><a href="/demo/normal?purpose=commercial">상업용 보고서 예시</a></nav>';
              const material = url.searchParams.get("material")?.trim().toUpperCase();
              if (material !== undefined && material !== "PET" && material !== "HDPE") {
                recovery = actions;
                throw new HttpFailure(400, "공개 연구 계산 예시는 PET와 HDPE에 있습니다.");
              }
              const sourceCaseId = material === "HDPE" ? "OYS-20261110-002" : "OYS-20261110-001";
              const catalog = await readCaseResearchCatalog();
              const source = catalog.calculations.data.cases.find(item => item.case_id === sourceCaseId);
              if (!source) throw new HttpFailure(503, "공개 시나리오 원본을 불러오지 못했습니다.");
              const attachment = buildCaseResearchAttachment({ actorId: actor, input: source.original,
                inputRevision: revision(source.original) }, sourceCaseId, catalog);
              decision = await createResourceDomain(source.original).decide();
              presentation = { mode: "synthetic", calculationVersion: attachment.calculations.model_version,
                sourceVersion: attachment.calculations.fixtureSha256, ...(dependencies.runtime ? { runtime: dependencies.runtime } : {}) };
              context = { audience: "authenticated-research", research: { attachment, artifactSha256: revision(attachment) },
                guidance: await buildCaseGuidance(source.original, decision, {
                  research: attachment, publicDirectoryCount: recyclingDirectory.rows.length,
                }) };
            } else if (url.searchParams.get("purpose") !== "commercial") {
              actions += `<p>공개 시나리오의 비용·탄소는 로그인 후 연구 화면에서 볼 수 있습니다.${dependencies.localAuth ? ' <a href="/login">운영자 로그인</a>' : ""}</p>`;
            }
          }
          const editor = fixture.input && (actor || (!dependencies.localAuth && !dependencies.actorForRequest)) ? fixture.input : undefined;
          const html = renderReport(decision, presentation, context, {
            actions, researchFirst: normalDemo,
            researchNavigation: context.audience === "authenticated-research",
            ...(editor ? { answerTarget: "#answer-fields" as const, editing: `${caseInputSummary(editor, "#answer-fields")}<div class="screen-only"><h2 id="answer-fields" tabindex="-1">답변·사례 수정</h2><p>예시 입력을 바꿔 제출하면 새 사례로 검토합니다.</p>${form("/cases", false, undefined, "", editor)}</div>` } : {}),
          });
          identityGuard();
          return editor && !actor && !session ? anonymousPage(html) : response(html);
        }
        const caseMatch = /^\/cases\/([A-Za-z0-9_-]{1,100})(?:\/(answers|report|input|inquiry|inquiry-reply))?$/.exec(url.pathname);
        const caseId = caseMatch?.[1];
        const suffix = caseMatch?.[2];
        if (caseId) recovery = `<p>이번 시도는 저장되지 않았습니다. <a href="/cases/${caseId}">이 사례의 마지막 결과 보기</a> · <a href="/cases">내 사례</a></p>`;
        const photoMatch = /^\/cases\/([A-Za-z0-9_-]{1,100})\/photos(?:\/([a-f0-9-]{36})(?:\/(withdraw-model|withdraw-storage))?)?$/.exec(url.pathname);
        if (preparer && (caseMatch || photoMatch || url.pathname === "/cases")) {
          if (!owner) throw new HttpFailure(403, "로그인해 주세요.");
          const progress = request.method === "POST" && url.pathname === "/cases" && request.headers.get("origin") === origin
            && request.headers.get("sec-fetch-site") !== "cross-site" ? reviewProgress.start(owner, url.searchParams.get("progress")) : undefined;
          try {
            return await caseRoute({ dependencies, origin, now, caseStore, maxBodyBytes, photoEnabled, cancelLease },
              { request, url, signal, guard, privateGuard, actor, owner, sessionDeadline, caseMatch, photoMatch,
                ...(progress ? { reportProgress: progress.report } : {}) });
          } finally { progress?.done(); }
        }
        if (request.method === "GET" && caseId && suffix !== "answers" && suffix !== "input" && suffix !== "inquiry-reply") {
          if (suffix === "report" && url.searchParams.get("purpose") === "research" && !actor) throw new HttpFailure(403, "연구용 보고서는 로그인한 소유자의 비공개 사례에서 열립니다.");
          const stored = reports?.get(caseId);
          if (stored === undefined) throw new HttpFailure(404, "사례를 찾을 수 없습니다.");
          const result = stored.decision;
          const extra = suffix === "report" ? "" : `<p class="screen-only"><a href="/cases/${caseId}/report">인쇄용 보고서</a></p>${form(`/cases/${caseId}/answers`, true)}`;
           const reportResponse = response(renderReport(result, { mode: "live", ...(stored.execution ? { execution: { traceId: stored.execution.traceId, usage: stored.execution.usage ?? null } } : {}) }, { audience: "commercial" }, { editing: extra, ...(suffix === "report" ? {} : { answerTarget: "#answers" as const }) }));
          privateGuard();
          return reportResponse;
        }
        if (request.method === "POST" && (url.pathname === "/cases" || (caseId && suffix === "answers"))) {
          if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") throw new HttpFailure(403, "이 앱 화면에서 다시 제출해 주세요.");
          if (owner === undefined) throw new HttpFailure(403, "입력 화면에서 시작해 주세요.");
          if (caseId && !reports?.has(caseId)) throw new HttpFailure(404, "사례를 찾을 수 없습니다.");
          const adapter = dependencies.adapter;
          if (adapter === undefined) throw new HttpFailure(503, "H1/H4 모델 어댑터가 연결되어 있지 않아 검토를 실행하지 않았습니다.");
          if (((reports?.size ?? 0) >= 100 || owners.size >= 100) && !caseId) throw new HttpFailure(429, "저장 가능한 사례 수가 가득 찼습니다.");
          const stored = await (async () => {
            const { raw } = await caseBody(request, dependencies.maxBodyBytes, signal);
            privateGuard();
            const output = caseId ? await adapter.answer(caseId, raw, signal) : await adapter.submit(raw, signal);
            if (Buffer.byteLength(JSON.stringify(output), "utf-8") > 524288) throw new HttpFailure(502, "검토 결과가 너무 커서 저장하지 못했습니다. 담당자에게 알려 주세요.");
            return parseAssessment(output);
          })();
          const result = stored.decision;
          if (!idPattern.test(result.caseId) || (caseId && result.caseId !== caseId) || (owners.has(result.caseId) && owners.get(result.caseId) !== owner)) throw new HttpFailure(502, "검토 결과의 사례 번호가 맞지 않습니다. 다시 제출해 주세요.");
          if (!caseId && reports?.has(result.caseId)) throw new HttpFailure(409, "이미 있는 사례입니다. 내 사례에서 여세요.");
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
