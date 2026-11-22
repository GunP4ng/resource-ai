import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

interface Candidate {
  readonly candidateId: string;
  readonly inputFile: string;
  readonly inputSha256: string;
  readonly metadataSnapshot: { readonly path: string; readonly sha256: string };
}

interface Manifest {
  readonly candidates: readonly Candidate[];
}

interface Review {
  readonly manifests: { readonly J: { readonly path: string; readonly sha256: string } };
}

export interface VerificationTotals {
  readonly manifests: number;
  readonly inputs: number;
  readonly metadata: number;
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function referencedPath(root: string, path: string): string {
  const resolved = resolve(root, path);
  if (!resolved.startsWith(resolve(root) + sep)) throw new Error(`Reference leaves candidate directory: ${path}`);
  return resolved;
}

async function verifyHash(path: string, expected: string, label: string): Promise<void> {
  const actual = sha256(await readFile(path));
  if (actual !== expected) throw new Error(`${label} SHA-256 mismatch: expected ${expected}, got ${actual}`);
}

export async function verifyJCandidates(root = fileURLToPath(new URL("../data/candidates/j-2026-11-13/", import.meta.url))): Promise<VerificationTotals> {
  const manifestPath = referencedPath(root, "manifest.json");
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as Manifest;
  const review = JSON.parse(await readFile(referencedPath(root, "peer-source-review.json"), "utf8")) as Review;

  if (review.manifests.J.path !== "data/candidates/j-2026-11-13/manifest.json") {
    throw new Error(`Unexpected J manifest reference: ${review.manifests.J.path}`);
  }
  if (sha256(manifestBytes) !== review.manifests.J.sha256) throw new Error("manifest SHA-256 mismatch");
  if (!Array.isArray(manifest.candidates)) throw new Error("manifest candidates must be an array");

  let inputs = 0;
  let metadata = 0;
  for (const candidate of manifest.candidates) {
    await verifyHash(referencedPath(root, candidate.inputFile), candidate.inputSha256, `${candidate.candidateId} input`);
    inputs++;
    await verifyHash(referencedPath(root, candidate.metadataSnapshot.path), candidate.metadataSnapshot.sha256,
      `${candidate.candidateId} metadata`);
    metadata++;
  }
  return { manifests: 1, inputs, metadata };
}

if (import.meta.main) {
  try {
    const totals = await verifyJCandidates();
    console.log(`J candidate hashes verified: manifests=${totals.manifests} inputs=${totals.inputs} metadata=${totals.metadata}`);
  } catch (error) {
    console.error(`J candidate verification failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
