import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import manifest from "../data/sources/manifest.json" with { type: "json" };

class PackagingError extends Error {}

function requireWithin(parent: string, path: string): void {
  const remainder = relative(parent, path);
  if (remainder === "" || remainder === ".." || remainder.startsWith(`..${sep}`) || isAbsolute(remainder)) {
    throw new PackagingError(`Asset path is outside ${parent}: ${path}`);
  }
}

const root = fileURLToPath(new URL("../", import.meta.url));
const data = await realpath(join(root, "data"));
if (data !== join(root, "data")) {
  throw new PackagingError(`Data directory must not be a symlink: ${data}`);
}
const dist = join(root, "dist");
await mkdir(dist, { recursive: true });
if (await realpath(dist) !== dist) {
  throw new PackagingError(`Output directory must not be a symlink: ${dist}`);
}
const staging = await mkdtemp(join(dist, ".app-assets-"));
try {
  await mkdir(join(staging, "data"));
  for (const source of manifest.sources) {
    if (source.access !== "bundled" || source.localPath === null) continue;
    const sourcePath = resolve(root, source.localPath);
    requireWithin(join(root, "data"), sourcePath);
    requireWithin(data, await realpath(sourcePath));
    const bytes = await readFile(sourcePath);
    if (createHash("sha256").update(bytes).digest("hex") !== source.sha256) {
      throw new PackagingError(`SHA-256 mismatch: ${source.localPath}`);
    }
    const target = resolve(staging, source.localPath);
    requireWithin(join(staging, "data"), target);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  await rm(join(dist, "data"), { recursive: true, force: true });
  await rename(join(staging, "data"), join(dist, "data"));
} finally {
  await rm(staging, { recursive: true, force: true });
}
