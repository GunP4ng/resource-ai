import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Database } from "bun:sqlite";

const key = "O_TEST_PROCESS_TIME";
export const processTimeArguments = ["--preload", fileURLToPath(new URL("./o-process-time-preload.ts", import.meta.url))];
export function processTimeEnvironment(epoch = Date.now()) {
  return { ...process.env, [key]: String(epoch) };
}
export function readProcessTime() {
  const epoch = Number(process.env[key]), anchor = performance.now();
  assert.ok(Number.isSafeInteger(epoch) && epoch > 0);
  // Explicitly hand off the parent's current epoch at each spawn. Bun's hrtime
  // and performance origins are process-local; the host wall clock may roll back.
  // Only epoch time changes: request deadlines, native timers and signals stay real.
  return () => epoch + Math.floor(performance.now() - anchor);
}

/** Numeric state only: never select hashes, identities, cookies or credentials. */
export function authTimeState(root: string) {
  const db = new Database(join(root, "runtime.sqlite"), { readonly: true });
  try {
    return { wall: Date.now(),
      window: db.query<{ at: number | null }, []>("SELECT max(window_start) AS at FROM login_limits").get()?.at,
      sessionCreated: db.query<{ at: number | null }, []>("SELECT max(created_at) AS at FROM sessions").get()?.at,
      sessionExpires: db.query<{ at: number | null }, []>("SELECT max(expires_at) AS at FROM sessions").get()?.at };
  } finally { db.close(); }
}

/** Execute once in an isolated test parent, preloading before any auth import.
 * Its launcher children use processTimeArguments and processTimeEnvironment().
 * Isolation keeps the auth module's shared offset out of the surrounding suite.
 */
export async function runWithProcessTime(t: { readonly name: string; diagnostic(message: string): void }, file: string) {
  if (process.env[key]) return false;
  const name = t.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const result = await promisify(execFile)(process.execPath,
    ["test", ...processTimeArguments, fileURLToPath(file), "-t", `^${name}$`],
    { env: processTimeEnvironment(1_800_000_000_000), timeout: 30000, maxBuffer: 1024 * 1024 });
  assert.match(result.stderr, /\b1 pass\b/);
  t.diagnostic(result.stdout + result.stderr);
  return true;
}
