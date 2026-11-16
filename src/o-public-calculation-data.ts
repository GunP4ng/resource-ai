import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureSchema, manifestSchema } from "./o-public-calculation-schema.ts";
import type { Dataset } from "./o-public-calculation-schema.ts";
import { parse, requireData, sha, validatePublicCalculationData } from "./o-public-calculation-validation.ts";
import { revision } from "./o-validation.ts";

export const publicCalculationDirectory = "data/o-public-calculations/2026-11-15";
/** Server/operator configuration only; never derive these paths from an attachment. */
export interface PublicDatasetOptions {
  readonly root?: string;
  readonly directory?: string;
  readonly evidence?: string;
}
export interface ImplementationReceipt {
  readonly files: readonly { readonly path: string; readonly sha256: string }[];
  readonly sha256: string;
}
export interface VerifiedPublicDataset {
  readonly data: Dataset;
  readonly fixture_sha256: string;
  readonly manifest_sha256: string;
  readonly calculator_sha256: string;
  readonly implementation: ImplementationReceipt;
}
const implementationPaths = [
  "scripts/o-public-calculations.ts",
  "src/o-public-calculation-schema.ts",
  "src/o-public-calculation-data.ts",
  "src/o-public-calculation-validation.ts",
  "src/o-public-calculation-engine.ts",
  "src/o-public-processors.ts",
  "src/o-case-research-schema.ts",
  "src/o-case-research-validation.ts",
  "src/o-case-research.ts",
  "src/o-case-artifact.ts",
  "src/o-validation.ts",
  "src/input.ts",
  "src/sources.ts",
  "src/case-record.ts",
] as const;

/** Off-cwd callers pass their packaged asset root explicitly. No network IO. */
export async function readPublicCalculationDataset(options: PublicDatasetOptions = {}): Promise<VerifiedPublicDataset> {
  const root = resolve(options.root ?? fileURLToPath(new URL("../", import.meta.url)));
  const directory = resolve(root, options.directory ?? publicCalculationDirectory);
  const manifestBytes = await readFile(join(directory, "manifest.json"));
  const bytes = await readFile(join(directory, "fixtures.json"));
  const manifest = parse(manifestSchema, JSON.parse(manifestBytes.toString("utf8")));
  requireData(sha(bytes) === manifest.fixture_sha256, "E_FIXTURE_HASH");
  const data = parse(fixtureSchema, JSON.parse(bytes.toString("utf8")));
  await validatePublicCalculationData(data, manifest, root, options.evidence);
  const files = await Promise.all(implementationPaths.map(async path => ({ path, sha256: sha(await readFile(join(root, path))) })));
  const implementation = { files, sha256: revision(files) };
  return { data, fixture_sha256: sha(bytes), manifest_sha256: sha(manifestBytes), calculator_sha256: implementation.sha256, implementation };
}
