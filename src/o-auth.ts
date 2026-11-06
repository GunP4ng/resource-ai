import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import type { RuntimeDatabase } from "./o-runtime-db.ts";

export type LocalAuthErrorCode = "denied" | "throttled" | "unavailable" | "cancelled";
export class LocalAuthError extends Error {
  constructor(readonly code: LocalAuthErrorCode) { super(`local-auth-${code}`); this.name = "LocalAuthError"; }
}
export type AuthGuard = () => void;
export type LocalIdentity = { actorId: string; validUntil: number; assertCurrent(): void };
export const LOCAL_AUTH_COOKIE = "resource_operator";
export const LOCAL_AUTH_LIMITS = Object.freeze({ crypto: 2, accounts: 1024, sessions: 4096,
  limitKeys: 2048, attempts: 5, globalAttempts: 100, windowMs: 15 * 60_000, sessionMs: 60 * 60_000 });
const params = { algorithm: "argon2id", memoryCost: 65536, timeCost: 3 } as const;
// Load the native API through Node's module boundary without adding Bun's global
// fetch overload (including preconnect) to the SDK's Node compilation unit.
const native: unknown = createRequire(import.meta.url)("bun");
if (typeof native !== "object" || native === null || !("password" in native)) throw new LocalAuthError("unavailable");
const passwordApi = native.password;
if (typeof passwordApi !== "object" || passwordApi === null || !("hash" in passwordApi) || typeof passwordApi.hash !== "function"
  || !("verify" in passwordApi) || typeof passwordApi.verify !== "function") throw new LocalAuthError("unavailable");
const bunPassword = {
  async hash(secret: string, options: typeof params): Promise<string> {
    const hash: unknown = Reflect.get(passwordApi, "hash");
    if (typeof hash !== "function") throw new LocalAuthError("unavailable");
    const value: unknown = await hash.call(passwordApi, secret, options);
    if (typeof value !== "string") throw new LocalAuthError("unavailable"); return value;
  },
  async verify(secret: string, encoded: string): Promise<boolean> {
    const verify: unknown = Reflect.get(passwordApi, "verify");
    if (typeof verify !== "function") throw new LocalAuthError("unavailable");
    const value: unknown = await verify.call(passwordApi, secret, encoded);
    if (typeof value !== "boolean") throw new LocalAuthError("unavailable"); return value;
  },
};
let cryptoActive = 0;
let dummyHash: string | undefined;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function fail(code: LocalAuthErrorCode): never { throw new LocalAuthError(code); }
function check(signal?: AbortSignal, guard?: AuthGuard) {
  if (signal?.aborted) fail("cancelled");
  if (guard) { try { guard(); } catch { fail("cancelled"); } }
}
function protectedCall<T>(fn: () => T): T {
  try { return fn(); } catch (error) { if (error instanceof LocalAuthError) throw error; fail("unavailable"); }
}
async function cryptoWork<T>(signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> {
  check(signal);
  if (cryptoActive >= LOCAL_AUTH_LIMITS.crypto) fail("unavailable");
  cryptoActive++;
  try { return await fn(); } catch (error) { if (error instanceof LocalAuthError) throw error; fail("unavailable"); }
  finally { cryptoActive--; }
}
function usernameValid(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,63}$/.test(value);
}
function passwordValid(value: unknown): value is string {
  return typeof value === "string" && value.length >= 12 && value.length <= 1024
    && Buffer.byteLength(value) <= 1024 && !/[\u0000\r\n]/.test(value);
}
type Account = { actor_id: string; username: string; password_hash: string; credential_generation: number;
  disabled: number; created_at: number };
function accountValid(a: Account) {
  if (!/^op_[a-f0-9]{64}$/.test(a.actor_id) || !usernameValid(a.username)
    || !/^\$argon2id\$v=19\$m=65536,t=3,p=\d{1,2}\$[A-Za-z0-9+/]{16,128}\$[A-Za-z0-9+/]{32,128}$/.test(a.password_hash)
    || !Number.isSafeInteger(a.credential_generation) || a.credential_generation < 1
    || (a.disabled !== 0 && a.disabled !== 1) || !Number.isSafeInteger(a.created_at) || a.created_at < 0) fail("unavailable");
  return a;
}

/** All timestamps are epoch milliseconds. Construct only for explicitly enabled local-operator mode. */
export function createLocalAuth(runtime: RuntimeDatabase, options: { origin: string; now?: () => number }) {
  let origin: URL;
  try {
    origin = new URL(options.origin);
    if (origin.origin !== options.origin || origin.username || origin.password
      || !(origin.protocol === "https:" || origin.protocol === "http:"
        && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))) fail("unavailable");
  } catch { fail("unavailable"); }
  const db = runtime.database;
  const now = () => {
    const value = (options.now ?? Date.now)();
    if (!Number.isSafeInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER - LOCAL_AUTH_LIMITS.sessionMs) fail("unavailable");
    return value;
  };
  const ready = () => {
    runtime.assertReady();
    // A missing auth table/column must fail even for requests without a cookie.
    db.query("SELECT actor_id,username,password_hash,credential_generation,disabled,created_at FROM accounts LIMIT 0").all();
    db.query("SELECT token_hash,actor_id,credential_generation,created_at,expires_at FROM sessions LIMIT 0").all();
    db.query("SELECT key,window_start,attempts FROM login_limits LIMIT 0").all();
  };
  const account = (username: string) => {
    const a = db.query<Account, [string]>("SELECT * FROM accounts WHERE username=?").get(username);
    return a ? accountValid(a) : null;
  };
  const immediate = <T>(fn: () => T): T => protectedCall(() => { ready(); return db.transaction(fn).immediate(); });
  const cookie = (token: string, clear = false) => `${LOCAL_AUTH_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${clear ? 0 : 3600}${origin.protocol === "https:" ? "; Secure" : ""}`;
  const tokenFrom = (request: Request): string | null => {
    if (new URL(request.url).origin !== origin.origin) return null;
    const raw = request.headers.get("cookie");
    if (!raw || raw.length > 8192 || /[\r\n\u0000]/.test(raw)) return null;
    let found: string | null = null;
    for (const part of raw.split(";")) {
      const field = part.trim(), equals = field.indexOf("=");
      if (equals < 1) return null;
      const name = field.slice(0, equals), value = field.slice(equals + 1);
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || !/^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/.test(value)) return null;
      if (name === LOCAL_AUTH_COOKIE) {
        if (found !== null || !/^[a-f0-9]{64}$/.test(value)) return null;
        found = value;
      }
    }
    return found;
  };
  type Session = { actor_id: string; credential_generation: number; created_at: number; expires_at: number };
  const current = (tokenHash: string): LocalIdentity | null => {
    ready();
    const s = db.query<Session, [string]>("SELECT actor_id,credential_generation,created_at,expires_at FROM sessions WHERE token_hash=?").get(tokenHash);
    if (!s) return null;
    if (!Number.isSafeInteger(s.created_at) || s.created_at < 0 || !Number.isSafeInteger(s.expires_at)
      || s.expires_at !== s.created_at + LOCAL_AUTH_LIMITS.sessionMs
      || !Number.isSafeInteger(s.credential_generation) || s.credential_generation < 1) fail("unavailable");
    const a = db.query<Account, [string]>("SELECT * FROM accounts WHERE actor_id=?").get(s.actor_id);
    if (!a) fail("unavailable");
    accountValid(a);
    const time = now();
    if (a.disabled || a.credential_generation !== s.credential_generation || time >= s.expires_at || time < s.created_at) return null;
    return { actorId: a.actor_id, validUntil: s.expires_at,
      assertCurrent() { protectedCall(() => { if (!current(tokenHash)) fail("denied"); }); } };
  };
  function takeAttempt(username: string) {
    immediate(() => {
      const time = now(), start = time - LOCAL_AUTH_LIMITS.windowMs;
      db.query("DELETE FROM login_limits WHERE window_start<=?").run(start);
      const keys = ["global", `user:${hash(username)}`];
      for (const key of keys) {
        const row = db.query<{ window_start: number; attempts: number }, [string]>("SELECT window_start,attempts FROM login_limits WHERE key=?").get(key);
        if (row && (!Number.isSafeInteger(row.window_start) || row.window_start < 0 || row.window_start > time
          || !Number.isSafeInteger(row.attempts) || row.attempts < 0)) fail("unavailable");
        if (row && row.attempts >= (key === "global" ? LOCAL_AUTH_LIMITS.globalAttempts : LOCAL_AUTH_LIMITS.attempts)) fail("throttled");
        if (!row && (db.query<{ n: number }, []>("SELECT count(*) AS n FROM login_limits").get()?.n ?? Infinity) >= LOCAL_AUTH_LIMITS.limitKeys) fail("unavailable");
        db.query("INSERT INTO login_limits(key,window_start,attempts) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1").run(key, time);
      }
    });
  }
  return {
    async login(username: string, password: string, signal: AbortSignal, guard?: AuthGuard): Promise<{ identity: LocalIdentity; setCookie: string }> {
      return protectedCall(async () => {
        // Async failures are normalized separately below.
        check(signal, guard);
        if (!usernameValid(username) || !passwordValid(password)) fail("denied");
        protectedCall(() => { ready(); takeAttempt(username); });
        const before = protectedCall(() => account(username));
        const valid = await cryptoWork(signal, async () => {
          if (!dummyHash) dummyHash = await bunPassword.hash(randomBytes(32).toString("hex"), params);
          return bunPassword.verify(password, before?.password_hash ?? dummyHash);
        });
        check(signal, guard);
        return immediate(() => {
          check(signal, guard);
          const a = account(username);
          if (!valid || !before || !a || a.disabled || a.actor_id !== before.actor_id
            || a.credential_generation !== before.credential_generation || a.password_hash !== before.password_hash) fail("denied");
          const time = now();
          db.query("DELETE FROM sessions WHERE expires_at<=?").run(time);
          db.query("DELETE FROM sessions WHERE actor_id=?").run(a.actor_id);
          if ((db.query<{ n: number }, []>("SELECT count(*) AS n FROM sessions").get()?.n ?? Infinity) >= LOCAL_AUTH_LIMITS.sessions) fail("unavailable");
          const token = randomBytes(32).toString("hex"), tokenHash = hash(token);
          db.query("INSERT INTO sessions(token_hash,actor_id,credential_generation,created_at,expires_at) VALUES(?,?,?,?,?)")
            .run(tokenHash, a.actor_id, a.credential_generation, time, time + LOCAL_AUTH_LIMITS.sessionMs);
          check(signal, guard);
          const identity = current(tokenHash);
          if (!identity) fail("denied");
          return { identity, setCookie: cookie(token) };
        });
      }).catch(error => { if (error instanceof LocalAuthError) throw error; fail("unavailable"); });
    },
    resolve(request: Request, signal: AbortSignal): LocalIdentity | null {
      return protectedCall(() => { check(signal); ready(); const token = tokenFrom(request); return token ? current(hash(token)) : null; });
    },
    logout(request: Request, signal?: AbortSignal, guard?: AuthGuard): { setCookie: string } {
      return immediate(() => { check(signal, guard); const token = tokenFrom(request);
        if (token) db.query("DELETE FROM sessions WHERE token_hash=?").run(hash(token));
        check(signal, guard); return { setCookie: cookie("", true) }; });
    },
    async create(username: string, password: string, signal?: AbortSignal): Promise<{ actorId: string }> {
      check(signal);
      if (!usernameValid(username) || !passwordValid(password)) fail("denied");
      protectedCall(() => { ready(); if (account(username)) fail("denied"); });
      const passwordHash = await cryptoWork(signal, () => bunPassword.hash(password, params));
      return immediate(() => { check(signal); if (account(username)) fail("denied");
        if ((db.query<{ n: number }, []>("SELECT count(*) AS n FROM accounts").get()?.n ?? Infinity) >= LOCAL_AUTH_LIMITS.accounts) fail("unavailable");
        const actorId = `op_${randomBytes(32).toString("hex")}`;
        db.query("INSERT INTO accounts(actor_id,username,password_hash,credential_generation,disabled,created_at) VALUES(?,?,?,1,0,?)").run(actorId, username, passwordHash, now());
        return { actorId }; });
    },
    async resetPassword(username: string, password: string, signal?: AbortSignal): Promise<void> {
      check(signal);
      if (!usernameValid(username) || !passwordValid(password)) fail("denied");
      const before = protectedCall(() => { ready(); const a = account(username); if (!a) fail("denied"); return a; });
      const passwordHash = await cryptoWork(signal, () => bunPassword.hash(password, params));
      immediate(() => { check(signal); const a = account(username);
        if (!a || a.actor_id !== before.actor_id || a.credential_generation !== before.credential_generation) fail("denied");
        if (a.credential_generation >= Number.MAX_SAFE_INTEGER) fail("unavailable");
        db.query("UPDATE accounts SET password_hash=?,credential_generation=credential_generation+1 WHERE actor_id=?").run(passwordHash, a.actor_id);
        db.query("DELETE FROM sessions WHERE actor_id=?").run(a.actor_id); });
    },
    disable(username: string, signal?: AbortSignal): void {
      immediate(() => { check(signal); if (!usernameValid(username)) fail("denied"); const a = account(username); if (!a) fail("denied");
        if (a.credential_generation >= Number.MAX_SAFE_INTEGER) fail("unavailable");
        db.query("UPDATE accounts SET disabled=1,credential_generation=credential_generation+1 WHERE actor_id=?").run(a.actor_id);
        db.query("DELETE FROM sessions WHERE actor_id=?").run(a.actor_id); });
    },
  };
}
