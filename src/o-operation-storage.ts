import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { constants, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync, type Stats } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export class OperationJournalError extends Error {
  constructor() { super("operation-journal-unavailable"); this.name = "OperationJournalError"; }
}
const schema = [
  "CREATE TABLE policy(approval TEXT PRIMARY KEY, digest TEXT NOT NULL, metadata TEXT NOT NULL) STRICT",
  "CREATE TABLE runs(id TEXT PRIMARY KEY, approval TEXT NOT NULL REFERENCES policy(approval), binding TEXT NOT NULL, terminal TEXT) STRICT",
  `CREATE TABLE attempts(run TEXT NOT NULL REFERENCES runs(id), attempt INTEGER NOT NULL CHECK(attempt>0), request TEXT NOT NULL,
    expires INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN('reserved','dispatch','unresolved','consumed','released')),
    payload TEXT, response TEXT, PRIMARY KEY(run,attempt)) STRICT`,
  "CREATE TABLE events(run TEXT NOT NULL REFERENCES runs(id), key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(run,key)) STRICT",
];
const same = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino;
function privateEntry(path: string, directory = false) {
  const info = lstatSync(path);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)
    || info.uid !== process.getuid?.() || (info.mode & 0o777) !== (directory ? 0o700 : 0o600)) throw new OperationJournalError();
  return info;
}
function optional(path: string) {
  try { return privateEntry(path); }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined; throw error; }
}
/** Linux local-filesystem lock belongs to this open file description, not a PID file.
 * flock(1) inherits the descriptor and locks it; this process retains it until close/crash. */
export function openOperationStorage(stateRoot: string, existingOnly = false) {
  let lock: number | undefined, database: Database | undefined;
  try {
    if (process.platform !== "linux" || !isAbsolute(stateRoot) || resolve(stateRoot) !== stateRoot || realpathSync(stateRoot) !== stateRoot) throw new OperationJournalError();
    const stateIdentity = privateEntry(stateRoot, true), root = join(stateRoot, "operations");
    if (!existingOnly) {
      try { mkdirSync(root, { mode: 0o700 }); }
      catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; }
    }
    const rootIdentity = privateEntry(root, true);
    if (realpathSync(root) !== root) throw new OperationJournalError();
    const lockPath = join(root, "process.lock"); optional(lockPath);
    lock = openSync(lockPath, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    const lockIdentity = privateEntry(lockPath);
    const acquired = spawnSync("/usr/bin/flock", ["-n", "3"], { stdio: ["ignore", "ignore", "ignore", lock] });
    if (acquired.error || acquired.status !== 0) throw new OperationJournalError();
    const file = join(root, "journal.sqlite"), previous = optional(file);
    if (existingOnly && !previous) throw new OperationJournalError();
    for (const suffix of ["-wal", "-shm", "-journal"]) if (optional(file + suffix) && !previous) throw new OperationJournalError();
    if (!previous) {
      const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { fsyncSync(fd); } finally { closeSync(fd); }
    }
    for (const path of [stateRoot, root]) {
      const directory = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { fsyncSync(directory); } finally { closeSync(directory); }
    }
    const identity = privateEntry(file);
    database = new Database(file, { strict: true, create: false });
    database.exec("PRAGMA busy_timeout=0; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    if (!previous) database.transaction(() => { for (const sql of schema) database?.exec(sql); database?.exec("PRAGMA user_version=1"); }).immediate();
    const normalize = (sql: string) => sql.replace(/\s+/g, " ").trim();
    const actual = database.query<{ sql: string }, []>("SELECT sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY sql").all().map(r => normalize(r.sql)).sort();
    if (database.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version !== 1
      || JSON.stringify(actual) !== JSON.stringify(schema.map(normalize).sort())
      || database.query<{ quick_check: string }, []>("PRAGMA quick_check").get()?.quick_check !== "ok"
      || database.query("PRAGMA foreign_key_check").all().length) throw new OperationJournalError();
    const db = database, fd = lock, sidecars = new Map<string, Stats>(); let closed = false;
    const assertReady = () => {
      if (closed || !same(stateIdentity, privateEntry(stateRoot, true)) || !same(rootIdentity, privateEntry(root, true))
        || realpathSync(stateRoot) !== stateRoot || realpathSync(root) !== root || !same(identity, privateEntry(file)) || !same(lockIdentity, privateEntry(lockPath))) throw new OperationJournalError();
      for (const suffix of ["-wal", "-shm", "-journal"]) {
        const info = optional(file + suffix), pinned = sidecars.get(suffix);
        if (pinned && (!info || !same(pinned, info))) throw new OperationJournalError();
        if (info) sidecars.set(suffix, info);
      }
    };
    assertReady();
    return { db, assertReady, close() { if (!closed) { db.close(); closeSync(fd); closed = true; } } };
  } catch { database?.close(); if (lock !== undefined) closeSync(lock); throw new OperationJournalError(); }
}
