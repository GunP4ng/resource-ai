import assert from "node:assert/strict";
import { mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import { parse, sha } from "../../../../src/o-public-calculation-validation.ts";
import { design, directory, temporary, hashObject, save, readJson, snapshot, verifySnapshot, pinSchema } from "./local.ts";
import { runContrasts, verifyContrasts } from "./contrast.ts";
import { runSensitivity, verifySensitivity } from "./sensitivity.ts";

const files = ["design.json", "local.ts", "contrast.ts", "oracle.ts", "sensitivity.ts", "run.ts", "tsconfig.json",
  "contrast-inputs.json", "contrasts.json", "parent-receipt.json", "sensitivity.json", "summary.json",
  "originals-before.json", "originals-after.json", "pre-execution.json", "methodology.md"] as const;
const mode = process.argv[2];
assert.ok(mode === "--run" || mode === "--verify", "Use --run (54 scenarios) or --verify (zero scenarios)");
await mkdir(temporary); // Exclusive ownership: an existing directory causes failure rather than deletion.
process.env["TMPDIR"] = temporary;
process.env["XDG_CACHE_HOME"] = temporary;
process.env["BUN_RUNTIME_TRANSPILER_CACHE_PATH"] = "0";
try {
  if (mode === "--run") {
    // Never silently repeat an existing run and consume another 54-scenario budget.
    const outputExists = await import("node:fs").then(fs => fs.existsSync(join(directory, "contrasts.json")));
    assert.equal(outputExists, false, "Existing run retained; use --verify. Reproduction belongs in a fresh copy of comparison.");
    const before = await snapshot();
    await save("originals-before.json", before);
    await save("pre-execution.json", { design_sha256: sha(await readFile(join(directory, "design.json"))),
      source_sha256: before.source_sha256, inputs_sha256: before.all_sha256,
      runtime: process.versions, budget: design.budget, model_api_calls: 0,
      network: "No network functions are invoked by this runner or its selected domain/calculation path." });
    await runContrasts(before.source_sha256);
    await runSensitivity();
    await save("originals-after.json", await snapshot());
  }
  const originals = await verifySnapshot();
  const contrast = await verifyContrasts(originals.source_sha256);
  const sensitivity = await verifySensitivity();
  const summary = { design_sha256: sha(await readFile(join(directory, "design.json"))),
    source_sha256: originals.source_sha256, originals_unchanged: true,
    scenario_runs: { domain: contrast.decisions, public_calculation: sensitivity.scenarios,
      total: contrast.decisions + sensitivity.scenarios, maximum: 54 },
    verification_additional_scenario_runs: 0, contrast, sensitivity };
  assert.equal(summary.scenario_runs.total, 54);
  if (mode === "--run") {
    await save("summary.json", summary);
    const pins = await Promise.all(files.map(async path => ({ path, sha256: sha(await readFile(join(directory, path))) })));
    await save("artifacts.json", { files: pins, sha256: hashObject(pins) });
  } else {
    assert.deepEqual(await readJson("summary.json"), summary, "independent replay summary mismatch");
    const sealed = parse(Type.Object({ files: Type.Array(pinSchema), sha256: Type.String() }), await readJson("artifacts.json"));
    assert.deepEqual(sealed.files.map(pin => pin.path), [...files]);
    for (const pin of sealed.files) assert.equal(sha(await readFile(join(directory, pin.path))), pin.sha256, pin.path);
    assert.equal(hashObject(sealed.files), sealed.sha256);
  }
  console.log(JSON.stringify({ status: "PASS", mode, scenarios_executed_now: mode === "--run" ? 54 : 0,
    source_sha256: originals.source_sha256, states: contrast.states, first_routes: contrast.first_routes,
    numeric_comparisons: sensitivity.independent_numeric_comparisons, maximum_error: sensitivity.maximum_absolute_error }));
} finally {
  await rm(temporary, { recursive: true });
}
