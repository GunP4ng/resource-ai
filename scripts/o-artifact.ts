import { randomUUID } from "node:crypto";
import { constants, closeSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, unlinkSync, writeFileSync, type Stats } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createCaseStore } from "../src/o-case-store.ts";
import { validateResourceArtifact } from "../src/o-resources.ts";
import { openRuntimeDatabase } from "../src/o-runtime-db.ts";
import { revision } from "../src/o-validation.ts";

class InstallError extends Error {
  constructor(readonly code: "arguments" | "filesystem" | "target" | "artifact" | "conflict") { super(code); }
}
const same = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
function privateEntry(path: string, directory: boolean): Stats {
  const info = lstatSync(path);
  if (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || info.isSymbolicLink()
    || (directory ? !info.isDirectory() || (info.mode & 0o700) !== 0o700 : !info.isFile() || info.nlink !== 1 || (info.mode & 0o600) !== 0o600)) throw new InstallError("filesystem");
  if (realpathSync(path) !== path) throw new InstallError("filesystem");
  return info;
}
/** Bounded descriptor read; private canonical parent excludes other-UID path writers. */
function readPrivate(path: string): Buffer {
  privateEntry(dirname(path), true);
  const before = privateEntry(path, false);
  if (before.size > 64 * 1024 * 1024) throw new InstallError("filesystem");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!same(before, fstatSync(fd))) throw new InstallError("filesystem");
    const bytes = Buffer.alloc(before.size + 1); let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, Math.min(65536, bytes.length - offset), offset);
      if (!count) break; offset += count;
    }
    if (offset !== before.size || !same(before, fstatSync(fd)) || !same(before, privateEntry(path, false))) throw new InstallError("filesystem");
    return bytes.subarray(0, offset);
  } finally { closeSync(fd); }
}
function syncDirectory(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function missing(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "ENOENT"; }

async function artifactMain(args = process.argv.slice(2)): Promise<number> {
  let runtime: Awaited<ReturnType<typeof openRuntimeDatabase>> | undefined;
  let cases: ReturnType<typeof createCaseStore> | undefined;
  try {
    const command = args[0], values = new Map<string, string>();
    const keys = ["--state-dir", "--resources-dir", "--username", "--case-id", "--expected-revision", "--artifact"];
    for (let index = 1; index < args.length; index += 2) {
      const key = args[index], value = args[index + 1];
      if (!key || !keys.includes(key) || values.has(key) || !value || value.startsWith("--")) throw new InstallError("arguments");
      values.set(key, value);
    }
    const state = values.get("--state-dir"), root = values.get("--resources-dir"), username = values.get("--username"),
      caseId = values.get("--case-id"), expected = values.get("--expected-revision"), source = values.get("--artifact");
    if ((command !== "check" && command !== "install") || !state || !root || !username || !caseId || !expected || !source
      || !/^[A-Za-z0-9][A-Za-z0-9_.@-]{0,63}$/.test(username) || !/^[A-Za-z0-9_-]{1,100}$/.test(caseId)
      || !/^[a-f0-9]{64}$/.test(expected) || [state, root, source].some(path => !isAbsolute(path) || resolve(path) !== path)) throw new InstallError("arguments");
    const rootIdentity = privateEntry(root, true);
    runtime = await openRuntimeDatabase(state, { existingOnly: true });
    const database = runtime.database;
    database.exec("PRAGMA busy_timeout=1000");
    cases = createCaseStore(Date.now, undefined, runtime);
    const store = cases, storage = runtime;
    const current = () => {
      storage.assertReady();
      const account = database.query<{ actor_id: string }, [string]>("SELECT actor_id FROM accounts WHERE username=? AND disabled=0").get(username);
      if (!account || !/^[A-Za-z0-9_-]{1,256}$/.test(account.actor_id)) throw new InstallError("target");
      const snapshot = store.read(`actor:${account.actor_id}`, caseId);
      if (!snapshot || snapshot.editUntil <= Date.now() || revision(snapshot.input) !== expected) throw new InstallError("target");
      return { actor: account.actor_id, input: snapshot.input };
    };
    const initial = database.transaction(current).deferred();
    const bytes = readPrivate(source);
    let accepted: Awaited<ReturnType<typeof validateResourceArtifact>>;
    try { accepted = await validateResourceArtifact(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), initial.input); }
    catch { throw new InstallError("artifact"); }
    // No await between the fresh binding check and publication. IMMEDIATE serializes
    // participating SQLite writers, including account disable and case withdrawal.
    database.transaction(() => {
      const target = current();
      if (target.actor !== initial.actor) throw new InstallError("target");
      const pinned: { readonly path: string; readonly info: Stats }[] = [{ path: root, info: rootIdentity }];
      let directory = root;
      for (const part of [target.actor, caseId]) {
        privateEntry(directory, true);
        const parent = directory; directory = join(directory, part);
        if (command === "install") {
          try { mkdirSync(directory, { mode: 0o700 }); }
          catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; }
        }
        try { pinned.push({ path: directory, info: privateEntry(directory, true) }); }
        catch (error) { if (command === "check" && missing(error)) break; throw error; }
        if (command === "install") syncDirectory(parent);
      }
      const path = join(root, target.actor, caseId, expected + ".json");
      const recheck = () => {
        storage.assertReady();
        for (const entry of pinned) {
          const info = privateEntry(entry.path, true);
          if (info.dev !== entry.info.dev || info.ino !== entry.info.ino) throw new InstallError("filesystem");
        }
      };
      recheck();
      let exists = false;
      try {
        if (!readPrivate(path).equals(bytes)) throw new InstallError("conflict");
        exists = true;
      } catch (error) { if (!missing(error)) throw error; }
      if (command === "check") return;
      if (exists) {
        const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try { fsyncSync(fd); } finally { closeSync(fd); }
        recheck(); syncDirectory(directory); return;
      }
      const temporary = join(directory, `.install-${randomUUID()}`);
      const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        try { writeFileSync(fd, bytes); fsyncSync(fd); }
        finally { closeSync(fd); }
        recheck(); current();
        // link refuses overwrite and only exposes a complete fsynced file.
        linkSync(temporary, path);
      } finally { unlinkSync(temporary); }
      recheck(); privateEntry(path, false); syncDirectory(directory);
    }).immediate();
    process.stdout.write(JSON.stringify({ status: command === "check" ? "checked" : "installed; reassessment pending",
      actorId: initial.actor, caseId, inputRevision: expected, artifactSha256: accepted.artifact.sha256 }) + "\n");
    return 0;
  } catch (error) {
    process.stderr.write(`Artifact operation failed: ${error instanceof InstallError ? error.code : "unavailable"}.\n`);
    return 1;
  } finally { cases?.dispose(); runtime?.close(); }
}
if (import.meta.main) process.exitCode = await artifactMain();
