import { createHash } from "node:crypto";
import { Value } from "typebox/value";
import { HistoryEvidenceSchema, HISTORY_SOURCE_BYTES } from "./o-history-schema.ts";
import type { HistoryComment, HistoryEvidence, HistoryTemplate } from "./o-history-schema.ts";
import { canonical, date, requireValid, revision, timestamp, unique, ValidationError } from "./o-validation.ts";
import { historyUsage } from "./o-history-usage.ts";

export function historyDigest(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export function parseHistoryJson(text: string): unknown {
  try { return JSON.parse(text); }
  catch (error) { if (error instanceof SyntaxError) throw new ValidationError("history-json"); throw error; }
}
export function historyText(bytes: Uint8Array, limit: number): string {
  requireValid(bytes.byteLength <= limit, "history-size");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch (error) { if (error instanceof TypeError) throw new ValidationError("history-encoding"); throw error; }
}
function validateTemplateDigests(templates: Readonly<Record<string, HistoryTemplate>>): void {
  for (const [hash, template] of Object.entries(templates)) {
    // H56 v1 hashes parsed insertion order, deliberately NOT canonical revision().
    requireValid(historyDigest(JSON.stringify(template)) === hash, "history-template-hash");
  }
}
/** Only this schema's retained fields convey claims. Source prose is untrusted attributed data. */
export function validateHistoryEvidence(text: string): HistoryEvidence {
  requireValid(Buffer.byteLength(text) <= HISTORY_SOURCE_BYTES, "history-size");
  const e = parseHistoryJson(text);
  requireValid(Value.Check(HistoryEvidenceSchema, e), "history-evidence-schema");
  for (const field of ["caseId", "photoRef", "sourcePhotoId", "workbookRow", "index"] as const)
    unique(e.cases.map(c => String(c[field])), "history-duplicate-" + field);
  unique(e.cases.map(c => c.execution.traceId), "history-duplicate-trace");
  unique(e.cases.flatMap(c => c.requests.map(r => r.requestId)), "history-duplicate-request");
  requireValid(new Set(e.cases.map(c => c.category)).size === 7
    && e.cases.every(c => e.cases.filter(other => other.category === c.category).length === 2), "history-cohort");
  requireValid(e.photoObservationAudit.sourceFingerprint === e.codeFingerprint, "history-fingerprint");
  const referenced = new Set(e.cases.map(c => c.decisionTemplateSha256));
  requireValid(referenced.size === Object.keys(e.decisionTemplates).length, "history-template-membership");
  for (const hash of Object.keys(e.decisionTemplates)) {
    requireValid(referenced.has(hash), "history-template-membership");
  }
  validateTemplateDigests(e.decisionTemplates);
  for (const c of e.cases) {
    date(c.input.assessmentDate);
    requireValid(c.caseId === c.input.caseId && c.input.photoRefs[0] === c.photoRef, "history-input-binding");
    requireValid(c.inputRevision === revision(c.input), "history-input-revision");
    requireValid(Object.hasOwn(e.decisionTemplates, c.decisionTemplateSha256), "history-template-membership");
  }
  const usage = historyUsage(e);
  requireValid(usage.cases === e.scope.photos && usage.requests === e.scope.actualModelHttp
    && usage.requests <= e.scope.maxModelHttp && e.aggregate.app303 === usage.cases
    && e.aggregate.modelHttp200 === usage.requests && e.aggregate.responseCompleted === usage.requests
    && e.aggregate.needsReview === usage.cases, "history-scope");
  return e;
}
export function validateHistoryComment(comment: HistoryComment, evidence: HistoryEvidence): void {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/56#issuecomment-([0-9]+)$/.exec(comment.htmlUrl);
  requireValid(match !== null && match[1] !== undefined && match[2] !== undefined
    && match[3] === String(comment.id), "history-comment-url");
  requireValid(comment.issueUrl === `https://api.github.com/repos/${match[1]}/${match[2]}/issues/56`, "history-issue-url");
  requireValid(timestamp(comment.createdAt) <= timestamp(comment.updatedAt), "history-comment-date");
  requireValid(evidence.cases.every(c => date(c.input.assessmentDate) <= timestamp(comment.createdAt)), "history-case-date");
  // A JSON fence is data, never an instruction stream. Extra JSON fences are ambiguous.
  const fences = [...comment.body.matchAll(/^```(?:json|h56-real-photo-evidence-v1)\s*\r?\n([\s\S]*?)^```[ \t]*\r?$/gm)];
  const fence = fences[0]?.[1];
  requireValid(fences.length === 1 && fence !== undefined, "history-evidence-fence");
  const embedded = parseHistoryJson(fence);
  requireValid(canonical(embedded) === canonical(evidence), "history-comment-evidence");
  // Canonical comparison alone would hide the template serialization distinction.
  requireValid(Value.Check(HistoryEvidenceSchema, embedded), "history-embedded-schema");
  validateTemplateDigests(embedded.decisionTemplates);
}
