import { Database } from "bun:sqlite";
import { constants, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync, type Stats } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export class RuntimeStorageError extends Error {
  constructor() { super("runtime-storage-unavailable"); this.name = "RuntimeStorageError"; }
}
export type RuntimeDatabase = {
  readonly database: Database;
  readonly root: string | null;
  assertReady(): void;
  close(): void;
};
const basename = "runtime.sqlite";
// Version 1 is deliberately closed: unknown tables, indexes, triggers and versions fail startup.
const schema = [
  `CREATE TABLE accounts(actor_id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    credential_generation INTEGER NOT NULL CHECK(credential_generation>=1), disabled INTEGER NOT NULL CHECK(disabled IN(0,1)),
    created_at INTEGER NOT NULL CHECK(created_at>=0)) STRICT`,
  `CREATE TABLE sessions(token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64), actor_id TEXT NOT NULL REFERENCES accounts(actor_id),
    credential_generation INTEGER NOT NULL CHECK(credential_generation>=1), created_at INTEGER NOT NULL CHECK(created_at>=0),
    expires_at INTEGER NOT NULL CHECK(expires_at>created_at)) STRICT`,
  `CREATE INDEX sessions_actor ON sessions(actor_id)`,
  `CREATE INDEX sessions_expiry ON sessions(expires_at)`,
  `CREATE TABLE login_limits(key TEXT PRIMARY KEY, window_start INTEGER NOT NULL CHECK(window_start>=0),
    attempts INTEGER NOT NULL CHECK(attempts>=0)) STRICT`,
  `CREATE TABLE review_records(hash TEXT PRIMARY KEY CHECK(length(hash)=64), artifact TEXT NOT NULL,
    bytes INTEGER NOT NULL CHECK(bytes>0 AND bytes<=67108864), CHECK(length(CAST(artifact AS BLOB))=bytes)) STRICT`,
  `CREATE TABLE cases(case_id TEXT PRIMARY KEY, owner TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>=1),
    row_revision INTEGER NOT NULL CHECK(row_revision>=1), notice_generation INTEGER NOT NULL CHECK(notice_generation>=0),
    expires INTEGER NOT NULL CHECK(expires>=0), edit_until INTEGER NOT NULL CHECK(edit_until>=0 AND edit_until<=expires),
    snapshot TEXT NOT NULL CHECK(length(CAST(snapshot AS BLOB))<=1048576),
    review_hash TEXT REFERENCES review_records(hash)) STRICT`,
  `CREATE INDEX cases_owner_expiry ON cases(owner,expires)`,
  `CREATE TABLE leases(case_id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, owner TEXT NOT NULL,
    expected_version INTEGER CHECK(expected_version>=1), notice_generation INTEGER NOT NULL CHECK(notice_generation>=0),
    created_at INTEGER NOT NULL CHECK(created_at>=0), expires INTEGER NOT NULL CHECK(expires>created_at AND expires<=created_at+65000)) STRICT`,
  `CREATE INDEX leases_expiry ON leases(expires)`,
  `CREATE TABLE photo_cleanup(owner TEXT NOT NULL, case_id TEXT NOT NULL, photo_ref TEXT NOT NULL,
    queued_at INTEGER NOT NULL CHECK(queued_at>=0), PRIMARY KEY(owner,case_id,photo_ref)) STRICT`,
];
const normalize = (sql: string) => sql.replace(/\s+/g, " ").trim();
function configure(database: Database, fresh: boolean) {
  database.exec("PRAGMA busy_timeout=0; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
  if (fresh) database.transaction(() => { for (const sql of schema) database.exec(sql); database.exec("PRAGMA user_version=1"); }).immediate();
  const version = database.query<{ user_version: number }, []>("PRAGMA user_version").get();
  const actual = database.query<{ sql: string }, []>("SELECT sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY sql").all().map(row => normalize(row.sql)).sort();
  const expected = schema.map(normalize).sort();
  if (version?.user_version !== 1 || JSON.stringify(actual) !== JSON.stringify(expected)
    || database.query<{ quick_check: string }, []>("PRAGMA quick_check").get()?.quick_check !== "ok"
    || database.query("PRAGMA foreign_key_check").all().length) throw new RuntimeStorageError();
}
export function createMemoryRuntimeDatabase(): RuntimeDatabase {
  const database = new Database(":memory:", { strict: true });
  configure(database, true); let closed = false;
  return { database, root: null,
    assertReady() { if (closed) throw new RuntimeStorageError(); },
    close() { if (!closed) { database.close(); closed = true; } },
  };
}
const same = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino;
function privatePath(path: string, directory: boolean): Stats {
  const info = lstatSync(path);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)
    || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0
    || (info.mode & (directory ? 0o700 : 0o600)) !== (directory ? 0o700 : 0o600)) throw new RuntimeStorageError();
  return info;
}
function optionalFile(path: string): Stats | undefined {
  try { return privatePath(path, false); }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined; throw error; }
}
/** A private directory is the confinement boundary; same-UID hostile processes are outside it. */
export async function openRuntimeDatabase(absolutePrivateRoot: string): Promise<RuntimeDatabase> {
  let database: Database | undefined;
  try {
    if (!isAbsolute(absolutePrivateRoot) || resolve(absolutePrivateRoot) !== absolutePrivateRoot) throw new RuntimeStorageError();
    mkdirSync(absolutePrivateRoot, { mode: 0o700 });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw new RuntimeStorageError();
  }
  try {
    const root = absolutePrivateRoot, identity = privatePath(root, true);
    if (realpathSync(root) !== root) throw new RuntimeStorageError();
    const file = join(root, basename), previous = optionalFile(file);
    const sidecars = new Map<string, Stats>();
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      const info = optionalFile(file + suffix); if (info) sidecars.set(suffix, info);
    }
    if (!previous && sidecars.size) throw new RuntimeStorageError();
    if (!previous) {
      const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { fsyncSync(fd); } finally { closeSync(fd); }
      const directory = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { fsyncSync(directory); } finally { closeSync(directory); }
    }
    const fileIdentity = privatePath(file, false);
    database = new Database(file, { strict: true, create: false });
    // SQLite may legitimately recreate sidecars during open/recovery. Re-pin after configuration.
    configure(database, !previous);
    sidecars.clear(); let closed = false;
    const connection = database;
    const assertReady = () => {
      if (closed || !same(identity, privatePath(root, true)) || realpathSync(root) !== root
        || !same(fileIdentity, privatePath(file, false))) throw new RuntimeStorageError();
      for (const suffix of ["-wal", "-shm", "-journal"]) {
        const info = optionalFile(file + suffix), pinned = sidecars.get(suffix);
        if (pinned && (!info || !same(info, pinned))) throw new RuntimeStorageError();
        if (info) sidecars.set(suffix, info);
      }
    };
    assertReady();
    return { database: connection, root,
      assertReady() { try { assertReady(); } catch { throw new RuntimeStorageError(); } },
      close() { if (!closed) { connection.close(); closed = true; } },
    };
  } catch { database?.close(); throw new RuntimeStorageError(); }
}
