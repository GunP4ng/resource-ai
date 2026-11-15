import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { TSchema } from "typebox";
import { canonical } from "../src/o-validation.ts";

const text = Type.String({ minLength: 1, pattern: "\\S" }), nullable = Type.Union([Type.Number(), Type.Null()]);
const strings = Type.Array(text), maybeText = Type.Union([text, Type.Null()]);
const rights = Type.Union([Type.Literal("allowed_with_conditions"), Type.Literal("unconfirmed"), Type.Literal("prohibited")]);
const cell = Type.Object({ cell_id: text, material: text, region: text, row: Type.Integer(), column: Type.Integer(), value: Type.Number() }, { additionalProperties: false });
const source = Type.Object({ source_id: text, agency: text, title: text, url: text, retrieved_at: text,
  published_or_period: text, locator: text, original_unit: text, rights_url: text, rights_notice_summary: text,
  commercial_use: rights, redistribution: rights, rights_checked_at: text, raw_sha256: text,
  selected_cells: Type.Array(cell), limitations: strings, geography: text, gwp: text, boundary: text }, { additionalProperties: false });
const input = Type.Object({ input_id: text, value: nullable, unit: text,
  kind: Type.Union([Type.Literal("published_reference"), Type.Literal("assumed"), Type.Literal("derived")]),
  source_id: maybeText, source_value: nullable, source_unit: maybeText, transform: text, assumption_reason: maybeText,
  geography: text, period: text, quality_grade: text, tax_basis: text, depends_on_input_ids: strings,
  missing_reason: maybeText, cell_id: maybeText, gwp: text, boundary: text }, { additionalProperties: false });
const scenario = Type.Object({ case_id: text, material: text, mass_t: nullable, scenario_type: Type.Literal("synthetic"),
  label: text, calculation_label: text, input_ids: strings, material_mapping_assumption: text, facility_eligibility: text,
  commercial_ready: Type.Literal(false), model_version: text, original_path: text, original_sha256: text,
  assessment_date: text, law_version: text, original: Type.Unknown(), provenance: Type.Unknown() }, { additionalProperties: false });
const fixtureSchema = Type.Object({ schema_version: Type.Literal(1), model_version: text,
  sources: Type.Array(source), inputs: Type.Array(input), cases: Type.Array(scenario), limitations: strings }, { additionalProperties: false });
const filePin = Type.Object({ path: text, sha256: text }, { additionalProperties: false });
const manifestSchema = Type.Object({ schema_version: Type.Literal(1), fixture_sha256: text,
  metadata_sha256: text, upstream: Type.Array(filePin), private_evidence: Type.Array(filePin) }, { additionalProperties: false });
type DeepReadonly<T> = T extends readonly (infer U)[] ? readonly DeepReadonly<U>[] : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
type Dataset = DeepReadonly<Type.Static<typeof fixtureSchema>>;
type Input = Dataset["inputs"][number];
const label = "공개 자료 기반 계산값(관측값 아님)", model = "stage2-plastics-2026-11-15-v1";
const boundary = "EPA-WARM-v16-US-default-net-lifecycle", gwp = "as_published_not_independently_harmonized";
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
class Invalid extends Error { constructor(readonly code: string) { super(code); } }
function requireData(ok: unknown, code: string): asserts ok { if (!ok) throw new Invalid(code); }
function parse<S extends TSchema>(schema: S, raw: unknown): Type.Static<S> {
  requireData(Value.Check(schema, raw), "E_REQUIRED");
  return Value.Parse(schema, raw);
}
const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));
function required<T>(value: T | undefined): T { requireData(value !== undefined, "E_PROVENANCE"); return value; }
function lookup(data: Dataset, id: string): Input { return required(data.inputs.find(item => item.input_id === id)); }
const priceReferenceId = (material: string) => `price.${material === "HDPE" ? "PE" : material}`;
function closure(data: Dataset, ids: readonly string[], visiting: readonly string[] = []): readonly string[] {
  return [...new Set(ids.flatMap(id => {
    requireData(!visiting.includes(id), "E_PROVENANCE");
    return [id, ...closure(data, lookup(data, id).depends_on_input_ids, [...visiting, id])];
  }))].sort();
}
async function validate(directory: string, root: string, evidence?: string) {
  const manifestBytes = await readFile(join(directory, "manifest.json")), bytes = await readFile(join(directory, "fixtures.json"));
  const manifest = parse(manifestSchema, JSON.parse(manifestBytes.toString("utf8")));
  requireData(sha(bytes) === manifest.fixture_sha256, "E_FIXTURE_HASH");
  const data: Dataset = parse(fixtureSchema, JSON.parse(bytes.toString("utf8")));
  requireData(data.model_version === model && data.sources.length === 3 && data.cases.length === 3, "E_MODEL");
  for (const entries of [data.sources.map(s => s.source_id), data.inputs.map(i => i.input_id), data.cases.map(c => c.case_id)])
    requireData(new Set(entries).size === entries.length, "E_PROVENANCE");
  for (const s of data.sources) requireData(s.commercial_use !== "prohibited" && s.redistribution !== "prohibited", "E_RIGHTS_PROHIBITED");
  requireData(sha(canonical({ sources: data.sources, upstream: manifest.upstream, private_evidence: manifest.private_evidence })) === manifest.metadata_sha256
    && manifest.metadata_sha256 === "023ab9e288128179674c463912b21584ccc431395ddc7f796057c5bfaa8e3cd5", "E_SOURCE_METADATA");
  for (const pin of manifest.upstream) requireData(sha(await readFile(join(root, pin.path))) === pin.sha256, "E_SOURCE_HASH");
  if (evidence) for (const pin of manifest.private_evidence)
    requireData(sha(await readFile(join(evidence, pin.path))) === pin.sha256, "E_SOURCE_HASH");
  const csv = new TextDecoder("euc-kr").decode(await readFile(join(root, "data/reference/keco-price-2026-10.csv"))).trim().split(/\r?\n/).map(row => row.split(","));
  for (const i of data.inputs) {
    requireData(i.value === null ? i.missing_reason !== null : Number.isFinite(i.value), "E_VALUE");
    requireData(i.value === null || i.input_id.startsWith("warm.") || i.value >= 0, "E_VALUE");
    requireData(i.kind !== "assumed" || (i.source_id === null && i.assumption_reason !== null), "E_PROVENANCE");
    const expectedSource = i.input_id.startsWith("warm.") ? "WARM" : i.input_id.startsWith("price.") ? "KECO" : i.input_id === "fee.reference" ? "Wonju" : null;
    requireData(i.source_id === expectedSource, "E_PROVENANCE");
    requireData(i.source_id !== null || (i.boundary === "scenario" && i.gwp === "not_applicable"), "E_BOUNDARY");
    if (i.source_id !== null) {
      const s = required(data.sources.find(s => s.source_id === i.source_id));
      requireData(i.source_unit === s.original_unit, "E_UNIT");
      requireData(i.gwp === s.gwp, "E_GWP");
      requireData(i.boundary === s.boundary, "E_BOUNDARY");
      const selected = required(s.selected_cells.find(c => c.cell_id === i.cell_id));
      requireData(i.cell_id === (s.source_id === "Wonju" ? "business_waste" : i.input_id.slice(i.input_id.indexOf(".") + 1))
        && canonical(i.depends_on_input_ids) === "[]" && i.geography === selected.region && i.period === s.published_or_period
        && i.kind === (s.source_id === "KECO" ? "derived" : "published_reference"), "E_PROVENANCE");
      requireData(i.transform === (i.kind === "derived" ? "multiply_by_1000" : "identity"), "E_PROVENANCE");
      requireData(i.source_value === selected.value, "E_SOURCE_VALUE");
      requireData(i.value === null || i.value === selected.value * (i.kind === "derived" ? 1000 : 1), "E_SOURCE_VALUE");
      requireData(i.unit === (i.kind === "derived" ? "KRW/metric_tonne" : s.original_unit), "E_UNIT");
      if (s.source_id === "KECO") {
        requireData(Number(csv[selected.row - 1]?.[selected.column - 1]) === selected.value, "E_SOURCE_VALUE");
        requireData(i.quality_grade === "compressed_mixed_colour" && i.tax_basis === "unverified"
          && i.missing_reason === null && i.assumption_reason === null, "E_SOURCE_METADATA");
      }
    } else requireData(i.kind === "assumed" && i.source_value === null && i.source_unit === null && i.cell_id === null, "E_PROVENANCE");
    closure(data, [i.input_id]);
  }
  for (const c of data.cases) {
    requireData(manifest.upstream.some(p => p.path === c.original_path && p.sha256 === c.original_sha256), "E_PROVENANCE");
    const original = parse(Type.Object({ caseId: text, polymer: text, massKg: nullable, assessmentDate: text }), await readJson(join(root, c.original_path)));
    requireData(c.case_id === original.caseId && c.material === original.polymer && canonical(c.original) === canonical(original)
      && c.assessment_date === original.assessmentDate && c.law_version === "290881", "E_ORIGINAL");
    const provenance = parse(Type.Object({ candidates: Type.Array(Type.Object({ candidateId: text })) }),
      await readJson(join(root, "data/candidates/oyeonseok-2026-11-10/manifest.json")));
    requireData(canonical(provenance.candidates.find(p => p.candidateId === c.case_id)) === canonical(c.provenance)
      && sha(await readFile(join(root, c.original_path))) === c.original_sha256, "E_PROVENANCE");
    requireData(c.label === label && c.calculation_label === label && c.model_version === model
      && c.facility_eligibility === "unverified_assumption", "E_MODEL");
    const get = (name: string) => lookup(data, `${c.material}.${name}`);
    requireData(c.mass_t === get("mass").value && (original.massKg !== null || c.mass_t === null), "E_MASS");
    requireData(get("mass").unit === "metric_tonne" && get("y").unit === "fraction"
      && get("price").unit === "KRW/metric_tonne", "E_UNIT");
    const yieldInput = get("y");
    requireData(yieldInput.value !== null && yieldInput.value <= 1, "E_MASS");
    for (const name of ["mass", "y"]) requireData(canonical(get(name).depends_on_input_ids) === "[]", "E_PROVENANCE");
    requireData(canonical(c.input_ids) === canonical(["mass", "y", "price"].map(name => get(name).input_id)), "E_PROVENANCE");
    const price = get("price"), ref = lookup(data, priceReferenceId(c.material));
    requireData(price.kind === "assumed" && price.source_id === null && canonical(price.depends_on_input_ids) === canonical([ref.input_id])
      && (price.value === null || price.value === ref.value), "E_PROVENANCE");
    closure(data, c.input_ids);
  }
  for (const [id, unit] of Object.entries({ c: "KRW/metric_tonne", s: "KRW/metric_tonne", r: "KRW/(metric_tonne*km)",
    d1: "km", d2: "km", d0: "km", f: "KRW/metric_tonne", f_rec: "KRW/metric_tonne", f_inc: "KRW/metric_tonne" })) {
    requireData(lookup(data, id).unit === unit, "E_UNIT");
    const i = lookup(data, id);
    requireData(i.kind === "assumed" && canonical(i.depends_on_input_ids) === canonical(id === "f" ? ["fee.reference"] : []), "E_PROVENANCE");
    requireData(id !== "f" || i.value === null || i.value === lookup(data, "fee.reference").value, "E_PROVENANCE");
  }
  const expectedIds = ["c", "s", "r", "d1", "d2", "d0", "f", "f_rec", "f_inc", "fee.reference",
    ...data.cases.flatMap(c => [priceReferenceId(c.material), ...["mass", "y", "price"].map(n => `${c.material}.${n}`),
      ...["recycling", "landfill", "energy_recovery"].map(n => `warm.${c.material}.${n}`)])].sort();
  requireData(canonical(data.inputs.map(i => i.input_id).sort()) === canonical(expectedIds), "E_PROVENANCE");
  return { data, fixture_sha256: sha(bytes), manifest_sha256: sha(manifestBytes), calculator_sha256: sha(await readFile(fileURLToPath(import.meta.url))) };
}
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
function build(verified: Awaited<ReturnType<typeof validate>>) {
  const { data } = verified, routes = [], results = [];
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
      const components = costMissing.length || m === null || a === null || b === null ? null : {
        collection: m * v("c"), transport: (recycling ? m * v("d1") + b * v("d2") : m * v("d0")) * v("r"),
        sorting: recycling ? m * v("s") : 0, treatment: recycling ? b * v("f") + a * v("f_rec") : m * v(incineration ? "f_inc" : "f") };
      const revenue = components === null || a === null || (recycling && p === null) ? null : recycling ? a * v(`${c.material}.price`) : 0;
      const cost = components === null || revenue === null ? null : Object.values(components).reduce((sum, n) => sum + n, 0) - revenue;
      const carbon = carbonMissing.length || m === null || a === null || b === null ? null :
        (recycling ? a * v(`warm.${c.material}.recycling`) + b * v(`warm.${c.material}.landfill`) : m * v(`warm.${c.material}.${route_id}`)) * 1000 / 0.90718474;
      const saving = cost === null || baselineCost === null ? null : baselineCost - cost;
      const difference = carbon === null || baselineCarbon === null ? null : baselineCarbon - carbon;
      const shared = { case_id: c.case_id, route_id, model_version: model, scenario_type: "synthetic", label, calculation_label: label,
        facility_eligibility: "unverified_assumption", commercial_ready: false, carbon_boundary_id: boundary, embedded_transport: true };
      routes.push({ ...shared, steps: recycling ? ["collection", "sorting", "resin_recycling", "residue_landfill"] : ["collection", route_id],
        mass_flow: { input_t: m, recycling_t: recycling ? a : m === null ? null : 0, residue_t: recycling ? b : m },
        distance_legs: recycling ? [{ mass_t: m, distance_input_id: "d1" }, { mass_t: b, distance_input_id: "d2" }] : [{ mass_t: m, distance_input_id: "d0" }],
        cost_formula: `cost.${route_id}.v1`, carbon_formula: `warm.${route_id}.v1`, missing_inputs: { cost: costMissing, carbon: carbonMissing } });
      results.push({ ...shared, input_ids: ids, source_ids: [...new Set(ids.flatMap(id => { const s = lookup(data, id).source_id; return s === null ? [] : [s]; }))].sort(),
        cost_components_krw: components, revenue_krw: revenue, net_cost_krw: cost, net_carbon_kgco2e: carbon,
        baseline_id: `${c.case_id}:landfill:${model}`, cost_saving_krw: saving, scenario_carbon_difference_kgco2e: difference,
        transport_diagnostic_kgco2e: null, transport_diagnostic_reason: "not_included_in_this_model", rights_status: "unconfirmed_for_WARM_and_Wonju_fee",
        availability: { cost: cost === null ? "unavailable" : "available", carbon: carbon === null ? "unavailable" : "available" }, missing_inputs: { cost: costMissing, carbon: carbonMissing },
        per_tonne: { cost_krw: !m || cost === null ? null : cost / m, carbon_kgco2e: !m || carbon === null ? null : carbon / m },
        rounding: { internal: "unrounded", KRW_display: 0, kgCO2e_display: 2, mode: "half_away_from_zero" },
        display: { net_cost_krw: display(cost, 0), net_carbon_kgco2e: display(carbon, 2), cost_saving_krw: display(saving, 0), scenario_carbon_difference_kgco2e: display(difference, 2) } });
    }
  }
  return { ...verified, data: undefined, schema_version: 1, model_version: model, purpose: "research_scenario", sources: data.sources,
    inputs: data.inputs, cases: data.cases, routes, results, limitations: data.limitations };
}
function commercial(bundle: ReturnType<typeof build>, data: Dataset) {
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
async function main() {
  const [command, ...args] = process.argv.slice(2), options = new Map<string, string>();
  requireData(["validate", "build", "export"].includes(command ?? "") && args.length % 2 === 0, "E_USAGE");
  for (let n = 0; n < args.length; n += 2) {
    const key = required(args[n]), val = required(args[n + 1]);
    requireData(["--dataset", "--root", "--evidence-dir", "--mode", "--input"].includes(key) && !options.has(key) && !val.startsWith("--"), "E_USAGE");
    options.set(key, val);
  }
  requireData(options.has("--dataset") && (command === "validate" ? !options.has("--mode") && !options.has("--input") :
    ["research", ...(command === "export" ? ["commercial"] : [])].includes(options.get("--mode") ?? "") && (command === "export") === options.has("--input")), "E_USAGE");
  const root = resolve(options.get("--root") ?? fileURLToPath(new URL("../", import.meta.url)));
  const verified = await validate(resolve(root, required(options.get("--dataset"))), root, options.get("--evidence-dir"));
  if (command === "validate") return { status: "valid", verification: options.has("--evidence-dir") ? "private_original_hashes" : "pinned_transcriptions", fixture_sha256: verified.fixture_sha256 };
  const bundle = build(verified);
  if (command === "export") requireData(canonical(await readJson(resolve(required(options.get("--input"))))) === canonical(JSON.parse(json(bundle))), "E_EXPORT_MISMATCH");
  return options.get("--mode") === "commercial" ? commercial(bundle, verified.data) : bundle;
}
if (import.meta.main) {
  try { process.stdout.write(json(await main())); }
  catch (error) { // no-excuse-ok: catch — sanitized CLI error boundary; never emit partial output.
    process.stderr.write(`${error instanceof Invalid ? error.code : "E_IO_OR_JSON"}\n`);
    process.exitCode = error instanceof Invalid && error.code === "E_USAGE" ? 2 : 1;
  }
}
