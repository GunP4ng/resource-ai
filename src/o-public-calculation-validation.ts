import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import { canonical, date } from "./o-validation.ts";
import { CaseInputSchema, manifestSchema } from "./o-public-calculation-schema.ts";
import type { Dataset, Input } from "./o-public-calculation-schema.ts";
const text = Type.String({ minLength: 1, pattern: "\\S" });
export const label = "공개 자료 기반 계산값(관측값 아님)";
export const model = "stage2-plastics-2026-11-15-v1";
export const boundary = "EPA-WARM-v16-US-default-net-lifecycle";
export const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
export class Invalid extends Error { constructor(readonly code: string) { super(code); } }
export function requireData(ok: unknown, code: string): asserts ok { if (!ok) throw new Invalid(code); }
export function parse<S extends TSchema>(schema: S, raw: unknown): Type.Static<S> {
  requireData(Value.Check(schema, raw), "E_REQUIRED");
  return Value.Parse(schema, raw);
}
export const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));
export function required<T>(value: T | undefined): T { requireData(value !== undefined, "E_PROVENANCE"); return value; }
export function lookup(data: Dataset, id: string): Input { return required(data.inputs.find(item => item.input_id === id)); }
const priceReferenceId = (material: string) => `price.${material === "HDPE" ? "PE" : material}`;
export function closure(data: Dataset, ids: readonly string[], visiting: readonly string[] = []): readonly string[] {
  return [...new Set(ids.flatMap(id => {
    requireData(!visiting.includes(id), "E_PROVENANCE");
    return [id, ...closure(data, lookup(data, id).depends_on_input_ids, [...visiting, id])];
  }))].sort();
}
export async function validatePublicCalculationData(data: Dataset, manifest: Type.Static<typeof manifestSchema>, root: string, evidence?: string) {
  requireData(data.model_version === model && data.sources.length === 3 && data.cases.length === 3, "E_MODEL");
  for (const entries of [data.sources.map(s => s.source_id), data.inputs.map(i => i.input_id), data.cases.map(c => c.case_id)])
    requireData(new Set(entries).size === entries.length, "E_PROVENANCE");
  for (const s of data.sources) {
    requireData(s.commercial_use !== "prohibited" && s.redistribution !== "prohibited", "E_RIGHTS_PROHIBITED");
    date(s.rights_checked_at);
    date(s.retrieved_at.slice(0, 10));
    requireData(Number.isFinite(Date.parse(s.retrieved_at)), "E_SOURCE_METADATA");
  }
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
    date(c.assessment_date);
    date(c.provenance.creationDate);
    requireData(manifest.upstream.some(p => p.path === c.original_path && p.sha256 === c.original_sha256), "E_PROVENANCE");
    const original = parse(CaseInputSchema, await readJson(join(root, c.original_path)));
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
}
