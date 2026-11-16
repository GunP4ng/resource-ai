import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import manifest from "../data/sources/manifest.json" with { type: "json" };
import calculationManifest from "../data/o-public-calculations/2026-11-15/manifest.json" with { type: "json" };
import { readCaseResearchCatalog } from "../src/o-case-research.ts";
import { artifactCodeRevision } from "../src/o-artifact-target.ts";

class PackagingError extends Error {}
function requireWithin(parent: string, path: string): void {
  const remainder = relative(parent, path);
  if (remainder === "" || remainder === ".." || remainder.startsWith(`..${sep}`) || isAbsolute(remainder)) {
    throw new PackagingError(`Asset path is outside ${parent}: ${path}`);
  }
}
/** Fixed public assets only. The source implementation receipt supplies the complete 14-path list. */
export async function packageAppAssets(options: { readonly root?: string; readonly output?: string } = {}): Promise<void> {
  const root = resolve(options.root ?? fileURLToPath(new URL("../", import.meta.url)));
  const data = await realpath(join(root, "data"));
  if (data !== join(root, "data")) throw new PackagingError("Data directory must not be a symlink");
  const catalog = await readCaseResearchCatalog({ root });
  const paths = new Map<string, string | null>();
  for (const source of manifest.sources) {
    if (source.access === "bundled" && source.localPath !== null) paths.set(source.localPath, source.sha256);
  }
  paths.set("data/sources/manifest.json", catalog.processors.sourceManifestSha256);
  paths.set("data/o-public-calculations/2026-11-15/fixtures.json", catalog.calculations.fixture_sha256);
  paths.set("data/o-public-calculations/2026-11-15/manifest.json", catalog.calculations.manifest_sha256);
  for (const pin of calculationManifest.upstream) paths.set(pin.path, pin.sha256);
  for (const pin of catalog.calculations.implementation.files) paths.set(pin.path, pin.sha256);
  // The catalog verified the sanitized directory and its source manifest.
  paths.set("data/reference/ulsan-processors-2025-12.sanitized.csv", catalog.processors.datasetSha256);
  const dist = resolve(options.output ?? join(root, "dist"));
  await mkdir(dist, { recursive: true });
  if (await realpath(dist) !== dist) throw new PackagingError("Output directory must not be a symlink");
  const staging = await mkdtemp(join(dist, ".app-assets-"));
  try {
    for (const [path, sha256] of paths) {
      const sourcePath = resolve(root, path);
      const boundary = path.startsWith("data/") ? data : root;
      requireWithin(boundary, sourcePath);
      requireWithin(boundary, await realpath(sourcePath));
      const bytes = await readFile(sourcePath);
      if (sha256 !== null && createHash("sha256").update(bytes).digest("hex") !== sha256) throw new PackagingError(`SHA-256 mismatch: ${path}`);
      const target = resolve(staging, path);
      requireWithin(staging, target);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
    await writeFile(join(staging, "o-build-receipt.json"), JSON.stringify({ version: 1, codeRevision: artifactCodeRevision(root) }) + "\n");
    for (const name of ["data", "src", "scripts", "o-build-receipt.json"]) {
      await rm(join(dist, name), { recursive: true, force: true });
      await rename(join(staging, name), join(dist, name));
    }
  } finally { await rm(staging, { recursive: true, force: true }); }
}
if (import.meta.main) await packageAppAssets();
