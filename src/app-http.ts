import type { SessionFailureCode } from "./session.ts";
import type { AppDependencies } from "./app-types.ts";
import { escapeHtml, page } from "./report-html.ts";
import { LocalAuthError } from "./o-auth.ts";
import { RuntimeStorageError } from "./o-runtime-db.ts";
import { ResourceUnavailableError } from "./o-resources.ts";
import { CaseConflict } from "./o-case-store.ts";
import { PhotoHttpFailure } from "./o-photo-http.ts";
import { PhotoStorageError } from "./photo-codec.ts";
import { AssessmentInputError } from "./assessment.ts";
export class HttpFailure extends Error {
  constructor(readonly status: number, readonly publicMessage: string) {
    super(publicMessage);
  }
}
export const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
export const sessionFailures: Readonly<Record<SessionFailureCode, { readonly status: number; readonly message: string }>> = {
  "case-not-found": { status: 404, message: "사례가 만료되었거나 찾을 수 없습니다. 입력 화면에서 새 사례를 제출해 주세요." },
  "case-busy": { status: 409, message: "이 사례를 처리하고 있습니다. 끝난 뒤 다시 제출해 주세요." },
  cancelled: { status: 408, message: "요청이 취소되었습니다. 내 사례에서 상태를 확인하고 다시 제출해 주세요." },
  timeout: { status: 504, message: "처리 시간이 초과되었습니다. 내 사례에서 상태를 확인하고 다시 제출해 주세요." },
  capacity: { status: 429, message: "저장 가능한 사례 수가 가득 찼습니다. 잠시 후 다시 제출해 주세요." },
  "rate-limit": { status: 429, message: "요청이 많습니다. 잠시 후 다시 제출해 주세요." },
  "not-configured": { status: 503, message: "모델 연결이 설정되지 않았습니다. 담당자에게 설정을 요청해 주세요." },
  authentication: { status: 502, message: "모델 구독 인증에 실패했습니다. 담당자에게 연결 설정을 요청해 주세요." },
  provider: { status: 502, message: "모델 요청이 실패했습니다. 잠시 후 다시 제출해 주세요." },
  "invalid-model-output": { status: 502, message: "모델 결과가 검증을 통과하지 못했습니다. 다시 제출하고, 반복되면 담당자에게 알려 주세요." },
  "turn-limit": { status: 502, message: "모델 실행 단계가 한도에 도달했습니다. 담당자에게 알려 주세요." },
};
function sessionFailureCode(error: unknown): SessionFailureCode | undefined {
  // Type-only session import avoids the runtime app ↔ session composition cycle.
  if (!(error instanceof Error) || error.name !== "SessionFailure" || !("code" in error) || typeof error.code !== "string") return undefined;
  const code = error.code;
  return Object.keys(sessionFailures).find((key): key is SessionFailureCode => key === code);
}
export const defaultBodyBytes = 16384;
export const caseFormTextLimits = {
  description: 10000, process: 500, polymer: 500, contamination: 500, region: 500, answers: 10000,
} as const;
// 12,000 UTF-16 units at up to nine encoded bytes each, plus form metadata.
const defaultCaseFormBodyBytes = 109024;
const formMediaType = "application/x-www-form-urlencoded";
const mediaType = (request: Request) => request.headers.get("content-type")?.split(";", 1)[0]?.trim();

export async function caseBody(request: Request, configuredLimit: number | undefined, signal: AbortSignal) {
  const format = mediaType(request) === formMediaType ? "form" : "json";
  const limit = configuredLimit ?? (format === "form" ? defaultCaseFormBodyBytes : defaultBodyBytes);
  const raw = await body(request, limit, signal, format === "form");
  return { raw, format } as const;
}

export async function body(request: Request, limit: number, signal: AbortSignal, caseForm = false): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) throw new HttpFailure(413, "입력이 너무 깁니다. 내용을 줄여 다시 제출해 주세요.");
  if (request.body === null) throw new HttpFailure(400, "입력 내용이 비어 있습니다.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new HttpFailure(408, "입력 전송이 중단되었습니다. 다시 제출해 주세요.");
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new HttpFailure(413, "입력이 너무 깁니다. 내용을 줄여 다시 제출해 주세요.");
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
    if (error instanceof TypeError) throw new HttpFailure(400, "UTF-8로 인코딩된 입력을 보내 주세요.");
    throw error;
  }
  switch (mediaType(request)) {
    case "application/json": {
      try {
        const parsed: unknown = JSON.parse(raw);
        return parsed;
      } catch (error) {
        if (error instanceof SyntaxError) throw new HttpFailure(400, "JSON 형식을 확인해 주세요.");
        throw error;
      }
    }
    case formMediaType: {
      const params = new URLSearchParams(raw);
      const keys = [...params.keys()];
      if (new Set(keys).size !== keys.length) throw new HttpFailure(400, "같은 필드가 두 번 들어 있습니다. 하나만 남겨 주세요.");
      if (caseForm) {
        for (const [field, max] of Object.entries(caseFormTextLimits)) {
          const value = params.get(field) ?? "";
          const editValue = params.get("field_" + field) ?? "";
          const length = field === "description" || field === "answers" ? value.replace(/\r\n/g, "\n").length : value.length;
          const editLength = field === "description" ? editValue.replace(/\r\n/g, "\n").length : editValue.length;
          if (length > max || editLength > max) {
            throw new HttpFailure(400, "입력 항목이 글자 수 한도를 넘었습니다. 줄여서 다시 제출해 주세요.");
          }
        }
      }
      return Object.fromEntries(params);
    }
    default: throw new HttpFailure(415, "JSON 또는 폼 형식으로 보내 주세요.");
  }
}
export async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>, request: Request, timeoutMs: number, pending: Set<Promise<unknown>>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel = () => {};
  const interruption = new Promise<never>((_, reject) => {
    cancel = () => {
      const failure = new HttpFailure(408, "요청이 취소되었습니다.");
      reject(failure);
      controller.abort(failure);
    };
    timer = setTimeout(() => {
      const failure = new HttpFailure(504, "처리 시간이 초과되었습니다. 다시 시도해 주세요.");
      reject(failure);
      controller.abort(failure);
    }, timeoutMs);
    if (request.signal.aborted) cancel();
    else request.signal.addEventListener("abort", cancel, { once: true });
  });
  try {
    const work = operation(controller.signal);
    pending.add(work);
    void work.then(() => pending.delete(work), () => pending.delete(work));
    return await Promise.race([interruption, work]);
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", cancel);
    controller.abort();
  }
}

export const versionOf = (raw: unknown, fallback?: number): number => {
    if (raw === undefined && fallback !== undefined) return fallback; // Legacy anonymous text API.
    const value = typeof raw === "string" && /^[1-9]\d*$/.test(raw) ? Number(raw) : raw;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new HttpFailure(409, "사례가 바뀌었습니다. 새로고침한 뒤 다시 제출해 주세요.");
    return value;
  };

export const response = (html: string, status = 200, headers: HeadersInit = {}) => new Response(html, { status, headers: {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
    "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", ...headers } });
export const redirect = (path: string) => response("", 303, { location: path });

export function errorResponse(error: unknown, recovery: string, dependencies: AppDependencies): Response {
  if (error instanceof LocalAuthError) {
    const status = { denied: 403, throttled: 429, unavailable: 503, cancelled: 408 }[error.code];
    const message = error.code === "throttled" ? "잠시 후 다시 시도해 주세요." : "로그인 정보나 계정 상태를 확인해 주세요.";
    return response(page("로그인 상태", `<h1>요청을 완료하지 못했습니다</h1><p role="alert">${message}</p><p><a href="/login">로그인</a></p>${recovery}`), status);
  }
  if (error instanceof RuntimeStorageError || error instanceof ResourceUnavailableError) return response(page("저장소 상태", `<h1>검토 실패</h1><p role="alert">저장소나 사례 자료에 접근하지 못했습니다. 내 사례에서 마지막 저장 결과를 확인해 주세요.</p>${recovery}`), 503);
  if (error instanceof CaseConflict && error.message === "capacity") return response(page("실행 상태", `<p role="alert">${escapeHtml(sessionFailures.capacity.message)}</p>${recovery}`), sessionFailures.capacity.status);
  if (error instanceof CaseConflict) return response(page("수정 충돌", `<p>다른 수정이 먼저 반영되었습니다. 새로고침한 뒤 다시 제출해 주세요.</p>${recovery}`), 409);
  if (error instanceof PhotoHttpFailure) return response(page("사진 확인", `<p>PNG 또는 JPEG, 5 MiB 이하인지 확인해 주세요.</p>${recovery}`), error.status);
  if (error instanceof PhotoStorageError) return response(page("사진 처리 실패", `<p>사진 동의, 파일 형식, 저장소 상태를 확인해 주세요.</p>${recovery}`), error.code === "denied" ? 403 : error.code === "unavailable" ? 503 : 400);
  if (error instanceof HttpFailure) return response(page("요청 상태", `<h1>요청을 완료하지 못했습니다</h1><p role="alert">${escapeHtml(error.publicMessage)}</p>${recovery}${dependencies.localAuth ? '<p><a href="/login">로그인</a></p>' : ""}`), error.status);
  if (error instanceof AssessmentInputError) {
    const labels = { $: "사례 입력", caseId: "사례 번호", description: "폐자원 설명", photoRefs: "사진",
      process: "발생 공정", polymer: "재질·품목", contamination: "오염 상태", hazardousContact: "유해물질 접촉",
      massKg: "질량", region: "발생 지역", assessmentDate: "평가 기준일" };
    const issues = error.issues.map((issue) => `<li>${labels[issue.field]}: ${issue.code === "required" ? "필수 항목입니다. 값을 입력해 주세요." : "형식이나 허용 값이 맞지 않습니다."}</li>`).join("");
    return response(page("입력 확인", `<h1>입력을 확인해 주세요</h1><p role="alert">아래 항목을 사례 화면 입력란에서 고쳐 주세요. 질량은 0보다 큰 kg 숫자로 쓰고, 모르면 비워 두세요. 평가 기준일은 실제 날짜로 입력하세요. 이전 저장 결과는 그대로입니다.</p><ul>${issues}</ul><details><summary>고급 JSON 입력 안내</summary><p>답변·수정은 JSON 객체로 입력하고 숫자는 따옴표 없이 씁니다. 날짜는 YYYY-MM-DD 형식입니다. caseId와 판정·승인 필드는 고정입니다.</p><p>예: <code>{"massKg":100}</code> · 생략한 필드는 그대로 두고, null은 미상으로 처리합니다.</p></details>${recovery}`), 400);
  }
  const code = sessionFailureCode(error);
  if (code !== undefined) {
    const failure = sessionFailures[code];
    return response(page("실행 상태", `<h1>검토 실패</h1><p role="alert">${escapeHtml(failure.message)}</p>${recovery}`), failure.status);
  }
  // HTTP trust boundary: provider and unexpected implementation errors never enter HTML/logs.
  return response(page("실행 실패", `<h1>검토 실패</h1><p role="alert">모델 연결이나 결과 검증에 실패했습니다. 다시 제출하고, 반복되면 담당자에게 알려 주세요.</p>${recovery}`), 502);
}
