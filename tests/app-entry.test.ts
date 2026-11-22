import assert from "node:assert/strict";
import { test } from "node:test";
import { createSyntheticResourceApp as createResourceApp } from "./synthetic-runtime.ts";
import originals from "../data/evaluation/rubric-followup-20261121/conditional-alternatives/results.json" with { type: "json" };

test("home example link reaches a result without model execution", async () => {
  let calls = 0;
  const app = createResourceApp({
    origin: "http://localhost:3000",
    actorForRequest: async () => "example-user",
    runner: async () => { calls++; return {}; },
  });
  try {
    for (const path of ["/", "/cases"]) {
      let target: string | null = null;
      await new HTMLRewriter().on("a[data-example-start]", {
        element(element) { target = element.getAttribute("href"); },
      }).transform(await app.fetch(new Request("http://localhost:3000" + path))).text();
      assert.equal(target, "/demo/normal");
      const response = await app.fetch(new Request("http://localhost:3000" + target));
      assert.equal(response.status, 200);
      let summary = "";
      await new HTMLRewriter().on("#decision-summary", {
        text(chunk) { summary += chunk.text; },
      }).transform(response).text();
      assert.ok(summary.trim());
    }
    assert.equal(calls, 0);
  } finally { app.dispose(); }
});

test("current guidance and inquiry stay case-bound while commercial and other owners cannot receive research", async () => {
  let actor = "inquiry-owner";
  const origin = "http://localhost:3000";
  const app = createResourceApp({ origin, actorForRequest: async () => actor,
    runner: async () => ({}) });
  try {
    const { caseId: _id, ...input } = originals[0]!.input;
    const created = await app.fetch(new Request(origin + "/cases", {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(input),
    }));
    assert.equal(created.status, 303);
    const path = created.headers.get("location");
    assert.ok(path);
    const beforeInput = await (await app.fetch(new Request(origin + path + "/input"))).text();
    const counts = { stages: 0, permits: 0, acceptanceUnknown: 0, epd: 0 };
    const result = await app.fetch(new Request(origin + path));
    assert.equal(result.status, 200);
    const html = await new HTMLRewriter()
      .on("[data-guidance-stage]", { element() { counts.stages++; } })
      .on("[data-permit-listed]", { element() { counts.permits++; } })
      .on("[data-acceptance-unverified]", { element() { counts.acceptanceUnknown++; } })
      .on("[data-epd-reference]", { element() { counts.epd++; } })
      .transform(result).text();
    assert.deepEqual(counts, { stages: 6, permits: 4, acceptanceUnknown: 4, epd: 3 });
    assert.match(html, /id="rank-stability"/);
    const inquiry = await app.fetch(new Request(origin + path + "/inquiry?recipient=" + encodeURIComponent("<hostile&recipient>")));
    assert.equal(inquiry.status, 200);
    const inquiryHtml = await inquiry.text();
    assert.match(inquiryHtml, /data-inquiry-print/);
    assert.match(inquiryHtml, /&lt;hostile&amp;recipient&gt;/);
    assert.ok(inquiryHtml.includes(path.slice("/cases/".length)));
    assert.doesNotMatch(inquiryHtml, /data-epd-reference|data-public-scenario-result|id="rank-stability"/);
    assert.equal(await (await app.fetch(new Request(origin + path + "/input"))).text(), beforeInput);
    const commercial = await (await app.fetch(new Request(origin + path + "/report"))).text();
    const publicStages: (string | null)[] = [];
    await new HTMLRewriter().on('[data-progress-audience="public"] [data-guidance-stage]', {
      element(element) { publicStages.push(element.getAttribute("data-guidance-stage")); },
    }).transform(new Response(commercial)).text();
    assert.deepEqual(publicStages, ["1", "2", "3", "4", "5", "6"]);
    assert.doesNotMatch(commercial, /data-epd-reference|data-public-scenario-result|data-research-result|id="rank-stability"/);
    actor = "other-owner";
    const denied = await app.fetch(new Request(origin + path + "/inquiry"));
    assert.equal(denied.status, 404);
  } finally { app.dispose(); }
});
