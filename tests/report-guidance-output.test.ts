import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaseInput } from "../src/contracts.ts";
import { readCaseResearchCatalog } from "../src/o-case-research.ts";
import { buildPublicInputScenario, publicScenarioEligibility } from "../src/o-input-public-scenario.ts";
import { buildCaseGuidance } from "../src/o-case-guidance.ts";
import { createResourceDomain } from "../src/domain.ts";
import { revision } from "../src/o-validation.ts";
import { renderReport } from "../src/report.ts";
import type { ReportPresentation } from "../src/report.ts";
import { publicRecyclingDirectory } from "../src/report-research.ts";
import { readableReason } from "../src/report-evidence.ts";
import directory from "../data/reference/public-recycling-candidates-20261121.json" with { type: "json" };

const catalog = readCaseResearchCatalog();
test("configured runners and synthetic traces are not displayed as recorded model execution", async () => {
  const source = (await catalog).calculations.data.cases[0];
  assert.ok(source);
  const decision = await createResourceDomain(source.original).decide();
  const guidance = await buildCaseGuidance(source.original, decision);
  const contexts: readonly (readonly [ReportPresentation, string])[] = [
    [{ mode: "live", runtime: { identity: "trusted", storage: "ephemeral", runner: "azure" } }, "none"],
    [{ mode: "live", execution: { traceId: "recorded-trace", usage: null } }, "trace"],
    [{ mode: "synthetic", execution: { traceId: "injected-trace", usage: null } }, "no-model"],
    [{ mode: "live", runtime: { identity: "trusted", storage: "ephemeral", runner: "local" },
      execution: { traceId: "local-trace", usage: null } }, "no-model"],
    [{ mode: "recording", execution: { traceId: "past-trace", usage: null } }, "recording"],
  ];
  for (const [presentation, expected] of contexts) {
    let state: string | null = null;
    await new HTMLRewriter().on("[data-model-execution]", {
      element(element) { state = element.getAttribute("data-model-execution"); },
    }).transform(new Response(renderReport(decision, presentation, {
      audience: "authenticated-research", research: null, guidance,
    }))).text();
    assert.equal(state, expected);
  }
});

test("held case retains its own required evidence and cannot display numerical sensitivity", async () => {
  const data = await catalog, source = data.calculations.data.cases[0];
  assert.ok(source);
  const input = { ...source.original, hazardousContact: "yes" as const };
  const decision = await createResourceDomain(input).decide();
  const publicScenario = buildPublicInputScenario({ actorId: "view-owner", input, inputRevision: revision(input) }, data);
  assert.ok(publicScenario);
  const guidance = await buildCaseGuidance(input, decision, { publicScenario });
  let reasons = "", sensitivityCells = 0;
  await new HTMLRewriter().on("[data-priority-unavailable] li", {
    text(chunk) { reasons += chunk.text; },
  }).on("[data-sensitivity-cell]", { element() { sensitivityCells++; } })
    .transform(new Response(renderReport(decision, { mode: "offline" }, {
      audience: "authenticated-research", research: null, publicScenario, guidance,
    }))).text();
  for (const required of guidance.actualComparison.regulatoryConditions) assert.ok(reasons.includes(readableReason(required)));
  assert.equal(sensitivityCells, 0);
});

test("province text matches neither infer ambiguous Gwangju nor conflate Gyeonggi Gwangju", async () => {
  for (const [region, expected] of [["광주광역시 북구", "same"], ["경기도 광주시", "different"], ["광주", "unknown"], [null, "unknown"]] as const) {
    const states: (string | null)[] = [];
    await new HTMLRewriter().on("[data-recycling-directory-row] [data-region-comparison]", {
      element(element) { states.push(element.getAttribute("data-region-comparison")); },
    }).transform(new Response(publicRecyclingDirectory(undefined, region))).text();
    assert.equal(states.length, directory.rows.length);
    assert.deepEqual([...new Set(states)], [expected]);
  }
});

test("the current private result shows nine sensitivity cells while the commercial result omits them", async () => {
  const data = await catalog, source = data.calculations.data.cases[0];
  assert.ok(source);
  const input = source.original, decision = await createResourceDomain(input).decide();
  const publicScenario = buildPublicInputScenario({ actorId: "view-owner", input, inputRevision: revision(input) }, data);
  assert.ok(publicScenario);
  const guidance = await buildCaseGuidance(input, decision, { publicScenario });
  let privateCells = 0, commercialCells = 0, privateCrossovers = 0, commercialCrossovers = 0;
  await new HTMLRewriter().on("[data-sensitivity-cell]", { element() { privateCells++; } })
    .on("[data-price-crossover]", { element() { privateCrossovers++; } })
    .transform(new Response(renderReport(decision, { mode: "offline" }, {
      audience: "authenticated-research", research: null, publicScenario, guidance,
    }))).text();
  await new HTMLRewriter().on("[data-sensitivity-cell]", { element() { commercialCells++; } })
    .on("[data-price-crossover]", { element() { commercialCrossovers++; } })
    .transform(new Response(renderReport(decision, { mode: "offline" }))).text();
  assert.equal(privateCells, 9);
  assert.equal(commercialCells, 0);
  assert.equal(privateCrossovers, 3);
  assert.equal(commercialCrossovers, 0);
});

test("public comparison omissions explain material and mass gaps only in the private result", async () => {
  const data = await catalog, source = data.calculations.data.cases[0];
  assert.ok(source);
  for (const [polymer, massKg, expectedReasons] of [
    ["PP", null, 2], ["LDPE", 12, 1], ["PET", null, 1], ["<img src=x onerror=alert(1)>", 12, 1],
  ] as const) {
    const input: CaseInput = { ...source.original, polymer, massKg };
    const eligibility = publicScenarioEligibility(input);
    assert.equal(eligibility.status, "unavailable");
    if (eligibility.status !== "unavailable") return;
    assert.equal(eligibility.reasons.length, expectedReasons);
    assert.equal(buildPublicInputScenario({ actorId: "view-owner", input, inputRevision: revision(input) }, data), null);
    const decision = await createResourceDomain(input).decide();
    let privateReasons = 0, commercialReasons = 0, injectedImages = 0;
    const view = { publicScenarioMissing: eligibility.reasons };
    await new HTMLRewriter().on("#public-scenario-unavailable li", { element() { privateReasons++; } })
      .on("#public-scenario-unavailable img", { element() { injectedImages++; } })
      .transform(new Response(renderReport(decision, { mode: "offline" }, {
        audience: "authenticated-research", research: null,
      }, view))).text();
    await new HTMLRewriter().on("#public-scenario-unavailable", { element() { commercialReasons++; } })
      .transform(new Response(renderReport(decision, { mode: "offline" }, { audience: "commercial" }, view))).text();
    assert.equal(privateReasons, expectedReasons);
    assert.equal(commercialReasons, 0);
    assert.equal(injectedImages, 0);
  }
});
