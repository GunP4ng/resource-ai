import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateRouteCost } from "../src/cost.ts";
import { bindSynthetic, calculationFixture, treatment, transport, sales, child, sq } from "../src/o-synthetic.ts";
import type { QuoteInput } from "../src/contracts.ts";
import type { QuoteReview } from "../src/o-calculation.ts";
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
  for (const [change, reason] of [[{ caseMassKg: 1000 }, "quote-mass-inapplicable"], [{ conditions: ["verify loading"] }, "quote-conditions-unresolved"], [{ material: "different" }, "quote-material-inapplicable"]] satisfies readonly [Partial<QuoteReview>, string][]) {
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
