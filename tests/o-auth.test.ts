import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { password as bunPassword, spawn } from "bun";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createLocalAuth, LOCAL_AUTH_COOKIE, LOCAL_AUTH_LIMITS } from "../src/o-auth.ts";
import { openRuntimeDatabase, type RuntimeDatabase } from "../src/o-runtime-db.ts";

const password = "correct horse battery staple";
const otherPassword = "another sufficiently long password";
const origin = "http://127.0.0.1:43123";
const roots: string[] = [], connections: RuntimeDatabase[] = [];
afterEach(async () => {
  for (const db of connections.splice(0)) db.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "o-auth-test-")); roots.push(root);
  const db = await openRuntimeDatabase(root); connections.push(db);
  let time = 1_800_000_000_000;
  const auth = createLocalAuth(db, { origin, now: () => time });
  return { root, db, auth, advance: (ms: number) => { time += ms; } };
}
const signal = () => new AbortController().signal;
const request = (setCookie?: string, extra: Record<string, string> = {}) => new Request(origin, {
  headers: { ...extra, ...(setCookie ? { cookie: setCookie.split(";")[0]! } : {}) },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

describe("local operator authentication with real Argon2 and private SQLite", () => {
  test("generic wrong/unknown denial; hashed credentials/session; stable actor after restart", async () => {
    const { root, db, auth } = await fixture();
    const created = await auth.create("operator", password);
    expect(created.actorId).not.toContain("operator");
    expect(db.database.query<{ password_hash: string }, []>("SELECT password_hash FROM accounts").get()?.password_hash).toStartWith("$argon2id$v=19$m=65536,t=3,");
    await expect(auth.login("operator", otherPassword, signal())).rejects.toMatchObject({ code: "denied", message: "local-auth-denied" });
    await expect(auth.login("unknown", password, signal())).rejects.toMatchObject({ code: "denied", message: "local-auth-denied" });
    const logged = await auth.login("operator", password, signal());
    expect(logged.identity.actorId).toBe(created.actorId);
    expect(logged.setCookie).toContain("HttpOnly; SameSite=Strict; Path=/; Max-Age=3600");
    const token = logged.setCookie.split(";")[0]!.split("=")[1]!;
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    const stored = db.database.query<{ token_hash: string }, []>("SELECT token_hash FROM sessions").get()!;
    expect(stored.token_hash).not.toBe(token);
    expect(stored.token_hash).toBe(createHash("sha256").update(token).digest("hex"));
    db.close();
    const reopened = await openRuntimeDatabase(root); connections.push(reopened);
    const again = createLocalAuth(reopened, { origin, now: () => logged.identity.validUntil - 100 });
    expect(again.resolve(request(logged.setCookie), signal())?.actorId).toBe(created.actorId);
    expect(again.resolve(request(undefined, { "x-actor-id": created.actorId, authorization: "Bearer forged" }), signal())).toBeNull();
    expect(again.resolve(request(`${LOCAL_AUTH_COOKIE}=${"0".repeat(64)}`), signal())).toBeNull();
    for (const cookie of [
      `${logged.setCookie.split(";")[0]}; ${logged.setCookie.split(";")[0]}`,
      `${logged.setCookie.split(";")[0]}; broken`,
      `${LOCAL_AUTH_COOKIE}="${token}"`,
      `${LOCAL_AUTH_COOKIE}=x; ${logged.setCookie.split(";")[0]}`,
    ]) expect(again.resolve(new Request(origin, { headers: { cookie } }), signal())).toBeNull();
    expect(again.resolve(new Request("http://localhost", { headers: { cookie: logged.setCookie.split(";")[0]! } }), signal())).toBeNull();
  });

  test("fresh login rotates and revokes previous token; logout revokes exactly its supplied token", async () => {
    const { auth } = await fixture();
    await auth.create("one", password); await auth.create("two", password);
    const one = await auth.login("one", password, signal());
    const two = await auth.login("two", password, signal());
    const fresh = await auth.login("one", password, signal());
    expect(fresh.setCookie).not.toBe(one.setCookie);
    expect(() => one.identity.assertCurrent()).toThrow("local-auth-denied");
    const cleared = auth.logout(request(fresh.setCookie));
    expect(cleared.setCookie).toContain("Max-Age=0");
    expect(auth.resolve(request(fresh.setCookie), signal())).toBeNull();
    expect(() => fresh.identity.assertCurrent()).toThrow("local-auth-denied");
    two.identity.assertCurrent();
  });

  test("fixed expiry, reset revocation, disabled reset stays disabled, duplicate create does not replace actor", async () => {
    const { auth, db, advance } = await fixture();
    const actor = await auth.create("operator", password);
    const old = await auth.login("operator", password, signal());
    advance(LOCAL_AUTH_LIMITS.sessionMs);
    expect(auth.resolve(request(old.setCookie), signal())).toBeNull();
    expect(() => old.identity.assertCurrent()).toThrow("local-auth-denied");
    const active = await auth.login("operator", password, signal());
    await auth.resetPassword("operator", otherPassword);
    expect(() => active.identity.assertCurrent()).toThrow("local-auth-denied");
    await expect(auth.login("operator", password, signal())).rejects.toMatchObject({ code: "denied" });
    const reset = await auth.login("operator", otherPassword, signal());
    expect(reset.identity.actorId).toBe(actor.actorId);
    auth.disable("operator");
    expect(() => reset.identity.assertCurrent()).toThrow("local-auth-denied");
    await auth.resetPassword("operator", password);
    await expect(auth.login("operator", password, signal())).rejects.toMatchObject({ code: "denied" });
    await expect(auth.create("operator", password)).rejects.toMatchObject({ code: "denied" });
    expect(db.database.query<{ actor_id: string; disabled: number }, []>("SELECT actor_id,disabled FROM accounts").get()).toEqual({ actor_id: actor.actorId, disabled: 1 });
  });

  test("persisted known/unknown attempt limits survive restart and expire", async () => {
    const { root, db, auth, advance } = await fixture();
    await auth.create("operator", password);
    for (const username of ["operator", "unknown"]) {
      for (let i = 0; i < LOCAL_AUTH_LIMITS.attempts; i++) await expect(auth.login(username, otherPassword, signal())).rejects.toMatchObject({ code: "denied" });
      await expect(auth.login(username, password, signal())).rejects.toMatchObject({ code: "throttled" });
    }
    db.close();
    const reopened = await openRuntimeDatabase(root); connections.push(reopened);
    const restarted = createLocalAuth(reopened, { origin, now: () => 1_800_000_000_000 });
    await expect(restarted.login("operator", password, signal())).rejects.toMatchObject({ code: "throttled" });
    const expired = createLocalAuth(reopened, { origin, now: () => 1_800_000_000_000 + LOCAL_AUTH_LIMITS.windowMs });
    expect((await expired.login("operator", password, signal())).identity.actorId).toBeString();
    advance(LOCAL_AUTH_LIMITS.windowMs);
    await expect(expired.login("unknown", password, signal())).rejects.toMatchObject({ code: "denied" });
    expect(reopened.database.query<{ n: number }, []>("SELECT count(*) AS n FROM login_limits").get()?.n).toBe(3);
  });

  for (const action of ["disable", "reset", "abort", "guard"] as const) {
    test(`revocation during async verification prevents issuance: ${action}`, async () => {
      const { auth, db } = await fixture(); await auth.create("operator", password);
      const entered = deferred<void>(), release = deferred<boolean>();
      const verify = spyOn(bunPassword, "verify").mockImplementation(async () => { entered.resolve(); return release.promise; });
      const controller = new AbortController(); let allowed = true;
      try {
        const pending = auth.login("operator", password, controller.signal, () => { if (!allowed) throw new Error("deadline"); });
        await entered.promise;
        if (action === "disable") auth.disable("operator");
        else if (action === "reset") await auth.resetPassword("operator", otherPassword);
        else if (action === "abort") controller.abort();
        else allowed = false;
        release.resolve(true);
        await expect(pending).rejects.toMatchObject({ code: action === "abort" || action === "guard" ? "cancelled" : "denied" });
        expect(db.database.query<{ n: number }, []>("SELECT count(*) AS n FROM sessions").get()?.n).toBe(0);
      } finally { release.resolve(false); verify.mockRestore(); }
    });
  }

  test("crypto concurrency has no queue, including across service instances", async () => {
    const { auth, db } = await fixture(); await auth.create("operator", password);
    const entered = deferred<void>(), release = deferred<boolean>(); let count = 0;
    const verify = spyOn(bunPassword, "verify").mockImplementation(async () => {
      if (++count === LOCAL_AUTH_LIMITS.crypto) entered.resolve(); return release.promise;
    });
    const pending: ReturnType<typeof auth.login>[] = [];
    try {
      for (let i = 0; i < LOCAL_AUTH_LIMITS.crypto; i++) pending.push(auth.login("operator", password, signal()));
      await entered.promise;
      const second = createLocalAuth(db, { origin });
      await expect(second.login("unknown", password, signal())).rejects.toMatchObject({ code: "unavailable" });
      release.resolve(false);
      expect((await Promise.allSettled(pending)).every(r => r.status === "rejected")).toBe(true);
      expect(count).toBe(LOCAL_AUTH_LIMITS.crypto);
    } finally { release.resolve(false); await Promise.allSettled(pending); verify.mockRestore(); }
  });

  test("publication guard runs inside transaction and rolls back session writes", async () => {
    const { auth, db } = await fixture(); await auth.create("operator", password);
    await expect(auth.login("operator", password, signal(), () => {
      if ((db.database.query<{ n: number }, []>("SELECT count(*) AS n FROM sessions").get()?.n ?? 0) > 0) throw new Error("expired");
    })).rejects.toMatchObject({ code: "cancelled" });
    expect(db.database.query<{ n: number }, []>("SELECT count(*) AS n FROM sessions").get()?.n).toBe(0);
  });

  test("malformed backing rows and closed backing stores fail explicitly; origin and input bounded", async () => {
    const { auth, db } = await fixture(); await auth.create("operator", password);
    const logged = await auth.login("operator", password, signal());
    db.database.query("UPDATE accounts SET password_hash='malformed'").run();
    expect(() => auth.resolve(request(logged.setCookie), signal())).toThrow("local-auth-unavailable");
    await expect(auth.login("operator", password, signal())).rejects.toMatchObject({ code: "unavailable" });
    db.close();
    expect(() => auth.resolve(request(), signal())).toThrow("local-auth-unavailable");
    expect(() => logged.identity.assertCurrent()).toThrow("local-auth-unavailable");
    await expect(auth.login("operator", "x".repeat(1025), signal())).rejects.toMatchObject({ code: "denied" });
    expect(() => createLocalAuth(db, { origin: "http://example.com" })).toThrow("local-auth-unavailable");
    expect(() => createLocalAuth(db, { origin: "https://example.com/" })).toThrow("local-auth-unavailable");
  });

  test("HTTPS secure cookie and cancelled resolve/logout", async () => {
    const { db } = await fixture(); const auth = createLocalAuth(db, { origin: "https://operators.example" });
    await auth.create("operator", password);
    const logged = await auth.login("operator", password, signal());
    expect(logged.setCookie).toEndWith("; Secure");
    const controller = new AbortController(); controller.abort();
    expect(() => auth.resolve(request(), controller.signal)).toThrow("local-auth-cancelled");
    expect(() => auth.logout(request(), controller.signal)).toThrow("local-auth-cancelled");
    logged.identity.assertCurrent();
  });

  test("missing auth storage is a service failure even without a cookie", async () => {
    const { auth, db } = await fixture();
    db.database.exec("DROP TABLE login_limits");
    expect(() => auth.resolve(request(), signal())).toThrow("local-auth-unavailable");
    expect(() => auth.logout(request())).toThrow("local-auth-unavailable");
  });

  test("explicit persisted key/global/session/account capacities fail closed", async () => {
    const { auth, db } = await fixture(); await auth.create("operator", password);
    const time = 1_800_000_000_000;
    db.database.query("INSERT INTO login_limits(key,window_start,attempts) VALUES('global',?,?)").run(time, LOCAL_AUTH_LIMITS.globalAttempts);
    await expect(auth.login("unknown", password, signal())).rejects.toMatchObject({ code: "throttled" });
    db.database.exec("DELETE FROM login_limits");
    db.database.query(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<?)
      INSERT INTO login_limits(key,window_start,attempts) SELECT 'key:'||n,?,1 FROM seq`).run(LOCAL_AUTH_LIMITS.limitKeys, time);
    await expect(auth.login("unknown", password, signal())).rejects.toMatchObject({ code: "unavailable" });
    expect(db.database.query<{ n: number }, []>("SELECT count(*) AS n FROM login_limits").get()?.n).toBe(LOCAL_AUTH_LIMITS.limitKeys);
    db.database.exec("DELETE FROM login_limits");
    const other = await auth.create("other", password);
    db.database.query(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n+1<=?)
      INSERT INTO sessions(token_hash,actor_id,credential_generation,created_at,expires_at)
      SELECT printf('%064x',n),?,1,?,? FROM seq`).run(LOCAL_AUTH_LIMITS.sessions, other.actorId, time, time + LOCAL_AUTH_LIMITS.sessionMs);
    await expect(auth.login("operator", password, signal())).rejects.toMatchObject({ code: "unavailable" });
    expect(db.database.query<{ n: number }, []>("SELECT count(*) AS n FROM sessions").get()?.n).toBe(LOCAL_AUTH_LIMITS.sessions);
    db.database.query(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n+1<=?)
      INSERT INTO accounts(actor_id,username,password_hash,credential_generation,disabled,created_at)
      SELECT 'op_'||printf('%064x',n),'capacity_'||n,password_hash,1,1,created_at FROM seq,accounts WHERE username='operator'`)
      .run(LOCAL_AUTH_LIMITS.accounts - 2);
    await expect(auth.create("full", password)).rejects.toMatchObject({ code: "unavailable" });
    expect(db.database.query<{ n: number }, []>("SELECT count(*) AS n FROM accounts").get()?.n).toBe(LOCAL_AUTH_LIMITS.accounts);
  });
});

const cli = fileURLToPath(new URL("../scripts/o-account.ts", import.meta.url));
async function runCli(root: string, command: string, secret?: string, extra: string[] = []) {
  const child = spawn([process.execPath, cli, command, "--state-dir", root, "--username", "operator", ...extra], {
    stdin: new Blob([secret ?? ""]), stdout: "pipe", stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { exit, stdout, stderr };
}
describe("actual account CLI", () => {
  test("explicit stdin create/reset/disable, duplicates and oversized/argv/non-TTY secrets fail without disclosure", async () => {
    const root = await mkdtemp(join(tmpdir(), "o-account-test-")); roots.push(root);
    const first = await runCli(root, "create", password + "\n", ["--stdin-secret"]);
    expect(first.exit).toBe(0); expect(first.stdout + first.stderr).not.toContain(password);
    const duplicate = await runCli(root, "create", password, ["--stdin-secret"]);
    expect(duplicate.exit).toBe(1); expect(duplicate.stdout + duplicate.stderr).not.toContain(password);
    const reset = await runCli(root, "reset-password", otherPassword, ["--stdin-secret"]);
    expect(reset.exit).toBe(0);
    expect((await runCli(root, "disable")).exit).toBe(0);
    for (const [secret, args] of [[password, []], ["x".repeat(2000), ["--stdin-secret"]], [password, ["--password", password]]] as [string, string[]][]) {
      const result = await runCli(root, "create", secret, args);
      expect(result.exit).toBe(1); expect(result.stdout + result.stderr).not.toContain(secret);
      expect(result.stdout + result.stderr).not.toContain(root);
    }
    const db = await openRuntimeDatabase(root); connections.push(db);
    expect(db.database.query<{ disabled: number }, []>("SELECT disabled FROM accounts").get()?.disabled).toBe(1);
  });

  test("real PTY conceals password and restores terminal after success and Ctrl-C", async () => {
    const root = await mkdtemp(join(tmpdir(), "o-account-tty-")); roots.push(root);
    // The PTY child drives the actual CLI. No timing sleeps, echoes, server, or test-only production switch.
    const python = String.raw`
import os, pty, select, signal, subprocess, sys, termios
root, bun, cli = sys.argv[1:]
for mode in ('success', 'ctrl-c', 'sigterm', 'error'):
    cancel = mode != 'success'
    master, slave = pty.openpty()
    before = termios.tcgetattr(slave)
    p = subprocess.Popen([bun, cli, 'reset-password' if cancel else 'create', '--state-dir', root, '--username', 'operator'], stdin=slave, stdout=slave, stderr=slave, close_fds=True)
    data = b''
    while b'Password: ' not in data:
        assert select.select([master], [], [], 10)[0], 'prompt timeout'
        data += os.read(master, 4096)
    assert not termios.tcgetattr(slave)[3] & termios.ECHO, 'echo enabled'
    if mode == 'sigterm': p.send_signal(signal.SIGTERM)
    else: os.write(master, b'\x03' if mode == 'ctrl-c' else b'\x01' if mode == 'error' else b'correct horse battery staple\r')
    while b'Account operation ' not in data:
        if select.select([master], [], [], 10)[0]: data += os.read(master, 4096)
        else: p.kill(); raise AssertionError('completion timeout')
    try: p.wait(timeout=10)
    except subprocess.TimeoutExpired: p.kill(); p.wait(); raise AssertionError('exit timeout')
    while select.select([master], [], [], 0)[0]: data += os.read(master, 4096)
    assert b'correct horse battery staple' not in data, 'secret disclosed'
    assert p.returncode == (1 if cancel else 0), 'bad exit'
    assert termios.tcgetattr(slave) == before, 'terminal not restored'
    os.close(master); os.close(slave)
print('concealed and restored')
`;
    const child = spawn(["python3", "-c", python, root, process.execPath, cli], { stdout: "pipe", stderr: "pipe" });
    const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ exit, err }).toEqual({ exit: 0, err: "" });
    expect(out.trim()).toBe("concealed and restored");
  }, 25000);
});
