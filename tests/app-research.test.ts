import assert from "node:assert/strict";
import { test } from "node:test";
import { createResourceApp } from "../src/session.ts";
import { createCaseStore } from "../src/o-case-store.ts";
import type { CaseArtifact } from "../src/o-case-artifact.ts";
import { prepareResearchCaseRecord, readCaseResearchCatalog } from "../src/o-case-research.ts";
import { revision } from "../src/o-validation.ts";

const origin = "http://localhost:3000";
const catalog = readCaseResearchCatalog();
const post = (path: string, raw: unknown) => new Request(origin + path, {
  method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(raw),
});
test("committed research uses one atomic report read and only explicit private report includes it", async () => {
  // Given a real stored case, then an installed artifact awaiting explicit reevaluation.
  const data = await catalog;
  const source = data.calculations.data.cases[0];
  assert.ok(source);
  const store = createCaseStore();
  let staged: CaseArtifact | null = null;
  let reads = 0;
  let enabled = true;
  const modelInputs: unknown[] = [];
  const app = createResourceApp({ origin, actorForRequest: async () => enabled ? "ui-private-actor" : null,
    runtime: { identity: "trusted", storage: "ephemeral", runner: "local" }, presentationMode: "offline",
    caseStore: { ...store, read: () => { throw new Error("split snapshot read is forbidden"); },
      readReport: (owner, id) => { reads++; return store.readReport(owner, id); } },
    resources: () => { store.stageResources(staged); return {}; },
    runner: async (input, _signal, resources) => { modelInputs.push({ input, resources }); return {}; },
  });
  try {
    const { caseId: _originalId, ...raw } = source.original;
    const submitted = await app.fetch(post("/cases", raw));
    assert.equal(submitted.status, 303);
    const path = submitted.headers.get("location");
    assert.ok(path);
    const id = path.slice("/cases/".length);
    const initial = store.read("actor:ui-private-actor", id);
    assert.ok(initial);
    staged = await prepareResearchCaseRecord({ actorId: "ui-private-actor", input: initial.input,
      inputRevision: revision(initial.input), codeRevision: "a".repeat(40), signal: new AbortController().signal }, "OYS-20261110-001", data);
    const before = await (await app.fetch(new Request(origin + path))).text();
    assert.doesNotMatch(before, /data-research-result/);
    const reevaluated = await app.fetch(post(path + "/answers", { baseVersion: initial.version, patch: { description: initial.input.description } }));
    assert.equal(reevaluated.status, 303);
    // When GET renders the committed pair through each output audience.
    reads = 0;
    const normal = await (await app.fetch(new Request(origin + path))).text();
    assert.equal(reads, 1);
    const commercial = await (await app.fetch(new Request(origin + path + "/report"))).text();
    const research = await (await app.fetch(new Request(origin + path + "/report?purpose=research"))).text();
    const exported = await app.fetch(new Request(origin + path + "/input"));
    // Then commercial bytes and model inputs never receive the attachment.
    assert.match(normal, /data-research-result/);
    assert.match(research, /data-research-result/);
    assert.doesNotMatch(commercial, /data-research-result|data-directory-row|WARM|Wonju|-13867|-27\.51/);
    assert.doesNotMatch(commercial, /<form\b/);
    assert.deepEqual(await exported.json(), initial.input);
    assert.doesNotMatch(JSON.stringify(modelInputs), /research|WARM|Wonju|net_carbon_kgco2e/);
    assert.ok(normal.indexOf("기계적 재활용 추천") < normal.indexOf("data-research-result"));
    assert.ok(normal.indexOf("확신도:") < normal.indexOf("data-research-result"));
    assert.ok(normal.indexOf("data-directory-row") < normal.indexOf('id="checks"'));
    enabled = false;
    assert.equal((await app.fetch(new Request(origin + path + "/report?purpose=research"))).status, 403);
  } finally { app.dispose(); await app.close(); store.dispose(); }
});

test("anonymous session cannot opt into research purpose", async () => {
  // Given the ordinary anonymous local app.
  const app = createResourceApp({ origin });
  try {
    const home = await app.fetch(new Request(origin));
    const cookie = home.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    // When research is requested, even an existing session cannot opt in.
    const response = await app.fetch(new Request(origin + "/cases/unknown/report?purpose=research", { headers: { cookie } }));
    assert.equal(response.status, 403);
    assert.doesNotMatch(await response.text(), /data-research-result/);
  } finally { app.dispose(); await app.close(); }
});
