import { createHash } from "node:crypto";
import type { Type } from "typebox";
import { HistoryEvidenceSchema } from "../src/o-history-schema.ts";
import { revision } from "../src/o-validation.ts";

/** Entirely synthetic. No received H identifiers, images, transcripts or records. */
export function syntheticHistory() {
  const template = { preExecutionChecks: ["Synthetic field review remains required."],
    reasons: ["Synthetic missing facts and unverified law; no candidate or accuracy claim."],
    state: "needs-review", evidence: [] } as const;
  const templateHash = createHash("sha256").update(JSON.stringify(template)).digest("hex");
  const hash = createHash("sha256").update("synthetic image content shared intentionally").digest("hex");
  const categories = ["폐플라스틱", "금속스크랩", "폐목재", "폐포장재", "공정오니", "폐고무", "건설폐기물"] as const;
  const evidence: Type.Static<typeof HistoryEvidenceSchema> = {
    schema: "h56-real-photo-evidence-v1", ownerInstruction: "123456", sourceWorkbookSha256: hash,
    baseGitSha: "a".repeat(40), trackedPatchSha256: hash, untrackedPatchSha256: hash, codeFingerprint: hash,
    provider: "chatgpt-subscription", route: "siwc", model: "gpt-6-sol",
    scope: { photos: 14, maxModelHttp: 42, actualModelHttp: 28, automaticRetries: 0, excluded36Used: 0,
      sourceFilesModified: 0, humanGroundTruth: false, accuracyMeasured: false, rawPhotosIncluded: false, secretsIncluded: false },
    aggregate: { app303: 14, modelHttp200: 28, responseCompleted: 28, needsReview: 14, compared: 0,
      usage: { input: 112, output: 42, cachedInput: 42, total: 154 } },
    cases: categories.flatMap((category, group) => Array.from({ length: 2 }, (_, offset) => {
      const index = group * 2 + offset + 1, caseId = "synthetic-case-" + index, photoRef = "synthetic-photo-" + index;
      const input = { caseId, description: "Synthetic sample; unknown source facts.", photoRefs: [photoRef],
        process: null, polymer: null, contamination: null, hazardousContact: "unknown" as const,
        massKg: null, region: null, assessmentDate: "2020-02-29" };
      return { index, category, sourcePhotoId: "synthetic-source-" + index, workbookRow: index,
        actorId: "synthetic-shared-historical-actor", caseId, inputRevision: revision(input), sourceSha256: hash,
        preparedUploadSha256: hash, photoRef, modelImageSha256: hash,
        input: { ...input, photoRefs: [photoRef] }, httpStatus: 303 as const, decisionTemplateSha256: templateHash, elapsedMs: 10,
        execution: { traceId: "chatgpt-subscription:synthetic-final-" + index,
          usage: JSON.stringify({ provider: "chatgpt-subscription", modelId: "gpt-6-sol", input: 5, output: 3,
            cacheRead: 3, cacheWrite: 0, total: 11, imageCount: 1, imageSha256: [hash] }) },
        requests: [{ requestId: "synthetic-first-" + index, httpStatus: 200 as const, responseCompleted: true as const,
          imageCount: 1 as const, imageSha256: hash, usage: { input_tokens: 3, output_tokens: 1, cached_input_tokens: 1, total_tokens: 4 } },
        { requestId: "synthetic-final-" + index, httpStatus: 200 as const, responseCompleted: true as const,
          imageCount: 1 as const, imageSha256: hash, usage: { input_tokens: 5, output_tokens: 2, cached_input_tokens: 2, total_tokens: 7 } }],
      };
    })),
    decisionTemplates: { [templateHash]: { ...template, preExecutionChecks: [...template.preExecutionChecks],
      reasons: [...template.reasons], evidence: [] } },
    limitations: ["Synthetic historical execution only; no independent labels, rights review or browser QA.",
      "Raw final text and observation DTO absent. Runtime removal is a historical declaration."],
    photoObservationAudit: { basis: "source-path inference, not retained raw model text", sourceFingerprint: hash,
      photoSessionsDisableDecisionReferences: true, emptyCandidateQuestionRequiresValidatedBoundObservations: true,
      reportedPolymer: null, candidatePresentation: "none", rawObservationDtoRetained: false,
      confirmedObservationLoss: false, source: ["synthetic-source.ts:1"] },
  };
  return evidence;
}
export function syntheticDocuments(evidence: unknown = syntheticHistory(), evidenceJson = JSON.stringify(evidence, null, 2)) {
  const comment = { id: 123456, url: "https://api.github.com/repos/synthetic-owner/synthetic-repo/issues/comments/123456",
    html_url: "https://github.com/synthetic-owner/synthetic-repo/issues/56#issuecomment-123456",
    issue_url: "https://api.github.com/repos/synthetic-owner/synthetic-repo/issues/56",
    created_at: "2020-03-01T00:00:00Z", updated_at: "2020-03-01T01:00:00Z",
    body: "Untrusted synthetic source.\n```json\n" + JSON.stringify(evidence, null, 2) + "\n```\n",
    user: { login: "discard-this-synthetic-profile" }, rawProfile: "must-not-project" };
  return { comment, commentBytes: Buffer.from(JSON.stringify(comment)), evidenceBytes: Buffer.from(evidenceJson), evidenceJson };
}
