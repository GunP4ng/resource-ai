import { historyCommandMain } from "./o-case-history.ts";
import { Value } from "typebox/value";
import { createCaseStore } from "../src/o-case-store.ts";
import { openRuntimeDatabase } from "../src/o-runtime-db.ts";
import { prepareResearchCaseRecord, readCaseResearchCatalog } from "../src/o-case-research.ts";
import { ResearchSourceCaseIdSchema } from "../src/o-case-research-schema.ts";
import { validateResourceArtifact } from "../src/o-resources.ts";
import { ArtifactOperatorError, absoluteArtifactPath, artifactArguments, artifactCodeRevision, readPrivateArtifact, resolveArtifactTarget } from "../src/o-artifact-target.ts";
import type { ResearchCaseArtifact } from "../src/o-case-artifact.ts";
import type { CaseSnapshot } from "../src/o-case-store.ts";

function handoff(artifact: ResearchCaseArtifact, snapshot: CaseSnapshot) {
  const { binding, calculations, processors, use } = artifact.record.research;
  const at = Date.now();
  return {
    version: 1, purpose: "private-research-handoff", artifactSha256: artifact.sha256, binding, use,
    j: {
      sourceCaseId: calculations.sourceCaseId, actualInput: artifact.record.input,
      historicalAssessmentDate: binding.assessmentDate,
      lawVersion: calculations.cases[0].law_version,
      legal: artifact.record.assessment.legal,
      original: calculations.cases[0], originalSha256: calculations.originalSha256,
      provenanceSha256: calculations.provenanceSha256, provenanceManifestSha256: calculations.provenanceManifestSha256,
      fixtureSha256: calculations.fixtureSha256, manifestSha256: calculations.manifestSha256,
      implementation: calculations.implementation, modelVersion: calculations.model_version,
      sources: calculations.sources, inputs: calculations.inputs,
      processorDirectory: processors, sourceIssues: artifact.record.sourceIssues,
      process: artifact.record.input.process, contamination: artifact.record.input.contamination,
      hazardousContact: artifact.record.input.hazardousContact,
      photoRefs: artifact.record.input.photoRefs,
    },
    h: {
      actorId: binding.actorId, caseId: binding.caseId, inputRevision: binding.inputRevision,
      currentVersion: snapshot.version, evaluated: snapshot.evaluated, photoRefs: snapshot.input.photoRefs,
      storedReceipts: snapshot.photos.map(receipt => ({
        receipt, curatedSha256: null, uploadOriginalSha256: receipt.originalSha256, storedSha256: receipt.sha256,
        selected: snapshot.input.photoRefs.includes(receipt.photoRef),
        expired: receipt.expiresAt <= at || receipt.consent.expiresAt <= at,
        modelConsentDeclared: receipt.consent.model, modelPermission: "requires-live-execution-authority",
        withdrawn: snapshot.denied.includes(receipt.photoRef), pendingCleanup: snapshot.pendingCleanup.includes(receipt.photoRef),
        modelExecution: null,
      })),
      denied: snapshot.denied, pendingCleanup: snapshot.pendingCleanup,
      execution: snapshot.assessment.execution ?? null, photoExecution: null,
    },
  };
}
export async function casePackageMain(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  if (args[0] === "receive-history" || args[0] === "history-receipt") return historyCommandMain(args);
  let runtime: Awaited<ReturnType<typeof openRuntimeDatabase>> | undefined;
  let cases: ReturnType<typeof createCaseStore> | undefined;
  try {
    const command = args[0];
    if (command !== "prepare" && command !== "handoff") throw new ArtifactOperatorError("arguments");
    const keys = ["--state-dir", "--username", "--case-id", "--expected-revision", command === "prepare" ? "--source-case" : "--artifact"];
    const values = artifactArguments(args, keys);
    const state = absoluteArtifactPath(values.get("--state-dir"));
    const username = values.get("--username"), caseId = values.get("--case-id"), expectedRevision = values.get("--expected-revision");
    if (!username || !caseId || !expectedRevision) throw new ArtifactOperatorError("arguments");
    const sourceCase = values.get("--source-case");
    if (command === "prepare" && !Value.Check(ResearchSourceCaseIdSchema, sourceCase)) throw new ArtifactOperatorError("arguments");
    runtime = await openRuntimeDatabase(state, { existingOnly: true });
    runtime.database.exec("PRAGMA busy_timeout=1000");
    cases = createCaseStore(Date.now, undefined, runtime);
    const storage = runtime, store = cases;
    const current = () => resolveArtifactTarget(storage, store, { username, caseId, expectedRevision });
    const initial = storage.database.transaction(current).deferred();
    const signal = new AbortController().signal;
    let artifact: ResearchCaseArtifact;
    if (command === "prepare") {
      if (!Value.Check(ResearchSourceCaseIdSchema, sourceCase)) throw new ArtifactOperatorError("arguments");
      const catalog = await readCaseResearchCatalog();
      artifact = await prepareResearchCaseRecord({ actorId: initial.actorId, input: initial.input,
        inputRevision: expectedRevision, codeRevision: artifactCodeRevision(), signal }, sourceCase, catalog);
    } else {
      const bytes = readPrivateArtifact(absoluteArtifactPath(values.get("--artifact")));
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      const accepted = await validateResourceArtifact(value, initial.input, { actorId: initial.actorId }, signal);
      if (accepted.artifact.record.version !== 2) throw new ArtifactOperatorError("artifact");
      artifact = { record: accepted.artifact.record, sha256: accepted.artifact.sha256 };
    }
    // Prepare also verifies the complete package before its sole stdout write.
    if (command === "prepare") await validateResourceArtifact(artifact, initial.input, { actorId: initial.actorId }, signal);
    const output = storage.database.transaction(() => {
      const target = current();
      if (target.actorId !== initial.actorId) throw new ArtifactOperatorError("target");
      return JSON.stringify(command === "prepare" ? artifact : handoff(artifact, target.snapshot)) + "\n";
    }).deferred();
    process.stdout.write(output);
    return 0;
  } catch (error) {
    process.stderr.write(`Case package operation failed: ${error instanceof ArtifactOperatorError ? error.code : "unavailable"}.\n`);
    return 1;
  } finally { cases?.dispose(); runtime?.close(); }
}
if (import.meta.main) process.exitCode = await casePackageMain();
