import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ModelRuntime } from "@code-yeongyu/senpi";
import { openRuntimeDatabase } from "../src/o-runtime-db.ts";
import { createCaseStore } from "../src/o-case-store.ts";
import { createLocalAuth } from "../src/o-auth.ts";
import { createOperationalApp } from "../src/operations.ts";
import { parseOperationalConfiguration } from "../src/o-operations-config.ts";
import { syntheticCase } from "./h-fixtures.ts";
import { revision } from "../src/o-validation.ts";
import { configuration } from "./o-operations-fixtures.ts";
import { decideCase } from "../src/assessment.ts";

export const origin = "http://localhost:3000", secret = "synthetic-only password";
export const signal = () => new AbortController().signal;
export const post = (path: string, cookie: string, body: unknown) => new Request(origin + path, { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
export async function loginCookie(result: Response, started: number) {
  const cookie = result.headers.get("set-cookie")?.split(";")[0];
  let diagnostic = "";
  if (result.status !== 303 || !cookie) {
    const elapsedMs = Math.round(performance.now() - started);
    let body = (await result.text()).replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ");
    for (const value of [secret, encodeURIComponent(secret), "synthetic-refresh", cookie, cookie?.slice(cookie.indexOf("=") + 1)]) {
      if (value) body = body.split(value).join("[redacted]");
    }
    body = body.replace(/\b(?:Bearer\s+\S+|[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|[a-f0-9]{64})\b/gi, "[redacted]")
      .replace(/\b(?:password|credential|authorization|cookie|access[_-]?token|refresh[_-]?token)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "[redacted]")
      .replace(/\s+/g, " ").trim().slice(0, 500);
    diagnostic = `login status=${result.status} elapsedMs=${elapsedMs} body=${JSON.stringify(body)}`;
  }
  assert.equal(result.status, 303, diagnostic); assert.ok(cookie, diagnostic); return cookie;
}
export async function login(app: { fetch(request: Request): Promise<Response> }) {
  const started = performance.now();
  const result = await app.fetch(new Request(origin + "/login", { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username: "operator", password: secret }) }));
  return loginCookie(result, started);
}
export async function fixture(t: { after(fn: () => unknown): void }) {
  const root = await mkdtemp(join(tmpdir(), "o-assembly-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateRoot = join(root, "state"), resourcesRoot = join(root, "resources"), authPath = join(root, "synthetic-auth.json");
  let db: Awaited<ReturnType<typeof openRuntimeDatabase>> | undefined;
  let cases: ReturnType<typeof createCaseStore> | undefined, local: ReturnType<typeof createOperationalApp> | undefined;
  try {
    await mkdir(resourcesRoot, { mode: 0o700 });
    const sdk = await ModelRuntime.create({ authPath, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    assert.ok(sdk.authStorage);
    const token = "synthetic." + Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "synthetic-account" } })).toString("base64url") + ".signature";
    sdk.authStorage.set("chatgpt-subscription", { type: "oauth", access: token, refresh: "synthetic-refresh", expires: Date.now() + 3600000 });
    await chmod(authPath, 0o600);
    db = await openRuntimeDatabase(stateRoot); cases = createCaseStore(Date.now, undefined, db);
    const auth = createLocalAuth(db, { origin }), actor = await auth.create("operator", secret);
    local = createOperationalApp({ origin, localAuth: auth, caseStore: cases, presentationMode: "synthetic" });
    const cookie = await login(local), { caseId: _id, ...fields } = syntheticCase;
    const created = await local.fetch(post("/cases", cookie, fields)); assert.equal(created.status, 303);
    const path = created.headers.get("location"); assert.ok(path);
    const snapshot = cases.read(`actor:${actor.actorId}`, path.slice(7)); assert.ok(snapshot);
    const config = parseOperationalConfiguration({ ...configuration(authPath), target: { ...configuration(authPath).target, accountIdSha256: createHash("sha256").update("synthetic-account").digest("hex") },
      grants: [{ actorId: actor.actorId, caseId: snapshot.input.caseId, inputRevision: revision(snapshot.input), artifactSha256: null }] });
    return { root, stateRoot, resourcesRoot, config, snapshot, path, actor };
  } finally {
    try { if (local) { local.dispose(); await local.close(); } }
    finally { try { cases?.dispose(); } finally { db?.close(); } }
  }
}
export function response(input: typeof syntheticCase) {
  const item = { type: "message", id: "msg_synthetic", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(decideCase(input)), annotations: [] }] };
  return new Response([{ type: "response.output_item.done", output_index: 0, item }, { type: "response.completed", response: { id: "resp_synthetic", status: "completed", output: [item], usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } } }]
    .map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream", "x-request-id": "observed-synthetic-request" } });
}
