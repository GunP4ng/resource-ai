import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonical } from "../src/o-validation.ts";
import { readPublicCalculationDataset } from "../src/o-public-calculation-data.ts";
import { buildPublicCalculations, projectCommercialReferences } from "../src/o-public-calculation-engine.ts";
import { requireData, required, json, readJson, Invalid } from "../src/o-public-calculation-validation.ts";
async function main() {
  const [command, ...args] = process.argv.slice(2), options = new Map<string, string>();
  requireData(["validate", "build", "export"].includes(command ?? "") && args.length % 2 === 0, "E_USAGE");
  for (let n = 0; n < args.length; n += 2) {
    const key = required(args[n]), val = required(args[n + 1]);
    requireData(["--dataset", "--root", "--evidence-dir", "--mode", "--input"].includes(key) && !options.has(key) && !val.startsWith("--"), "E_USAGE");
    options.set(key, val);
  }
  requireData(options.has("--dataset") && (command === "validate" ? !options.has("--mode") && !options.has("--input") :
    ["research", ...(command === "export" ? ["commercial"] : [])].includes(options.get("--mode") ?? "") && (command === "export") === options.has("--input")), "E_USAGE");
  const root = resolve(options.get("--root") ?? fileURLToPath(new URL("../", import.meta.url)));
  const verified = await readPublicCalculationDataset({ directory: resolve(root, required(options.get("--dataset"))), root, evidence: options.get("--evidence-dir") });
  if (command === "validate") return { status: "valid", verification: options.has("--evidence-dir") ? "private_original_hashes" : "pinned_transcriptions", fixture_sha256: verified.fixture_sha256 };
  const bundle = buildPublicCalculations(verified);
  if (command === "export") requireData(canonical(await readJson(resolve(required(options.get("--input"))))) === canonical(JSON.parse(json(bundle))), "E_EXPORT_MISMATCH");
  return options.get("--mode") === "commercial" ? projectCommercialReferences(bundle) : bundle;
}
if (import.meta.main) {
  try { process.stdout.write(json(await main())); }
  catch (error) { // no-excuse-ok: catch — sanitized CLI error boundary; never emit partial output.
    process.stderr.write(`${error instanceof Invalid ? error.code : "E_IO_OR_JSON"}\n`);
    process.exitCode = error instanceof Invalid && error.code === "E_USAGE" ? 2 : 1;
  }
}
