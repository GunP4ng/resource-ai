import type { RouteRequest, RouteServices } from "./app-types.ts";
import { CaseConflict, parseAssessment } from "./o-case-store.ts";
import { matchesPhotoConsent } from "./photo-execution.ts";
import { revision } from "./o-validation.ts";
import { renderReport } from "./report.ts";
import { HttpFailure, body, idPattern, redirect, response, sessionFailures, versionOf } from "./app-http.ts";
import { form, nativeAnswer } from "./app-views.ts";
import { photoUI, photoRoute } from "./app-photo-routes.ts";
import { readCaseResearchCatalog } from "./o-case-research.ts";
import { buildPublicInputScenario } from "./o-input-public-scenario.ts";

export async function caseRoute(services: RouteServices, context: RouteRequest): Promise<Response> {
  const { dependencies, caseStore, maxBodyBytes, origin, now, cancelLease } = services;
  const { request, url, signal, guard, privateGuard, owner, actor, caseMatch, photoMatch } = context;
  const preparer = dependencies.preparer;
  if (!preparer) throw new HttpFailure(503, "입력 연결을 사용할 수 없습니다.");
  const caseId = caseMatch?.[1];
  const suffix = caseMatch?.[2];
  if (request.method === "GET" && suffix === "report" && url.searchParams.get("purpose") === "research" && !actor) {
    throw new HttpFailure(403, "연구용 보고서는 인증된 비공개 사례에서만 확인할 수 있습니다.");
  }

  const id = caseId ?? photoMatch?.[1];
  const report = id ? caseStore.readReport(owner, id) : undefined;
  const snapshot = report?.snapshot;
  if (id && !snapshot) throw new HttpFailure(404, "사례를 찾을 수 없습니다.");
  if (request.method === "GET" && snapshot && suffix === "input") {
    const result = Response.json(snapshot.input, { headers: { etag: `"${revision(snapshot.input)}"`, "cache-control": "private, no-store", "content-disposition": `attachment; filename="${snapshot.input.caseId}.json"`, "x-content-type-options": "nosniff" } });
    privateGuard();
    return result;
  }
  if (request.method === "GET" && snapshot && caseMatch && suffix !== "answers") {
    const ticket = dependencies.photoExecution?.current() ?? null;
    const stored = snapshot.assessment;
    const notice = snapshot.permissionChanged ? '<p class="notice">사진 권한이 변경되었습니다. 이전 보고서는 과거 평가입니다. 이미 전송된 사진을 회수하지 않습니다. 사진 없이 다시 평가할 수 있습니다.</p>' : "";
    const selection = `<input type="hidden" name="photoSelection" value="explicit">${snapshot.photos.map(photo => `<label class="consent"><input type="checkbox" name="photo_${photo.photoRef}" value="yes" ${matchesPhotoConsent(photo.consent, ticket) && photo.expiresAt > now() && !snapshot.denied.includes(photo.photoRef) ? "" : "disabled"}>다음 평가에 이 사진 선택</label>`).join("")}`;
    const privateAudience = actor && (suffix !== "report" || url.searchParams.get("purpose") === "research");
    const publicScenario = privateAudience && !report?.research && snapshot.evaluated.revision === revision(snapshot.input)
      ? buildPublicInputScenario({ actorId: actor, input: snapshot.input, inputRevision: snapshot.evaluated.revision },
        await readCaseResearchCatalog()) : null;
    const audience = privateAudience
      ? { audience: "authenticated-research", research: report?.research ?? null, publicScenario } as const
      : { audience: "commercial" } as const;
    const editable = snapshot.editUntil > now();
    const optionalMass = stored.decision.state === "compared" && snapshot.input.massKg === null && editable
      ? '<p class="screen-only"><a class="primary-action secondary-action" href="#answer-fields">질량을 입력하면 비용·탄소를 계산해요</a> (선택)</p><p>견적·탄소 계수 등 근거가 있는 항목부터 계산합니다. 자료가 없으면 필요한 내용을 알려드려요.</p>' : "";
    const actions = suffix === "report" ? notice : `${notice}${optionalMass}<p class="cluster screen-only"><a href="/cases/${id}/report">상업용 보고서</a>${actor ? `<a href="/cases/${id}/report?purpose=research">비공개 연구용 보고서</a>` : ""}<a href="/cases/${id}/input">정확한 입력 내보내기</a><a href="/cases">내 사례</a></p>`;
    const editing = suffix === "report" ? "" : `<p>버전 ${snapshot.version}</p>${editable
      ? `<p>수정 가능 기한 (UTC): ${new Date(snapshot.editUntil).toISOString()}</p>${form(`/cases/${id}/answers`, true, snapshot.version, selection, snapshot.input)}`
      : '<p class="notice">수정 기한이 지났습니다. 보관 중인 보고서와 입력은 확인할 수 있습니다. 다시 평가하려면 <a href="/">새 사례를 입력하세요</a>.</p>'}${photoUI(snapshot, ticket, services)}`;
    const result = response(renderReport(stored.decision, {
      ...snapshot.presentation, mode: snapshot.presentation?.mode ?? "live", review: snapshot.review,
      historical: snapshot.evaluated.revision !== revision(snapshot.input),
      execution: stored.execution ? { traceId: stored.execution.traceId, usage: stored.execution.usage ?? null } : undefined,
    }, audience, { actions, editing, ...(suffix === "report" || !editable ? {} : { answerTarget: "#answer-fields" as const }) }));
    privateGuard();
    return result;
  }
  if (photoMatch && snapshot && actor && services.photoEnabled) {
    const result = await photoRoute(services, context, snapshot);
    if (result) return result;
  }
  if (request.method === "POST" && (url.pathname === "/cases" || (caseId && suffix === "answers"))) {
    if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") throw new HttpFailure(403, "같은 앱에서 제출해 주세요.");
    if (!owner) throw new HttpFailure(403, "입력 화면에서 세션을 시작해 주세요.");
    const raw = await body(request, maxBodyBytes, signal);
    guard(signal);
    if (snapshot && snapshot.editUntil <= now()) throw new HttpFailure(sessionFailures["case-not-found"].status, sessionFailures["case-not-found"].message);
    let payload = raw, expected: number | null = null;
    if (snapshot) {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new HttpFailure(400, "수정 입력은 JSON 객체여야 합니다.");
      const fields: Record<string, unknown> = Object.fromEntries(Object.entries(raw));
      const { baseVersion, ...rest } = fields;
      expected = versionOf(baseVersion, actor ? undefined : snapshot.version);
      if (snapshot.version !== expected) throw new CaseConflict("snapshot-version-mismatch");
      if (Object.hasOwn(rest, "patch")) {
        if (Object.keys(rest).length !== 1) throw new HttpFailure(400, "수정 입력을 확인해 주세요.");
        payload = rest["patch"];
      } else if (rest["photoSelection"] === "explicit") {
        const selected: string[] = [];
        for (const key of Object.keys(rest)) if (key.startsWith("photo_")) {
          if (rest[key] !== "yes" || !snapshot.photos.some(photo => `photo_${photo.photoRef}` === key)) throw new HttpFailure(400, "사진 선택을 확인해 주세요.");
          selected.push(key.slice(6));
          delete rest[key];
        }
        delete rest["photoSelection"];
        let patch: unknown;
        if (rest["answerMode"] === "fields") patch = nativeAnswer(rest);
        else {
          if (Object.keys(rest).length !== 1 || typeof rest["answers"] !== "string") throw new HttpFailure(400, "수정 입력을 확인해 주세요.");
          try { patch = JSON.parse(rest["answers"]); }
          catch (error) {
            if (error instanceof SyntaxError) throw new HttpFailure(400, "JSON 입력을 확인해 주세요.");
            throw error;
          }
        }
        if (typeof patch !== "object" || patch === null || Array.isArray(patch) || Object.hasOwn(patch, "photoRefs")) throw new HttpFailure(400, "사례 필드를 입력하고 사진은 선택란에서 지정해 주세요.");
        payload = { ...patch, photoRefs: selected };
      } else payload = rest["answerMode"] === "fields" ? nativeAnswer(rest) : rest;
    }
    const input = snapshot ? preparer.prepareAnswer(snapshot.input, payload) : preparer.prepareSubmit(raw, request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded") ? "form" : "json");
    const authority = dependencies.photoExecution;
    const ticket = input.photoRefs.length ? authority?.current() : undefined;
    if (input.photoRefs.length && (input.photoRefs.length > 3 || !ticket || !snapshot || !caseStore.eligible(snapshot, input, ticket))) throw new HttpFailure(sessionFailures.provider.status, sessionFailures.provider.message);
    const lease = caseStore.begin(owner, input.caseId, expected);
    const cancel = () => cancelLease(lease);
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const output = await caseStore.run(lease, input, async runSignal => {
        const output = await preparer.evaluate(structuredClone(input), runSignal);
        privateGuard();
        caseStore.stagePresentation({ mode: dependencies.presentationMode ?? "live", ...(dependencies.runtime ? { runtime: dependencies.runtime } : {}) });
        return output;
      }, ticket ?? undefined, privateGuard);
      guard(signal);
      const captured: unknown = structuredClone(output);
      if (Buffer.byteLength(JSON.stringify(captured), "utf8") > 524288) throw new HttpFailure(502, "검토 결과 크기 제한을 초과했습니다.");
      const parsed = parseAssessment(captured);
      if (parsed.decision.caseId !== input.caseId || !idPattern.test(parsed.decision.caseId)) throw new HttpFailure(502, "사례 식별 정보를 확인할 수 없습니다.");
      const owned = structuredClone(parsed);
      const result = redirect(`/cases/${input.caseId}`);
      caseStore.commit(lease, owned, () => {
        privateGuard();
        if (ticket && authority) authority.assertCurrent(ticket);
      });
      dependencies.committed?.();
      return result;
    } finally {
      signal.removeEventListener("abort", cancel);
      caseStore.rollback(lease);
    }
  }
  throw new HttpFailure(404, "페이지를 찾을 수 없습니다.");
}
