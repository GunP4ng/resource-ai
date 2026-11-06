import { isAbsolute, resolve } from "node:path";
import { createLocalAuth, LocalAuthError } from "../src/o-auth.ts";
import { openRuntimeDatabase } from "../src/o-runtime-db.ts";

/** No readline echo or unbounded stdin buffering. The caller owns the process signal. */
export function readAccountSecret(signal: AbortSignal, stdinSecret: boolean): Promise<string> {
  const input = process.stdin;
  if (!stdinSecret && (!input.isTTY || typeof input.setRawMode !== "function")) {
    return Promise.reject(new LocalAuthError("denied"));
  }
  return new Promise((resolveSecret, reject) => {
    const previousRaw = input.isRaw;
    let bytes: number[] = [], done = false;
    const finish = (error?: LocalAuthError) => {
      if (done) return;
      done = true;
      input.off("data", onData); input.off("end", onEnd); input.off("error", onError);
      signal.removeEventListener("abort", onAbort);
      try { if (!stdinSecret) input.setRawMode(Boolean(previousRaw)); }
      catch { error = new LocalAuthError("unavailable"); }
      input.pause();
      if (!stdinSecret) process.stderr.write("\n");
      const value = Buffer.from(bytes).toString("utf8"); bytes.fill(0); bytes = [];
      if (error) reject(error); else resolveSecret(value);
    };
    const onAbort = () => finish(new LocalAuthError("cancelled"));
    const onError = () => finish(new LocalAuthError("unavailable"));
    const onEnd = () => {
      if (!stdinSecret) return finish(new LocalAuthError("cancelled"));
      if (bytes.at(-1) === 10) { bytes.pop(); if (bytes.at(-1) === 13) bytes.pop(); }
      finish();
    };
    const onData = (chunk: Buffer | string) => {
      for (const byte of Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)) {
        if (!stdinSecret) {
          if (byte === 3 || byte === 4) return onAbort();
          if (byte === 13 || byte === 10) return finish();
          if (byte === 127 || byte === 8) {
            // Remove one complete UTF-8 code point without displaying it.
            while (bytes.length && (bytes.at(-1)! & 0xc0) === 0x80) bytes.pop();
            bytes.pop(); continue;
          }
          if (byte < 32) return finish(new LocalAuthError("denied"));
        }
        bytes.push(byte);
        if (bytes.length > (stdinSecret ? 1026 : 1024)) return finish(new LocalAuthError("denied"));
      }
    };
    input.on("data", onData); input.once("end", onEnd); input.once("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      if (!stdinSecret) { input.setRawMode(true); process.stderr.write("Password: "); }
      if (signal.aborted) onAbort(); else input.resume();
    } catch { finish(new LocalAuthError("unavailable")); }
  });
}

export async function accountMain(args = process.argv.slice(2)): Promise<number> {
  const abort = new AbortController();
  const cancel = () => abort.abort();
  process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
  let runtime: Awaited<ReturnType<typeof openRuntimeDatabase>> | undefined;
  try {
    const command = args[0];
    const values = new Map<string, string>();
    let stdinSecret = false;
    for (let i = 1; i < args.length; i++) {
      const key = args[i];
      if (key === "--stdin-secret" && !stdinSecret) { stdinSecret = true; continue; }
      if ((key !== "--state-dir" && key !== "--username") || values.has(key)) throw new LocalAuthError("denied");
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new LocalAuthError("denied");
      values.set(key, value);
    }
    const root = values.get("--state-dir"), username = values.get("--username");
    if (!["create", "reset-password", "disable"].includes(command ?? "") || !root || !username
      || !isAbsolute(root) || resolve(root) !== root || !/^[A-Za-z0-9][A-Za-z0-9_.@-]{0,63}$/.test(username)
      || command === "disable" && stdinSecret) throw new LocalAuthError("denied");
    // Read secrets before opening or creating the explicitly supplied application root.
    const secret = command === "disable" ? undefined : await readAccountSecret(abort.signal, stdinSecret);
    if (abort.signal.aborted) throw new LocalAuthError("cancelled");
    runtime = await openRuntimeDatabase(root);
    const auth = createLocalAuth(runtime, { origin: "http://127.0.0.1" });
    if (command === "create") await auth.create(username, secret!, abort.signal);
    else if (command === "reset-password") await auth.resetPassword(username, secret!, abort.signal);
    else auth.disable(username, abort.signal);
    process.stdout.write("Account operation completed.\n");
    return 0;
  } catch (error) {
    const code = error instanceof LocalAuthError ? error.code : "unavailable";
    process.stderr.write(`Account operation failed: ${code}.\n`);
    return 1;
  } finally {
    try { runtime?.close(); } catch { /* Never print storage diagnostics or secrets. */ }
    process.off("SIGINT", cancel); process.off("SIGTERM", cancel);
  }
}
if (import.meta.main) process.exitCode = await accountMain();
