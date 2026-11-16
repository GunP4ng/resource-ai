import { Type } from "typebox";
import { fixtureSchema, digest, strict, PublicCalculationRouteSchema, PublicCalculationResultSchema } from "./o-public-calculation-schema.ts";
import type { DeepReadonly } from "./o-public-calculation-schema.ts";
import { PublicProcessorResearchSchema } from "./o-public-processors.ts";

const text = Type.String({ minLength: 1, pattern: "\\S" });
export const ResearchSourceCaseIdSchema = Type.Union([
  Type.Literal("OYS-20261110-001"), Type.Literal("OYS-20261110-002"), Type.Literal("OYS-20261110-003"),
]);
export type ResearchSourceCaseId = Type.Static<typeof ResearchSourceCaseIdSchema>;
const filePin = Type.Object({ path: text, sha256: digest }, strict);
export const CaseResearchAttachmentSchema = Type.Object({
  version: Type.Literal(1), purpose: Type.Literal("research-display"),
  label: Type.Literal("공개 자료 기반 계산값(관측값 아님)"),
  status: Type.Literal("시나리오 추정, 현장 미검증"),
  binding: Type.Object({ actorId: text, caseId: text, inputRevision: digest,
    assessmentDate: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
  }, strict),
  calculations: Type.Object({
    sourceCaseId: ResearchSourceCaseIdSchema, fixtureSha256: digest, manifestSha256: digest,
    originalSha256: digest, provenanceSha256: digest, provenanceManifestSha256: digest,
    implementation: Type.Object({ files: Type.Array(filePin), sha256: digest }, strict),
    verification: Type.Literal("pinned-transcriptions"),
    model_version: fixtureSchema.properties.model_version,
    sources: fixtureSchema.properties.sources, inputs: fixtureSchema.properties.inputs,
    cases: Type.Tuple([fixtureSchema.properties.cases.items]),
    routes: Type.Array(PublicCalculationRouteSchema), results: Type.Array(PublicCalculationResultSchema),
    limitations: fixtureSchema.properties.limitations,
  }, strict),
  processors: PublicProcessorResearchSchema,
  use: Type.Object({ display: Type.Literal("authenticated-research"), storage: Type.Literal("private-runtime"),
    redistribution: Type.Literal("not-authorized-by-package"), commercialExport: Type.Literal("excluded"),
    modelTransmission: Type.Literal("excluded"),
  }, strict),
}, strict);
/** Display-only sidecar. Never an operational resource, model input or recommendation. */
export type CaseResearchAttachment = DeepReadonly<Type.Static<typeof CaseResearchAttachmentSchema>>;
export type PublicCalculationSlice = CaseResearchAttachment["calculations"];
export interface CaseResearchReport {
  readonly artifactSha256: string;
  readonly attachment: CaseResearchAttachment;
}
