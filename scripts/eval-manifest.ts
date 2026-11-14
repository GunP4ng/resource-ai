import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CaseInput } from "../src/contracts.ts";
import { parseCaseInput } from "../src/input.ts";

const repository = fileURLToPath(new URL("../", import.meta.url));

export class EvaluationError extends Error {
  constructor(readonly category: "manifest" | "arguments" | "budget-exhausted" | "git-version", message: string) {
    super(message); this.name = "EvaluationError";
  }
}

export interface DevelopmentCase {
  readonly caseId: string;
  readonly groupId: string;
  readonly stratum: string;
  readonly input: CaseInput;
  readonly inputSha256: string;
}

export interface DevelopmentManifest {
  readonly corpusVersion: string;
  readonly manifestSha256: string;
  readonly cases: readonly DevelopmentCase[];
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new EvaluationError("manifest", `Missing ${field}`);
  return value;
}

export function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function json(path: string): { readonly raw: string; readonly value: unknown } {
  const raw = readFileSync(path, "utf8");
  try { return { raw, value: JSON.parse(raw) }; }
  catch (error) {
    if (error instanceof SyntaxError) throw new EvaluationError("manifest", `Invalid JSON: ${path}`);
    throw error;
  }
}

function within(root: string, path: string): boolean {
  const part = relative(root, path);
  return part !== ".." && !part.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(part);
}

/** Validate the entire inventory before selecting a bounded execution subset. */
export async function loadDevelopmentManifest(path: string): Promise<DevelopmentManifest> {
  const manifest = json(resolve(path));
  const value = manifest.value;
  if (!record(value) || value["split"] !== "development" || !Array.isArray(value["cases"]) || value["cases"].length === 0) {
    throw new EvaluationError("manifest", "Expected a nonempty development manifest");
  }
  const corpusVersion = text(value["corpusVersion"], "corpusVersion");
  const root = realpathSync(repository);
  const manifestRoot = realpathSync(dirname(resolve(path)));
  const ids = new Set<string>();
  const cases: DevelopmentCase[] = [];
  for (const entry of value["cases"]) {
    if (!record(entry) || entry["split"] !== "development" || entry["exposure"] !== "exposed"
      || !record(entry["rights"]) || entry["rights"]["status"] !== "eligible"
      || entry["rights"]["scope"] !== "existing-synthetic-text-only" || entry["rights"]["photoTransmission"] !== "excluded"
      || entry["rights"]["licenseGranted"] !== false) {
      throw new EvaluationError("manifest", "Every case must be exposed development with eligible synthetic text and excluded photos");
    }
    const caseId = text(entry["caseId"], "caseId");
    if (ids.has(caseId)) throw new EvaluationError("manifest", `Duplicate caseId: ${caseId}`);
    ids.add(caseId);
    const ref = text(entry["inputRef"], "inputRef");
    if (isAbsolute(ref) || ref.includes("://")) throw new EvaluationError("manifest", "inputRef must be a relative local JSON path");
    const target = realpathSync(resolve(dirname(resolve(path)), ref));
    // A manifest may live in an owned test/output directory; references stay in its tree or the repository.
    if (!within(root, target) && !within(manifestRoot, target)) throw new EvaluationError("manifest", "inputRef escapes the corpus root");
    const inputFile = json(target);
    if (entry["sourceHash"] !== hash(inputFile.raw)) throw new EvaluationError("manifest", `sourceHash mismatch: ${caseId}`);
    const parsed = parseCaseInput(inputFile.value);
    if (!parsed.ok || parsed.value.caseId !== caseId) throw new EvaluationError("manifest", `Invalid CaseInput or caseId mismatch: ${caseId}`);
    cases.push({ caseId, groupId: text(entry["groupId"], "groupId"), stratum: text(entry["stratum"], "stratum"),
      input: { ...parsed.value, photoRefs: [] }, inputSha256: hash(inputFile.raw) });
  }
  return { corpusVersion, manifestSha256: hash(manifest.raw), cases };
}

export function inventory(manifest: DevelopmentManifest) {
  const groups: Record<string, number> = {};
  const strata: Record<string, number> = {};
  for (const entry of manifest.cases) {
    groups[entry.groupId] = (groups[entry.groupId] ?? 0) + 1;
    strata[entry.stratum] = (strata[entry.stratum] ?? 0) + 1;
  }
  return { corpusVersion: manifest.corpusVersion, split: "development", count: manifest.cases.length,
    groupCount: Object.keys(groups).length, groups, strata, unseenEligible: 0, lockedMissing: 12, photosSent: false };
}
