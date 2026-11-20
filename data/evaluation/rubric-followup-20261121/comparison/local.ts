import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { parse, sha, json } from "../../../../src/o-public-calculation-validation.ts";
import { sourceManifest } from "../../../../src/sources.ts";
import manifest from "../../../o-public-calculations/2026-11-15/manifest.json" with { type: "json" };
import design from "./design.json" with { type: "json" };

export { design };
export const directory = dirname(fileURLToPath(import.meta.url));
export const root = resolve(directory, "../../../..");
export const temporary = join(directory, ".work");
export const hashObject = (value: unknown) => sha(json(value));
export const save = (name: string, value: unknown) => writeFile(join(directory, name), json(value));
export const readJson = async (name: string): Promise<unknown> => JSON.parse(await readFile(join(directory, name), "utf8"));
export const pinSchema = Type.Object({ path: Type.String(), sha256: Type.String() });
export const snapshotSchema = Type.Object({ files: Type.Array(pinSchema), source_sha256: Type.String(), all_sha256: Type.String() });

export async function snapshot() {
  const paths = new Set([
    "package.json", "bun.lock", "tsconfig.json",
    "data/o-public-calculations/2026-11-15/fixtures.json",
    "data/o-public-calculations/2026-11-15/manifest.json",
    "data/sources/manifest.json", "data/sources/evidence-candidates.json",
    "tests/o-public-calculations.test.ts",
    "scripts/o-public-calculations.ts",
    ...manifest.upstream.map(pin => pin.path),
    ...sourceManifest.flatMap(source => source.localPath === null ? [] : [source.localPath]),
  ]);
  for (const entry of await readdir(join(root, "src"))) if (entry.endsWith(".ts")) paths.add(`src/${entry}`);
  // Only these named input/source paths are read; no evaluation folders are traversed.
  const files = await Promise.all([...paths].sort().map(async path => {
    assert.ok(!/masked|arm[-_]key|evaluation12/iu.test(path), path);
    return { path, sha256: sha(await readFile(join(root, path))) };
  }));
  return { files, source_sha256: hashObject(files.filter(pin => pin.path.startsWith("src/"))), all_sha256: hashObject(files) };
}

export async function verifySnapshot() {
  const before = parse(snapshotSchema, await readJson("originals-before.json"));
  const after = parse(snapshotSchema, await readJson("originals-after.json"));
  assert.deepEqual(before, after, "original source/input/registry bytes changed during execution");
  assert.deepEqual(before, await snapshot(), "current source/input/registry bytes differ from recorded execution");
  return before;
}
