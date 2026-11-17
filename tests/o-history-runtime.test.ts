import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, symlink, truncate, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createMemoryRuntimeDatabase } from "../src/o-runtime-db.ts";
import { createLocalAuth } from "../src/o-auth.ts";
import { receiveHistory } from "../src/o-history.ts";
import { HISTORY_PACKAGE_BYTES } from "../src/o-history-schema.ts";
import { syntheticDocuments, syntheticHistory } from "./o-history-fixture.ts";
import { historyConfiguration, loadHistoryMount } from "../src/o-history-runtime.ts";

const actorId = "op_" + "a".repeat(64);
const settings = (path = "/private/archive.json", actor = actorId) => ({ RESOURCE_HISTORY_ARTIFACT: path,
  RESOURCE_HISTORY_READER_ACTOR_ID: actor, RESOURCE_APP_AUTH: "local-operator", RESOURCE_MODEL_RUNNER: "local" });
test("configuration requires paired canonical private path/current actor and explicit local modes", () => {
  assert.equal(historyConfiguration({}), undefined);
  assert.equal(historyConfiguration({ RESOURCE_MODEL_RUNNER: "azure" }), undefined);
  const valid = historyConfiguration(settings());
  assert.deepEqual(valid, { artifactPath: "/private/archive.json", readerActorId: actorId });
  assert.ok(Object.isFrozen(valid));
  for (const bad of [
    { RESOURCE_HISTORY_ARTIFACT: "/private/archive.json" }, { RESOURCE_HISTORY_READER_ACTOR_ID: actorId },
    settings(""), settings("relative"), settings("/private/../archive.json"), settings("/private/archive.json", ""),
    settings("/private/archive.json", "synthetic-shared-historical-actor"),
    { ...settings(), RESOURCE_APP_AUTH: "anonymous" }, { ...settings(), RESOURCE_APP_AUTH: undefined },
    ...["subscription", "azure", "operational", undefined].map(mode => ({ ...settings(), RESOURCE_MODEL_RUNNER: mode })),
  ]) assert.throws(() => historyConfiguration(bad), /^HistoryRuntimeError: history-configuration$/);
});
async function fixture(t: { after(fn: () => unknown): void }) {
  const directory = await mkdtemp(join(tmpdir(), "o-history-mount-")), path = join(directory, "archive.json");
  const runtime = createMemoryRuntimeDatabase(), auth = createLocalAuth(runtime, { origin: "http://localhost:3000" });
  const reader = await auth.create("history-reader", "synthetic history password");
  const docs = syntheticDocuments(), artifact = receiveHistory(docs.commentBytes, docs.evidenceBytes);
  await writeFile(path, JSON.stringify(artifact), { mode: 0o600 });
  t.after(async () => { runtime.close(); await rm(directory, { recursive: true, force: true }); });
  const config = historyConfiguration(settings(path, reader.actorId)); assert.ok(config);
  return { directory, path, runtime, auth, reader, config, artifact };
}
test("startup only reads existing enabled account ID and freezes accepted package until restart", async t => {
  const f = await fixture(t);
  const before = f.runtime.database.serialize();
  const mount = loadHistoryMount(f.config, f.runtime); assert.ok(mount);
  assert.deepEqual(f.runtime.database.serialize(), before);
  assert.equal(mount.readerActorId, f.reader.actorId);
  assert.notEqual(mount.readerActorId, mount.archive.evidence.cases[0]?.actorId);
  assert.ok(Object.isFrozen(mount)); assert.ok(Object.isFrozen(mount.archive.evidence.cases));
  const evidence = syntheticHistory(); evidence.limitations.push("Synthetic replacement after restart only.");
  const replacement = syntheticDocuments(evidence);
  await writeFile(f.path, JSON.stringify(receiveHistory(replacement.commentBytes, replacement.evidenceBytes)));
  assert.equal(mount.archive.evidence.limitations.includes("Synthetic replacement after restart only."), false);
  assert.equal(loadHistoryMount(f.config, f.runtime)?.archive.evidence.limitations.includes("Synthetic replacement after restart only."), true);
  assert.equal(loadHistoryMount(undefined, f.runtime), undefined);
});
test("unknown or disabled reader fails closed without creating any rows", async t => {
  const f = await fixture(t);
  assert.throws(() => loadHistoryMount({ ...f.config, readerActorId: actorId }, f.runtime), /history-unavailable/);
  f.auth.disable("history-reader");
  const before = f.runtime.database.serialize();
  assert.throws(() => loadHistoryMount(f.config, f.runtime), /history-unavailable/);
  assert.deepEqual(f.runtime.database.serialize(), before);
});
for (const fault of ["malformed", "corrupt", "public", "parent", "symlink", "oversize", "utf8"] as const) {
  test(`startup rejects ${fault} archive with redacted error`, async t => {
    const f = await fixture(t);
    switch (fault) {
      case "malformed": await writeFile(f.path, "PRIVATE-SENTINEL"); break;
      case "corrupt": await writeFile(f.path, JSON.stringify({ ...f.artifact, sha256: "0".repeat(64) })); break;
      case "public": await chmod(f.path, 0o644); break;
      case "parent": await chmod(f.directory, 0o755); break;
      case "symlink": await rm(f.path); await symlink(join(f.directory, "absent"), f.path); break;
      case "oversize": await truncate(f.path, HISTORY_PACKAGE_BYTES + 1); break;
      case "utf8": await writeFile(f.path, Buffer.from([0xff])); break;
    }
    assert.throws(() => loadHistoryMount(f.config, f.runtime), /^HistoryRuntimeError: history-unavailable$/);
  });
}

test("native launcher rejects incompatible history settings before opening current runtime storage", { timeout: 30000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "o-history-config-launcher-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const execute = promisify(execFile), script = fileURLToPath(new URL("../scripts/app.ts", import.meta.url));
  for (const mode of ["azure", "subscription", "operational"]) {
    const state = join(directory, mode);
    await assert.rejects(execute(process.execPath, [script], { cwd: directory, timeout: 10000,
      env: { ...process.env, ...settings(join(directory, "PRIVATE-SENTINEL.json")), RESOURCE_MODEL_RUNNER: mode,
        RESOURCE_STATE_DIR: state } }), error => {
      assert.ok(error instanceof Error && "stderr" in error && "stdout" in error && "code" in error);
      assert.equal(error.code, 1); assert.equal(error.stdout, "");
      assert.equal(error.stderr, "Re:Source startup failed; check explicit runtime configuration and private storage.\n");
      return true;
    });
    const { existsSync } = await import("node:fs"); assert.equal(existsSync(state), false);
  }
});
