import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { verifyJCandidates } from "../scripts/verify-j-candidates.ts";

const source = fileURLToPath(new URL("../data/candidates/j-2026-11-13/", import.meta.url));
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

async function temporaryCandidatePack(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "j-candidate-verification-"));
  await cp(source, root, { recursive: true });
  return root;
}

test("J candidate verifier checks the manifest and every input and metadata reference", async () => {
  assert.deepEqual(await verifyJCandidates(), { manifests: 1, inputs: 10, metadata: 10 });
});

test("J candidate verifier rejects tampered input bytes", async () => {
  const root = await temporaryCandidatePack();
  try {
    await writeFile(join(root, "inputs/J-20261113-001.json"), "{}\n");
    await assert.rejects(verifyJCandidates(root), /J-20261113-001 input SHA-256 mismatch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("J candidate verifier rejects a tampered input hash", async () => {
  const root = await temporaryCandidatePack();
  try {
    const manifestPath = join(root, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.candidates[0].inputSha256 = "0".repeat(64);
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
    await writeFile(manifestPath, manifestBytes);

    const reviewPath = join(root, "peer-source-review.json");
    const review = JSON.parse(await readFile(reviewPath, "utf8"));
    review.manifests.J.sha256 = sha256(manifestBytes);
    await writeFile(reviewPath, JSON.stringify(review, null, 2) + "\n");

    await assert.rejects(verifyJCandidates(root), /J-20261113-001 input SHA-256 mismatch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
