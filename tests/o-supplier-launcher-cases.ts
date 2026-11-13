import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "bun:sqlite";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { fixture, secret, loginCookie } from "./o-operational-fixtures.ts";
import { hConfiguration, supplierFixture } from "./o-supplier-fixture.ts";
import { parseHOperationalConfiguration } from "../src/o-operations-config.ts";
import { authTimeState, processTimeArguments, processTimeEnvironment, runWithProcessTime } from "./o-process-time.ts";

export function registerSupplierLauncherCases() {
  for (const mode of ["normal", "held"] as const) test(`H typed HTTP launcher SIGTERM ${mode} ${mode === "held" ? "exits nonzero with unknown reservation" : "drains before closing"}`, { timeout: 20000 }, async t => {
    if (await runWithProcessTime(t, new URL("./o-operational-suppliers.test.ts", import.meta.url).href)) return;
    const f = await fixture(t), config = parseHOperationalConfiguration({ ...hConfiguration(f.config), runnerTimeoutMs: 1000, requestTimeoutMs: 1500, shutdownGraceMs: 1800 });
    t.diagnostic(JSON.stringify({ stage: "parent seed", ...authTimeState(f.stateRoot), validFrom: config.validFrom, validUntil: config.validUntil }));
    const reservation = createServer();
    await new Promise<void>((done, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", done); });
    const address = reservation.address(); assert.ok(address && typeof address !== "string");
    await new Promise<void>((done, reject) => reservation.close(error => error ? reject(error) : done()));
    const environment = Object.fromEntries(Object.entries(processTimeEnvironment()).filter(([key]) => !key.startsWith("RESOURCE_") && !key.startsWith("AZURE_OPENAI_")));
    const child = spawn(process.execPath, [...processTimeArguments, fileURLToPath(new URL("./o-launcher-child.ts", import.meta.url)), `h-${mode}`, JSON.stringify(f.snapshot.input), JSON.stringify(config), f.root], {
      env: { ...environment, PORT: String(address.port), RESOURCE_MODEL_RUNNER: "operational", RESOURCE_APP_AUTH: "local-operator",
        RESOURCE_STATE_DIR: f.stateRoot, RESOURCE_RESOURCES_DIR: f.resourcesRoot }, stdio: ["ignore", "pipe", "pipe"],
    });
    const exited = once(child, "exit"), lines = createInterface({ input: child.stdout }), transported = Promise.withResolvers<void>();
    let diagnostic = ""; child.stderr.on("data", bytes => { diagnostic += String(bytes); });
    try {
      await Promise.race([new Promise<void>(done => lines.on("line", line => {
        if (line.startsWith("Re:Source app:")) done(); if (line === "transport") transported.resolve();
        if (line.startsWith("test-auth-time ")) t.diagnostic(line);
      })), exited.then(() => { throw new Error(diagnostic); })]);
      const url = `http://localhost:${address.port}`, started = performance.now();
      const signed = await fetch(url + "/login", { method: "POST", redirect: "manual", headers: { origin: url, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username: "operator", password: secret }) });
      const cookie = await loginCookie(signed, started);
      t.diagnostic(JSON.stringify({ stage: "child native login", ...authTimeState(f.stateRoot), elapsedMs: performance.now() - started, requestTimeoutMs: config.requestTimeoutMs }));
      const pending = fetch(url + f.path + "/answers", { method: "POST", redirect: "manual", headers: { origin: url, cookie, "content-type": "application/json" },
        body: JSON.stringify({ baseVersion: 1, patch: { massKg: f.snapshot.input.massKg } }) });
      let signalled: number;
      if (mode === "held") { await transported.promise; signalled = performance.now(); child.kill("SIGTERM"); await pending.catch(() => undefined); }
      else { assert.equal((await pending).status, 303); signalled = performance.now(); child.kill("SIGTERM"); }
      const [code] = await exited; assert.equal(code, mode === "held" ? 1 : 0, diagnostic);
      const shutdownMs = performance.now() - signalled;
      if (mode === "held") assert.ok(shutdownMs >= config.shutdownGraceMs, `grace=${config.shutdownGraceMs} elapsed=${shutdownMs}`);
      t.diagnostic(JSON.stringify({ mode, exit: code, shutdownMs, graceMs: config.shutdownGraceMs }));
      const ledger = new Database(join(f.root, "test-h", "ledger.sqlite"), { readonly: true });
      try {
        assert.equal(ledger.query<{ state: string }, []>("SELECT state FROM reservations").get()?.state, mode === "held" ? "unknown" : "consumed");
        const usage = ledger.query<{ usage: string }, []>("SELECT usage FROM settlements").get()?.usage;
        assert.equal(JSON.parse(usage ?? "null")?.total ?? null, mode === "held" ? null : 0);
      } finally { ledger.close(); }
      assert.equal(existsSync(join(f.stateRoot, "operations")), false);
      const supervisor = await supplierFixture(f.root);
      try { assert.equal((await supervisor.recover()).state, "empty"); } finally { supervisor.dispose(); }
    } finally { lines.close(); if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await exited; }
  });
}
