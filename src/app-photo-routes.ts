import { randomUUID } from "node:crypto";
import type { CaseSnapshot } from "./o-case-store.ts";
import type { RouteRequest, RouteServices } from "./app-types.ts";
import type { PhotoExecutionTicket } from "./photo-execution.ts";
import { matchesPhotoConsent } from "./photo-execution.ts";
import { photoForm } from "./o-photo-http.ts";
import { escapeHtml } from "./report-html.ts";
import { HttpFailure, redirect, versionOf } from "./app-http.ts";
import { revision } from "./o-validation.ts";
export function photoUI(snapshot: CaseSnapshot, ticket: PhotoExecutionTicket | null, services: RouteServices): string {
  const { photoEnabled, dependencies } = services;
    if (!photoEnabled) return '<p class="notice">사진 저장은 로그인한 사례에서 사용할 수 있습니다.</p>';
    const base = `/cases/${snapshot.input.caseId}`, policy = dependencies.photoPolicy;
    const model = ticket?.scope;
    return `<section class="screen-only"><h2>비공개 사진</h2><p>저장 기간: 최대 ${Math.ceil((policy?.retentionMs ?? 0) / 60000)}분. 저장 동의와 모델 전송 동의를 각각 선택합니다. ${model ? `전송 제공자: ${escapeHtml(model.provider)} · 목적: ${escapeHtml(model.purpose)}` : "이 환경에서는 사진을 모델에 보내지 않고 저장만 합니다."}</p>
    <form method="post" enctype="multipart/form-data" action="${base}/photos"><input type="hidden" name="baseVersion" value="${snapshot.version}">${ticket ? `<input type="hidden" name="modelBindingId" value="${escapeHtml(ticket.bindingId)}">` : ""}<label>PNG/JPEG 한 장 (최대 5 MiB)<input type="file" name="file" accept="image/png,image/jpeg" required></label>
    <label class="consent"><input type="checkbox" name="store" value="yes" required>비공개 저장에 동의합니다</label>
    <label class="consent"><input type="checkbox" name="model" value="yes" ${model ? "" : "disabled"}>위 제공자·목적으로 모델에 보내는 데 동의합니다</label>
    <label class="consent"><input type="checkbox" name="visible" value="yes">사진 속 개인정보·민감 정보를 확인했습니다</label><button type="submit">사진 저장</button></form>
    ${snapshot.pendingCleanup.map(ref => `<p role="status">사진 삭제 대기 중 · 미리보기와 모델 사용을 막았습니다. 파일 삭제가 끝나지 않았으면 아래 버튼으로 다시 시도하세요.</p><form method="post" action="${base}/photos/${ref}/withdraw-storage"><button type="submit">사진 삭제 다시 시도</button></form>`).join("")}
    ${snapshot.photos.map(photo => `<figure><img class="private-photo" src="${base}/photos/${photo.photoRef}" alt="비공개 사진 (메타데이터 제거)"><figcaption>${snapshot.denied.includes(photo.photoRef) ? "모델 사용 철회됨" : photo.consent.model ? matchesPhotoConsent(photo.consent, ticket) ? "현재 제공자·목적으로 모델 사용 동의" : "제공자·목적이 바뀌었습니다. 다시 올리고 동의해 주세요." : "저장 전용"}</figcaption></figure>
    ${["model", "storage"].map(kind => `<form method="post" action="${base}/photos/${photo.photoRef}/withdraw-${kind}"><button type="submit">${kind === "model" ? "모델 사용 철회" : "사진 삭제"}</button></form>`).join("")}`).join("")}</section>`;
}

export async function photoRoute(services: RouteServices, context: RouteRequest, snapshot: CaseSnapshot): Promise<Response | undefined> {
  const { dependencies, origin, now, caseStore, photoEnabled, cancelLease } = services;
  const { request, signal, guard, privateGuard, actor, photoMatch } = context;
  if (photoMatch && snapshot && actor && photoEnabled) {
    const store = dependencies.photoStore;
    if (!store) throw new HttpFailure(503, "사진 저장소에 연결하지 못했습니다.");
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
      if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") throw new HttpFailure(403, "이 앱 화면에서 다시 제출해 주세요.");
      if (ref && action) {
        privateGuard();
        const result = redirect(`/cases/${snapshot.input.caseId}`);
        caseStore.withdraw(snapshot.owner, snapshot.input.caseId, ref, action === "withdraw-storage", privateGuard);
        if (dependencies.localAuth) {
          dependencies.committed?.();
          return result;
        }
        if (action === "withdraw-storage") {
          await store.revoke(actor, ref, signal);
          caseStore.completeCleanup(snapshot.owner, snapshot.input.caseId, ref);
        }
        else await store.withdrawModel(actor, ref, signal);
        guard(signal);
        return redirect(`/cases/${snapshot.input.caseId}`);
      }
      if (!ref) {
        const data = await photoForm(request, signal), version = versionOf(data.get("baseVersion"));
        const authority = dependencies.photoExecution;
        const ticket = data.has("model") ? authority?.current() : undefined;
        if (data.get("store") !== "yes" || (data.has("model") && data.get("model") !== "yes") || (data.has("visible") && data.get("visible") !== "yes")
          || (data.has("model") && (!ticket || data.get("modelBindingId") !== ticket.bindingId || data.get("visible") !== "yes"))) throw new HttpFailure(400, "저장 동의와, 모델 전송 시 민감 정보 확인란을 체크해 주세요.");
        if (ticket && authority) authority.assertCurrent(ticket);
        const lease = caseStore.begin(snapshot.owner, snapshot.input.caseId, version);
        const cancel = () => cancelLease(lease);
        signal.addEventListener("abort", cancel, { once: true });
        if (signal.aborted) cancel();
        let receipt: Awaited<ReturnType<typeof store.put>> | undefined;
        try {
          const result = redirect(`/cases/${snapshot.input.caseId}`);
          const file = data.get("file");
          if (!(file instanceof File)) throw new HttpFailure(400, "사진 파일을 선택해 주세요.");
          receipt = await store.put(actor, snapshot.input.caseId, new Uint8Array(await file.arrayBuffer()), file.type,
            { recordId: randomUUID(), store: true, model: data.has("model"), visibleContentReviewed: data.has("visible"), expiresAt: now() + (dependencies.photoPolicy?.retentionMs ?? 0),
              ...(ticket ? { modelScope: ticket.scope, modelBindingId: ticket.bindingId } : {}) }, signal);
          caseStore.associate(lease, receipt, () => {
            privateGuard();
            if (ticket && authority) authority.assertCurrent(ticket);
          });
          dependencies.committed?.();
          return result;
        } catch (error) {
          if (receipt) {
            caseStore.queueCleanup(snapshot.owner, snapshot.input.caseId, receipt.photoRef);
            await store.revoke(actor, receipt.photoRef, new AbortController().signal);
            caseStore.completeCleanup(snapshot.owner, snapshot.input.caseId, receipt.photoRef);
          }
          throw error;
        } finally {
          signal.removeEventListener("abort", cancel);
          caseStore.rollback(lease);
        }
      }
    }
  }

  return undefined;
}
