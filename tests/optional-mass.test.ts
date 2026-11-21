import { test } from "node:test";
import assert from "node:assert/strict";
import { createResourceDomain } from "../src/domain.ts";
import { massQuestion } from "../src/input.ts";
import { renderReport } from "../src/report.ts";
import { createResourceApp } from "../src/session.ts";

const origin = "http://localhost:3000";
const baseFields = {
  description: "QA 재현", process: "사출", contamination: "없음", hazardousContact: "yes" as const,
  region: "울산", assessmentDate: "2026-11-25",
};
const post = (path: string, cookie: string, body: string, contentType = "application/json") =>
  new Request(origin + path, { method: "POST", headers: { cookie, origin, "content-type": contentType }, body });

async function heldDecision(polymer: string, massKg: number | null, hazardousContact: "yes" | "no") {
  const decision = await createResourceDomain({ caseId: `issue109-${polymer}-${massKg ?? "null"}`,
    ...baseFields, photoRefs: [], polymer, massKg, hazardousContact }).decide();
  assert.equal(decision.state, "needs-review");
  if (decision.state !== "needs-review") assert.fail("issue input must remain under review");
  return decision;
}

test("issue #109 keeps held reasons unchanged when optional mass is added", async () => {
  for (const [polymer, hazardousContact] of [["PP", "yes"], ["PVC", "no"]] as const) {
    const missing = await heldDecision(polymer, null, hazardousContact);
    const supplied = await heldDecision(polymer, 100, hazardousContact);
    assert.deepEqual(missing.reasons, supplied.reasons);
    assert.ok(missing.reasons.length > 0);
    assert.ok(!missing.reasons.includes(massQuestion));
    assert.ok(!supplied.reasons.includes(massQuestion));
    assert.equal(renderReport(missing, { mode: "offline" }).includes(massQuestion), false);
    assert.equal(renderReport(supplied, { mode: "offline" }).includes(massQuestion), false);
    const legacy = { ...missing, reasons: [...missing.reasons, massQuestion] };
    assert.equal(renderReport(legacy, { mode: "offline" }).includes(massQuestion), false);
    assert.ok(legacy.reasons.includes(massQuestion));
  }
});

test("issue #109 editable native held page offers mass separately without releasing hold", async () => {
  for (const [polymer, hazardousContact] of [["PP", "yes"], ["PVC", "no"]] as const) {
    const app = createResourceApp({ origin });
    try {
      const landing = await app.fetch(new Request(origin));
      const cookie = landing.headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookie);
      const input = new URLSearchParams({ ...baseFields, photoRefs: "", polymer, hazardousContact, massKg: "" }).toString();
      const created = await app.fetch(post("/cases", cookie, input, "application/x-www-form-urlencoded"));
      assert.equal(created.status, 303);
      const path = created.headers.get("location");
      assert.ok(path);
      const page = await app.fetch(new Request(origin + path, { headers: { cookie } }));
      const html = await page.text();
      assert.equal(page.status, 200);
      assert.equal(html.includes(massQuestion), false);
      assert.match(html, /href="#answer-fields">선택 정보: 질량을 입력할 수 있습니다/);
      assert.match(html, /질량 입력은 선택 사항이며 보류 사유를 해제하거나 비용·탄소 계산을 보장하지 않습니다/);
      const order: string[] = [];
      await new HTMLRewriter()
        .on("#case-reasons", { element() { order.push("reasons"); } })
        .on('a.secondary-action[href="#answer-fields"]', { element() { order.push("optional-mass"); } })
        .transform(new Response(html)).text();
      assert.deepEqual(order, ["reasons", "optional-mass"]);

      const saved = await app.fetch(post(path + "/answers", cookie, '{"massKg":100}'));
      assert.equal(saved.status, 303);
      const supplied = await app.fetch(new Request(origin + path, { headers: { cookie } }));
      const suppliedHtml = await supplied.text();
      assert.equal(supplied.status, 200);
      assert.doesNotMatch(suppliedHtml, /선택 정보: 질량을 입력할 수 있습니다/);
      assert.match(suppliedHtml, /검토 필요 · 실행 보류/);
      const reasons = (value: string) => value.match(/<section id="case-reasons">([\s\S]*?)<\/section>/)?.[1];
      assert.ok(reasons(html));
      assert.equal(reasons(html), reasons(suppliedHtml));
    } finally {
      await app.close();
    }
  }
});
