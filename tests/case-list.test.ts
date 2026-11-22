import assert from "node:assert/strict";
import { test } from "node:test";
import { caseListPage } from "../src/app-views.ts";
import type { CaseListRow } from "../src/app-views.ts";
import { createApp } from "../src/app.ts";
import { createResourceDomain } from "../src/domain.ts";
import { createSyntheticAssessmentAdapter } from "./synthetic-runtime.ts";

const deadline = Date.parse("2026-11-25T15:29:30.123Z");
const rows: readonly CaseListRow[] = [
  { caseId: "recommended", title: "<추천 & 사례>", deadline, state: "compared" },
  { caseId: "information", title: "질문 사례", deadline, state: "needs-information" },
  { caseId: "held", title: "보류 사례", deadline, state: "needs-review" },
  { caseId: "unknown/id", title: "상태 미상 사례", deadline, state: "unknown" },
];

async function inspect(html: string) {
  const ids: (string | null)[] = [], links: (string | null)[] = [], selected: (string | null)[] = [];
  const counts: string[] = [], headers: (string | null)[] = [], times: (string | null)[] = [];
  const displayed: string[] = [];
  const cells: (string | null)[] = [], tables: (string | null)[] = [];
  await new HTMLRewriter()
    .on(".case-table", { element(el) { tables.push(el.getAttribute("role")); } })
    .on(".case-table th", { element(el) { headers.push(el.getAttribute("scope")); } })
    .on(".case-table tbody tr", { element(el) { ids.push(el.getAttribute("data-case-id")); } })
    .on(".case-table td", { element(el) { cells.push(el.getAttribute("headers")); } })
    .on(".case-list a", { element(el) { links.push(el.getAttribute("href")); } })
    .on('.case-filters a[aria-current="page"]', { element(el) { selected.push(el.getAttribute("data-status")); } })
    .on(".case-counts strong", { element() { counts.push(""); }, text(chunk) { counts[counts.length - 1] += chunk.text; } })
    .on(".case-table time", { element(el) { times.push(el.getAttribute("datetime")); displayed.push(""); },
      text(chunk) { displayed[displayed.length - 1] += chunk.text; } })
    .transform(new Response(html)).text();
  return { ids, links, selected, counts, headers, times, displayed, cells, tables };
}

for (const [status, ids] of [
  [null, ["recommended", "information", "held", "unknown/id"]],
  ["all", ["recommended", "information", "held", "unknown/id"]],
  ["compared", ["recommended"]],
  ["needs-information", ["information"]],
  ["needs-review", ["held"]],
  ["unknown", ["recommended", "information", "held", "unknown/id"]],
  ["<invalid>", ["recommended", "information", "held", "unknown/id"]],
] as const) {
  test(`case status ${status} selects rows while counts retain all owned cases`, async () => {
    const html = caseListPage(rows, false, { deadlineLabel: "열람 기한", status });
    const result = await inspect(html);
    assert.deepEqual(result.ids, ids);
    assert.deepEqual(result.counts, ["4", "1", "1", "1"]);
    assert.deepEqual(result.selected, [status && ["compared", "needs-information", "needs-review"].includes(status) ? status : "all"]);
    assert.deepEqual(result.links, ids.flatMap(id => [`/cases/${encodeURIComponent(id)}`, `/cases/${encodeURIComponent(id)}/report`]));
  });
}

test("case table keeps exact deadlines and displays the Korean date after midnight without a version column", async () => {
  const html = caseListPage(rows, true, { deadlineLabel: "보관 기한", status: null });
  const result = await inspect(html);
  assert.deepEqual(result.tables, ["table"]);
  assert.deepEqual(result.headers, Array.from({ length: 4 }, () => "col"));
  assert.deepEqual(result.cells, rows.flatMap(() => ["case-title", "case-status", "case-deadline", "case-actions"]));
  assert.deepEqual(result.times, rows.map(() => "2026-11-25T15:29:30.123Z"));
  assert.deepEqual(result.displayed, rows.map(() => "11월 26일 00:29까지"));
  assert.ok(html.includes("&lt;추천 &amp; 사례&gt;"));
  assert.ok(html.includes('action="/logout"'));
  assert.ok(html.includes('data-label="보관 기한"'));
});

test("empty store and empty filtered result retain the filter navigation", async () => {
  for (const supplied of [[], rows.filter(row => row.state === "unknown")]) {
    const html = caseListPage(supplied, false, { deadlineLabel: "열람 기한", status: "compared" });
    const result = await inspect(html);
    assert.deepEqual(result.tables, []);
    assert.deepEqual(result.counts, [String(supplied.length), "0", "0", "0"]);
    assert.deepEqual(result.selected, ["compared"]);
    assert.ok(html.includes('class="case-empty"'));
  }
});

test("GET cases applies native filter links and retains decision status after report viewing", async t => {
  const origin = "http://localhost:3000";
  const adapter = createSyntheticAssessmentAdapter();
  const app = createApp({ origin, now: () => Date.UTC(2026, 10, 25), preparer: {
    prepareSubmit: adapter.prepareSubmit,
    prepareAnswer: adapter.prepareAnswer,
    async evaluate(input) { return { decision: await createResourceDomain(input).decide() }; },
  } });
  t.after(async () => { app.dispose(); await app.settled(); adapter.dispose(); });
  const home = await app(new Request(origin));
  const cookie = home.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  const created = await app(new Request(origin + "/cases", { method: "POST", headers: { origin, cookie },
    body: new URLSearchParams({ description: "합성 사출 용기 파쇄품", process: "사출", polymer: "PET",
      contamination: "없음", hazardousContact: "no", massKg: "100", region: "", assessmentDate: "2026-11-25" }) }));
  assert.equal(created.status, 303);
  const path = created.headers.get("location");
  assert.ok(path);
  const get = (path: string) => app(new Request(origin + path, { headers: { cookie } }));
  assert.equal((await get(path + "/report")).status, 200);
  const initial = await get("/cases?status=needs-information");
  assert.equal(initial.status, 200);
  const initialHtml = await initial.text();
  assert.deepEqual((await inspect(initialHtml)).ids, [path.slice("/cases/".length)]);
  const filterPaths: (string | null)[] = [];
  await new HTMLRewriter().on(".case-filters a", { element(el) { filterPaths.push(el.getAttribute("href")); } })
    .transform(new Response(initialHtml)).text();
  assert.deepEqual(filterPaths, ["/cases", "/cases?status=compared", "/cases?status=needs-information", "/cases?status=needs-review"]);
  for (const filterPath of filterPaths) {
    assert.ok(filterPath);
    const response = await get(filterPath);
    assert.equal(response.status, 200);
    const result = await inspect(await response.text());
    assert.deepEqual(result.ids, filterPath === "/cases" || filterPath.endsWith("needs-information") ? [path.slice("/cases/".length)] : []);
    assert.deepEqual(result.counts, ["1", "0", "1", "0"]);
  }
});
