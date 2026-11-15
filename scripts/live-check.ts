import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { checkApp, emptyCase } from "./live-check-app.ts";
import type { CaseResult } from "./live-check-app.ts";

const repository = fileURLToPath(new URL("../", import.meta.url));
export interface LiveCheckOptions {
  readonly out: string;
  readonly timeoutMs?: number;
  readonly authPath?: string;
}
export async function runLiveCheck(options: LiveCheckOptions) {
  const started = performance.now();
  // Mutable accumulator: every case is finalized before the single report write.
  const report: { schema: number; gitSha: string | null; date: string; live: boolean;
    provider: string; model: string; syntheticTextOnly: boolean; passed: boolean;
    elapsedMs: number; failure: string | null; cases: [CaseResult, CaseResult, CaseResult] } = {
    schema: 1, gitSha: null, date: new Date().toISOString(),
    live: true, provider: "chatgpt-subscription", model: "gpt-6-sol",
    syntheticTextOnly: true, passed: false, elapsedMs: 0, failure: null,
    cases: [emptyCase("normal"), emptyCase("missing-information"), emptyCase("app-logout")] };
  mkdirSync(options.out, { recursive: true, mode: 0o700 });
  const directory = join(resolve(options.out), randomUUID()); mkdirSync(directory, { mode: 0o700 });
  const path = join(directory, "result.json");
  const fd = openSync(path, "wx", 0o600);
  try {
    const timeoutMs = options.timeoutMs ?? 60_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) throw new Error("configuration");
    if ((process.env["RESOURCE_MODEL_RUNNER"] ?? "subscription") !== "subscription"
      || (process.env["RESOURCE_MODEL_ID"] ?? "gpt-6-sol") !== "gpt-6-sol") throw new Error("configuration");
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("version");
    report.gitSha = sha;
    await checkApp({ timeoutMs, authPath: options.authPath }, report.cases);
    report.passed = report.cases.every(c => c.passed);
  } catch {
    report.failure = "setup-or-execution";
  } finally {
    for (const result of report.cases) if (!result.passed) result.failure ??= "not-completed";
    report.elapsedMs = Math.round(performance.now() - started);
    try { writeFileSync(fd, JSON.stringify(report, null, 2) + "\n"); fsyncSync(fd); }
    finally { closeSync(fd); chmodSync(path, 0o400); }
  }
  return { path, report, exitCode: report.passed ? 0 : 1 };
}

/** Public command boundary shared with offline QA; no raw error or output is printed. */
export async function liveCheckCommand(args: string[]) {
  try {
    const { values } = parseArgs({ args, options: { out: { type: "string", default: "artifacts/live-check" },
      "timeout-ms": { type: "string", default: "60000" } }, strict: true, allowPositionals: false });
    if (values.out === undefined) throw new RangeError("output-required");
    const result = await runLiveCheck({ out: values.out, timeoutMs: Number(values["timeout-ms"]),
      authPath: process.env["RESOURCE_AUTH_PATH"] });
    // Path arguments may contain secrets, so stdout contains only fixed scalars.
    console.log(JSON.stringify({ passed: result.report.passed, live: result.report.live, exitCode: result.exitCode }));
    return result;
  } catch {
    console.error("Live check could not persist results.");
    return { exitCode: 1 };
  }
}
if (import.meta.main) process.exitCode = (await liveCheckCommand(process.argv.slice(2))).exitCode;
