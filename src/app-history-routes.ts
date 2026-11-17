import type { HistoryRouteOptions } from "./app-types.ts";
import { bounded, errorResponse, HttpFailure, response } from "./app-http.ts";
import { historyIndexPage, historyCasePage } from "./report-history.ts";
import { requireValid } from "./o-validation.ts";

const recovery = '<p><a href="/cases">내 사례로 돌아가기</a></p>';
const denied = () => new HttpFailure(403, "비공개 연구 기록을 확인할 권한이 없습니다. 인증 또는 계정 상태를 확인해 주세요.");
/** Only this namespace is handled here. All ordinary application requests keep their original wiring. */
export function createHistoryRoutes(next: (request: Request) => Promise<Response>, options: HistoryRouteOptions) {
  const origin = new URL(options.origin).origin, timeoutMs = options.timeoutMs ?? 10000;
  requireValid(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000, "invalid-http-limits");
  const pending = new Set<Promise<unknown>>();
  let disposed = false;
  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname !== "/research/history" && !url.pathname.startsWith("/research/history/")) return next(request);
      const deadline = performance.now() + timeoutMs;
      try {
        return await bounded(async signal => {
          const guard = () => {
            if (disposed || request.signal.aborted || signal.aborted) throw new HttpFailure(408, "요청이 취소되었습니다.");
            if (performance.now() >= deadline) throw new HttpFailure(504, "처리 시간이 초과되었습니다. 다시 시도해 주세요.");
          };
          guard();
          if (url.origin !== origin) throw new HttpFailure(400, "앱 주소가 일치하지 않습니다.");
          const callerOrigin = request.headers.get("origin");
          if (callerOrigin !== null && callerOrigin !== origin || request.headers.get("sec-fetch-site") === "cross-site") throw denied();
          const identity = options.localAuth?.resolve(request, signal);
          guard();
          if (options.localAuth && !identity) throw denied();
          const mount = options.mount;
          if (!mount) throw new HttpFailure(404, "비공개 연구 기록이 구성되지 않아 확인할 수 없습니다.");
          if (!identity || identity.actorId !== mount.readerActorId) throw denied();
          identity.assertCurrent();
          guard();
          if (request.method !== "GET") {
            const result = errorResponse(new HttpFailure(405, "읽기 전용 기록입니다. GET 요청으로 확인해 주세요."), recovery, options);
            result.headers.set("allow", "GET");
            identity.assertCurrent();
            guard();
            return result;
          }
          const match = /^\/research\/history\/cases\/([1-9]\d?)$/.exec(url.pathname);
          const item = match ? mount.archive.evidence.cases.find(record => record.index === Number(match[1])) : undefined;
          const html = url.pathname === "/research/history" ? historyIndexPage(mount.archive)
            : item ? historyCasePage(mount.archive, item) : undefined;
          if (html === undefined) throw new HttpFailure(404, "비공개 연구 기록을 찾을 수 없습니다.");
          const result = response(html);
          identity.assertCurrent();
          guard();
          return result;
        }, request, timeoutMs, pending);
      } catch (error) {
        return errorResponse(error, recovery, options);
      }
    },
    dispose() { disposed = true; },
    async settled() { while (pending.size) await Promise.allSettled([...pending]); },
  };
}
