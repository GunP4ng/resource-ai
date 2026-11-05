import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateRouteCarbon, compatibleBaseline } from "../src/carbon.ts";
import { createComparisonCalculator } from "../src/cost.ts";
import { carbonFixture, bindSynthetic } from "../src/o-synthetic.ts";
import { route as assessment } from "../src/o-synthetic-evidence.ts";
import type { ActivityReview, FactorReview } from "../src/o-calculation.ts";
import type { ActivityInput, FactorRecord } from "../src/contracts.ts";
test("independent carbon constants: gross100, material50, energy5, net45; point estimates", () => {
  const f = carbonFixture();
  const result = calculateRouteCarbon(f.input, f.route, f.context);
  for (const [actual, expected] of [[result.grossEmissions, 100], [result.materialCredit, 50], [result.energyCredit, 5], [result.netEmissions, 45]] as const) {
    assert.ok(actual.state === "available");
    assert.deepEqual([actual.low, actual.central, actual.high], [expected, expected, expected]);
  }
  assert.deepEqual(result.carbonLines.map((v) => v.amount.state === "available" ? v.amount.central : v.amount), [10, 10, 60, 20, 50, 5]);
});
for (const [change, reason] of [
  [{ region: "elsewhere" }, "factor-region-incompatible"], [{ gwpMethod: "different" }, "factor-gwpMethod-incompatible"],
  [{ validTo: "2026-10-31" }, "factor-out-of-period"], [{ embeddedCredits: true }, "embedded-credit-factor-unsupported"],
  [{ massBasis: "output" }, "activity-basis-incompatible"],
] satisfies readonly [Partial<FactorReview>, string][]) test(`factor unavailable: ${reason}`, () => {
  const f = carbonFixture();
  const c = { ...f.context, factors: f.context.factors.map((v, i) => i === 0 ? { ...v, ...change } : v) };
  const b = bindSynthetic(f.input, c);
  const result = calculateRouteCarbon(b.input, f.route, b.context);
  assert.deepEqual(result.carbonLines[0]?.amount, { state: "unavailable", missingInputs: [reason] });
});
for (const [change, reason] of [
  [{ factorVersion: null }, "factor-id-or-version-missing"], [{ factorVersion: "absent" }, "factor-version-unresolved"],
  [{ amount: { value: 100, unit: "L", evidenceIds: ["synthetic-evidence"], missingReason: null } }, "activity-unit-incompatible"],
] satisfies readonly [Partial<ActivityInput>, string][]) test(`activity unavailable: ${reason}`, () => {
  const f = carbonFixture();
  const r = { ...f.route, activities: f.route.activities.map((v, i) => i === 0 ? { ...v, ...change } : v) };
  const b = bindSynthetic({ ...f.input, routes: [r] }, f.context);
  assert.deepEqual(calculateRouteCarbon(b.input, r, b.context).carbonLines[0]?.amount, { state: "unavailable", missingInputs: [reason] });
});
test("unverified reuse blocks factor even with valid hash", () => {
  const f = carbonFixture();
  const factors: FactorRecord[] = f.input.factors.map((v, i) => i === 0 ? { ...v, reusePermission: "unverified" } : v);
  const b = bindSynthetic({ ...f.input, factors }, f.context);
  assert.deepEqual(calculateRouteCarbon(b.input, f.route, b.context).carbonLines[0]?.amount, { state: "unavailable", missingInputs: ["factor-reuse-unverified"] });
});
for (const [change, reason] of [[{ moistureBasis: "wet" }, "activity-basis-incompatible"], [{ outputQuantity: null }, "substitution-evidence-missing"], [{ substitutionRatio: 1 }, "substitution-derivation-mismatch"]] satisfies readonly [Partial<ActivityReview>, string][]) test(`credit unavailable: ${reason}`, () => {
  const f = carbonFixture();
  const c = { ...f.context, activities: f.context.activities.map((v, i) => i === 4 ? { ...v, ...change } : v) };
  const b = bindSynthetic(f.input, c);
  const result = calculateRouteCarbon(b.input, f.route, b.context);
  assert.deepEqual(result.materialCredit, { state: "unavailable", missingInputs: [reason] });
  assert.equal(result.grossEmissions.state, "available");
  assert.equal(result.netEmissions.state, "unavailable");
});
test("duplicate transport leg rejected; independent leg allowed", () => {
  const f = carbonFixture();
  const a = f.route.activities[0], review = f.context.activities[0], factor = f.context.factors[0], actualFactor = f.input.factors[0];
  assert.ok(a && review && factor && actualFactor);
  const extra = { ...a, activityId: "synthetic-leg2", factorId: "synthetic-leg2-factor" };
  const r = { ...f.route, activities: [...f.route.activities, extra] };
  const input = { ...f.input, routes: [r], factors: [...f.input.factors, { ...actualFactor, factorId: extra.factorId }] };
  const context = { ...f.context, factors: [...f.context.factors, { ...factor, factorId: extra.factorId }], activities: [...f.context.activities, { ...review, activityId: extra.activityId }] };
  const duplicate = bindSynthetic(input, context);
  assert.throws(() => calculateRouteCarbon(duplicate.input, r, duplicate.context), /carbon-coverage-overlap/);
  const independent = bindSynthetic(input, { ...context, routes: context.routes.map((v) => ({ ...v, carbonComponents: [...v.carbonComponents, "transport-leg2"] })), factors: context.factors.map((v) => v.factorId === extra.factorId ? { ...v, components: ["transport-leg2"] } : v), activities: context.activities.map((v) => v.activityId === extra.activityId ? { ...v, components: ["transport-leg2"] } : v) });
  const result = calculateRouteCarbon(independent.input, r, independent.context);
  assert.equal(result.grossEmissions.state === "available" ? result.grossEmissions.central : result.grossEmissions, 110);
});
test("missing credit preserves gross but blocks net; supported exclusions produce zero", () => {
  const f = carbonFixture();
  const r = { ...f.route, activities: f.route.activities.filter((a) => !a.stage.endsWith("credit")) };
  const b = bindSynthetic({ ...f.input, routes: [r] }, f.context);
  const missing = calculateRouteCarbon(b.input, r, b.context);
  assert.equal(missing.grossEmissions.state, "available");
  assert.deepEqual(missing.materialCredit, { state: "unavailable", missingInputs: ["material-credit-evidence-missing"] });
  const excluded = bindSynthetic(b.input, { ...b.context, routes: b.context.routes.map((v) => ({ ...v, materialCreditExcluded: true, energyCreditExcluded: true })) });
  const result = calculateRouteCarbon(excluded.input, r, excluded.context);
  assert.equal(result.netEmissions.state === "available" ? result.netEmissions.central : result.netEmissions, 100);
});
test("no baseline is exact; missing baseline has unavailable reason; valid self baseline is zero", async () => {
  const f = carbonFixture();
  const calculate = createComparisonCalculator(f.context);
  assert.deepEqual((await calculate(f.input, [assessment]))[0]?.avoidedEmissions, { state: "no-baseline" });
  assert.deepEqual((await calculate({ ...f.input, baselineRouteId: "missing" }, [assessment]))[0]?.avoidedEmissions, { state: "baseline-provided", baselineRouteId: "missing", amount: { state: "unavailable", missingInputs: ["baseline-missing-or-incompatible"] } });
  const self = (await calculate({ ...f.input, baselineRouteId: f.route.routeId }, [assessment]))[0]?.avoidedEmissions;
  assert.ok(self?.state === "baseline-provided" && self.amount.state === "available");
  assert.equal(self.amount.central, 0);
});
test("incompatible baseline GWP is unavailable; included evidenced-zero baseline net120 yields avoided75", async () => {
  const f = carbonFixture();
  const boundary = f.context.routes[0];
  assert.ok(boundary);
  const baseRoute = { ...f.route, routeId: "synthetic-baseline", quotes: [], activities: f.route.activities.map((a) => ({ ...a, activityId: `${a.activityId}-base`, amount: { ...a.amount, value: a.stage.endsWith("credit") ? 0 : a.stage === "residue" ? 200 : a.amount.value } })) };
  const input = { ...f.input, baselineRouteId: baseRoute.routeId, routes: [...f.input.routes, baseRoute] };
  const context = { ...f.context, routes: [...f.context.routes, { ...boundary, routeId: baseRoute.routeId }], activities: [...f.context.activities, ...f.context.activities.map((a) => ({ ...a, activityId: `${a.activityId}-base`, routeId: baseRoute.routeId, outputQuantity: a.activityId.endsWith("credit") ? 0 : a.outputQuantity }))] };
  const b = bindSynthetic(input, context);
  const assessments = [assessment, { ...assessment, routeId: baseRoute.routeId }];
  const result = await createComparisonCalculator(b.context)(b.input, assessments);
  const avoided = result[0]?.avoidedEmissions;
  assert.ok(avoided?.state === "baseline-provided" && avoided.amount.state === "available");
  assert.equal(avoided.amount.central, 75);
  const mismatch = bindSynthetic(input, { ...context, routes: context.routes.map((v) => v.routeId === baseRoute.routeId ? { ...v, gwpMethod: "incompatible" } : v) });
  const incompatible = (await createComparisonCalculator(mismatch.context)(mismatch.input, assessments))[0]?.avoidedEmissions;
  assert.deepEqual(incompatible, { state: "baseline-provided", baselineRouteId: baseRoute.routeId, amount: { state: "unavailable", missingInputs: ["baseline-missing-or-incompatible"] } });
});
test("kg to tonne and tonne to kg conversions keep independently known emissions", () => {
  const f = carbonFixture();
  const r = { ...f.route, activities: f.route.activities.map((a) => a.stage === "treatment" ? { ...a, amount: { ...a.amount, value: 2000, unit: "kg" } as const } : a.stage === "residue" ? { ...a, amount: { ...a.amount, value: 0.1, unit: "t" } as const } : a) };
  const b = bindSynthetic({ ...f.input, routes: [r] }, f.context);
  const result = calculateRouteCarbon(b.input, r, b.context);
  assert.equal(result.grossEmissions.state === "available" ? result.grossEmissions.central : result.grossEmissions, 100);
});
test("embedded preprocessing plus separately added preprocessing is rejected", () => {
  const f = carbonFixture();
  const factors = f.input.factors.map((v, i) => i === 2 ? { ...v, includedStages: ["treatment", "preprocessing"] as const } : v);
  const b = bindSynthetic({ ...f.input, factors }, f.context);
  assert.throws(() => calculateRouteCarbon(b.input, f.route, b.context), /embedded-stage-overlap/);
});
test("factor registry version and exact value binding cannot drift", () => {
  const f = carbonFixture();
  const result = calculateRouteCarbon({ ...f.input, factorRegistryVersion: "different" }, f.route, f.context);
  assert.deepEqual(result.carbonLines[0]?.amount, { state: "unavailable", missingInputs: ["activity-factor-or-boundary-review-missing"] });
  const factors = f.input.factors.map((v, i) => i === 0 ? { ...v, kgCo2ePerUnit: { ...v.kgCo2ePerUnit, value: 99 } } : v);
  const changed = calculateRouteCarbon({ ...f.input, factors }, f.route, f.context);
  assert.ok(changed.carbonLines[0]?.amount.state === "unavailable");
  assert.ok(changed.carbonLines[0].amount.missingInputs[0]?.startsWith("fact-unbound:"));
});
test("conflicting factor definitions and duplicate activity IDs are rejected", () => {
  const f = carbonFixture();
  const factor = f.input.factors[0], activity = f.route.activities[0];
  assert.ok(factor && activity);
  assert.throws(() => calculateRouteCarbon({ ...f.input, factors: [...f.input.factors, { ...factor, region: "conflict" }] }, f.route, f.context), /duplicate-factor-version/);
  const r = { ...f.route, activities: [...f.route.activities, activity] };
  assert.throws(() => calculateRouteCarbon({ ...f.input, routes: [r] }, r, f.context), /duplicate-activity/);
});
test("source rights failure prevents gross and credit totals; wrong activity source never proves mass", () => {
  const f = carbonFixture();
  const docs = f.context.documents.map((d) => ({ ...d, record: { ...d.record, license: null, licenseVerified: false } }));
  const result = calculateRouteCarbon({ ...f.input, evidence: docs.map((d) => d.record) }, f.route, { ...f.context, documents: docs });
  assert.equal(result.grossEmissions.state, "unavailable");
  assert.equal(result.netEmissions.state, "unavailable");
  const r = { ...f.route, activities: f.route.activities.map((a, i) => i === 0 ? { ...a, amount: { ...a.amount, evidenceIds: [] } } : a) };
  const b = bindSynthetic({ ...f.input, routes: [r] }, f.context);
  // Quantity evidence cannot be supplied merely by factor applicability metadata.
  const line = calculateRouteCarbon(b.input, r, b.context).carbonLines[0]?.amount;
  assert.deepEqual(line, { state: "unavailable", missingInputs: ["activity-quantity-evidence-missing"] });
});
test("unverified eligibility blocks comparison and self-baseline zero", async () => {
  const f = carbonFixture();
  const scenarios = await createComparisonCalculator(f.context)({ ...f.input, baselineRouteId: f.route.routeId }, []);
  assert.deepEqual(scenarios[0]?.netEmissions, { state: "unavailable", missingInputs: ["eligible-assessment-unverified"] });
  const avoided = scenarios[0]?.avoidedEmissions;
  assert.ok(avoided?.state === "baseline-provided");
  assert.equal(avoided.amount.state, "unavailable");
});

test("supported zero credit activities remain available within the reviewed boundary", () => {
  const f = carbonFixture();
  const route = { ...f.route, activities: f.route.activities.map((a) => a.stage.endsWith("credit")
    ? { ...a, amount: { ...a.amount, value: 0 } } : a) };
  const bound = bindSynthetic({ ...f.input, routes: [route] }, {
    ...f.context, activities: f.context.activities.map((a) => a.activityId.endsWith("credit")
      ? { ...a, outputQuantity: 0 } : a),
  });
  const result = calculateRouteCarbon(bound.input, route, bound.context);
  for (const [value, expected] of [[result.grossEmissions, 100], [result.materialCredit, 0], [result.energyCredit, 0], [result.netEmissions, 100]] as const) {
    assert.ok(value.state === "available");
    assert.deepEqual([value.low, value.central, value.high], [expected, expected, expected]);
    assert.doesNotMatch(value.assumptions.join(" "), /제외|excluded|outside/i);
  }
});

for (const [material, energy, net] of [[true, false, 95], [false, true, 50], [true, true, 100]] as const) {
  test(`P2 separate boundary policy material=${material} energy=${energy}`, async () => {
    const f = carbonFixture();
    const route = { ...f.route, activities: f.route.activities.filter((a) => !(material && a.stage === "material-credit") && !(energy && a.stage === "energy-credit")) };
    const bound = bindSynthetic({ ...f.input, routes: [route], baselineRouteId: route.routeId }, {
      ...f.context, routes: f.context.routes.map((r) => ({ ...r, materialCreditExcluded: material, energyCreditExcluded: energy })),
    });
    const result = calculateRouteCarbon(bound.input, route, bound.context);
    assert.ok(result.netEmissions.state === "available" && result.grossEmissions.state === "available");
    assert.equal(result.netEmissions.central, net);
    assert.doesNotMatch(result.grossEmissions.assumptions.join(" "), /제외/);
    for (const [credit, excluded, label] of [[result.materialCredit, material, "원료"], [result.energyCredit, energy, "에너지"]] as const) {
      assert.ok(credit.state === "available");
      assert.equal(credit.assumptions.some((a) => a.includes(`${label} 대체효과 제외 경계`)), excluded);
      if (excluded) {
        assert.equal(credit.central, 0);
        assert.ok(credit.assumptions.some((a) => a.includes("계산상 0") && a.includes("실측·근거 기반 0 아님")));
        assert.ok(credit.evidenceIds.every((id) => result.netEmissions.state === "available" && result.netEmissions.evidenceIds.includes(id)));
        assert.ok(result.netEmissions.assumptions.some((a) => a.includes(`${label} 대체효과 제외 경계`)));
      }
    }
    assert.ok(result.netEmissions.assumptions.some((a) => a.includes("완전한 순탄소 비교 아님")));
    const scenarios = await createComparisonCalculator(bound.context)(bound.input, [assessment]);
    const avoided = scenarios[0]?.avoidedEmissions;
    assert.ok(avoided?.state === "baseline-provided" && avoided.amount.state === "available");
    assert.equal(avoided.amount.central, 0);
    assert.ok(avoided.amount.assumptions.some((a) => a.includes("회피배출 비교")));
    const review = bound.context.routes[0];
    assert.ok(review);
    assert.equal(compatibleBaseline(review, review), true);
    for (const flag of ["materialCreditExcluded", "energyCreditExcluded"] as const) {
      assert.equal(compatibleBaseline(review, { ...review, [flag]: !review[flag] }), false);
    }
    const overlap = bindSynthetic(f.input, { ...f.context, routes: bound.context.routes });
    assert.throws(() => calculateRouteCarbon(overlap.input, f.route, overlap.context), /credit-exclusion-overlap/);
  });
}

test("P2 baseline exclusion mismatch makes avoided unavailable while route results survive", async () => {
  const f = carbonFixture();
  const review = f.context.routes[0];
  assert.ok(review);
  for (const flag of ["materialCreditExcluded", "energyCreditExcluded"] as const) {
    const stage = flag === "materialCreditExcluded" ? "material-credit" : "energy-credit";
    const base = { ...f.route, routeId: "policy-baseline", quotes: [], activities: f.route.activities.filter((a) => a.stage !== stage).map((a) => ({ ...a, activityId: `${a.activityId}-base` })) };
    const bound = bindSynthetic({ ...f.input, routes: [f.route, base], baselineRouteId: base.routeId }, {
      ...f.context, routes: [...f.context.routes, { ...review, routeId: base.routeId, [flag]: true }],
      activities: [...f.context.activities, ...f.context.activities.map((a) => ({ ...a, activityId: `${a.activityId}-base`, routeId: base.routeId }))],
    });
    const result = await createComparisonCalculator(bound.context)(bound.input, [assessment, { ...assessment, routeId: base.routeId }]);
    assert.equal(result[0]?.netEmissions.state, "available");
    assert.deepEqual(result[0]?.avoidedEmissions, { state: "baseline-provided", baselineRouteId: base.routeId, amount: { state: "unavailable", missingInputs: ["baseline-missing-or-incompatible"] } });
  }
});

test("P2 matching excluded baseline net120 yields qualified avoided20", async () => {
  const f = carbonFixture();
  const review = f.context.routes[0];
  assert.ok(review);
  const route = { ...f.route, activities: f.route.activities.filter((a) => !a.stage.endsWith("credit")) };
  const base = { ...route, routeId: "excluded-baseline", quotes: [], activities: route.activities.map((a) => ({ ...a, activityId: `${a.activityId}-base`, amount: { ...a.amount, value: a.stage === "residue" ? 200 : a.amount.value } })) };
  const bound = bindSynthetic({ ...f.input, routes: [route, base], baselineRouteId: base.routeId }, {
    ...f.context, routes: [review, { ...review, routeId: base.routeId }].map((r) => ({ ...r, materialCreditExcluded: true, energyCreditExcluded: true })),
    activities: [...f.context.activities, ...f.context.activities.map((a) => ({ ...a, activityId: `${a.activityId}-base`, routeId: base.routeId }))],
  });
  const result = await createComparisonCalculator(bound.context)(bound.input, [assessment, { ...assessment, routeId: base.routeId }]);
  const avoided = result[0]?.avoidedEmissions;
  assert.ok(avoided?.state === "baseline-provided" && avoided.amount.state === "available");
  assert.equal(avoided.amount.central, 20);
  assert.ok(avoided.amount.assumptions.some((a) => a.includes("원료 대체효과 제외")));
  assert.ok(avoided.amount.assumptions.some((a) => a.includes("에너지 대체효과 제외")));
  assert.ok(avoided.amount.assumptions.some((a) => a.includes("회피배출 비교") && a.includes("완전한 순탄소 비교 아님")));
  const mismatch = bindSynthetic(bound.input, { ...bound.context, routes: bound.context.routes.map((r) => r.routeId === route.routeId ? { ...r, materialCreditExcluded: false, energyCreditExcluded: false } : r) });
  const incompatible = await createComparisonCalculator(mismatch.context)(mismatch.input, [assessment, { ...assessment, routeId: base.routeId }]);
  assert.deepEqual(incompatible[0]?.avoidedEmissions, { state: "baseline-provided", baselineRouteId: base.routeId, amount: { state: "unavailable", missingInputs: ["baseline-missing-or-incompatible"] } });
});
