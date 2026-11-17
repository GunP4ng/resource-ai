import { Value } from "typebox/value";
import { Type } from "typebox";
import { strict } from "./o-public-calculation-schema.ts";
import type { DeepReadonly } from "./o-public-calculation-schema.ts";
import { HistoryPackageSchema, HistoryReceivedCommentSchema, HistorySdkUsageSchema, HISTORY_PACKAGE_BYTES, HISTORY_SOURCE_BYTES } from "./o-history-schema.ts";
import type { HistoryPackage, HistoryEvidence } from "./o-history-schema.ts";
import { historyDigest, historyText, parseHistoryJson, validateHistoryComment, validateHistoryEvidence } from "./o-history-validation.ts";
import { requireValid, revision } from "./o-validation.ts";
import { historyCaseUsage, historyUsage } from "./o-history-usage.ts";

const acceptedBrand: unique symbol = Symbol("accepted-history");
export type AcceptedHistoryArchive = {
  readonly [acceptedBrand]: true;
  readonly package: HistoryPackage;
  readonly evidence: HistoryEvidence;
};
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
/** Detached and frozen. The seal proves integrity, not authorship, rights or provider authenticity. */
export function acceptHistoryPackage(value: unknown): AcceptedHistoryArchive {
  requireValid(Value.Check(HistoryPackageSchema, value), "history-package-schema");
  requireValid(Buffer.byteLength(JSON.stringify(value)) <= HISTORY_PACKAGE_BYTES, "history-package-size");
  const detached: unknown = structuredClone(value);
  requireValid(Value.Check(HistoryPackageSchema, detached), "history-package-schema");
  requireValid(detached.sha256 === revision(detached.record), "history-seal");
  const source = detached.record.source;
  requireValid(Buffer.byteLength(source.comment.body) <= HISTORY_SOURCE_BYTES, "history-size");
  requireValid(historyDigest(source.evidenceJson) === source.suppliedEvidenceBytesSha256, "history-evidence-bytes");
  const evidence = validateHistoryEvidence(source.evidenceJson);
  validateHistoryComment(source.comment, evidence);
  return freeze({ [acceptedBrand]: true, package: detached, evidence });
}
export function receiveHistory(commentBytes: Uint8Array, evidenceBytes: Uint8Array): HistoryPackage {
  const comment = parseHistoryJson(historyText(commentBytes, HISTORY_SOURCE_BYTES));
  requireValid(Value.Check(HistoryReceivedCommentSchema, comment), "history-source-comment-schema");
  const evidenceJson = historyText(evidenceBytes, HISTORY_SOURCE_BYTES);
  const source = { comment: { id: comment.id, htmlUrl: comment.html_url, issueUrl: comment.issue_url,
    createdAt: comment.created_at, updatedAt: comment.updated_at, body: comment.body },
    suppliedCommentBytesSha256: historyDigest(commentBytes), suppliedEvidenceBytesSha256: historyDigest(evidenceBytes), evidenceJson };
  requireValid(comment.url === comment.issue_url.replace(/\/issues\/56$/, "/issues/comments/" + comment.id), "history-api-url");
  const record: HistoryPackage["record"] = { version: 1, purpose: "historical-execution-research", source,
    use: { display: "authenticated-research", identity: "historical-only", redistribution: "not-authorized-by-package",
      commercialExport: "excluded", modelTransmission: "excluded", executionAuthority: "none" } };
  return acceptHistoryPackage({ record, sha256: revision(record) }).package;
}
const paths = Type.Array(Type.String());
const FieldStatusSchema = Type.Object({ accepted: paths, declaredOnly: paths, missing: paths }, strict);
export const HistoryReceiptSchema = Type.Object({ version: Type.Literal(1), purpose: Type.Literal("historical-execution-receipt"),
  artifactSha256: Type.String(), seal: Type.Literal("integrity-only-not-provider-authentication"),
  sourceComment: Type.String(), commentByteHash: Type.Literal("import-time-only-not-recomputable-from-projection"),
  recomputed: paths, declaredOnly: paths, missing: paths, limitations: paths,
  receiverModelCalls: Type.Literal(0), executionAuthority: Type.Literal("none"),
  runtime: Type.Literal("stopped-removed-as-declared-by-H-no-restoration-authority"),
  usage: Type.Object({ api: Type.Object({ input: Type.Number(), output: Type.Number(), cachedInput: Type.Number(), total: Type.Number() }, strict),
    sdk: Type.Object({ input: Type.Number(), output: Type.Number(), cacheRead: Type.Number(), cacheWrite: Type.Number(), total: Type.Number() }, strict),
    cases: Type.Number(), requests: Type.Number(), distinctModelImageHashes: Type.Number(), repeatedModelImageHashes: Type.Number() }, strict),
  cases: Type.Array(Type.Object({ index: Type.Number(), caseId: Type.String(), fields: FieldStatusSchema, sdk: HistorySdkUsageSchema,
    api: Type.Object({ input: Type.Number(), output: Type.Number(), cachedInput: Type.Number(), total: Type.Number() }, strict),
  }, strict)),
}, strict);
export type HistoryReceipt = DeepReadonly<Type.Static<typeof HistoryReceiptSchema>>;
/** All field status is derived from the single accepted value; no second persisted assessment. */
export function historyReceipt(accepted: AcceptedHistoryArchive): HistoryReceipt {
  const { evidence, package: artifact } = accepted;
  const missing = ["uploadOriginalReceipt", "storedReceipt", "originalPhotoBytes", "workbookBytes", "patchBytes",
    "rawFinalModelText", "photoObservationDto", "visibleFeatures", "independentHumanLabels", "measuredAccuracy",
    "legalSnapshots", "legalCurrentness", "finalRightsReview", "originalBrowserQA"];
  return freeze({ version: 1, purpose: "historical-execution-receipt", artifactSha256: artifact.sha256,
    seal: "integrity-only-not-provider-authentication", sourceComment: artifact.record.source.comment.htmlUrl,
    commentByteHash: "import-time-only-not-recomputable-from-projection",
    recomputed: ["packageSeal", "evidenceBytes", "inputRevisions", "templateDigests:SHA256(JSON.stringify(parsedTemplate))",
      "sourceCorrespondence", "requestSdkUsage", "cohortScope"],
    declaredOnly: ["sourceWorkbookSha256", "baseGitSha", "trackedPatchSha256", "untrackedPatchSha256", "codeFingerprint",
      "physicalImageLineage", "providerExecution", "sourcePathObservationInference"], missing,
    limitations: evidence.limitations, receiverModelCalls: 0, executionAuthority: "none",
    runtime: "stopped-removed-as-declared-by-H-no-restoration-authority", usage: historyUsage(evidence),
    cases: evidence.cases.map((c, offset) => ({ index: c.index, caseId: c.caseId, ...historyCaseUsage(c),
      fields: { accepted: ["index", "category", "input", "inputRevision", "photoRef", "decisionTemplateSha256", "execution/usage", "requests"]
        .map(path => `/cases/${offset}/${path}`),
        declaredOnly: ["actorId", "sourcePhotoId", "workbookRow", "sourceSha256", "preparedUploadSha256", "modelImageSha256", "elapsedMs", "execution/traceId"]
          .map(path => `/cases/${offset}/${path}`), missing: missing.map(path => `/cases/${offset}/${path}`) } })),
  });
}
