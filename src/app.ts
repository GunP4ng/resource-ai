import { randomBytes } from "node:crypto";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { DecisionResult } from "./contracts.ts";
import { parseDecision } from "./o-decision.ts";
import { demo } from "./o-demo.ts";
import { referencePage } from "./o-reference.ts";
import type { ReportPresentation } from "./report.ts";
import { escapeHtml, page, renderReport } from "./report.ts";
import { requireValid } from "./o-validation.ts";

export interface AssessmentEnvelope {
  readonly decision: DecisionResult;
  readonly execution?: { readonly traceId: string; readonly usage?: string | null };
}
interface StoredAssessment {
  readonly decision: DecisionResult;
  readonly execution?: NonNullable<ReportPresentation["execution"]>;
}
const AssessmentSchema = Type.Object({ decision: Type.Unknown(), execution: Type.Optional(Type.Unknown()) }, { additionalProperties: false });
const ExecutionSchema = Type.Object({ traceId: Type.Optional(Type.Unknown()), usage: Type.Optional(Type.Unknown()) }, { additionalProperties: false });
function parseAssessment(output: unknown): StoredAssessment {
  if (typeof output !== "object" || output === null || !Object.hasOwn(output, "decision")) {
    return { decision: parseDecision(output) };
  }
  requireValid(Value.Check(AssessmentSchema, output), "invalid-assessment-envelope");
  const decision = parseDecision(output.decision);
  const execution = output.execution;
  if (execution === undefined) return { decision };
  requireValid(Value.Check(ExecutionSchema, execution), "invalid-execution-metadata");
  const traceId = execution.traceId;
  const usage = execution.usage ?? null;
  requireValid(typeof traceId === "string" && traceId.trim().length > 0 && traceId.length <= 200, "invalid-execution-trace");
  requireValid(usage === null || (typeof usage === "string" && usage.trim().length > 0 && usage.length <= 2000), "invalid-execution-usage");
  return { decision, execution: { traceId, usage } };
}
/** Proposed H1/H4 handoff; not a senpi API. No provider is invoked by this module. */
export interface AssessmentAdapter {
  submit(raw: unknown, signal: AbortSignal): Promise<DecisionResult | AssessmentEnvelope>;
  answer(caseId: string, raw: unknown, signal: AbortSignal): Promise<DecisionResult | AssessmentEnvelope>;
}
export interface AppDependencies {
  readonly origin: string;
  readonly adapter?: AssessmentAdapter;
  readonly timeoutMs?: number;
  readonly maxBodyBytes?: number;
  readonly now?: () => number;
}
class HttpFailure extends Error {
  constructor(readonly status: number, readonly publicMessage: string) {
    super(publicMessage);
  }
}
const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
function form(action: string, answers = false): string {
  return `<form method="post" action="${escapeHtml(action)}">${answers ? '<label for="answers">추가 답변</label><textarea id="answers" name="answers" required maxlength="10000"></textarea>' : `
  <label for="description">폐자원 설명</label><textarea id="description" name="description" required maxlength="10000"></textarea>
  <label for="process">발생 공정</label><input id="process" name="process" maxlength="500">
  <label for="polymer">수지 (미상은 공란)</label><input id="polymer" name="polymer" maxlength="200">
  <label for="contamination">오염 상태</label><input id="contamination" name="contamination" maxlength="500">
  <label for="hazardousContact">유해물질 접촉</label><select id="hazardousContact" name="hazardousContact"><option value="unknown">미상</option><option value="yes">있음</option><option value="no">없음</option></select>
  <label for="massKg">실측 질량 (kg, 미상은 공란)</label><input id="massKg" name="massKg" type="number" min="0.001" step="any">
  <label for="region">발생 지역</label><input id="region" name="region" maxlength="200">
  <label for="assessmentDate">평가 기준일</label><input id="assessmentDate" name="assessmentDate" type="date" required>
  <label for="photoRefs">사진 참조 URL (선택, 서버가 가져오지 않음)</label><input id="photoRefs" name="photoRefs" maxlength="2000">`}
  <button type="submit">${answers ? "답변 제출" : "사례 검토 요청"}</button></form>`;
}
async function body(request: Request, limit: number, signal: AbortSignal): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) throw new HttpFailure(413, "요청 크기 제한을 초과했습니다.");
  if (request.body === null) throw new HttpFailure(400, "입력 본문이 필요합니다.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new HttpFailure(408, "입력 요청 시간이 초과되었거나 취소되었습니다.");
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new HttpFailure(413, "요청 크기 제한을 초과했습니다.");
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof TypeError) throw new HttpFailure(400, "UTF-8 입력이 필요합니다.");
    throw error;
  }
  const type = request.headers.get("content-type")?.split(";")[0]?.trim();
  switch (type) {
    case "application/json": {
      try {
        const parsed: unknown = JSON.parse(raw);
        return parsed;
      } catch (error) {
        if (error instanceof SyntaxError) throw new HttpFailure(400, "JSON 입력을 확인해 주세요.");
        throw error;
      }
    }
    case "application/x-www-form-urlencoded": {
      const params = new URLSearchParams(raw);
      const keys = [...params.keys()];
      if (new Set(keys).size !== keys.length) throw new HttpFailure(400, "중복 입력 필드는 허용하지 않습니다.");
      return Object.fromEntries(params);
    }
    default: throw new HttpFailure(415, "JSON 또는 폼 입력이 필요합니다.");
  }
}
async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>, request: Request, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel = () => {};
  const interruption = new Promise<never>((_, reject) => {
    cancel = () => {
      controller.abort();
      reject(new HttpFailure(408, "요청이 취소되었습니다."));
    };
    timer = setTimeout(() => {
      controller.abort();
      reject(new HttpFailure(504, "처리 시간이 초과되었습니다. 다시 시도해 주세요."));
    }, timeoutMs);
    if (request.signal.aborted) cancel();
    else request.signal.addEventListener("abort", cancel, { once: true });
  });
  try {
    return await Promise.race([interruption, operation(controller.signal)]);
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", cancel);
    controller.abort();
  }
}
export function createApp(dependencies: AppDependencies): (request: Request) => Promise<Response> {
  const origin = new URL(dependencies.origin).origin;
  requireValid(["http:", "https:"].includes(new URL(origin).protocol), "invalid-app-origin");
  const timeoutMs = dependencies.timeoutMs ?? 10000;
  const maxBodyBytes = dependencies.maxBodyBytes ?? 16384;
  const now = dependencies.now ?? Date.now;
  requireValid(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000 && Number.isInteger(maxBodyBytes) && maxBodyBytes > 0 && maxBodyBytes <= 1048576, "invalid-http-limits");
  // Per-app in-memory sessions, one hour TTL, bounded capacity. Reports never shared by ID alone.
  const sessions = new Map<string, { readonly created: number; readonly cases: Map<string, StoredAssessment> }>();
  const owners = new Map<string, string>();
  const secure = origin.startsWith("https:");
  const response = (html: string, status = 200, headers: HeadersInit = {}) => new Response(html, { status, headers: {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", ...headers } });
  const redirect = (path: string) => response("", 303, { location: path });
  return async (request) => {
    try {
      const url = new URL(request.url);
      if (url.origin !== origin) throw new HttpFailure(400, "앱 주소가 일치하지 않습니다.");
      for (const [token, session] of sessions) if (now() - session.created > 3600000) {
        sessions.delete(token);
        for (const caseId of session.cases.keys()) owners.delete(caseId);
      }
      const cookie = request.headers.get("cookie")?.split(";").map((v) => v.trim()).find((v) => v.startsWith("resource_session="))?.slice("resource_session=".length);
      const session = cookie === undefined ? undefined : sessions.get(cookie);
      if (request.method === "GET" && url.pathname === "/health") return new Response(JSON.stringify({ app: "ready", backend: dependencies.adapter ? "adapter-connected" : "unavailable", azure: "not-verified" }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
      if (request.method === "GET" && url.pathname === "/") {
        if (session === undefined && sessions.size >= 1000) throw new HttpFailure(503, "현재 새 세션을 열 수 없습니다.");
        const token = cookie !== undefined && session !== undefined ? cookie : randomBytes(32).toString("hex");
        if (session === undefined) sessions.set(token, { created: now(), cases: new Map() });
        return response(page("사례 입력", `<h1>폐자원 조건부 검토</h1>
          <p class="notice">${dependencies.adapter ? "입력·세션 어댑터 연결됨 · 실행 후 상태를 확인하세요." : "입력·세션 연결 준비 중 · 현재 제출하면 503 준비 상태를 표시합니다."}</p>
          <p>실제 자료와 합성 데모를 구분합니다. 설명·사진만으로 법적 코드나 처리 허가를 확정하지 않습니다.</p>
          ${form("/cases")}<p><a href="/demo/review">합성 위험·검토 예시 보기</a></p>`), 200, { "set-cookie": `resource_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600${secure ? "; Secure" : ""}` });
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
        const html = renderReport(fixture.result, fixture.presentation);
        return response(html.replace("</main>", '<p class="screen-only"><a href="/demo/review">합성 위험·검토 예시</a></p></main>'));
      }
      const caseMatch = /^\/cases\/([A-Za-z0-9_-]{1,100})(?:\/(answers|report))?$/.exec(url.pathname);
      const caseId = caseMatch?.[1];
      const suffix = caseMatch?.[2];
      if (request.method === "GET" && caseId && suffix !== "answers") {
        const stored = session?.cases.get(caseId);
        if (stored === undefined) throw new HttpFailure(404, "사례를 찾을 수 없습니다.");
        const result = stored.decision;
        const html = renderReport(result, { mode: "live", ...(stored.execution ? { execution: stored.execution } : {}) });
        const extra = suffix === "report" ? "" : `<p class="screen-only"><a href="/cases/${caseId}/report">인쇄용 보고서</a></p>${result.state === "needs-information" ? form(`/cases/${caseId}/answers`, true) : ""}`;
        return response(html.replace("</main>", `${extra}</main>`));
      }
      if (request.method === "POST" && (url.pathname === "/cases" || (caseId && suffix === "answers"))) {
        if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") throw new HttpFailure(403, "같은 앱에서 제출해 주세요.");
        if (session === undefined || cookie === undefined) throw new HttpFailure(403, "입력 화면에서 세션을 시작해 주세요.");
        if (caseId && !session.cases.has(caseId)) throw new HttpFailure(404, "사례를 찾을 수 없습니다.");
        const adapter = dependencies.adapter;
        if (adapter === undefined) throw new HttpFailure(503, "입력·세션 연결 준비 중 · H1/H4 어댑터가 없어 검토를 실행하지 않았습니다.");
        if ((session.cases.size >= 100 || owners.size >= 100) && !caseId) throw new HttpFailure(429, "저장 가능한 사례 제한에 도달했습니다.");
        const stored = await bounded(async (signal) => {
          const raw = await body(request, maxBodyBytes, signal);
          if (signal.aborted) throw new HttpFailure(408, "요청이 취소되었습니다.");
          const output = caseId ? await adapter.answer(caseId, raw, signal) : await adapter.submit(raw, signal);
          if (Buffer.byteLength(JSON.stringify(output), "utf-8") > 524288) throw new HttpFailure(502, "검토 결과 크기 제한을 초과했습니다.");
          return parseAssessment(output);
        }, request, timeoutMs);
        const result = stored.decision;
        if (!idPattern.test(result.caseId) || (caseId && result.caseId !== caseId) || (owners.has(result.caseId) && owners.get(result.caseId) !== cookie)) throw new HttpFailure(502, "사례 식별 정보를 확인할 수 없습니다.");
        if (!caseId && session.cases.has(result.caseId)) throw new HttpFailure(409, "이미 존재하는 사례입니다.");
        session.cases.set(result.caseId, structuredClone(stored));
        owners.set(result.caseId, cookie);
        return redirect(`/cases/${result.caseId}`);
      }
      throw new HttpFailure(404, "페이지를 찾을 수 없습니다.");
    } catch (error) {
      if (error instanceof HttpFailure) return response(page("요청 상태", `<h1>요청을 완료하지 못했습니다</h1><p role="alert">${escapeHtml(error.publicMessage)}</p>`), error.status);
      // HTTP trust boundary: provider and unexpected implementation errors never enter HTML/logs.
      return response(page("실행 실패", "<h1>검토 실행 실패</h1><p role=\"alert\">연결 또는 결과 검증에 실패했습니다. 담당자에게 실행 상태를 확인해 주세요.</p>"), 502);
    }
  };
}
