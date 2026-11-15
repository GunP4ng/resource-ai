import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { createBundledSnapshotReader, prepareCaseRecord } from "../src/case-record.ts";
import { parseCaseInput } from "../src/input.ts";
import { validateResourceArtifact } from "../src/o-resources.ts";
import { canonical, requireValid, revision, ValidationError } from "../src/o-validation.ts";
import { sanitizePhoto } from "../src/photo-codec.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const packagePath = "data/o-public-images/2026-11-15";
const samplePaths = ["samples/river-fragments.png", "samples/gannet-plastic.png", "samples/strapping.png"] as const;
const boundPaths = ["manifest.json", "source-snapshots.json", "license-snapshots.json", ...samplePaths] as const;
const bundleEntries = ["manifest.json", "source-snapshots.json", "license-snapshots.json", "input.json",
  "lineage.json", "artifact.json", "README.md", "qa.json", "samples"] as const;
const strict = { additionalProperties: false } as const;
const digest = Type.String({ pattern: "^[a-f0-9]{64}$" });
const imageSchema = Type.Object({ id: Type.String(), path: Type.String(), sha256: digest,
  bytes: Type.Integer({ minimum: 1 }), width: Type.Integer({ minimum: 1 }), height: Type.Integer({ minimum: 1 }),
  mimeType: Type.Literal("image/png") });
const manifestSchema = Type.Object({ version: Type.Literal(1), selection: Type.Object({
  images: Type.Array(imageSchema, { minItems: 3, maxItems: 3 }) }),
  runtimeIdentity: Type.Object({ uploadedCuratedSha256: Type.Null(), sanitizedStorageSha256: Type.Null(),
    modelExecutionApproval: Type.Literal(false), operatorApproval: Type.Literal(false) }, strict),
  evidenceStatus: Type.Object({ exposedDevelopmentPictures: Type.Literal(3), newIndependentFieldCases: Type.Literal(0),
    independentHumanLabels: Type.Literal(0), unseenHoldout: Type.Literal(0) }, strict) }, strict);
const snapshotsSchema = Type.Object({ snapshots: Type.Array(Type.Object({ id: Type.String(),
  kind: Type.Literal("selected-reordered-declaration"), encoding: Type.Literal("UTF-8/LF"),
  text: Type.String(), sha256: digest }, strict), { minItems: 1, maxItems: 1 }) }, strict);
// Anchors authenticate the observed, selected declarations, not entire publisher pages.
const anchors = {
  selection: "7b07519c40a475b6f08824cb009d42afde9334b7098e78ee78414ac52845f71a",
  "source-snapshots.json": "7474cbecacde274abc08066b9ce99411baa7d952d096bdb05de8a653fd0c8102",
  "license-snapshots.json": "8080b9d5d99ffc69ecfa3f79335daf79242d196b9402389e5ba4d0d466adda61",
} as const;
const lineageSchema = Type.Object({ version: Type.Literal(1), caseId: Type.Literal("PUBLIC-IMG-DEV-001"),
  inputRevision: digest, inputFileSha256: digest,
  files: Type.Array(Type.Object({ path: Type.String(), sha256: digest }, strict), { minItems: 6, maxItems: 6 }),
  fieldBasis: Type.Literal("non-field synthetic/unknown; photographs are distinct references, not one lot") }, strict);
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
async function bytes(directory: string, name: string) {
  const file = join(directory, name), info = await lstat(file);
  requireValid(info.isFile() && !info.isSymbolicLink() && info.size <= 16 * 1024 * 1024, "bundle-file");
  return readFile(file);
}
async function load(directory: string, name: string): Promise<unknown> {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await bytes(directory, name)));
}
async function foundation(directory: string) {
  requireValid((await lstat(directory)).isDirectory() && !(await lstat(directory)).isSymbolicLink(), "bundle-directory");
  const samples = await lstat(join(directory, "samples"));
  requireValid(samples.isDirectory() && !samples.isSymbolicLink(), "samples-directory");
  requireValid(canonical((await readdir(join(directory, "samples"))).sort())
    === canonical(samplePaths.map(path => path.slice(8)).sort()), "sample-set");
  const rawManifest = await load(directory, "manifest.json");
  requireValid(Value.Check(manifestSchema, rawManifest), "manifest-boundary");
  const manifest = rawManifest;
  requireValid(revision(manifest.selection) === anchors.selection, "observed-selection");
  requireValid(canonical(manifest.selection.images.map(image => image.path)) === canonical(samplePaths), "sample-paths");
  for (const name of ["source-snapshots.json", "license-snapshots.json"] as const) {
    const raw = await load(directory, name);
    requireValid(Value.Check(snapshotsSchema, raw), "snapshot-boundary");
    for (const snapshot of raw.snapshots) requireValid(!snapshot.text.includes("\r")
      && snapshot.text.endsWith("\n") && sha(snapshot.text) === snapshot.sha256
      && snapshot.sha256 === anchors[name], "snapshot-provenance");
  }
  const images = [];
  for (const image of manifest.selection.images) {
    const raw = await bytes(directory, image.path);
    requireValid(raw.length === image.bytes && sha(raw) === image.sha256, "image-bytes");
    const decoded = await sanitizePhoto(raw, image.mimeType, new AbortController().signal);
    requireValid(decoded.width === image.width && decoded.height === image.height, "image-dimensions");
    images.push({ path: image.path, curatedSha256: sha(raw), decodedWidth: decoded.width, decodedHeight: decoded.height,
      resanitizedSha256: sha(decoded.data) });
  }
  const rawInput = await load(directory, "input.json"), parsed = parseCaseInput(rawInput);
  requireValid(parsed.ok, "input-boundary");
  const input = parsed.value;
  requireValid(canonical(input) === canonical(rawInput) && input.caseId === "PUBLIC-IMG-DEV-001"
    && input.assessmentDate === "2026-11-15" && input.photoRefs.length === 0
    && [input.process, input.polymer, input.contamination, input.massKg, input.region].every(value => value === null)
    && input.hazardousContact === "unknown", "synthetic-unknowns");
  const files = [];
  for (const path of boundPaths) files.push({ path, sha256: sha(await bytes(directory, path)) });
  return { input, files, images, inputFileSha256: sha(await bytes(directory, "input.json")) };
}
async function verify(directory: string) {
  const { input, files, images, inputFileSha256 } = await foundation(directory);
  requireValid(canonical((await readdir(directory)).sort()) === canonical([...bundleEntries].sort()), "bundle-entries");
  requireValid(Value.Check(Type.Object({ version: Type.Literal(1) }), await load(directory, "qa.json")), "qa-boundary");
  await bytes(directory, "README.md");
  const lineageBytes = await bytes(directory, "lineage.json"), rawLineage: unknown = JSON.parse(lineageBytes.toString("utf8"));
  requireValid(Value.Check(lineageSchema, rawLineage), "lineage-boundary");
  requireValid(rawLineage.inputRevision === revision(input) && rawLineage.inputFileSha256 === inputFileSha256,
    "lineage-input");
  requireValid(canonical(rawLineage.files) === canonical(files), "lineage-files");
  const artifactBytes = await bytes(directory, "artifact.json");
  const accepted = await validateResourceArtifact(JSON.parse(artifactBytes.toString("utf8")), input);
  const record = accepted.artifact.record;
  requireValid(record.dataOrigin.kind === "synthetic"
    && record.dataOrigin.reference === `${packagePath}/lineage.json#sha256=${sha(lineageBytes)}`, "lineage-binding");
  requireValid(canonical(record.resources) === "{}" && canonical(accepted.resources) === "{}" && record.images.length === 0
    && record.sourceIssues.length === 0 && record.sources.every(source => source.state === "verified")
    && record.assessment.routes.every(route => route.eligibility.state === "unknown")
    && record.decision.state === "needs-information", "development-holds");
  return { status: "verified", codeRevision: record.codeRevision, images, files,
    inputRevision: record.caseRevision, inputFileSha256, lineageFileSha256: sha(lineageBytes),
    artifactCanonicalSha256: accepted.artifact.sha256, artifactFileSha256: sha(artifactBytes),
    resourcesSha256: record.resourcesSha256, decision: record.decision.state };
}
async function main() {
  const [command, supplied, ...extra] = process.argv.slice(2);
  requireValid(extra.length === 0, "arguments");
  const directory = supplied ? resolve(supplied) : join(root, packagePath);
  switch (command) {
    case "prepare": {
      const { input, files, inputFileSha256 } = await foundation(directory);
      const lineage = { version: 1, caseId: input.caseId, inputRevision: revision(input), inputFileSha256, files,
        fieldBasis: "non-field synthetic/unknown; photographs are distinct references, not one lot" };
      const lineageBytes = json(lineage);
      const artifact = await prepareCaseRecord(input, { resources: {}, dataOrigin: { kind: "synthetic",
        reference: `${packagePath}/lineage.json#sha256=${sha(lineageBytes)}` },
        codeRevision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8",
          env: { ...process.env, GIT_MASTER: "1" } }).trim(),
        signal: new AbortController().signal, sources: createBundledSnapshotReader(root) });
      await validateResourceArtifact(artifact, input);
      await writeFile(join(directory, "lineage.json"), lineageBytes);
      await writeFile(join(directory, "artifact.json"), json(artifact));
      return { status: "prepared", codeRevision: artifact.record.codeRevision,
        inputRevision: artifact.record.caseRevision, artifactCanonicalSha256: artifact.sha256 };
    }
    case "verify": return verify(directory);
    default: requireValid(false, "usage: prepare | verify [bundle-directory]");
  }
}
if (import.meta.main) {
  try { process.stdout.write(json(await main())); }
  catch (error) {
    if (!(error instanceof Error)) throw error;
    process.stderr.write(`Public image operation failed: ${error instanceof ValidationError ? error.reason : "invalid-or-missing-bundle-data"}.\n`);
    process.exitCode = 1;
  }
}
