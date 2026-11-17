import { Type } from "typebox";
import { strict, digest } from "./o-public-calculation-schema.ts";
import type { DeepReadonly } from "./o-public-calculation-schema.ts";

export const HISTORY_SOURCE_BYTES = 256 * 1024;
export const HISTORY_PACKAGE_BYTES = 1024 * 1024;
const text = Type.String({ minLength: 1, maxLength: 4096, pattern: "\\S" });
const id = Type.String({ minLength: 1, maxLength: 256, pattern: "^[A-Za-z0-9_-]+$" });
const integer = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const positive = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const texts = Type.Array(text, { minItems: 1, maxItems: 64 });
const date = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
const stamp = Type.String({ maxLength: 20 });
export const HistoryTemplateSchema = Type.Object({ state: Type.Literal("needs-review"),
  evidence: Type.Array(Type.Never(), { maxItems: 0 }), reasons: texts, preExecutionChecks: texts,
}, strict);
export const HistorySdkUsageSchema = Type.Object({ provider: Type.Literal("chatgpt-subscription"),
  modelId: Type.Literal("gpt-6-sol"), input: integer, output: integer, cacheRead: integer,
  cacheWrite: Type.Literal(0), total: integer, imageCount: Type.Literal(1), imageSha256: Type.Tuple([digest]),
}, strict);
const request = Type.Object({ requestId: id, httpStatus: Type.Literal(200), responseCompleted: Type.Literal(true),
  imageCount: Type.Literal(1), imageSha256: digest, usage: Type.Object({ input_tokens: integer,
    output_tokens: integer, cached_input_tokens: integer, total_tokens: integer }, strict),
}, strict);
export const HistoryCaseSchema = Type.Object({ index: Type.Integer({ minimum: 1, maximum: 14 }),
  sourcePhotoId: id, category: Type.Union([Type.Literal("폐플라스틱"), Type.Literal("금속스크랩"),
    Type.Literal("폐목재"), Type.Literal("폐포장재"), Type.Literal("공정오니"), Type.Literal("폐고무"), Type.Literal("건설폐기물")]),
  workbookRow: positive, actorId: id, caseId: id, inputRevision: digest, sourceSha256: digest,
  preparedUploadSha256: digest, photoRef: id, modelImageSha256: digest,
  input: Type.Object({ caseId: id, description: text, photoRefs: Type.Tuple([id]), process: Type.Null(),
    polymer: Type.Null(), contamination: Type.Null(), hazardousContact: Type.Literal("unknown"),
    massKg: Type.Null(), region: Type.Null(), assessmentDate: date }, strict),
  httpStatus: Type.Literal(303), decisionTemplateSha256: digest, elapsedMs: integer,
  execution: Type.Object({ traceId: text, usage: Type.String({ minLength: 1, maxLength: 4096 }) }, strict),
  requests: Type.Tuple([request, request]),
}, strict);
export const HistoryEvidenceSchema = Type.Object({ schema: Type.Literal("h56-real-photo-evidence-v1"),
  ownerInstruction: Type.String({ pattern: "^[0-9]{1,32}$" }), sourceWorkbookSha256: digest,
  baseGitSha: Type.String({ pattern: "^[a-f0-9]{40}$" }), trackedPatchSha256: digest,
  untrackedPatchSha256: digest, codeFingerprint: digest, provider: Type.Literal("chatgpt-subscription"),
  route: Type.Literal("siwc"), model: Type.Literal("gpt-6-sol"),
  scope: Type.Object({ photos: Type.Literal(14), maxModelHttp: Type.Literal(42), actualModelHttp: Type.Literal(28),
    automaticRetries: Type.Literal(0), excluded36Used: Type.Literal(0), sourceFilesModified: Type.Literal(0),
    humanGroundTruth: Type.Literal(false), accuracyMeasured: Type.Literal(false), rawPhotosIncluded: Type.Literal(false),
    secretsIncluded: Type.Literal(false) }, strict),
  aggregate: Type.Object({ app303: Type.Literal(14), modelHttp200: Type.Literal(28), responseCompleted: Type.Literal(28),
    needsReview: Type.Literal(14), compared: Type.Literal(0), usage: Type.Object({ input: integer,
      output: integer, cachedInput: integer, total: integer }, strict) }, strict),
  cases: Type.Array(HistoryCaseSchema, { minItems: 14, maxItems: 14 }),
  decisionTemplates: Type.Record(Type.String({ pattern: "^[a-f0-9]{64}$" }), HistoryTemplateSchema,
    { additionalProperties: false, minProperties: 1, maxProperties: 14 }),
  limitations: texts,
  photoObservationAudit: Type.Object({ basis: Type.Literal("source-path inference, not retained raw model text"),
    sourceFingerprint: digest, photoSessionsDisableDecisionReferences: Type.Literal(true),
    emptyCandidateQuestionRequiresValidatedBoundObservations: Type.Literal(true), reportedPolymer: Type.Null(),
    candidatePresentation: Type.Literal("none"), rawObservationDtoRetained: Type.Literal(false),
    confirmedObservationLoss: Type.Literal(false), source: texts }, strict),
}, strict);
export const HistoryCommentSchema = Type.Object({ id: positive, htmlUrl: text, issueUrl: text,
  createdAt: stamp, updatedAt: stamp, body: Type.String({ minLength: 1, maxLength: HISTORY_SOURCE_BYTES }) }, strict);
export const HistorySourceSchema = Type.Object({ comment: HistoryCommentSchema,
  suppliedCommentBytesSha256: digest, suppliedEvidenceBytesSha256: digest,
  evidenceJson: Type.String({ minLength: 1, maxLength: HISTORY_SOURCE_BYTES }) }, strict);
export const HistoryUseSchema = Type.Object({ display: Type.Literal("authenticated-research"),
  identity: Type.Literal("historical-only"), redistribution: Type.Literal("not-authorized-by-package"),
  commercialExport: Type.Literal("excluded"), modelTransmission: Type.Literal("excluded"),
  executionAuthority: Type.Literal("none") }, strict);
export const HistoryPackageSchema = Type.Object({ record: Type.Object({ version: Type.Literal(1),
  purpose: Type.Literal("historical-execution-research"), source: HistorySourceSchema, use: HistoryUseSchema }, strict),
  sha256: digest }, strict);
export const HistoryReceivedCommentSchema = Type.Object({ id: positive, url: text, html_url: text, issue_url: text,
  created_at: stamp, updated_at: stamp, body: Type.String({ minLength: 1, maxLength: HISTORY_SOURCE_BYTES }) });
export type HistoryPackage = DeepReadonly<Type.Static<typeof HistoryPackageSchema>>;
export type HistorySource = DeepReadonly<Type.Static<typeof HistorySourceSchema>>;
export type HistoryComment = DeepReadonly<Type.Static<typeof HistoryCommentSchema>>;
export type HistoryEvidence = DeepReadonly<Type.Static<typeof HistoryEvidenceSchema>>;
export type HistoryCase = DeepReadonly<Type.Static<typeof HistoryCaseSchema>>;
export type HistoryTemplate = DeepReadonly<Type.Static<typeof HistoryTemplateSchema>>;
export type HistorySdkUsage = DeepReadonly<Type.Static<typeof HistorySdkUsageSchema>>;
