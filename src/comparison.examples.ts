import type { ComparisonInput, QuoteInput, ScenarioComparison } from "./contracts.ts";

// Format examples only: nulls are intentional, no real quotations or factors.
const quoteA: QuoteInput = {
  quoteId: "format-only-quote-A",
  category: "treatment",
  basis: {
    kind: "per-kg",
    rate: { value: null, unit: "KRW/kg", evidenceIds: [], missingReason: "Actual quote A required" },
    amount: { value: null, unit: "kg", evidenceIds: [], missingReason: "Measured mass required" },
  },
  validThrough: null,
  vat: "unknown",
  includedInQuoteId: null,
  revenueRecipient: "not-applicable",
};
const quoteB: QuoteInput = { ...quoteA, quoteId: "format-only-quote-B" };

export const quoteVariants: readonly ComparisonInput[] = [quoteA, quoteB].map((quote) => ({
  caseId: "same-case-format-only",
  assessmentDate: "2026-11-05",
  functionalUnit: "Same waste at the factory gate; mass not yet measured",
  boundary: "Collection through treatment and residue, with credits reported separately",
  baselineRouteId: null,
  routes: [{ routeId: "candidate-route", quotes: [quote], activities: [], missingInputs: ["Activity data and factors"] }],
  factorRegistryVersion: "not-collected",
  factors: [],
  evidence: [],
}));

export const noBaselineExample: ScenarioComparison = {
  routeId: "candidate-route",
  functionalUnit: quoteVariants[0]?.functionalUnit ?? "Unmeasured format example",
  boundary: "Collection through treatment and residue",
  costLines: [{
    quoteId: quoteA.quoteId,
    category: "treatment",
    amount: { state: "unavailable", missingInputs: ["Actual quotation and mass"] },
  }],
  carbonLines: [],
  netCost: { state: "unavailable", missingInputs: ["Complete non-overlapping quotations"] },
  grossEmissions: { state: "unavailable", missingInputs: ["Verified activities and factors"] },
  materialCredit: { state: "unavailable", missingInputs: ["Verified substitution evidence"] },
  energyCredit: { state: "unavailable", missingInputs: ["Verified energy recovery evidence"] },
  netEmissions: { state: "unavailable", missingInputs: ["Complete boundary"] },
  avoidedEmissions: { state: "no-baseline" },
};
