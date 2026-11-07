// Test-process only: retain real filesystem operations, failing one selected sync.
import fs from "node:fs";
import { mock } from "bun:test";
import { sep } from "node:path";

export type FsProbe = { root: string; trace: string; failSync?: string };
const probe: FsProbe = JSON.parse(process.env["O_ARTIFACT_FS_PROBE"]!);
const original = { ...fs }, paths = new Map<number, string>();
const inside = (path: unknown): path is string => typeof path === "string" && (path === probe.root || path.startsWith(probe.root + sep));
const record = (operation: string, path: string) => original.appendFileSync(probe.trace, JSON.stringify({ operation, path }) + "\n");
fs.openSync = (...args: Parameters<typeof fs.openSync>) => {
  const fd = original.openSync(...args);
  if (inside(args[0])) {
    paths.set(fd, args[0]);
    if (typeof args[1] === "number" && (args[1] & fs.constants.O_CREAT)) record("create", args[0]);
  }
  return fd;
};
fs.closeSync = fd => { try { original.closeSync(fd); } finally { paths.delete(fd); } };
fs.fsyncSync = fd => {
  const path = paths.get(fd);
  if (path && path === probe.failSync) {
    record("fsync-failed", path);
    throw Object.assign(new Error("injected ancestor sync failure"), { code: "EIO" });
  }
  original.fsyncSync(fd);
  if (path) record("fsync", path);
};
fs.mkdirSync = ((...args: Parameters<typeof fs.mkdirSync>) => {
  if (inside(args[0])) record("mkdir", args[0]);
  return original.mkdirSync(...args);
}) as typeof fs.mkdirSync;
fs.linkSync = (source, target) => {
  if (inside(target)) record("publish", target);
  return original.linkSync(source, target);
};
// Bun's syncBuiltinESMExports is a no-op; register the wrapped real builtin so
// the CLI's named ESM imports see the same functions as the default export.
mock.module("node:fs", () => fs);
