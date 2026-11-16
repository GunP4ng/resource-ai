import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Value } from "typebox/value";
import type { CaseInput } from "./contracts.ts";
import { prepareCaseRecord, createBundledSnapshotReader } from "./case-record.ts";
import { readPublicCalculationDataset } from "./o-public-calculation-data.ts";
import type { VerifiedPublicDataset } from "./o-public-calculation-data.ts";
import { buildPublicCalculations } from "./o-public-calculation-engine.ts";
import { buildPublicProcessorResearch, readPublicProcessorDirectory } from "./o-public-processors.ts";
import type { VerifiedProcessorDirectory } from "./o-public-processors.ts";
import { requireData, required } from "./o-public-calculation-validation.ts";
import { canonical, date, revision } from "./o-validation.ts";
import { CaseInputSchema } from "./o-public-calculation-schema.ts";
import { ResearchSourceCaseIdSchema } from "./o-case-research-schema.ts";
import type { CaseResearchAttachment, ResearchSourceCaseId } from "./o-case-research-schema.ts";
import type { ResearchCaseArtifact } from "./o-case-artifact.ts";

const catalogSeal: unique symbol = Symbol("verified-fixed-research-catalog");
export interface VerifiedResearchCatalog {
  readonly [catalogSeal]: true;
  readonly root: string;
  readonly calculations: VerifiedPublicDataset;
  readonly processors: VerifiedProcessorDirectory;
}
/** actorId must come from the authenticated server/lease, never an artifact declaration. */
export interface ResearchTarget {
  readonly actorId: string;
  readonly input: CaseInput;
  readonly inputRevision: string;
}
export interface ResearchPreparationTarget extends ResearchTarget {
  readonly codeRevision: string;
  readonly signal: AbortSignal;
}

/** Operator-controlled asset root. The fixture is fixed, unlike CLI premise experiments. */
export async function readCaseResearchCatalog(options: { readonly root?: string } = {}): Promise<VerifiedResearchCatalog> {
  const root = resolve(options.root ?? fileURLToPath(new URL("../", import.meta.url)));
  const calculations = await readPublicCalculationDataset({ root });
  requireData(calculations.fixture_sha256 === "4ebc0a90b8150a033bd3daeb07191bbc2ad2f0bdf5be6310065f53c620ecd69c"
    && calculations.manifest_sha256 === "10b1fa467b509261f0f73af78bcd04e1060efe9a44bfca1cd6487475718ed683", "E_FIXED_DATASET");
  return { [catalogSeal]: true, root, calculations, processors: await readPublicProcessorDirectory(root) };
}

export function buildCaseResearchAttachment(target: ResearchTarget, sourceCaseId: ResearchSourceCaseId,
  catalog: VerifiedResearchCatalog): CaseResearchAttachment {
  requireData(catalog[catalogSeal] === true && Value.Check(ResearchSourceCaseIdSchema, sourceCaseId), "E_SOURCE_CASE");
  requireData(typeof target.actorId === "string" && target.actorId.trim().length > 0, "E_ACTOR_BINDING");
  requireData(Value.Check(CaseInputSchema, target.input) && target.input.caseId.trim().length > 0
    && target.inputRevision === revision(target.input), "E_RESEARCH_BINDING");
  date(target.input.assessmentDate);
  const verified = catalog.calculations;
  const selected = required(verified.data.cases.find(c => c.case_id === sourceCaseId));
  requireData(canonical(target.input) === canonical({ ...selected.original, caseId: target.input.caseId }), "E_SOURCE_INPUT");
  const bundle = buildPublicCalculations(verified);
  const results = bundle.results.filter(r => r.case_id === sourceCaseId);
  const ids = new Set(results.flatMap(r => r.input_ids));
  const inputs = bundle.inputs.filter(i => ids.has(i.input_id));
  const sourceIds = new Set(inputs.flatMap(i => i.source_id === null ? [] : [i.source_id]));
  const attachment: CaseResearchAttachment = {
    version: 1, purpose: "research-display", label: "공개 자료 기반 계산값(관측값 아님)", status: "시나리오 추정, 현장 미검증",
    binding: { actorId: target.actorId, caseId: target.input.caseId, inputRevision: target.inputRevision,
      assessmentDate: target.input.assessmentDate },
    calculations: {
      sourceCaseId, fixtureSha256: verified.fixture_sha256, manifestSha256: verified.manifest_sha256,
      originalSha256: selected.original_sha256, provenanceSha256: revision(selected.provenance),
      provenanceManifestSha256: "95be89c0a5eeae1d7484371d5066e3532226c66d2e1aee54239900316ea3fbd4",
      implementation: verified.implementation, verification: "pinned-transcriptions",
      model_version: bundle.model_version, sources: bundle.sources.filter(s => sourceIds.has(s.source_id)),
      inputs, cases: [selected], routes: bundle.routes.filter(r => r.case_id === sourceCaseId), results,
      limitations: bundle.limitations,
    },
    processors: buildPublicProcessorResearch(catalog.processors, target.input.region),
    use: { display: "authenticated-research", storage: "private-runtime", redistribution: "not-authorized-by-package",
      commercialExport: "excluded", modelTransmission: "excluded" },
  };
  // Consumers may deserialize/edit their copy; never expose the catalog's pinned object graph.
  return structuredClone(attachment);
}

/** Pure research builder above; this outer builder additionally reads licensed J snapshots offline. */
export async function prepareResearchCaseRecord(target: ResearchPreparationTarget, sourceCaseId: ResearchSourceCaseId,
  catalog: VerifiedResearchCatalog): Promise<ResearchCaseArtifact> {
  const research = buildCaseResearchAttachment(target, sourceCaseId, catalog);
  const dataOrigin = { kind: "synthetic", reference: `public-calculation:${sourceCaseId}` } as const;
  const base = await prepareCaseRecord(target.input, { dataOrigin, codeRevision: target.codeRevision,
    signal: target.signal, sources: createBundledSnapshotReader(catalog.root) });
  const record = { ...base.record, version: 2 as const, dataOrigin, resources: {}, research };
  return { record, sha256: revision(record) };
}
