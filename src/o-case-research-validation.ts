import { Value } from "typebox/value";
import { CaseResearchAttachmentSchema } from "./o-case-research-schema.ts";
import type { CaseResearchAttachment } from "./o-case-research-schema.ts";
import { buildCaseResearchAttachment } from "./o-case-research.ts";
import { prepareResearchCaseRecord } from "./o-case-research.ts";
import { ResearchCaseArtifactSchema } from "./o-case-artifact.ts";
import type { ResearchCaseArtifact } from "./o-case-artifact.ts";
import type { ResearchTarget, VerifiedResearchCatalog } from "./o-case-research.ts";
import { canonical, date, revision } from "./o-validation.ts";
import { requireData } from "./o-public-calculation-validation.ts";

/** Recompute from server-fixed data and actual authenticated binding; a self hash grants nothing. */
export function validateCaseResearchAttachment(value: unknown, target: ResearchTarget,
  catalog: VerifiedResearchCatalog): CaseResearchAttachment {
  requireData(Value.Check(CaseResearchAttachmentSchema, value), "E_RESEARCH_SCHEMA");
  date(value.binding.assessmentDate);
  const expected = buildCaseResearchAttachment(target, value.calculations.sourceCaseId, catalog);
  requireData(canonical(value) === canonical(expected), "E_RESEARCH_MISMATCH");
  return expected;
}

/** Full v2 boundary, including outer resealing and cached envelopes. Missing actual actor binding fails. */
export async function validateResearchCaseArtifact(value: unknown, target: ResearchTarget,
  catalog: VerifiedResearchCatalog, signal: AbortSignal): Promise<ResearchCaseArtifact> {
  requireData(Value.Check(ResearchCaseArtifactSchema, value), "E_RESEARCH_ARTIFACT_SCHEMA");
  const supplied = value.record;
  const attachment = validateCaseResearchAttachment(supplied.research, target, catalog);
  requireData(value.sha256 === revision(supplied), "E_RESEARCH_ARTIFACT_HASH");
  requireData(Number.isFinite(Date.parse(supplied.recordedAt))
    && new Date(supplied.recordedAt).toISOString() === supplied.recordedAt, "E_RECORDED_AT");
  const regenerated = await prepareResearchCaseRecord({ ...target, codeRevision: supplied.codeRevision, signal },
    attachment.calculations.sourceCaseId, catalog);
  const record = { ...regenerated.record, recordedAt: supplied.recordedAt };
  requireData(canonical(supplied) === canonical(record), "E_RESEARCH_ARTIFACT_MISMATCH");
  return { record, sha256: revision(record) };
}
