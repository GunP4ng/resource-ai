import { execFileSync } from "node:child_process";
import { constants, closeSync, existsSync, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync, type Stats } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { OCaseStore } from "./o-case-store.ts";
import type { RuntimeDatabase } from "./o-runtime-db.ts";
import { revision } from "./o-validation.ts";

export class ArtifactOperatorError extends Error {
  constructor(readonly code: "arguments" | "filesystem" | "target" | "artifact" | "conflict" | "metadata") { super(code); }
}
export interface ArtifactTargetRequest {
  readonly username: string;
  readonly caseId: string;
  readonly expectedRevision: string;
}
export const artifactAssetRoot = fileURLToPath(new URL("../", import.meta.url));
export function resolveArtifactTarget(runtime: RuntimeDatabase, store: Pick<OCaseStore, "read">, request: ArtifactTargetRequest) {
  runtime.assertReady();
  const { username, caseId, expectedRevision } = request;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.@-]{0,63}$/.test(username) || !/^[A-Za-z0-9_-]{1,100}$/.test(caseId)
    || !/^[a-f0-9]{64}$/.test(expectedRevision)) throw new ArtifactOperatorError("arguments");
  const account = runtime.database.query<{ actor_id: string }, [string]>(
    "SELECT actor_id FROM accounts WHERE username=? AND disabled=0").get(username);
  if (!account || !/^[A-Za-z0-9_-]{1,256}$/.test(account.actor_id)) throw new ArtifactOperatorError("target");
  const snapshot = store.read("actor:" + account.actor_id, caseId);
  if (!snapshot || snapshot.editUntil <= Date.now() || revision(snapshot.input) !== expectedRevision) throw new ArtifactOperatorError("target");
  return { actorId: account.actor_id, input: snapshot.input, snapshot };
}
const same = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
export function privateArtifactEntry(path: string, directory: boolean): Stats {
  const info = lstatSync(path);
  if (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || info.isSymbolicLink()
    || (directory ? !info.isDirectory() || (info.mode & 0o700) !== 0o700 : !info.isFile() || info.nlink !== 1 || (info.mode & 0o600) !== 0o600)) throw new ArtifactOperatorError("filesystem");
  if (realpathSync(path) !== path) throw new ArtifactOperatorError("filesystem");
  return info;
}
/** Descriptor identity and bounded reads share the installer's existing private path boundary. */
export function readPrivateArtifact(path: string): Buffer {
  privateArtifactEntry(dirname(path), true);
  const before = privateArtifactEntry(path, false);
  if (before.size > 64 * 1024 * 1024) throw new ArtifactOperatorError("filesystem");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!same(before, fstatSync(fd))) throw new ArtifactOperatorError("filesystem");
    const bytes = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, Math.min(65536, bytes.length - offset), offset);
      if (!count) break;
      offset += count;
    }
    if (offset !== before.size || !same(before, fstatSync(fd)) || !same(before, privateArtifactEntry(path, false))) throw new ArtifactOperatorError("filesystem");
    return bytes.subarray(0, offset);
  } finally { closeSync(fd); }
}
export function artifactArguments(args: readonly string[], keys: readonly string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 1; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!key || !keys.includes(key) || values.has(key) || !value || value.startsWith("--")) throw new ArtifactOperatorError("arguments");
    values.set(key, value);
  }
  if (values.size !== keys.length) throw new ArtifactOperatorError("arguments");
  return values;
}
export function absoluteArtifactPath(value: string | undefined): string {
  if (!value || !isAbsolute(value) || resolve(value) !== value) throw new ArtifactOperatorError("arguments");
  return value;
}
/** Source execution records Git HEAD; packaged execution requires its strict build receipt.
 * Working implementation bytes are independently recorded by the research catalog.
 */
export function artifactCodeRevision(root = artifactAssetRoot): string {
  if (existsSync(join(root, ".git"))) {
    const head = execFileSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: root, env: { ...process.env, GIT_MASTER: "1" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    if (!/^[a-f0-9]{40}$/.test(head)) throw new ArtifactOperatorError("metadata");
    return head;
  }
  const value: unknown = JSON.parse(readFileSync(join(root, "o-build-receipt.json"), "utf8"));
  if (typeof value !== "object" || value === null || Object.keys(value).sort().join(",") !== "codeRevision,version"
    || !("version" in value) || value.version !== 1 || !("codeRevision" in value)
    || typeof value.codeRevision !== "string" || !/^[a-f0-9]{40}$/.test(value.codeRevision)) throw new ArtifactOperatorError("metadata");
  return value.codeRevision;
}
