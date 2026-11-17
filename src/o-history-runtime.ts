import { isAbsolute, resolve } from "node:path";
import { readPrivateArtifact } from "./o-artifact-target.ts";
import { acceptHistoryPackage } from "./o-history.ts";
import { HISTORY_PACKAGE_BYTES } from "./o-history-schema.ts";
import { historyText, parseHistoryJson } from "./o-history-validation.ts";
import type { HistoryMount } from "./app-types.ts";
import type { RuntimeDatabase } from "./o-runtime-db.ts";

export interface HistoryConfiguration {
  readonly artifactPath: string;
  readonly readerActorId: string;
}
export class HistoryRuntimeError extends Error {
  readonly name = "HistoryRuntimeError";
  constructor(readonly code: "configuration" | "unavailable") { super("history-" + code); }
}
/** Run before constructing any provider or operational runtime. Absence preserves existing defaults. */
export function historyConfiguration(env: Readonly<Record<string, string | undefined>>): HistoryConfiguration | undefined {
  const artifactPath = env["RESOURCE_HISTORY_ARTIFACT"], readerActorId = env["RESOURCE_HISTORY_READER_ACTOR_ID"];
  if (artifactPath === undefined && readerActorId === undefined) return undefined;
  if (!artifactPath || !isAbsolute(artifactPath) || resolve(artifactPath) !== artifactPath
    || !readerActorId || !/^op_[a-f0-9]{64}$/.test(readerActorId)
    || env["RESOURCE_APP_AUTH"] !== "local-operator" || env["RESOURCE_MODEL_RUNNER"] !== "local") throw new HistoryRuntimeError("configuration");
  return Object.freeze({ artifactPath, readerActorId });
}
/** Startup boundary: one bounded read, full acceptance, no import into current storage. */
export function loadHistoryMount(configuration: HistoryConfiguration | undefined, runtime: RuntimeDatabase): HistoryMount | undefined {
  if (!configuration) return undefined;
  try {
    runtime.assertReady();
    const reader = runtime.database.query<{ readonly actor_id: string }, [string]>(
      "SELECT actor_id FROM accounts WHERE actor_id=? AND disabled=0").get(configuration.readerActorId);
    if (!reader || reader.actor_id !== configuration.readerActorId) throw new HistoryRuntimeError("unavailable");
    const bytes = readPrivateArtifact(configuration.artifactPath, HISTORY_PACKAGE_BYTES);
    const archive = acceptHistoryPackage(parseHistoryJson(historyText(bytes, HISTORY_PACKAGE_BYTES)));
    return Object.freeze({ readerActorId: reader.actor_id, archive });
  } catch { // Startup trust boundary: paths, account IDs and package contents stay private.
    throw new HistoryRuntimeError("unavailable");
  }
}
