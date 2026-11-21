import { closure, lookup, requireData, label, model, boundary } from "./o-public-calculation-validation.ts";
import type { Dataset, Input, PublicCalculationRoute, PublicCalculationResult } from "./o-public-calculation-schema.ts";
import type { VerifiedPublicDataset } from "./o-public-calculation-data.ts";
function display(value: number | null, places: number): string | null {
  if (value === null) return null;
  requireData(Number.isFinite(value), "E_FINITE");
  const [coefficient = "0", exponent = "0"] = Math.abs(value).toString().split("e");
  const [whole = "0", fraction = ""] = coefficient.split(".");
  const digits = BigInt(whole + fraction), shift = Number(exponent) - fraction.length + places;
  const divisor = 10n ** BigInt(Math.max(0, -shift));
  const rounded = shift >= 0 ? digits * 10n ** BigInt(shift) : (digits + divisor / 2n) / divisor;
  const padded = rounded.toString().padStart(places + 1, "0");
  return (value < 0 && rounded !== 0n ? "-" : "") + (places ? padded.slice(0, -places) + "." + padded.slice(-places) : padded);
}
export function buildPublicCalculations(verified: VerifiedPublicDataset) {
  const { data } = verified;
  const routes: PublicCalculationRoute[] = [], results: PublicCalculationResult[] = [];
  for (const c of data.cases) {
    const ids = closure(data, [...c.input_ids, ...["c", "s", "r", "d1", "d2", "d0", "f", "f_rec", "f_inc"],
      ...["recycling", "landfill", "energy_recovery"].map(r => `warm.${c.material}.${r}`)]);
    const value = (id: string) => lookup(data, id).value;
    const v = (id: string) => { const n = value(id); requireData(n !== null, "E_REQUIRED"); return n; };
    const m = c.mass_t, y = value(`${c.material}.y`), p = value(`${c.material}.price`);
    const a = m === null || y === null ? null : m * y, b = m === null || a === null ? null : m - a;
    requireData(m === null || (a !== null && b !== null && a <= m && b >= 0 && Math.abs(a + b - m) < 1e-12), "E_MASS");
    const baselineCost = m === null || ["c", "d0", "r", "f"].some(id => value(id) === null) ? null : m * (v("c") + v("d0") * v("r") + v("f"));
    const baselineCarbon = m === null || value(`warm.${c.material}.landfill`) === null ? null : m * v(`warm.${c.material}.landfill`) * 1000 / 0.90718474;
    for (const route_id of ["recycling", "landfill", "energy_recovery"] as const) {
      const recycling = route_id === "recycling", incineration = route_id === "energy_recovery";
      const needed = recycling ? ["c", "s", "r", "d1", "d2", "f", "f_rec", `${c.material}.price`] : ["c", "r", "d0", incineration ? "f_inc" : "f"];
      const costMissing = [...(m === null ? ["missing_mass"] : []), ...needed.filter(id => value(id) === null).map(id => `missing:${id}`)];
      const carbonIds = (recycling ? ["recycling", "landfill"] : [route_id]).map(r => `warm.${c.material}.${r}`);
      const carbonMissing = [...(m === null ? ["missing_mass"] : []), ...carbonIds.filter(id => value(id) === null).map(id => `missing:${id}`)];
      let components = costMissing.length || m === null || a === null || b === null ? null : {
        collection: m * v("c"), transport: (recycling ? m * v("d1") + b * v("d2") : m * v("d0")) * v("r"),
        sorting: recycling ? m * v("s") : 0, treatment: recycling ? b * v("f") + a * v("f_rec") : m * v(incineration ? "f_inc" : "f") };
      let revenue = components === null || a === null || (recycling && p === null) ? null : recycling ? a * v(`${c.material}.price`) : 0;
      let cost = components === null || revenue === null ? null : Object.values(components).reduce((sum, n) => sum + n, 0) - revenue;
      let carbon = carbonMissing.length || m === null || a === null || b === null ? null :
        (recycling ? a * v(`warm.${c.material}.recycling`) + b * v(`warm.${c.material}.landfill`) : m * v(`warm.${c.material}.${route_id}`)) * 1000 / 0.90718474;
      let saving = cost === null || baselineCost === null ? null : baselineCost - cost;
      let difference = carbon === null || baselineCarbon === null ? null : baselineCarbon - carbon;
      let perTonneCost = !m || cost === null ? null : cost / m;
      let perTonneCarbon = !m || carbon === null ? null : carbon / m;
      if ([...Object.values(components ?? {}), revenue, cost, saving, perTonneCost].some(n => n !== null && !Number.isFinite(n))) {
        components = null; revenue = null; cost = null; saving = null; perTonneCost = null;
        costMissing.push("arithmetic_overflow");
      }
      if ([carbon, difference, perTonneCarbon].some(n => n !== null && !Number.isFinite(n))) {
        carbon = null; difference = null; perTonneCarbon = null;
        carbonMissing.push("arithmetic_overflow");
      }
      const shared = { case_id: c.case_id, route_id, model_version: model, scenario_type: "synthetic", label, calculation_label: label,
        facility_eligibility: "unverified_assumption", commercial_ready: false, carbon_boundary_id: boundary, embedded_transport: true } as const;
      routes.push({ ...shared, steps: recycling ? ["collection", "sorting", "resin_recycling", "residue_landfill"] : ["collection", route_id],
        mass_flow: { input_t: m, recycling_t: recycling ? a : m === null ? null : 0, residue_t: recycling ? b : m },
        distance_legs: recycling ? [{ mass_t: m, distance_input_id: "d1" }, { mass_t: b, distance_input_id: "d2" }] : [{ mass_t: m, distance_input_id: "d0" }],
        cost_formula: `cost.${route_id}.v1`, carbon_formula: `warm.${route_id}.v1`, missing_inputs: { cost: costMissing, carbon: carbonMissing } });
      results.push({ ...shared, input_ids: ids, source_ids: [...new Set(ids.flatMap(id => { const s = lookup(data, id).source_id; return s === null ? [] : [s]; }))].sort(),
        cost_components_krw: components, revenue_krw: revenue, net_cost_krw: cost, net_carbon_kgco2e: carbon,
        baseline_id: `${c.case_id}:landfill:${model}`, cost_saving_krw: saving, scenario_carbon_difference_kgco2e: difference,
        transport_diagnostic_kgco2e: null, transport_diagnostic_reason: "not_included_in_this_model", rights_status: "unconfirmed_for_WARM_and_Wonju_fee",
        availability: { cost: cost === null ? "unavailable" : "available", carbon: carbon === null ? "unavailable" : "available" }, missing_inputs: { cost: costMissing, carbon: carbonMissing },
        per_tonne: { cost_krw: perTonneCost, carbon_kgco2e: perTonneCarbon },
        rounding: { internal: "unrounded", KRW_display: 0, kgCO2e_display: 2, mode: "half_away_from_zero" },
        display: { net_cost_krw: display(cost, 0), net_carbon_kgco2e: display(carbon, 2), cost_saving_krw: display(saving, 0), scenario_carbon_difference_kgco2e: display(difference, 2) } });
    }
  }
  const { data: _data, ...receipt } = verified;
  return { ...receipt, schema_version: 1 as const, model_version: model, purpose: "research_scenario", sources: data.sources,
    inputs: data.inputs, cases: data.cases, routes, results, limitations: data.limitations };
}
export function projectCommercialReferences(bundle: PublicCalculationBundle) {
  const data: Dataset = bundle;
  const permitted = (i: Input) => closure(data, [i.input_id]).every(id => {
    const item = lookup(data, id), s = data.sources.find(s => s.source_id === item.source_id);
    return item.kind === "derived" && s?.source_id === "KECO" && s.commercial_use === "allowed_with_conditions" && s.redistribution === "allowed_with_conditions";
  });
  return { schema_version: 1, purpose: "commercial_reference_only", sources: data.sources.filter(s => s.source_id === "KECO").map(s => ({
    source_id: s.source_id, agency: s.agency, title: s.title, url: s.url, retrieved_at: s.retrieved_at, published_or_period: s.published_or_period,
    locator: s.locator, original_unit: s.original_unit, raw_sha256: s.raw_sha256, selected_cells: s.selected_cells,
    rights_url: s.rights_url, rights_notice_summary: s.rights_notice_summary, commercial_use: s.commercial_use, redistribution: s.redistribution, rights_checked_at: s.rights_checked_at })),
    inputs: data.inputs.filter(permitted).map(i => ({ input_id: i.input_id, value: i.value, unit: i.unit, kind: i.kind, source_id: i.source_id,
      source_value: i.source_value, source_unit: i.source_unit, cell_id: i.cell_id, transform: i.transform, geography: i.geography, period: i.period,
      quality_grade: i.quality_grade, tax_basis: i.tax_basis, depends_on_input_ids: i.depends_on_input_ids, missing_reason: i.missing_reason })),
    cases: [], routes: [], results: [], exclusions: [
      ...data.sources.filter(s => s.source_id !== "KECO").map(s => ({ id: s.source_id, reason: "rights_unconfirmed" })),
      ...data.inputs.filter(i => !permitted(i)).map(i => ({ id: i.input_id, reason: "scenario_or_restricted_dependency" })),
      ...bundle.results.map(r => ({ id: `${r.case_id}:${r.route_id}:${r.model_version}`, reason: "restricted_dependency" }))] };
}

export type PublicCalculationBundle = ReturnType<typeof buildPublicCalculations>;
export type CommercialReferenceBundle = ReturnType<typeof projectCommercialReferences>;
