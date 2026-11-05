import { test } from "node:test";
import assert from "node:assert/strict";
import { createComparisonCalculator, calculateRouteCost } from "../src/cost.ts";
import { bindSynthetic, carbonFixture, calculationFixture, treatment, transport, sales, child, sq } from "../src/o-synthetic.ts";
import type { QuoteInput } from "../src/contracts.ts";
import type { CaseMassReview, QuoteReview } from "../src/o-calculation.ts";
import { documents, route as assessment } from "../src/o-synthetic-evidence.ts";
import { ValidationError } from "../src/o-validation.ts";
import { subtract } from "../src/o-validation.ts";
function calculate(quotes?: readonly QuoteInput[], changes?: Parameters<typeof calculationFixture>[1]) {
  const f = calculationFixture(quotes, changes);
  return calculateRouteCost(f.input, f.route, f.context);
}
test("independent 2t treatment, two trips, operator sales = 240000 KRW; included preprocessing excluded", () => {
  const result = calculate([treatment, transport, sales, child]);
  assert.deepEqual(result.netCost.state === "available" ? [result.netCost.low, result.netCost.central, result.netCost.high] : result.netCost, [240000, 240000, 240000]);
  const included = result.costLines.find((v) => v.quoteId === child.quoteId)?.amount;
  assert.ok(included?.state === "available");
  assert.ok(included.assumptions.includes(`상위 견적에 포함 · 합산 제외: ${treatment.quoteId}`));
});
test("kg and tonne bills both independently produce 200000 treatment", () => {
  const kg: QuoteInput = { ...treatment, basis: { kind: "per-kg", rate: sq(100, "KRW/kg"), amount: sq(2000, "kg") } };
  const line = calculate([kg, transport, sales]).costLines[0]?.amount;
  assert.equal(line?.state === "available" ? line.central : line, 200000);
});
test("alternative B all-in 250000 less sales = 230000", () => {
  const all: QuoteInput = { ...treatment, basis: { kind: "total", amount: sq(250000, "KRW") } };
  const result = calculate([all, sales], { components: ["treatment", "preprocessing", "transport"] });
  assert.equal(result.netCost.state === "available" ? result.netCost.central : result.netCost, 230000);
});
test("processor-owned sales are not operator revenue", () => {
  const result = calculate([treatment, transport, { ...sales, revenueRecipient: "processor" }]);
  assert.equal(result.netCost.state === "available" ? result.netCost.central : result.netCost, 260000);
  const line = result.costLines.find((value) => value.quoteId === sales.quoteId)?.amount;
  assert.ok(line?.state === "available");
  assert.equal(line.central, 20000);
  assert.ok(line.assumptions.includes("처리업체 귀속 · 사업자 수입 합산 제외"));
});
test("synthetic 0.10 VAT converts exclusive treatment to 220000", () => {
  const result = calculate([{ ...treatment, vat: "excluded" }, transport, sales], { vatRate: 0.1 });
  const line = result.costLines[0]?.amount;
  assert.ok(line?.state === "available");
  assert.ok(Math.abs(line.central - 220000) < 0.000001);
});
for (const [quotes, reason] of [
  [[{ ...treatment, vat: "unknown" }, transport, sales], "vat-unknown"],
  [[{ ...treatment, vat: "excluded" }, transport, sales], "vat-rate-missing"],
  [[{ ...treatment, validThrough: "2026-11-04" }, transport], "quote-out-of-period"],
  [[{ ...treatment, basis: { kind: "total", amount: sq(null, "KRW") } }, transport], "quote-quantity-missing"],
  [[treatment], "cost-coverage-missing:transport"],
] satisfies readonly [readonly QuoteInput[], string][]) {
  test(`unavailable total explains ${reason}`, () => {
    const result = calculate(quotes);
    assert.equal(result.netCost.state, "unavailable");
    if (result.netCost.state !== "unavailable") throw new Error("expected unavailable");
    assert.ok(result.netCost.missingInputs.includes(reason));
  });
}
for (const [quotes, reason] of [
  [[{ ...treatment, includedInQuoteId: "missing" }], "quote-inclusion-dangling"],
  [[{ ...treatment, includedInQuoteId: treatment.quoteId }], "quote-inclusion-cycle"],
  [[{ ...treatment, includedInQuoteId: child.quoteId }, child], "quote-inclusion-cycle"],
  [[treatment, { ...child, includedInQuoteId: null }], "quote-root-coverage-overlap"],
  [[{ ...sales, revenueRecipient: "not-applicable" }], "sales-recipient-inconsistent"],
  [[{ ...transport, basis: { kind: "per-trip", rate: sq(1, "KRW/trip"), amount: sq(1.5, "trip") } }], "trip-billing-rule"],
  [[{ ...treatment, basis: { kind: "total", amount: sq(-1, "KRW") } }], "invalid-number"],
  [[{ ...treatment, basis: { kind: "total", amount: sq(Infinity, "KRW") } }], "invalid-comparison-input"],
  [[{ ...treatment, basis: { kind: "per-tonne", rate: sq(1e308, "KRW/t"), amount: sq(2, "t") } }], "arithmetic-overflow"],
] satisfies readonly [readonly QuoteInput[], string][]) test(`rejects ${reason}`, () => assert.throws(() => calculate(quotes), new RegExp(reason)));
test("quote validity includes its final day; empty quotes remain unavailable", () => {
  const f = calculationFixture([{ ...treatment, validThrough: "2026-11-05" }, transport, sales]);
  assert.equal(calculateRouteCost(f.input, f.route, f.context).netCost.state, "available");
  assert.equal(calculate([]).netCost.state, "unavailable");
});
test("reference and statutory rates cannot masquerade as actual quotation", () => {
  for (const kind of ["reference", "statutory"] as const) {
    const result = calculate(undefined, { kind });
    assert.equal(result.netCost.state, "unavailable");
    if (result.netCost.state !== "unavailable") throw new Error("expected unavailable");
    assert.ok(result.netCost.missingInputs.includes("actual-quotation-required"));
  }
});
test("revenue already netted in an actual payable quote is not subtracted twice", () => {
  const nettedTreatment = { ...treatment, basis: { kind: "total", amount: sq(180000, "KRW") } } as const;
  const f = calculationFixture([nettedTreatment, transport, sales]);
  const b = bindSynthetic(f.input, { ...f.context, quotes: f.context.quotes.map((v) => v.quoteId === sales.quoteId ? { ...v, revenueNettedIn: treatment.quoteId } : v) });
  const result = calculateRouteCost(b.input, f.route, b.context);
  assert.equal(result.netCost.state === "available" ? result.netCost.central : result.netCost, 240000);
  const line = result.costLines.find((value) => value.quoteId === sales.quoteId)?.amount;
  assert.ok(line?.state === "available");
  assert.equal(line.central, 20000);
  assert.ok(line.assumptions.includes(`견적 ${treatment.quoteId}에 이미 반영 · 추가 차감 제외`));
});
test("uniform exclusive quotes need no invented tax rate; verified inclusive to exclusive converts", () => {
  const f = calculationFixture([treatment, transport, sales].map((q) => ({ ...q, vat: "excluded" })));
  const result = calculateRouteCost(f.input, f.route, { ...f.context, vatBasis: "excluded" });
  assert.equal(result.netCost.state === "available" ? result.netCost.central : result.netCost, 240000);
  const inclusive = calculationFixture([{ ...treatment, basis: { kind: "total", amount: sq(220000, "KRW") } }, transport, sales], { vatRate: 0.1 });
  const converted = calculateRouteCost(inclusive.input, inclusive.route, { ...inclusive.context, vatBasis: "excluded" }).costLines[0]?.amount;
  assert.ok(converted?.state === "available");
  assert.ok(Math.abs(converted.central - 200000) < 0.000001);
});
test("explicit zero remains zero; missing quantity never uses zero", () => {
  const zero: QuoteInput = { ...sales, basis: { kind: "total", amount: sq(0, "KRW") } };
  const result = calculate([treatment, transport, zero]);
  assert.equal(result.netCost.state === "available" ? result.netCost.central : result.netCost, 260000);
  const missing: QuoteInput = { ...sales, basis: { kind: "total", amount: sq(null, "KRW") } };
  assert.equal(calculate([treatment, transport, missing]).netCost.state, "unavailable");
});
test("minimum charge and reviewed integer trip multiples apply", () => {
  const f = calculationFixture([treatment, transport, sales]);
  const b = bindSynthetic(f.input, { ...f.context, quotes: f.context.quotes.map((q) => q.quoteId === transport.quoteId ? { ...q, minimumCharge: 80000, tripMultiple: 2 } : q) });
  const result = calculateRouteCost(b.input, f.route, b.context);
  assert.equal(result.netCost.state === "available" ? result.netCost.central : result.netCost, 260000);
});
test("reviewed quantity applicability and unresolved conditions prevent totals", () => {
  for (const [change, reason] of [[{ caseMassKg: 1000 }, "quote-case-mass-mismatch"], [{ minMassKg: 2100, maxMassKg: 2200 }, "quote-mass-inapplicable"], [{ conditions: ["verify loading"] }, "quote-conditions-unresolved"], [{ material: "different" }, "quote-material-inapplicable"]] satisfies readonly [Partial<QuoteReview>, string][]) {
    const f = calculationFixture();
    const b = bindSynthetic(f.input, { ...f.context, quotes: f.context.quotes.map((q) => q.quoteId === treatment.quoteId ? { ...q, ...change } : q) });
    const result = calculateRouteCost(b.input, f.route, b.context);
    assert.ok(result.netCost.state === "unavailable");
    assert.ok(result.netCost.missingInputs.includes(reason));
  }
});
test("hash-valid document without a matching claim cannot support arbitrary rates or quantities", () => {
  const f = calculationFixture();
  const tampered = { ...f.route, quotes: f.route.quotes.map((q) => q.quoteId === treatment.quoteId ? { ...q, basis: { kind: "total", amount: sq(999, "KRW") } as const } : q) };
  const result = calculateRouteCost({ ...f.input, routes: [tampered] }, tampered, f.context);
  assert.ok(result.netCost.state === "unavailable");
  assert.ok(result.netCost.missingInputs.some((s) => s.startsWith("fact-unbound:")));
});
test("missing reuse permission blocks calculation even when snapshot hash is correct", () => {
  const f = calculationFixture();
  const docs = f.context.documents.map((d) => ({ ...d, record: { ...d.record, licenseVerified: false } }));
  const result = calculateRouteCost({ ...f.input, evidence: docs.map((d) => d.record) }, f.route, { ...f.context, documents: docs });
  assert.deepEqual(result.netCost, { state: "unavailable", missingInputs: ["boundary-review-missing"] });
});
test("supplemental independent endpoint arithmetic uses opposite credit endpoints", () => {
  const estimate = (low: number, central: number, high: number) => ({ state: "available", low, central, high, unit: "kgCO2e", evidenceIds: ["synthetic-evidence"], assumptions: ["explicit supported independent bounds"] } as const);
  const result = subtract(estimate(90, 100, 110), [estimate(40, 50, 60), estimate(5, 5, 5)], "kgCO2e");
  assert.ok(result.state === "available");
  assert.deepEqual([result.low, result.central, result.high], [25, 45, 65]);
});
test("unapproved quantity bounds and coupled-input hints are rejected instead of discarded", () => {
  const f = calculationFixture();
  const rate = { ...sq(100000, "KRW/t"), low: 90000, high: 110000, coupledWith: "mass" };
  const q: QuoteInput = { ...treatment, basis: { kind: "per-tonne", rate, amount: sq(2, "t") } };
  const r = { ...f.route, quotes: [q, transport, sales] };
  assert.throws(() => calculateRouteCost({ ...f.input, routes: [r] }, r, f.context), /invalid-comparison-input/);
});
test("duplicate quote, source and route identifiers are rejected", () => {
  const f = calculationFixture();
  assert.throws(() => calculateRouteCost({ ...f.input, routes: [f.route, f.route] }, f.route, f.context), /duplicate-route/);
  assert.throws(() => calculateRouteCost({ ...f.input, evidence: [...f.input.evidence, ...f.input.evidence] }, f.route, f.context), /duplicate-source/);
  const r = { ...f.route, quotes: [treatment, treatment] };
  assert.throws(() => calculateRouteCost({ ...f.input, routes: [r] }, r, f.context), /duplicate-quote/);
});
test("reversed and impossible quote dates are structured validation failures", () => {
  assert.throws(() => calculate([{ ...treatment, validThrough: "2026-02-30" }]), /invalid-date/);
  assert.throws(() => calculate([{ ...treatment, validThrough: "2025-12-31" }]), /reversed-period/);
});
test("sales quantity evidence and ownership cannot be borrowed from an expense quote", () => {
  for (const [change, reason] of [[{ saleableOutputKg: null }, "saleable-output-evidence-missing"], [{ saleableOutputKg: 10 }, "saleable-output-mismatch"]] satisfies readonly [Partial<QuoteReview>, string][]) {
    const f = calculationFixture();
    const b = bindSynthetic(f.input, { ...f.context, quotes: f.context.quotes.map((q) => q.quoteId === sales.quoteId ? { ...q, ...change } : q) });
    const result = calculateRouteCost(b.input, f.route, b.context);
    assert.ok(result.netCost.state === "unavailable");
    assert.ok(result.netCost.missingInputs.includes(reason));
  }
  const f = calculationFixture();
  const b = bindSynthetic(f.input, { ...f.context, quotes: f.context.quotes.map((q) => q.quoteId === sales.quoteId ? { ...q, salesOwner: "processor" } as const : q) });
  assert.throws(() => calculateRouteCost(b.input, f.route, b.context), /sales-ownership-inconsistent/);
});

test("P1: a rebound 1t treatment quote cannot price a 2t comparison as available", async () => {
  const f = carbonFixture();
  const control = (await createComparisonCalculator(f.context)(f.input, [assessment]))[0];
  assert.ok(control);
  assert.ok(control.netCost.state === "available" && control.netEmissions.state === "available");
  assert.deepEqual([control.netCost.central, control.netEmissions.central], [240000, 45]);
  const route = { ...f.route, quotes: f.route.quotes.map((q) => q.quoteId === treatment.quoteId
    ? { ...q, basis: { kind: "per-tonne", rate: sq(100000, "KRW/t"), amount: sq(1, "t") } as const } : q) };
  const bound = bindSynthetic({ ...f.input, routes: [route] }, {
    ...f.context, quotes: f.context.quotes.map((q) => q.quoteId === treatment.quoteId
      ? { ...q, caseMassKg: 1000, minMassKg: 1000, maxMassKg: 1000 } : q),
  });
  let scenarios;
  try {
    scenarios = await createComparisonCalculator(bound.context)(bound.input, [assessment]);
  } catch (error) {
    // Only a mass contradiction rejection satisfies this alternative contract.
    if (error instanceof ValidationError && /mass/i.test(error.message)) return;
    throw error;
  }
  const result = scenarios[0];
  assert.ok(result);
  assert.equal(result.netCost.state, "unavailable", JSON.stringify({
    functionalUnit: bound.input.functionalUnit, quoteReviews: bound.context.quotes,
    treatmentActivity: route.activities.find((a) => a.stage === "treatment"),
    netCost: result.netCost, netEmissions: result.netEmissions,
  }));
});

test("P1: all quote reviews and mass bills stale together cannot override the independent 2000kg anchor", async () => {
  const f = carbonFixture();
  const route = { ...f.route, quotes: f.route.quotes.map((q) => q.quoteId === treatment.quoteId
    ? { ...q, basis: { kind: "per-tonne", rate: sq(100000, "KRW/t"), amount: sq(1, "t") } as const } : q) };
  const bound = bindSynthetic({ ...f.input, routes: [route] }, { ...f.context,
    quotes: f.context.quotes.map((q) => ({ ...q, caseMassKg: 1000, minMassKg: 1000, maxMassKg: 1000 })),
  });
  assert.equal(bound.context.caseMass?.massKg, 2000);
  const result = (await createComparisonCalculator(bound.context)(bound.input, [assessment]))[0];
  assert.ok(result && result.netCost.state === "unavailable");
  assert.ok(result.netCost.missingInputs.includes("quote-case-mass-mismatch"));
  for (const line of result.costLines) assert.deepEqual(line.amount, { state: "unavailable", missingInputs: ["quote-case-mass-mismatch"] });
  assert.ok(result.netEmissions.state === "available");
  assert.equal(result.netEmissions.central, 45);
});

const totalTreatment: QuoteInput = { ...treatment, basis: { kind: "total", amount: sq(200000, "KRW") } };
const kgTreatment: QuoteInput = { ...treatment, basis: { kind: "per-kg", rate: sq(100, "KRW/kg"), amount: sq(2000, "kg") } };
for (const [name, quotes, target, netted] of [
  ["per-tonne", [treatment, transport, sales], treatment.quoteId, false],
  ["per-kg", [kgTreatment, transport, sales], treatment.quoteId, false],
  ["total", [totalTreatment, transport, sales], treatment.quoteId, false],
  ["per-trip", [treatment, transport, sales], transport.quoteId, false],
  ["included child", [treatment, transport, sales, child], child.quoteId, false],
  ["operator sales", [treatment, transport, sales], sales.quoteId, false],
  ["processor-owned sales", [treatment, transport, { ...sales, revenueRecipient: "processor" }], sales.quoteId, false],
  ["already-netted sales", [totalTreatment, transport, sales], sales.quoteId, true],
] satisfies readonly [string, readonly QuoteInput[], string, boolean][]) {
  test(`P1: ${name} review must match the anchor even when not summed`, () => {
    const f = calculationFixture(quotes);
    const context = { ...f.context, quotes: f.context.quotes.map((q) => netted && q.quoteId === target ? { ...q, revenueNettedIn: treatment.quoteId } : q) };
    const control = bindSynthetic(f.input, context);
    assert.equal(calculateRouteCost(control.input, f.route, control.context).netCost.state, "available");
    const stale = bindSynthetic(f.input, { ...context, quotes: context.quotes.map((q) => q.quoteId === target
      ? { ...q, caseMassKg: 1000, minMassKg: 1000, maxMassKg: 1000 } : q) });
    const result = calculateRouteCost(stale.input, f.route, stale.context);
    assert.deepEqual(result.costLines.find((l) => l.quoteId === target)?.amount, { state: "unavailable", missingInputs: ["quote-case-mass-mismatch"] });
    assert.ok(result.netCost.state === "unavailable" && result.netCost.missingInputs.includes("quote-case-mass-mismatch"));
  });
}

test("P1: correct case applicability still requires the non-sales kg/t bill to cover the whole case", () => {
  for (const quote of [
    { ...kgTreatment, basis: { kind: "per-kg", rate: sq(100, "KRW/kg"), amount: sq(1000, "kg") } },
    { ...treatment, basis: { kind: "per-tonne", rate: sq(100000, "KRW/t"), amount: sq(1, "t") } },
  ] satisfies QuoteInput[]) {
    const result = calculate([quote, transport, sales]);
    assert.ok(result.netCost.state === "unavailable" && result.netCost.missingInputs.includes("quote-mass-mismatch"));
  }
});

for (const [name, change] of [
  ["wrong case", { caseId: "another-case" }], ["wrong date", { assessmentDate: "2026-11-04" }],
  ["wrong functional unit", { functionalUnit: "other-unit" }], ["wrong boundary", { boundary: "other-boundary" }],
  ["wrong material", { material: "other-polymer" }], ["wrong condition", { condition: "wet" }],
  ["wrong moisture basis", { moistureBasis: "wet" }],
] satisfies readonly [string, Partial<CaseMassReview>][]) {
  test(`P1: independently bound but ${name} anchor makes every whole-case total unavailable`, async () => {
    const f = carbonFixture();
    assert.ok(f.context.caseMass);
    const bound = bindSynthetic({ ...f.input, baselineRouteId: f.route.routeId }, { ...f.context, caseMass: { ...f.context.caseMass, ...change } });
    const result = (await createComparisonCalculator(bound.context)(bound.input, [assessment]))[0];
    assert.ok(result);
    const avoided = result.avoidedEmissions;
    assert.ok(avoided.state === "baseline-provided");
    for (const value of [result.netCost, result.grossEmissions, result.materialCredit, result.energyCredit, result.netEmissions, avoided.amount]) {
      assert.ok(value.state === "unavailable" && value.missingInputs.includes("case-mass-review-inapplicable"));
    }
    // Independent stage results remain auditable without claiming a whole-case total.
    assert.ok(result.carbonLines.every((line) => line.amount.state === "available"));
  });
}

for (const missing of [null, undefined]) test(`P1: ${missing} anchor cannot be manufactured from quotes or functional-unit digits`, async () => {
  const f = carbonFixture();
  const context = { ...f.context, caseMass: missing };
  if (missing === undefined) delete context.caseMass;
  const bound = bindSynthetic({ ...f.input, baselineRouteId: f.route.routeId }, context);
  assert.equal(bound.context.caseMass, missing);
  assert.ok(bound.context.documents.every((d) => !d.snapshot.includes('"case-mass:')));
  const result = (await createComparisonCalculator(bound.context)(bound.input, [assessment]))[0];
  assert.ok(result && result.avoidedEmissions.state === "baseline-provided");
  for (const value of [result.netCost, result.grossEmissions, result.materialCredit, result.energyCredit, result.netEmissions, result.avoidedEmissions.amount]) {
    assert.ok(value.state === "unavailable" && value.missingInputs.includes("case-mass-review-missing"));
  }
});

/** Anchor evidence has its own document identity, independent of quote/activity documents. */
function independentlyDocumentedMass() {
  const f = carbonFixture();
  assert.ok(f.context.caseMass);
  const caseMass = { ...f.context.caseMass, evidenceIds: ["synthetic-independent-mass"] };
  const bound = bindSynthetic(f.input, { ...f.context, caseMass });
  const document = documents({ [`case-mass:${caseMass.caseId}`]: caseMass }).documents[0];
  assert.ok(document);
  const massDocument = { ...document, record: { ...document.record, sourceId: caseMass.evidenceIds[0] ?? "missing" } };
  return { ...f, input: { ...bound.input, evidence: [...bound.input.evidence, massDocument.record] },
    context: { ...bound.context, documents: [...bound.context.documents, massDocument] }, massDocument };
}

test("P1: available totals disclose 2000kg and carry independent mass evidence; 100kg sales and residue remain valid", async () => {
  const f = independentlyDocumentedMass();
  const result = (await createComparisonCalculator(f.context)({ ...f.input, baselineRouteId: f.route.routeId }, [assessment]))[0];
  assert.ok(result && result.avoidedEmissions.state === "baseline-provided");
  for (const [value, expected] of [[result.netCost, 240000], [result.grossEmissions, 100], [result.materialCredit, 50], [result.energyCredit, 5], [result.netEmissions, 45], [result.avoidedEmissions.amount, 0]] as const) {
    assert.ok(value.state === "available");
    assert.equal(value.central, expected);
    assert.ok(value.evidenceIds.includes(f.massDocument.record.sourceId));
    assert.ok(value.assumptions.includes("검토된 사례 전체 유입 폐기물 질량: 2000 kg"));
  }
  for (const line of result.costLines) {
    assert.ok(line.amount.state === "available" && line.amount.evidenceIds.includes(f.massDocument.record.sourceId));
  }
  assert.equal(f.route.quotes.find((q) => q.category === "sales")?.basis.amount.value, 100);
  assert.equal(f.route.activities.find((a) => a.stage === "residue")?.amount.value, 100);
  assert.equal(f.route.activities.find((a) => a.stage === "material-credit")?.amount.value, 50);
});

for (const [name, reason] of [
  ["unbound", "fact-unbound:/facts/case-mass:synthetic-case"], ["stale", "source-stale"],
  ["out of period", "source-out-of-period"], ["missing input evidence", "input-evidence-missing"],
  ["missing evidence IDs", "evidence-missing"], ["unverified rights", "reuse-unverified"],
] as const) test(`P1: ${name} independent anchor evidence blocks totals despite valid quote evidence`, async () => {
  const f = independentlyDocumentedMass();
  assert.ok(f.context.caseMass);
  const context = { ...f.context,
    caseMass: name === "unbound" ? { ...f.context.caseMass, massKg: 1000 }
      : name === "missing evidence IDs" ? { ...f.context.caseMass, evidenceIds: [] } : f.context.caseMass,
    documents: f.context.documents.map((d) => d.record.sourceId !== f.massDocument.record.sourceId ? d
      : name === "stale" ? { ...d, observedOn: "2026-09-01" }
      : name === "out of period" ? { ...d, record: { ...d.record, effectiveTo: "2026-11-04" } }
      : name === "unverified rights" ? { ...d, record: { ...d.record, licenseVerified: false } } : d),
  };
  const input = { ...f.input, baselineRouteId: f.route.routeId, evidence: context.documents
    .filter((d) => name !== "missing input evidence" || d.record.sourceId !== f.massDocument.record.sourceId).map((d) => d.record) };
  const result = (await createComparisonCalculator(context)(input, [assessment]))[0];
  assert.ok(result && result.avoidedEmissions.state === "baseline-provided");
  for (const value of [result.netCost, result.grossEmissions, result.materialCredit, result.energyCredit, result.netEmissions, result.avoidedEmissions.amount]) {
    assert.ok(value.state === "unavailable" && value.missingInputs.includes(reason), JSON.stringify(value));
  }
  assert.ok(result.carbonLines.every((line) => line.amount.state === "available"));
});

test("P1: malformed mass numbers and schema throw typed ValidationError before arithmetic", async () => {
  const f = carbonFixture();
  assert.ok(f.context.caseMass);
  const { material: omitted, ...incomplete } = f.context.caseMass;
  assert.ok(omitted);
  const malformed: readonly unknown[] = [
    ...[0, -1, NaN, Infinity, -Infinity, "2000", null, undefined].map((massKg) => ({ ...f.context.caseMass, massKg })),
    {}, [], "2000kg", incomplete, { ...f.context.caseMass, evidenceIds: "synthetic-evidence" },
    { ...f.context.caseMass, stageMassKg: 100 }, { ...f.context.caseMass, assessmentDate: "not-a-date" },
  ];
  for (const caseMass of malformed) {
    const context = structuredClone(f.context);
    Reflect.set(context, "caseMass", caseMass);
    await assert.rejects(() => createComparisonCalculator(context)(f.input, [assessment]), (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.equal(error.reason, "invalid-case-mass-review");
      return true;
    });
  }
  const impossible = { ...f.context, caseMass: { ...f.context.caseMass, assessmentDate: "2026-02-30" } };
  await assert.rejects(() => createComparisonCalculator(impossible)(f.input, [assessment]), (error: unknown) => error instanceof ValidationError && error.reason === "invalid-date");
});

test("P1: functional unit is opaque text; only the explicit anchor establishes mass", async () => {
  for (const functionalUnit of ["synthetic-opaque-unit", "synthetic-1000kg"]) {
    const f = carbonFixture();
    assert.ok(f.context.caseMass);
    const bound = bindSynthetic({ ...f.input, functionalUnit }, { ...f.context, caseMass: { ...f.context.caseMass, functionalUnit },
      routes: f.context.routes.map((r) => ({ ...r, functionalUnit })),
    });
    const result = (await createComparisonCalculator(bound.context)(bound.input, [assessment]))[0];
    assert.ok(result && result.netCost.state === "available" && result.netEmissions.state === "available");
    assert.deepEqual([result.netCost.central, result.netEmissions.central], [240000, 45]);
  }
});
