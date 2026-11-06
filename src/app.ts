import { randomBytes, randomUUID } from "node:crypto";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { DecisionResult } from "./contracts.ts";
import { parseDecision } from "./o-decision.ts";
import { demo } from "./o-demo.ts";
import { referencePage } from "./o-reference.ts";
import type { ReportPresentation } from "./report.ts";
import { escapeHtml, page, renderReport } from "./report.ts";
import { requireValid } from "./o-validation.ts";
import { AssessmentInputError } from "./assessment.ts";
import type { SessionFailureCode } from "./session.ts";
import type { CaseInput } from "./contracts.ts";
import { CaseConflict, createCaseStore } from "./o-case-store.ts";
import type { OCaseStore, CaseSnapshot } from "./o-case-store.ts";
import type { createPhotoStore } from "./photos.ts";
import { PhotoStorageError } from "./photo-codec.ts";
import { photoForm, PhotoHttpFailure } from "./o-photo-http.ts";
import { revision } from "./o-validation.ts";
import { matchesPhotoConsent, type PhotoExecutionAuthority, type PhotoExecutionTicket } from "./photo-execution.ts";

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
  /** Trusted server verification only; never read caller-supplied actor fields here. */
  readonly actorForRequest?: (request: Request, signal: AbortSignal) => Promise<string | { readonly actorId: string; readonly validUntil: number } | null>;
  readonly preparer?: {
    prepareSubmit(raw: unknown, format: "json" | "form"): CaseInput;
    prepareAnswer(input: CaseInput, raw: unknown): CaseInput;
    evaluate(input: CaseInput, signal: AbortSignal): Promise<AssessmentEnvelope>;
  };
  readonly caseStore?: OCaseStore;
  readonly photoStore?: Awaited<ReturnType<typeof createPhotoStore>>;
  readonly photoPolicy?: { readonly retentionMs: number; readonly guardedModel?: { readonly provider: string; readonly purpose: string } };
  readonly photoExecution?: PhotoExecutionAuthority;
  readonly checkRequest?: () => void;
  readonly committed?: () => void;
}
class HttpFailure extends Error {
  constructor(readonly status: number, readonly publicMessage: string) {
    super(publicMessage);
  }
}
const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
const sessionFailures: Readonly<Record<SessionFailureCode, { readonly status: number; readonly message: string }>> = {
  "case-not-found": { status: 404, message: "실행 중인 사례를 찾을 수 없거나 유효기간이 지났습니다. 입력 화면에서 새 사례를 제출해 주세요." },
  "case-busy": { status: 409, message: "이 사례의 수정 사항을 처리 중입니다. 완료 후 다시 제출해 주세요." },
  cancelled: { status: 408, message: "요청이 취소되었습니다. 사례 상태를 확인한 뒤 다시 제출해 주세요." },
  timeout: { status: 504, message: "처리 시간이 초과되었습니다. 사례 상태를 확인한 뒤 다시 제출해 주세요." },
  capacity: { status: 429, message: "현재 저장 가능한 사례 제한에 도달했습니다. 잠시 후 다시 제출해 주세요." },
  "rate-limit": { status: 429, message: "실행 요청 제한에 도달했습니다. 잠시 후 다시 제출해 주세요." },
  "not-configured": { status: 503, message: "실행 연결이 구성되지 않았습니다. 담당자에게 설정을 확인해 주세요." },
  authentication: { status: 502, message: "실행 서비스 인증을 확인할 수 없습니다. 담당자에게 연결 설정을 확인해 주세요." },
  provider: { status: 502, message: "실행 서비스 요청에 실패했습니다. 잠시 후 다시 제출해 주세요." },
  "invalid-model-output": { status: 502, message: "실행 결과를 검증하지 못했습니다. 담당자에게 실행 상태를 확인해 주세요." },
  "turn-limit": { status: 502, message: "실행 단계 제한에 도달했습니다. 담당자에게 실행 상태를 확인해 주세요." },
};
function sessionFailureCode(error: unknown): SessionFailureCode | undefined {
  // Type-only session import avoids the runtime app ↔ session composition cycle.
  if (!(error instanceof Error) || error.name !== "SessionFailure" || !("code" in error) || typeof error.code !== "string") return undefined;
  const code = error.code;
  return Object.keys(sessionFailures).find((key): key is SessionFailureCode => key === code);
}
function form(action: string, answers = false, version?: number, selection = ""): string {
  return `<form method="post" action="${escapeHtml(action)}">${version === undefined ? "" : `<input type="hidden" name="baseVersion" value="${version}">`}${answers ? `<label for="answers">사례 필드 답변·수정 (JSON 객체)</label>
  <p id="answers-help">수정할 필드만 입력하세요. 생략한 필드는 유지됩니다. 허용되는 필드의 null은 미상이며 숫자에는 따옴표를 붙이지 않습니다. caseId와 판정·승인은 수정할 수 없습니다.</p>
  <p>입력 예시 (자동 입력되지 않음): <code>{"polymer":"PP","massKg":100}</code></p>
  <textarea id="answers" name="answers" aria-describedby="answers-help" required maxlength="10000"></textarea>` : `
  <label for="description">폐자원 설명</label><textarea id="description" name="description" required maxlength="10000"></textarea>
  <label for="process">발생 공정</label><input id="process" name="process" maxlength="500">
  <label for="polymer">수지 (미상은 공란)</label><input id="polymer" name="polymer" maxlength="200">
  <label for="contamination">오염 상태</label><input id="contamination" name="contamination" maxlength="500">
  <label for="hazardousContact">유해물질 접촉</label><select id="hazardousContact" name="hazardousContact"><option value="unknown">미상</option><option value="yes">있음</option><option value="no">없음</option></select>
  <label for="massKg">실측 질량 (kg, 미상은 공란)</label><input id="massKg" name="massKg" type="number" min="0.001" step="any">
  <label for="region">발생 지역</label><input id="region" name="region" maxlength="200">
  <label for="assessmentDate">평가 기준일</label><input id="assessmentDate" name="assessmentDate" type="date" required>
  <p>사진은 사례를 만든 후 별도로 업로드하세요.</p>`}
  ${selection}<button type="submit">${answers ? "사례 필드 수정 제출" : "사례 제출"}</button></form>`;
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
  const caseStore = dependencies.caseStore ?? createCaseStore(now, dependencies.photoExecution);
  const preparer = dependencies.preparer;
  const photoEnabled = !!(dependencies.actorForRequest && dependencies.photoStore && dependencies.photoPolicy);
  const checkRequest = (signal: AbortSignal) => { signal.throwIfAborted(); dependencies.checkRequest?.(); };
  const versionOf = (raw: unknown, fallback?: number): number => {
    if (raw === undefined && fallback !== undefined) return fallback; // Legacy anonymous text API.
    const value = typeof raw === "string" && /^[1-9]\d*$/.test(raw) ? Number(raw) : raw;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new HttpFailure(409, "사례 버전을 확인하고 새로고침해 주세요.");
    return value;
  };
  const photoUI = (snapshot: CaseSnapshot, ticket: PhotoExecutionTicket | null) => {
    if (!photoEnabled) return '<p class="notice">인증된 비공개 사진 저장소를 사용할 수 없습니다.</p>';
    const base = `/cases/${snapshot.input.caseId}`, policy = dependencies.photoPolicy;
    const model = ticket?.scope;
    return `<section class="screen-only"><h2>비공개 사진</h2><p>저장 기간: 최대 ${Math.ceil((policy?.retentionMs ?? 0) / 60000)}분. 저장 동의와 모델 전송 동의는 별개입니다. ${model ? `전송 제공자: ${escapeHtml(model.provider)} · 목적: ${escapeHtml(model.purpose)}` : "모델 사진 전송을 사용할 수 없습니다. 모델 동의·선택은 비활성 상태입니다."}</p>
    <form method="post" enctype="multipart/form-data" action="${base}/photos"><input type="hidden" name="baseVersion" value="${snapshot.version}">${ticket ? `<input type="hidden" name="modelBindingId" value="${escapeHtml(ticket.bindingId)}">` : ""}<label>PNG/JPEG 한 장 (최대 5 MiB)<input type="file" name="file" accept="image/png,image/jpeg" required></label>
    <label style="display:flex;align-items:center;gap:.7rem;min-height:44px"><input style="width:auto" type="checkbox" name="store" value="yes" required>비공개 저장에 동의합니다</label>
    <label style="display:flex;align-items:center;gap:.7rem;min-height:44px"><input style="width:auto" type="checkbox" name="model" value="yes" ${model ? "" : "disabled"}>명시된 제공자·목적의 모델 전송에 동의합니다</label>
    <label style="display:flex;align-items:center;gap:.7rem;min-height:44px"><input style="width:auto" type="checkbox" name="visible" value="yes">사진에 보이는 식별·민감 내용을 검토했습니다</label><button type="submit">사진 저장</button></form>
    ${snapshot.pendingCleanup.map(ref => `<p role="status">사진 삭제 대기 중 · 미리보기와 모델 사용이 차단되었습니다. 실제 파일 삭제는 아직 확인되지 않았습니다.</p><form method="post" action="${base}/photos/${ref}/withdraw-storage"><button type="submit">사진 삭제 다시 시도</button></form>`).join("")}
    ${snapshot.photos.map(photo => `<figure><img style="max-width:100%;max-height:240px;object-fit:contain" src="${base}/photos/${photo.photoRef}" alt="정제된 비공개 사진"><figcaption>${snapshot.denied.includes(photo.photoRef) ? "모델 사용 철회됨" : photo.consent.model ? matchesPhotoConsent(photo.consent, ticket) ? "현재 제공자·목적의 모델 사용 동의됨" : "현재 제공자·목적에 새 업로드와 재동의가 필요합니다." : "저장 전용"}</figcaption></figure>
    ${["model", "storage"].map(kind => `<form method="post" action="${base}/photos/${photo.photoRef}/withdraw-${kind}"><button type="submit">${kind === "model" ? "모델 사용 철회" : "사진 저장 철회·삭제"}</button></form>`).join("")}`).join("")}</section>`;
  };
  requireValid(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000 && Number.isInteger(maxBodyBytes) && maxBodyBytes > 0 && maxBodyBytes <= 1048576, "invalid-http-limits");
  // Per-app in-memory sessions, one hour TTL, bounded capacity. Reports never shared by ID alone.
  const sessions = new Map<string, { readonly created: number; readonly cases: Map<string, StoredAssessment> }>();
  const actorReports = new Map<string, { readonly created: number; readonly cases: Map<string, StoredAssessment> }>();
  const owners = new Map<string, string>();
  const secure = origin.startsWith("https:");
  const response = (html: string, status = 200, headers: HeadersInit = {}) => new Response(html, { status, headers: {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
    "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", ...headers } });
  const redirect = (path: string) => response("", 303, { location: path });
  return async (request) => {
    const deadline = performance.now() + timeoutMs;
    try {
      return await bounded(async (signal) => {
      const guard = (signal: AbortSignal) => {
        checkRequest(signal);
        if (performance.now() >= deadline) throw new HttpFailure(504, "처리 시간이 초과되었습니다. 다시 시도해 주세요.");
      };
      const url = new URL(request.url);
      if (url.origin !== origin) throw new HttpFailure(400, "앱 주소가 일치하지 않습니다.");
      let actor: string | null = null;
      let validUntil = Infinity;
      if (dependencies.actorForRequest && (url.pathname === "/" || url.pathname.startsWith("/cases"))) {
        try {
          const identity = await dependencies.actorForRequest(request, signal);
          actor = typeof identity === "string" ? identity : identity?.actorId ?? null;
          if (identity && typeof identity === "object") validUntil = Number.isSafeInteger(identity.validUntil) ? identity.validUntil : 0;
        }
        catch { guard(signal); throw new HttpFailure(503, "인증 서비스를 사용할 수 없습니다."); }
        guard(signal);
        if (!actor || !/^[A-Za-z0-9_-]{1,128}$/.test(actor) || validUntil <= now() || Number.isNaN(validUntil)) throw new HttpFailure(403, "인증이 필요합니다.");
      }
      const privateGuard = () => { guard(signal); if (validUntil <= now()) throw new HttpFailure(403, "인증 유효기간이 지났습니다."); };
      for (const [token, session] of sessions) if (now() - session.created > 3600000) {
        sessions.delete(token);
        for (const caseId of session.cases.keys()) owners.delete(caseId);
      }
      for (const [id, reports] of actorReports) if (now() - reports.created > 3600000) {
        actorReports.delete(id); for (const caseId of reports.cases.keys()) owners.delete(caseId);
      }
      const cookie = request.headers.get("cookie")?.split(";").map((v) => v.trim()).find((v) => v.startsWith("resource_session="))?.slice("resource_session=".length);
      const session = cookie === undefined ? undefined : sessions.get(cookie);
      const owner = actor ? `actor:${actor}` : cookie && session ? `session:${cookie}` : undefined;
      const reports = actor ? actorReports.get(actor)?.cases : session?.cases;
      if (request.method === "GET" && url.pathname === "/health") return new Response(JSON.stringify({ app: "ready", backend: dependencies.adapter ? "adapter-connected" : "unavailable", azure: "not-verified" }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
      if (request.method === "GET" && url.pathname === "/") {
        if (session === undefined && sessions.size >= 1000) throw new HttpFailure(503, "현재 새 세션을 열 수 없습니다.");
        const token = cookie !== undefined && session !== undefined ? cookie : randomBytes(32).toString("hex");
        if (session === undefined) sessions.set(token, { created: now(), cases: new Map() });
        return response(page("사례 입력", `<h1>폐자원 조건부 검토</h1>
          <p class="notice">${dependencies.adapter ? "입력·세션 어댑터 연결됨 · 실행 후 상태를 확인하세요." : "입력·세션 연결 준비 중 · 현재 제출하면 503 준비 상태를 표시합니다."}</p>
          <p>실제 자료와 합성 데모를 구분합니다. 설명·사진만으로 법적 코드나 처리 허가를 확정하지 않습니다.</p>
          ${form("/cases")}<p>사진 저장: ${photoEnabled ? "인증된 사례에서 사용 가능" : "인증된 비공개 사진 저장소를 사용할 수 없습니다."}</p><p><a href="/demo/review">합성 위험·검토 예시 보기</a></p>`), 200, { "set-cookie": `resource_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600${secure ? "; Secure" : ""}` });
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
      const photoMatch = /^\/cases\/([A-Za-z0-9_-]{1,100})\/photos(?:\/([a-f0-9-]{36})(?:\/(withdraw-model|withdraw-storage))?)?$/.exec(url.pathname);
      if (preparer && (caseMatch || photoMatch || url.pathname === "/cases")) {
        const id = caseId ?? photoMatch?.[1];
        const snapshot = owner && id ? caseStore.read(owner, id) : undefined;
        if (id && !snapshot) throw new HttpFailure(404, "사례를 찾을 수 없습니다.");
        if (request.method === "GET" && snapshot && caseMatch && suffix !== "answers") {
          const ticket = dependencies.photoExecution?.current() ?? null;
          const stored = snapshot.assessment;
          const html = renderReport(stored.decision, { mode: "live", ...(stored.execution ? { execution: { traceId: stored.execution.traceId, usage: stored.execution.usage ?? null } } : {}) });
          const notice = snapshot.permissionChanged ? '<p class="notice">사진 권한이 변경되었습니다. 이전 보고서는 과거 평가입니다. 이미 전송된 사진을 회수하지 않습니다. 사진 없이 다시 평가할 수 있습니다.</p>' : "";
          const selection = `<input type="hidden" name="photoSelection" value="explicit">${snapshot.photos.map(photo => `<label style="display:flex;align-items:center;gap:.7rem;min-height:44px"><input style="width:auto" type="checkbox" name="photo_${photo.photoRef}" value="yes" ${matchesPhotoConsent(photo.consent, ticket) && photo.expiresAt > now() && !snapshot.denied.includes(photo.photoRef) ? "" : "disabled"}>다음 평가에 이 사진 선택</label>`).join("")}`;
          const extra = suffix === "report" ? notice : `${notice}<p>버전 ${snapshot.version}</p><p class="screen-only"><a href="/cases/${id}/report">인쇄용 보고서</a></p>${form(`/cases/${id}/answers`, true, snapshot.version, selection)}${photoUI(snapshot, ticket)}`;
          const result = response(html.replace('<h2>출처와 원문 위치</h2>', `${extra}<h2>출처와 원문 위치</h2>`));
          privateGuard(); return result;
        }
        if (photoMatch && snapshot && actor && photoEnabled) {
          const store = dependencies.photoStore;
          if (!store) throw new HttpFailure(503, "사진 저장소를 사용할 수 없습니다.");
          const ref = photoMatch[2], action = photoMatch[3];
          const attachment = snapshot.photos.find(photo => photo.photoRef === ref);
          if (ref && !attachment && !(request.method === "POST" && action && snapshot.denied.includes(ref))) throw new HttpFailure(404, "사진을 찾을 수 없습니다.");
          if (request.method === "GET" && ref && !action) {
            const preview = await store.read(actor, { caseId: snapshot.input.caseId, caseRevision: revision(snapshot.input), photoRef: ref }, signal);
            privateGuard();
            if (!caseStore.read(snapshot.owner, snapshot.input.caseId)?.photos.some(photo => photo.photoRef === ref)) throw new HttpFailure(404, "사진을 찾을 수 없습니다.");
            return new Response(preview.data, { headers: { "content-type": "image/png", "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" } });
          }
          if (request.method === "POST") {
            if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") throw new HttpFailure(403, "같은 앱에서 제출해 주세요.");
            if (ref && action) {
              guard(signal);
              caseStore.withdraw(snapshot.owner, snapshot.input.caseId, ref, action === "withdraw-storage");
              if (action === "withdraw-storage") {
                await store.revoke(actor, ref, signal);
                caseStore.completeCleanup(snapshot.owner, snapshot.input.caseId, ref);
              }
              else await store.withdrawModel(actor, ref, signal);
              guard(signal); return redirect(`/cases/${snapshot.input.caseId}`);
            }
            if (!ref) {
              const data = await photoForm(request, signal), version = versionOf(data.get("baseVersion"));
              const ticket = data.has("model") ? dependencies.photoExecution?.current() : undefined;
              if (data.get("store") !== "yes" || (data.has("model") && data.get("model") !== "yes") || (data.has("visible") && data.get("visible") !== "yes")
                || (data.has("model") && (!ticket || data.get("modelBindingId") !== ticket.bindingId || data.get("visible") !== "yes"))) throw new HttpFailure(400, "사진 동의를 확인해 주세요.");
              if (ticket) dependencies.photoExecution!.assertCurrent(ticket);
              const lease = caseStore.begin(snapshot.owner, snapshot.input.caseId, version);
              const cancel = () => caseStore.rollback(lease);
              signal.addEventListener("abort", cancel, { once: true });
              if (signal.aborted) cancel();
              let receipt: Awaited<ReturnType<typeof store.put>> | undefined;
              try {
                const file = data.get("file"); if (!(file instanceof File)) throw new HttpFailure(400, "사진이 필요합니다.");
                receipt = await store.put(actor, snapshot.input.caseId, new Uint8Array(await file.arrayBuffer()), file.type,
                  { recordId: randomUUID(), store: true, model: data.has("model"), visibleContentReviewed: data.has("visible"), expiresAt: now() + (dependencies.photoPolicy?.retentionMs ?? 0),
                    ...(ticket ? { modelScope: ticket.scope, modelBindingId: ticket.bindingId } : {}) }, signal);
                caseStore.associate(lease, receipt, () => { privateGuard(); if (ticket) dependencies.photoExecution!.assertCurrent(ticket); }); dependencies.committed?.();
                return redirect(`/cases/${snapshot.input.caseId}`);
              } catch (error) {
                if (receipt) {
                  caseStore.queueCleanup(snapshot.owner, snapshot.input.caseId, receipt.photoRef);
                  await store.revoke(actor, receipt.photoRef, new AbortController().signal);
                  caseStore.completeCleanup(snapshot.owner, snapshot.input.caseId, receipt.photoRef);
                }
                throw error;
              } finally { signal.removeEventListener("abort", cancel); caseStore.rollback(lease); }
            }
          }
        }
        if (request.method === "POST" && (url.pathname === "/cases" || (caseId && suffix === "answers"))) {
          if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") throw new HttpFailure(403, "같은 앱에서 제출해 주세요.");
          if (!owner) throw new HttpFailure(403, "입력 화면에서 세션을 시작해 주세요.");
          const raw = await body(request, maxBodyBytes, signal); guard(signal);
          if (snapshot && snapshot.editUntil <= now()) throw new HttpFailure(sessionFailures["case-not-found"].status, sessionFailures["case-not-found"].message);
          let payload = raw, expected: number | null = null;
          if (snapshot) {
            if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new HttpFailure(400, "수정 입력은 JSON 객체여야 합니다.");
            const { baseVersion, ...rest } = raw as Record<string, unknown>;
            expected = versionOf(baseVersion, actor ? undefined : snapshot.version);
            if (snapshot.version !== expected) throw new CaseConflict("snapshot-version-mismatch");
            if (Object.hasOwn(rest, "patch")) {
              if (Object.keys(rest).length !== 1) throw new HttpFailure(400, "수정 입력을 확인해 주세요.");
              payload = rest["patch"];
            } else if (rest["photoSelection"] === "explicit") {
              const selected: string[] = [];
              for (const key of Object.keys(rest)) if (key.startsWith("photo_")) {
                if (rest[key] !== "yes" || !snapshot.photos.some(photo => `photo_${photo.photoRef}` === key)) throw new HttpFailure(400, "사진 선택을 확인해 주세요.");
                selected.push(key.slice(6)); delete rest[key];
              }
              delete rest["photoSelection"];
              if (Object.keys(rest).length !== 1 || typeof rest["answers"] !== "string") throw new HttpFailure(400, "수정 입력을 확인해 주세요.");
              let patch: unknown; try { patch = JSON.parse(rest["answers"]); } catch { throw new HttpFailure(400, "JSON 입력을 확인해 주세요."); }
              if (typeof patch !== "object" || patch === null || Array.isArray(patch) || Object.hasOwn(patch, "photoRefs")) throw new HttpFailure(400, "사진은 선택란에서 지정해 주세요.");
              payload = { ...patch, photoRefs: selected };
            } else payload = rest;
          }
          const input = snapshot ? preparer.prepareAnswer(snapshot.input, payload) : preparer.prepareSubmit(raw, request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded") ? "form" : "json");
          const ticket = input.photoRefs.length ? dependencies.photoExecution?.current() : undefined;
          if (input.photoRefs.length && (input.photoRefs.length > 3 || !ticket || !snapshot || !caseStore.eligible(snapshot, input, ticket))) throw new HttpFailure(sessionFailures.provider.status, sessionFailures.provider.message);
          const lease = caseStore.begin(owner, input.caseId, expected);
          const cancel = () => caseStore.rollback(lease); signal.addEventListener("abort", cancel, { once: true });
          try {
            const output = await caseStore.run(lease, input, runSignal => preparer.evaluate(structuredClone(input), runSignal), ticket ?? undefined);
            guard(signal);
            const captured: unknown = structuredClone(output);
            if (Buffer.byteLength(JSON.stringify(captured), "utf8") > 524288) throw new HttpFailure(502, "검토 결과 크기 제한을 초과했습니다.");
            const parsed = parseAssessment(captured);
            if (parsed.decision.caseId !== input.caseId || !idPattern.test(parsed.decision.caseId)) throw new HttpFailure(502, "사례 식별 정보를 확인할 수 없습니다.");
            const owned = structuredClone(parsed);
            const result = redirect(`/cases/${input.caseId}`);
            caseStore.commit(lease, owned, () => { privateGuard(); if (ticket) dependencies.photoExecution!.assertCurrent(ticket); }); dependencies.committed?.();
            return result;
          } finally { signal.removeEventListener("abort", cancel); caseStore.rollback(lease); }
        }
        throw new HttpFailure(404, "페이지를 찾을 수 없습니다.");
      }
      if (request.method === "GET" && caseId && suffix !== "answers") {
        const stored = reports?.get(caseId);
        if (stored === undefined) throw new HttpFailure(404, "사례를 찾을 수 없습니다.");
        const result = stored.decision;
        const html = renderReport(result, { mode: "live", ...(stored.execution ? { execution: stored.execution } : {}) });
        const extra = suffix === "report" ? "" : `<p class="screen-only"><a href="/cases/${caseId}/report">인쇄용 보고서</a></p>${form(`/cases/${caseId}/answers`, true)}`;
        return response(html.replace('<h2>출처와 원문 위치</h2>', `${extra}<h2>출처와 원문 위치</h2>`));
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
        const owned = structuredClone(stored); privateGuard();
        if (actor) {
          const collection = actorReports.get(actor) ?? { created: now(), cases: new Map<string, StoredAssessment>() };
          collection.cases.set(result.caseId, owned); actorReports.set(actor, collection);
        } else session?.cases.set(result.caseId, owned);
        owners.set(result.caseId, owner);
        return redirect(`/cases/${result.caseId}`);
      }
      throw new HttpFailure(404, "페이지를 찾을 수 없습니다.");
      }, request, timeoutMs);
    } catch (error) {
      if (error instanceof CaseConflict && error.message === "capacity") return response(page("실행 상태", `<p role="alert">${escapeHtml(sessionFailures.capacity.message)}</p>`), sessionFailures.capacity.status);
      if (error instanceof CaseConflict) return response(page("수정 충돌", "<p>사례가 변경되었거나 처리 중입니다. 새로고침해 주세요.</p>"), 409);
      if (error instanceof PhotoHttpFailure) return response(page("사진 입력 확인", "<p>사진 입력 형식과 크기를 확인해 주세요.</p>"), error.status);
      if (error instanceof PhotoStorageError) return response(page("사진 요청 실패", "<p>사진 권한·형식 또는 저장 상태를 확인해 주세요.</p>"), error.code === "denied" ? 403 : error.code === "unavailable" ? 503 : 400);
      if (error instanceof HttpFailure) return response(page("요청 상태", `<h1>요청을 완료하지 못했습니다</h1><p role="alert">${escapeHtml(error.publicMessage)}</p>`), error.status);
      if (error instanceof AssessmentInputError) {
        const issues = error.issues.map((issue) => `<li>${escapeHtml(issue.field)}: ${issue.code === "required" ? "필수 필드가 필요합니다." : "필드 형식과 허용 값을 확인해 주세요."}</li>`).join("");
        return response(page("입력 확인", `<h1>입력을 확인해 주세요</h1><p role="alert">사례 필드와 값 형식을 확인해 주세요. 답변·수정은 JSON 객체로 입력하고 숫자에는 따옴표를 붙이지 않습니다. 질량은 0보다 큰 숫자, 날짜는 YYYY-MM-DD 형식의 실제 날짜여야 합니다. caseId와 판정·승인은 수정할 수 없습니다.</p><ul>${issues}</ul><p>예: <code>{"massKg":100}</code> · 생략한 필드는 유지되며 허용되는 필드의 null은 미상입니다. 사례 화면으로 돌아가 수정해 주세요.</p>`), 400);
      }
      const code = sessionFailureCode(error);
      if (code !== undefined) {
        const failure = sessionFailures[code];
        return response(page("실행 상태", `<h1>요청을 완료하지 못했습니다</h1><p role="alert">${escapeHtml(failure.message)}</p><p><a href="/">입력 화면에서 새 사례 제출</a></p>`), failure.status);
      }
      // HTTP trust boundary: provider and unexpected implementation errors never enter HTML/logs.
      return response(page("실행 실패", "<h1>검토 실행 실패</h1><p role=\"alert\">연결 또는 결과 검증에 실패했습니다. 담당자에게 실행 상태를 확인해 주세요.</p>"), 502);
    }
  };
}
