import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { createBundledSnapshotReader, prepareCaseRecord } from "../src/case-record.ts";
import { parseCaseInput } from "../src/input.ts";
import { createCaseStore } from "../src/o-case-store.ts";
import { openRuntimeDatabase } from "../src/o-runtime-db.ts";
import { validateResourceArtifact } from "../src/o-resources.ts";
import { canonical, requireValid, revision } from "../src/o-validation.ts";
import { readPriceSnapshot, sourceManifest } from "../src/sources.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const packagePath = "data/o-public-development/2026-11-15";
const researchPath = "data/sources/public-2026-11-15";
const subsetPath = "data/reference/public-2026-11-15/keco-price-subset.json";
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const load = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));
const digest = Type.String({ pattern: "^[a-f0-9]{64}$" });
const filesSchema = Type.Array(Type.Object({ path: Type.String(), sha256: digest }));
const lineageSchema = Type.Object({ version: Type.Literal(1), caseId: Type.Literal("PUBLIC-DEV-001"),
  inputRevision: digest, files: filesSchema, fields: Type.Record(Type.String(), Type.String()) });
const snapshotSchema = Type.Object({ snapshots: Type.Array(Type.Object({ id: Type.String(),
  text: Type.String(), sha256: digest })) });
const snapshotRef = Type.Object({ id: Type.String(), sha256: digest });
const catalogSchema = Type.Object({ sources: Type.Array(Type.Object({
  sourceSnapshot: Type.Union([snapshotRef, Type.Null()]), rightsSnapshots: Type.Array(snapshotRef) })) });

async function publicSources() {
  const source = sourceManifest.find(entry => entry.sourceId === "keco-price-2026-10");
  requireValid(source !== undefined && source.localPath !== null, "price-source-missing");
  const bytes = await readFile(join(root, source.localPath));
  const result = readPriceSnapshot(bytes, source);
  requireValid(result.state === "available", "price-source-unavailable");
  requireValid(result.rows.length === 136 && result.rows.filter(row => row.priceKrwPerKg !== null).length === 60
    && result.rows.filter(row => row.priceKrwPerKg === null).length === 76
    && result.skipped.count === 9 && result.issues.length === 0, "price-population");
  const rows = result.rows.filter(row => row.rowNumber === 4 && ["수도권", "강원"].includes(row.region));
  const subset = { version: 1, source: result.evidence, observationDate: "2026-11-15",
    observationMeaning: "기존 바이트와 공개 미리보기 대조; 새 다운로드 아님", unit: "KRW/kg",
    attribution: "한국환경공단, 재활용가능자원 가격조사_20261026, 공공누리 제1유형; 2개 셀 정규화 추출",
    locators: { dataRow: 3, csvRowIncludingHeader: 4, previewRowIndex: 3, columnIndices: [2, 3] }, rows };
  const refs = [];
  for (const name of ["source-snapshots.json", "license-snapshots.json"]) {
    const snapshots = Value.Parse(snapshotSchema, await load(join(root, researchPath, name)));
    requireValid(snapshots.snapshots.every(snapshot => sha(snapshot.text) === snapshot.sha256), "snapshot-hash");
    refs.push(...snapshots.snapshots);
  }
  const catalog = Value.Parse(catalogSchema, await load(join(root, researchPath, "catalog.json")));
  for (const source of catalog.sources) {
    for (const ref of [...(source.sourceSnapshot ? [source.sourceSnapshot] : []), ...source.rightsSnapshots]) {
      requireValid(refs.some(snapshot => snapshot.id === ref.id && snapshot.sha256 === ref.sha256), "catalog-snapshot-binding");
    }
  }
  return { subset, population: { records: 136, numeric: 60, null: 76, skipped: 9, issues: 0 } };
}

async function developmentInput(directory: string) {
  const parsed = parseCaseInput(await load(join(directory, "input.json")));
  requireValid(parsed.ok, "input-invalid");
  const input = parsed.value;
  requireValid(input.caseId === "PUBLIC-DEV-001" && input.photoRefs.length === 0
    && [input.process, input.polymer, input.contamination, input.massKg, input.region].every(value => value === null)
    && input.hazardousContact === "unknown", "synthetic-unknowns");
  return input;
}

async function verify(directory: string) {
  const input = await developmentInput(directory);
  const lineageBytes = await readFile(join(directory, "lineage.json"));
  const lineage = Value.Parse(lineageSchema, JSON.parse(lineageBytes.toString("utf8")));
  requireValid(lineage.inputRevision === revision(input), "lineage-revision");
  const expectedPaths = [`${researchPath}/catalog.json`, `${researchPath}/source-snapshots.json`,
    `${researchPath}/license-snapshots.json`, subsetPath];
  requireValid(canonical(lineage.files.map(file => file.path).sort()) === canonical(expectedPaths.sort()), "lineage-files");
  for (const file of lineage.files) requireValid(sha(await readFile(join(root, file.path))) === file.sha256, "lineage-file-hash");
  const { subset, population } = await publicSources();
  requireValid(canonical(await load(join(root, subsetPath))) === canonical(subset), "subset-binding");
  const artifactBytes = await readFile(join(directory, "artifact.json"));
  const accepted = await validateResourceArtifact(JSON.parse(artifactBytes.toString("utf8")), input);
  const record = accepted.artifact.record;
  requireValid(record.dataOrigin.kind === "synthetic"
    && record.dataOrigin.reference === `${packagePath}/lineage.json#sha256=${sha(lineageBytes)}`, "lineage-binding");
  requireValid(canonical(accepted.resources) === "{}" && canonical(record.resources) === "{}"
    && record.images.length === 0 && record.sourceIssues.length === 0
    && record.sources.every(source => source.state === "verified")
    && record.assessment.routes.every(route => route.eligibility.state === "unknown")
    && record.decision.state === "needs-information", "development-holds");
  return { status: "verified", population, inputRevision: record.caseRevision,
    artifactCanonicalSha256: accepted.artifact.sha256, artifactFileSha256: sha(artifactBytes),
    resourcesSha256: record.resourcesSha256, lineageFileSha256: sha(lineageBytes), sourceSha256: subset.source.sha256 };
}

async function main() {
  const [command, supplied, ...extra] = process.argv.slice(2);
  requireValid(extra.length === 0, "arguments");
  const directory = supplied ? resolve(supplied) : join(root, packagePath);
  switch (command) {
    case "prepare": {
      requireValid(supplied === undefined, "prepare-fixed-destination");
      const { subset } = await publicSources();
      await mkdir(join(root, "data/reference/public-2026-11-15"), { recursive: true });
      await mkdir(directory, { recursive: true });
      await writeFile(join(root, subsetPath), json(subset));
      const input = await developmentInput(directory);
      const files = [];
      for (const path of [`${researchPath}/catalog.json`, `${researchPath}/source-snapshots.json`, `${researchPath}/license-snapshots.json`, subsetPath]) {
        files.push({ path, sha256: sha(await readFile(join(root, path))) });
      }
      const lineage = { version: 1, caseId: input.caseId, inputRevision: revision(input), files,
        fields: { caseId: "합성 개발 식별자", description: "공개 가격 분류를 참고한 합성 설명; 실제 사례 증거 아님",
          assessmentDate: "개발 기준일 가정", photoRefs: "빈 배열; 사진 없음", process: "미상 null", polymer: "미상 null",
          contamination: "미상 null", hazardousContact: "미상 unknown", massKg: "독립 계량 증거 없음 null", region: "사례 지역 미상 null" } };
      const lineageBytes = json(lineage);
      await writeFile(join(directory, "lineage.json"), lineageBytes);
      const artifact = await prepareCaseRecord(input, { dataOrigin: { kind: "synthetic",
        reference: `${packagePath}/lineage.json#sha256=${sha(lineageBytes)}` },
        codeRevision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, env: process.env, encoding: "utf8" }).trim(),
        signal: new AbortController().signal, sources: createBundledSnapshotReader(root) });
      await validateResourceArtifact(artifact, input);
      await writeFile(join(directory, "artifact.json"), json(artifact));
      return { status: "prepared", artifactCanonicalSha256: artifact.sha256 };
    }
    case "verify": return verify(directory);
    case "fixture": {
      const verified = await verify(directory);
      const input = await developmentInput(directory);
      const temporary = await mkdtemp(join(tmpdir(), "o-public-qa-"));
      const state = join(temporary, "state"), resources = join(temporary, "resources"), artifact = join(temporary, "artifact.json");
      await mkdir(resources, { mode: 0o700 });
      await writeFile(artifact, await readFile(join(directory, "artifact.json")), { mode: 0o600 });
      const db = await openRuntimeDatabase(state), cases = createCaseStore(Date.now, undefined, db);
      try {
        db.database.query("INSERT INTO accounts VALUES(?,?,?,1,0,?)").run("public-data-dev", "public-data-dev", "unused-synthetic-fixture", Date.now());
        const lease = cases.begin("actor:public-data-dev", input.caseId, null);
        await cases.run(lease, input, async () => undefined);
        cases.commit(lease, { decision: { state: "needs-information", caseId: input.caseId, questions: ["합성 개발 자료"], evidence: [] } }, () => {});
      } finally { cases.dispose(); db.close(); }
      return { ...verified, status: "fixture-prepared; CLI check pending", state, resources, artifact, username: "public-data-dev",
        actorId: "public-data-dev", caseId: input.caseId, fixtureStatus: "private; 30-minute edit window; no installation" };
    }
    default: requireValid(false, "usage: prepare | verify [package-directory] | fixture [package-directory]");
  }
}
if (import.meta.main) {
  try { process.stdout.write(json(await main())); }
  catch (error) { // no-excuse-ok: catch — CLI boundary follows existing sanitized diagnostic style.
    process.stderr.write(`Public data operation failed: ${error instanceof Error ? error.message : "unknown"}.\n`);
    process.exitCode = 1;
  }
}
