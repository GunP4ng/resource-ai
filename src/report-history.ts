import type { AcceptedHistoryArchive } from "./o-history.ts";
import type { HistoryCase, HistoryTemplate } from "./o-history-schema.ts";
import { historyCaseUsage, historyUsage } from "./o-history-usage.ts";
import { escapeHtml, list, page, safeLink } from "./report-html.ts";

const root = "/research/history";
const esc = escapeHtml;
function archivePage(title: string, content: string): string {
  return page(title, `<div class="print-only"><h1>비공개 연구 자료</h1><p>읽기 전용 연구 기록은 인쇄·반출 대상이 아닙니다. 실행·반출·계약 승인 아님.</p></div>
    <div class="screen-only"><p>과거 실행 기록 · 비공개 연구용 · 읽기 전용</p>
    <p class="state held">! 검토 필요</p><h1>${esc(title)}</h1>
    <p class="notice">실행·반출·계약 승인 아님. 수신된 과거 메타데이터입니다. 새 실행이나 제공자 인증 결과가 아니며 정확한 추천을 보증하지 않습니다.</p>
    ${content}</div>`);
}
function definitions(rows: readonly (readonly [string, string])[]): string {
  return `<dl>${rows.map(([name, value]) => `<dt>${esc(name)}</dt><dd>${esc(value)}</dd>`).join("")}</dl>`;
}
function usage(values: ReturnType<typeof historyCaseUsage> | ReturnType<typeof historyUsage>): string {
  const { api, sdk } = values;
  return `<section id="history-usage"><h2>당시 기록된 사용량</h2>
    <p>API와 SDK는 같은 기록의 서로 다른 집계 경계입니다. 두 값을 더하거나 캐시를 두 번 더하지 마세요. 청구 금액이나 정확도 증빙이 아닙니다.</p>
    <section data-usage="api"><h3>API 요청 합계</h3>
    <p>입력에는 캐시 입력이 이미 포함되어 있습니다. 총량은 입력 + 출력입니다.</p>
    ${definitions([["입력 (캐시 포함)", String(api.input)], ["캐시 입력 (입력의 일부)", String(api.cachedInput)],
      ["출력", String(api.output)], ["총량", String(api.total)]])}</section>
    <section data-usage="sdk"><h3>SDK 세션 카운터</h3>
    <p>입력은 캐시를 제외합니다. 총량은 입력 + cacheRead + 출력입니다. cacheWrite는 별도 기록입니다.</p>
    ${definitions([["입력 (캐시 제외)", String(sdk.input)], ["cacheRead", String(sdk.cacheRead)],
      ["cacheWrite", String(sdk.cacheWrite)], ["출력", String(sdk.output)], ["총량", String(sdk.total)]])}</section></section>`;
}
function sourceDisclosure(archive: AcceptedHistoryArchive): string {
  const { evidence: e, package: artifact } = archive;
  const s = artifact.record.source;
  const href = safeLink(s.comment.htmlUrl);
  return `<details id="history-source"><summary>출처·수신 무결성·확인되지 않은 자료 보기</summary>
    <p>${href === null ? "원본 댓글 링크를 표시할 수 없습니다." : `<a class="source-link" data-history-source href="${href}" rel="noreferrer">원본 출처 댓글 열기</a>`}</p>
    <p>댓글 Markdown·JSON은 직접 표시하지 않습니다. 패키지 봉인은 무결성 검사이며 서명·제공자 인증·사용권 증명이 아닙니다.</p>
    ${definitions([["패키지 봉인 SHA-256", artifact.sha256], ["수신 댓글 바이트 SHA-256", s.suppliedCommentBytesSha256],
      ["수신 evidence 바이트 SHA-256", s.suppliedEvidenceBytesSha256], ["댓글 작성", s.comment.createdAt],
      ["댓글 갱신", s.comment.updatedAt], ["과거 지시 참조", e.ownerInstruction]])}
    <p>패키지 봉인·보존 evidence 바이트·입력 revision·template digest는 수신 시 재계산됩니다. 댓글 파일 해시는 반입 당시 검사이며 투영된 필드로 원래 파일 바이트를 재구성할 수 없습니다.</p>
    <p>원본 모델 출력, 관찰 DTO·특징, 중간 업로드·저장 영수증, 원본 사진·workbook·patch 바이트, 독립 인간 정답·측정 정확도, 당시 브라우저 QA, 법령 현행성·검증된 법령 snapshot, 최종 권리 검토 자료가 없습니다.</p>
    <p>원래 런타임의 중단·제거는 H의 진술입니다. 복구 권한은 없습니다. 이 화면은 모델을 실행하지 않습니다.</p>
    <h3>보존된 한계 원문</h3>${list(e.limitations)}
    <h3>H의 소스 경로 추론</h3>
    <p>빈 후보 질문에 대한 설명은 H의 소스 경로 추론입니다. 보존된 모델 관찰 원문에 근거한 판정이 아닙니다. DTO 미보존은 모델 관찰 결함의 증거가 아닙니다.</p>
    ${definitions([["추론 근거 원문", e.photoObservationAudit.basis], ["추론 fingerprint 선언", e.photoObservationAudit.sourceFingerprint]])}
    ${list(e.photoObservationAudit.source)}
    <h3>당시 코드·자료·모델 선언</h3>
    <p>아래 workbook·patch·fingerprint 해시는 선언입니다. 해당 원본 바이트나 fingerprint 알고리즘을 검증하지 않았습니다.</p>
    ${definitions([["Workbook SHA-256 선언", e.sourceWorkbookSha256], ["기준 Git SHA 선언", e.baseGitSha],
      ["추적 patch SHA-256 선언", e.trackedPatchSha256], ["비추적 patch SHA-256 선언", e.untrackedPatchSha256],
      ["코드 fingerprint 선언", e.codeFingerprint], ["제공자 선언", e.provider], ["경로 선언", e.route], ["모델 선언", e.model]])}</details>`;
}
export function historyIndexPage(archive: AcceptedHistoryArchive): string {
  const e = archive.evidence;
  const totals = historyUsage(e);
  return archivePage("과거 연구 기록 목록", `<nav aria-label="기록 탐색"><a href="/cases">사례 목록으로 돌아가기</a></nav>
    <p>다음으로 기록을 선택해 당시 질문과 실행 전 확인사항을 읽으세요. 수집 분류는 원본 수집 단계의 분류이며 검증된 물질 성분이 아닙니다.</p>
    <div class="cluster"><a class="primary-action" href="#history-records">기록 목록 확인하기</a></div>
    <section id="history-records" class="case-list"><h2>수신된 기록</h2><table><caption>수집 분류와 당시 평가일</caption>
    <thead><tr><th scope="col">기록</th><th scope="col">수집 분류</th><th scope="col">평가일</th><th scope="col">당시 상태</th></tr></thead>
    <tbody>${e.cases.map(c => `<tr><td data-label="기록"><a href="${root}/cases/${c.index}">기록 ${c.index} 보기</a></td>
      <td data-label="수집 분류">${esc(c.category)}</td><td data-label="평가일">${esc(c.input.assessmentDate)}</td>
      <td data-label="당시 상태">! 검토 필요</td></tr>`).join("")}</tbody></table></section>
    <section id="history-counts"><h2>기록 범위</h2>
    ${definitions([["사례 기록", String(totals.cases)], ["요청 전송 기록", String(totals.requests)],
      ["서로 다른 모델 이미지 해시 선언", String(totals.distinctModelImageHashes)], ["중복 이미지 해시 기록", String(totals.repeatedModelImageHashes)]])}
    <p>요청 전송 수와 서로 다른 이미지 해시 수는 다릅니다. 해시 선언은 이미지 바이트 검증이나 독립 사례·정확도 측정이 아닙니다.</p></section>
    ${usage(totals)}${sourceDisclosure(archive)}`);
}
function templateSections(template: HistoryTemplate): string {
  const legalIds = [...new Set(template.reasons.flatMap(reason => reason.match(/(?:legal-|waste-rule-)[A-Za-z0-9_-]+/g) ?? []))];
  return `<section id="history-reasons"><h2>당시 질문과 검토 사유</h2>
    <p>입력 사실과 법적 근거가 부족해 당시 검토가 필요했습니다. 다음 원문에는 당시 질문과 진단이 함께 보존되어 있습니다.</p>
    <details open><summary>보존된 질문·진단 원문 읽기</summary>${list(template.reasons)}</details></section>
    <section id="history-checks"><h2>당시 실행 전 확인사항</h2>
    <p>현장 사실과 법적 근거를 담당자가 별도 확인해야 합니다. 아래는 당시 기록이며 현재 확인 완료를 뜻하지 않습니다.</p>
    <details open><summary>보존된 확인사항 원문 읽기</summary>${list(template.preExecutionChecks)}</details></section>
    <section id="history-legal"><h2>당시 법령 진단</h2>
    <p>평가일에 적용할 법령의 유효성이 확인되지 않았습니다. 검증된 법령 snapshot이 보존되어 있지 않아 현재 registry나 인용문으로 보완하지 않습니다.</p>
    ${list(legalIds.map(id => `${id} · 당시 기록: currentness-unverified · 검증된 법령 근거 없음`))}</section>`;
}
function inputSection(c: HistoryCase): string {
  const unknowns = [["발생 공정", "process", "발생 공정 미기록"], ["수지 성분", "polymer", "물질 성분 미기록"],
    ["오염", "contamination", "오염 정도 미기록"], ["유해물질 접촉", "hazardousContact", "접촉 이력 미확인"],
    ["질량 (kg)", "massKg", "질량 미기록"], ["지역", "region", "지역 미기록"]] as const;
  return `<section id="history-input"><h2>당시 입력</h2>
    ${definitions([["설명", c.input.description], ["평가 기준일", c.input.assessmentDate], ["수집 분류 (성분 미검증)", c.category]])}
    <dl>${unknowns.map(([label, field, reason]) => `<dt>${label}</dt><dd data-unknown="${field}">미상 · ${reason}</dd>`).join("")}</dl></section>`;
}
function executionDisclosure(c: HistoryCase): string {
  return `<details><summary>당시 요청·시간·이미지 계보 선언 보기</summary>
    <p>식별자와 HTTP 상태는 보존된 메타데이터입니다. 제공자 인증이나 원본 이미지 바이트 검증을 의미하지 않습니다.</p>
    ${definitions([["사례 ID", c.caseId], ["과거 actor ID (현재 사용자 권한 아님)", c.actorId], ["소요 시간 (ms) 선언", String(c.elapsedMs)],
      ["실행 trace ID", c.execution.traceId], ["앱 HTTP 상태", String(c.httpStatus)], ["원본 사진 ID", c.sourcePhotoId],
      ["Workbook 행 선언", String(c.workbookRow)], ["사진 참조", c.photoRef], ["입력 revision", c.inputRevision],
      ["Template SHA-256 (JSON.stringify 순서)", c.decisionTemplateSha256], ["원본 이미지 SHA-256 선언", c.sourceSha256],
      ["준비 이미지 SHA-256 선언", c.preparedUploadSha256], ["모델 이미지 SHA-256 선언", c.modelImageSha256]])}
    <p>원본 → 준비 → 모델 이미지 해시는 선언입니다. 원본 업로드·정규화 저장 단계의 별도 영수증과 실제 이미지 바이트는 없습니다.</p>
    ${c.requests.map((r, i) => `<section><h3>요청 ${i + 1}</h3>
      ${definitions([["요청 ID", r.requestId], ["HTTP 상태", String(r.httpStatus)], ["응답 완료 선언", String(r.responseCompleted)],
        ["이미지 전송 수", String(r.imageCount)], ["이미지 SHA-256 선언", r.imageSha256],
        ["입력 (캐시 포함)", String(r.usage.input_tokens)], ["캐시 입력 (입력의 일부)", String(r.usage.cached_input_tokens)],
        ["출력", String(r.usage.output_tokens)], ["총량", String(r.usage.total_tokens)]])}</section>`).join("")}</details>`;
}
export function historyCasePage(archive: AcceptedHistoryArchive, item: HistoryCase): string {
  return archivePage("과거 연구 기록 상세", `<nav aria-label="기록 탐색"><a href="${root}">과거 기록 목록으로 돌아가기</a><a href="/cases">사례 목록</a></nav>
    <p>기록 ${item.index} · 평가 기준일 ${esc(item.input.assessmentDate)} · 수집 분류 ${esc(item.category)} (물질 성분 미검증)</p>
    <p>다음으로 당시 질문과 실행 전 확인사항을 읽고 누락된 근거를 확인하세요.</p>
    <div class="cluster"><a class="primary-action" href="#history-checks">당시 확인사항 읽기</a></div>
    ${inputSection(item)}
    ${Object.entries(archive.evidence.decisionTemplates).filter(([hash]) => hash === item.decisionTemplateSha256)
      .map(([, template]) => templateSections(template)).join("")}
    ${usage(historyCaseUsage(item))}${executionDisclosure(item)}${sourceDisclosure(archive)}`);
}
