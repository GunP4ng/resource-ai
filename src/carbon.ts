import type { ActivityInput, ComparisonInput, Estimate, RouteCalculationInput, ScenarioComparison } from "./contracts.ts";
import { binding, caseMassReview, caseMassTotal, overlaps, routeReview, validateCalculation } from "./o-calculation.ts";
import type { CalculationContext, RouteReview } from "./o-calculation.ts";
import { canonical, period, point, quantity, requireValid, subtract, sum, unavailable } from "./o-validation.ts";

export const materialExclusion = "원료 대체효과 제외 경계 · 계산상 0 반영 · 실측·근거 기반 0 아님";
export const energyExclusion = "에너지 대체효과 제외 경계 · 계산상 0 반영 · 실측·근거 기반 0 아님";
export const restrictedNet = "대체효과 제외 경계의 순배출 · 완전한 순탄소 비교 아님";
export function creditPolicyNotes(values: readonly Estimate<"kgCO2e">[]): string[] {
  return [...new Set(values.flatMap((value) => value.state === "available"
    ? value.assumptions.filter((note) => [materialExclusion, energyExclusion, restrictedNet].includes(note)) : []))];
}

function carbonAmount(input: ComparisonInput, a: ActivityInput, context: CalculationContext, boundary: RouteReview | null): Estimate<"kgCO2e"> {
  const amount = quantity(a.amount);
  if (a.amount.evidenceIds.length === 0) return unavailable("activity-quantity-evidence-missing");
  if (a.factorId === null || a.factorVersion === null) return unavailable("factor-id-or-version-missing");
  const f = input.factors.find((v) => v.factorId === a.factorId && v.version === a.factorVersion);
  if (f === undefined) return unavailable("factor-version-unresolved");
  const rate = quantity(f.kgCo2ePerUnit);
  if (f.kgCo2ePerUnit.evidenceIds.length === 0) return unavailable("factor-quantity-evidence-missing");
  const ar = context.activities.find((v) => v.activityId === a.activityId && v.caseId === input.caseId && v.routeId === boundary?.routeId);
  const fr = context.factors.find((v) => v.factorId === f.factorId && v.version === f.version && v.registryVersion === input.factorRegistryVersion);
  if (ar === undefined || fr === undefined || boundary === null) return unavailable("activity-factor-or-boundary-review-missing");
  const ids = [...a.amount.evidenceIds, ...ar.evidenceIds, ...f.kgCo2ePerUnit.evidenceIds, ...fr.evidenceIds];
  const ai = binding(context, input, { key: `activity:${a.activityId}`, value: { activity: a, review: ar }, evidenceIds: [...a.amount.evidenceIds, ...ar.evidenceIds] });
  const fi = binding(context, input, { key: `factor:${f.factorId}:${f.version}`, value: { factor: f, review: fr }, evidenceIds: [...f.kgCo2ePerUnit.evidenceIds, ...fr.evidenceIds] });
  if (ai !== null || fi !== null) return unavailable(ai ?? fi ?? "binding-missing");
  if (f.reusePermission !== "verified") return unavailable("factor-reuse-unverified");
  if (!period(fr.validFrom, fr.validTo, input.assessmentDate)) return unavailable("factor-out-of-period");
  for (const key of ["material", "condition", "region", "process", "moistureBasis", "gasCoverage", "gwpMethod"] as const) {
    if (fr[key] !== boundary[key]) return unavailable(`factor-${key}-incompatible`);
  }
  if (f.region !== fr.region || f.gwpMethod !== fr.gwpMethod || f.boundary !== input.boundary || f.period !== `${fr.validFrom}/${fr.validTo}`) return unavailable("factor-declaration-incompatible");
  if (ar.massBasis !== fr.massBasis || ar.moistureBasis !== fr.moistureBasis || ar.allocation !== fr.allocation) return unavailable("activity-basis-incompatible");
  if (!f.includedStages.includes(a.stage) || canonical([...ar.components].sort()) !== canonical([...fr.components].sort())) return unavailable("factor-coverage-incompatible");
  if (f.includedStages.length !== 1) return unavailable("multi-stage-factor-unsupported");
  if (fr.embeddedCredits) return unavailable("embedded-credit-factor-unsupported");
  if (amount === null || rate === null) return unavailable("activity-or-factor-quantity-missing");
  let converted = amount;
  if (a.amount.unit !== f.denominatorUnit) {
    if (a.amount.unit === "kg" && f.denominatorUnit === "t") converted /= 1000;
    else if (a.amount.unit === "t" && f.denominatorUnit === "kg") converted *= 1000;
    else return unavailable("activity-unit-incompatible");
  }
  if (a.stage === "material-credit" || a.stage === "energy-credit") {
    if (ar.outputQuantity === null || ar.substitutionRatio === null || ar.displaced === null || ar.substitution === null || ar.substitution !== fr.substitution) return unavailable("substitution-evidence-missing");
    requireValid(Number.isFinite(ar.outputQuantity * ar.substitutionRatio), "arithmetic-overflow");
    // Output and substituted activity use the activity's declared denominator unit.
    if (Math.abs(ar.outputQuantity * ar.substitutionRatio - amount) > 1e-9 * Math.max(1, amount)) return unavailable("substitution-derivation-mismatch");
  }
  const result = point(converted * rate, "kgCO2e", ids);
  return result.state === "available" ? { ...result, assumptions: [...result.assumptions,
    `활동 원문 위치: /facts/${`activity:${a.activityId}`.replaceAll("~", "~0").replaceAll("/", "~1")}`,
    `계수 원문 위치: /facts/${`factor:${f.factorId}:${f.version}`.replaceAll("~", "~0").replaceAll("/", "~1")}`] } : result;
}
export function calculateRouteCarbon(input: ComparisonInput, route: RouteCalculationInput, context: CalculationContext): Pick<ScenarioComparison, "carbonLines" | "grossEmissions" | "materialCredit" | "energyCredit" | "netEmissions"> {
  validateCalculation(input, context);
  const boundary = routeReview(input, route, context);
  const mass = caseMassReview(input, boundary, context);
  const carbonLines = route.activities.map((a) => ({ activityId: a.activityId, stage: a.stage, factorId: a.factorId, factorVersion: a.factorVersion, amount: carbonAmount(input, a, context, boundary) }));
  const components = route.activities.map((a) => context.activities.find((v) => v.activityId === a.activityId)?.components ?? []);
  requireValid(!overlaps(components), "carbon-coverage-overlap");
  const grossActivities = route.activities.filter((a) => a.stage !== "material-credit" && a.stage !== "energy-credit");
  for (const a of route.activities) {
    const factor = input.factors.find((f) => f.factorId === a.factorId && f.version === a.factorVersion);
    requireValid(!factor?.includedStages.some((stage) => stage !== a.stage && route.activities.some((other) => other.activityId !== a.activityId && other.stage === stage)), "embedded-stage-overlap");
  }
  const covered = grossActivities.flatMap((a) => context.activities.find((v) => v.activityId === a.activityId)?.components ?? []);
  if (boundary !== null) requireValid(covered.every((c) => boundary.carbonComponents.includes(c)), "carbon-component-outside-boundary");
  requireValid(!overlaps([covered, boundary?.carbonExclusions ?? []]), "carbon-exclusion-overlap");
  const missing = boundary === null ? ["boundary-review-missing"] : boundary.carbonComponents.filter((c) => !covered.includes(c) && !boundary.carbonExclusions.includes(c)).map((c) => `carbon-coverage-missing:${c}`);
  const grossLines = carbonLines.filter((l) => l.stage !== "material-credit" && l.stage !== "energy-credit");
  const grossEmissions = caseMassTotal(missing.length || route.missingInputs.length ? unavailable([...missing, ...route.missingInputs]) : sum(grossLines.map((l) => l.amount), "kgCO2e"), mass);
  const credit = (stage: "material-credit" | "energy-credit", excluded: boolean): Estimate<"kgCO2e"> => {
    const lines = carbonLines.filter((l) => l.stage === stage);
    requireValid(!excluded || lines.length === 0, "credit-exclusion-overlap");
    if (excluded && boundary !== null) {
      const zero = point(0, "kgCO2e", boundary.evidenceIds);
      return zero.state === "available" ? { ...zero, assumptions: [...zero.assumptions, stage === "material-credit" ? materialExclusion : energyExclusion] } : zero;
    }
    return lines.length ? sum(lines.map((l) => l.amount), "kgCO2e") : unavailable(`${stage}-evidence-missing`);
  };
  const materialCredit = caseMassTotal(credit("material-credit", boundary?.materialCreditExcluded ?? false), mass);
  const energyCredit = caseMassTotal(credit("energy-credit", boundary?.energyCreditExcluded ?? false), mass);
  const net = subtract(grossEmissions, [materialCredit, energyCredit], "kgCO2e");
  const policies = creditPolicyNotes([materialCredit, energyCredit]);
  const netEmissions = caseMassTotal(net.state === "available" && policies.length
    ? { ...net, assumptions: [...net.assumptions, ...policies, restrictedNet] } : net, mass);
  return { carbonLines, grossEmissions, materialCredit, energyCredit, netEmissions };
}
export function compatibleBaseline(a: RouteReview | null, b: RouteReview | null): boolean {
  if (a === null || b === null) return false;
  const keys = ["functionalUnit", "boundary", "material", "condition", "massBasis", "moistureBasis", "gasCoverage", "gwpMethod", "materialCreditExcluded", "energyCreditExcluded"] as const;
  return keys.every((key) => a[key] === b[key]) && canonical([...a.carbonComponents].sort()) === canonical([...b.carbonComponents].sort())
    && canonical([...a.carbonExclusions].sort()) === canonical([...b.carbonExclusions].sort());
}
