import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { startApp } from "../../../scripts/app.ts";
import { providerRequestId } from "../../../src/session.ts";

const authPath = process.env["RESOURCE_AUTH_PATH"];
const ledger = process.env["RESOURCE_UI_CALL_LEDGER"];
assert.ok(authPath && ledger, "Explicit isolated auth and call ledger are required");
assert.equal(process.env["RESOURCE_MODEL_RUNNER"], "subscription");
const credential = JSON.parse(readFileSync(authPath, "utf8"))["chatgpt-subscription"];
assert.equal(credential.type, "oauth");
assert.equal(credential.accounts, undefined);
assert.ok(credential.expires > Date.now() + 300000);
const identity = JSON.parse(Buffer.from(credential.access.split(".")[1], "base64url").toString())["https://api.openai.com/auth"]?.chatgpt_account_id;
assert.equal(typeof identity, "string");
const identitySha256 = createHash("sha256").update(identity).digest("hex");
assert.equal(identitySha256, "59d94fb21f184353729aae918be1eb6dfacb1fbcc202c2e04472b0ec130f2610");
const prior = existsSync(ledger) ? readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
let calls = prior.filter(row => row.event === "dispatch").length;
assert.ok(calls <= 10);
console.log(`UI_CALL_BUDGET used=${calls} limit=10 account=login-4`);
await startApp({
  transport: async (url, init) => {
    const request = new Request(url, { ...init, redirect: "error" });
    assert.equal(request.url, "https://chatgpt.com/backend-api/codex/responses");
    assert.equal(request.headers.get("chatgpt-account-id"), identity);
    assert.equal(request.headers.get("authorization"), `Bearer ${credential.access}`);
    if (calls >= 10) throw new Error("Approved live UI call limit reached");
    const call = ++calls;
    appendFileSync(ledger, JSON.stringify({ event: "dispatch", call, at: new Date().toISOString(),
      account: "sanghyeob", slot: "login-4", identitySha256 }) + "\n");
    console.log(`UI_DISPATCH ${call} login-4`);
    const response = await fetch(request);
    const receipt = { event: "response", call, at: new Date().toISOString(),
      status: response.status, requestId: providerRequestId(response.headers) };
    appendFileSync(ledger, JSON.stringify(receipt) + "\n");
    console.log(JSON.stringify(receipt));
    return response;
  },
});
