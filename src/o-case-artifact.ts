import type { prepareCaseRecord } from "./case-record.ts";
import type { CaseResearchAttachment } from "./o-case-research-schema.ts";
import { Type } from "typebox";
import { CaseResearchAttachmentSchema } from "./o-case-research-schema.ts";
import { CaseInputSchema, digest, strict } from "./o-public-calculation-schema.ts";

/** Keep v1 tied to its production builder instead of duplicating its contract. */
export type LegacyCaseArtifact = Awaited<ReturnType<typeof prepareCaseRecord>>;
export interface ResearchCaseArtifact {
  readonly record: Omit<LegacyCaseArtifact["record"], "version" | "resources" | "dataOrigin"> & {
    readonly version: 2;
    readonly dataOrigin: { readonly kind: "synthetic"; readonly reference: string };
    readonly resources: Readonly<Record<string, never>>;
    readonly research: CaseResearchAttachment;
  };
  readonly sha256: string;
}
export type CaseArtifact = LegacyCaseArtifact | ResearchCaseArtifact;

const text = Type.String({ minLength: 1, pattern: "\\S" });
/** Cached envelopes stay opaque until regeneration; the validator never casts them to domain types. */
export const ResearchCaseArtifactSchema = Type.Object({
  record: Type.Object({
    version: Type.Literal(2), execution: Type.Literal("offline-preparation"), release: Type.Literal("review-required"),
    dataOrigin: Type.Object({ kind: Type.Literal("synthetic"), reference: text }, strict),
    codeRevision: Type.String({ pattern: "^[a-f0-9]{40}$" }), recordedAt: text, caseRevision: digest,
    input: CaseInputSchema, images: Type.Array(Type.Never()),
    assessment: Type.Unknown(), decision: Type.Unknown(), sources: Type.Array(Type.Object({
      sourceId: text, expectedSha256: digest,
      role: Type.Union([Type.Literal("registered-source"), Type.Literal("review-facts")]),
      state: Type.Union([Type.Literal("verified"), Type.Literal("unavailable"), Type.Literal("hash-mismatch"), Type.Literal("too-large")]),
      actualSha256: Type.Union([digest, Type.Null()]), base64: Type.Union([Type.String(), Type.Null()]),
    }, strict), { maxItems: 32 }),
    resources: Type.Object({}, strict), resourcesSha256: digest, sourceIssues: Type.Array(text, { maxItems: 32 }),
    research: CaseResearchAttachmentSchema,
  }, strict), sha256: digest,
}, strict);
