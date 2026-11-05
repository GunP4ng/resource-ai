import { createHash } from "node:crypto";
import { Type } from "typebox";
import { Value } from "typebox/value";
import manifestJson from "../data/sources/manifest.json" with { type: "json" };
import type { EvidenceRecord } from "./contracts.ts";

const SourceSchema = Type.Object({
  sourceId: Type.String(),
  category: Type.Union([Type.Literal("law"), Type.Literal("processor"), Type.Literal("price"), Type.Literal("factor")]),
  legalFamily: Type.Optional(Type.Union([Type.Literal("waste-rule"), Type.Literal("food-resin-notice")])),
  title: Type.String(),
  publisher: Type.String(),
  url: Type.String(),
  downloadUrl: Type.Union([Type.String(), Type.Null()]),
  retrievedAt: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$" }),
  datasetVersion: Type.String(),
  sourceDate: Type.Union([Type.String(), Type.Null()]),
  effectiveFrom: Type.Union([Type.String(), Type.Null()]),
  effectiveTo: Type.Union([Type.String(), Type.Null()]),
  sha256: Type.Union([Type.String(), Type.Null()]),
  license: Type.Union([Type.String(), Type.Null()]),
  licenseVerified: Type.Boolean(),
  access: Type.Union([Type.Literal("bundled"), Type.Literal("downloaded-not-bundled"), Type.Literal("body-only"), Type.Literal("metadata-only")]),
  localPath: Type.Union([Type.String(), Type.Null()]),
  verifiedFields: Type.Array(Type.String()),
  missing: Type.Array(Type.String()),
  derivedFrom: Type.Optional(Type.String({ pattern: "^[a-f0-9]{64}$" })),
  removedColumns: Type.Optional(Type.Array(Type.String())),
});

const ManifestSchema = Type.Object({ snapshotDate: Type.String(), sources: Type.Array(SourceSchema) });
export type SourceManifestEntry = Readonly<Type.Static<typeof SourceSchema>>;
export const sourceManifest: readonly SourceManifestEntry[] = Value.Parse(ManifestSchema, manifestJson).sources;

export type SourceFailure = "reuse-unverified" | "hash-mismatch" | "snapshot-unavailable" | "invalid-source" | "encoding-error";
export type QualityIssue = { readonly kind: "header" | "row-length" | "date" | "invalid-price" | "duplicate" | "missing-name"; readonly rowNumber: number };
export type SkippedRows = { readonly count: number; readonly rowNumbers: readonly number[] };

export interface PriceRecord {
  readonly sourceId: string;
  readonly rowNumber: number;
  readonly itemLabel: string;
  readonly polymer: string;
  readonly form: string;
  readonly quality: string | null;
  readonly region: string;
  readonly sourceLocator: string;
  readonly observedOn: string;
  readonly surveyMonth: string;
  readonly publishedOn: string;
  readonly priceKrwPerKg: number | null;
  readonly missingReason: "unpublished" | "invalid-value" | null;
  readonly priceKind: "reference-sale-price";
  readonly vat: "unverified";
  readonly logistics: "unverified";
}

export interface ProcessorDirectoryRow {
  readonly sourceId: string;
  readonly rowNumber: number;
  readonly name: string;
  readonly district: string;
  readonly officeAddress: string;
  readonly serviceArea: string;
  readonly description: string;
  readonly sourceDate: string;
  readonly permitStatus: "unverified";
  readonly acceptedWasteCodes: readonly string[];
}

const regions = ["수도권", "강원", "충북", "충남", "전북", "전남", "경북", "경남"] as const;
const priceHeader = ["시점", "구분", ...regions, "데이터 기준일"] as const;
const processorHeader = ["구분", "업체명", "대표자", "사무실 소재지", "전화번호", "영업구역", "비고"] as const;
const sanitizedProcessorHeader = ["구분", "업체명", "사무실 소재지", "영업구역", "비고"] as const;

function csvLines(csv: string): readonly { readonly cells: readonly string[]; readonly rowNumber: number }[] {
  const rows: { cells: string[]; rowNumber: number }[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let rowNumber = 1;
  let lineNumber = 1;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (char === '"') {
      if (quoted && csv[index + 1] === '"') { cell += '"'; index += 1; }
      else if (quoted || cell === "") quoted = !quoted;
      else cell += char;
    } else if (char === "," && !quoted) {
      cells.push(cell); cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      cells.push(cell); rows.push({ cells, rowNumber }); cells = []; cell = "";
      if (char === "\r" && csv[index + 1] === "\n") index += 1;
      lineNumber += 1; rowNumber = lineNumber;
    } else if (char !== undefined) {
      cell += char;
      if (char === "\n") lineNumber += 1;
    }
  }
  if (cell !== "" || cells.length > 0) { cells.push(cell); rows.push({ cells, rowNumber }); }
  return rows;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function verifiedBytes(bytes: Uint8Array, source: SourceManifestEntry, category: SourceManifestEntry["category"]): SourceFailure | null {
  if (source.category !== category) return "invalid-source";
  if (!source.licenseVerified || source.license === null) return "reuse-unverified";
  if (source.sha256 === null || (source.access !== "bundled" && source.access !== "downloaded-not-bundled")) return "snapshot-unavailable";
  return createHash("sha256").update(bytes).digest("hex") === source.sha256 ? null : "hash-mismatch";
}

function decodeSource(bytes: Uint8Array, encoding = "euc-kr"): string | null {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

export function normalizePriceCsv(csv: string, sourceId: string): { readonly rows: readonly PriceRecord[]; readonly issues: readonly QualityIssue[]; readonly skipped: SkippedRows } {
  const lines = csvLines(csv);
  if (lines[0]?.cells.join(",") !== priceHeader.join(",")) return { rows: [], issues: [{ kind: "header", rowNumber: 1 }], skipped: { count: 0, rowNumbers: [] } };
  const rows: PriceRecord[] = [];
  const issues: QualityIssue[] = [];
  const skipped: number[] = [];
  const seen = new Set<string>();
  for (const [index, line] of lines.entries()) {
    if (index === 0) continue;
    const { cells, rowNumber } = line;
    if (cells.length !== priceHeader.length) { issues.push({ kind: "row-length", rowNumber }); continue; }
    const observedOn = cells[0] ?? "";
    const itemLabel = cells[1] ?? "";
    const publishedOn = cells[10] ?? "";
    if (!validDate(observedOn) || !validDate(publishedOn)) { issues.push({ kind: "date", rowNumber }); continue; }
    const item = /^(압축|플레이크|펠렛|잉고트)[-_](PE|PP|PS|PET|ABS|PVC|EPS)(?:\(([^)]+)\))?$/.exec(itemLabel);
    if (item === null) { skipped.push(rowNumber); continue; }
    const form = item[1];
    const polymer = item[2];
    if (form === undefined || polymer === undefined) continue;
    const key = `${observedOn}|${itemLabel}`;
    if (seen.has(key)) { issues.push({ kind: "duplicate", rowNumber }); continue; }
    seen.add(key);
    for (const [regionIndex, region] of regions.entries()) {
      const raw = cells[regionIndex + 2]?.trim() ?? "";
      const validPrice = /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw) && Number.isFinite(Number(raw));
      if (raw !== "" && !validPrice) issues.push({ kind: "invalid-price", rowNumber });
      const price = validPrice ? Number(raw) : null;
      rows.push({ sourceId, rowNumber, itemLabel, polymer, form, quality: item[3] ?? null, region,
        sourceLocator: `CSV row ${rowNumber}, column ${region}`, observedOn,
        surveyMonth: observedOn.slice(0, 7), publishedOn, priceKrwPerKg: price,
        missingReason: raw === "" ? "unpublished" : validPrice ? null : "invalid-value",
        priceKind: "reference-sale-price", vat: "unverified", logistics: "unverified" });
    }
  }
  return { rows, issues, skipped: { count: skipped.length, rowNumbers: skipped } };
}

export function readPriceSnapshot(bytes: Uint8Array, source: SourceManifestEntry):
  | { readonly state: "available"; readonly rows: readonly PriceRecord[]; readonly issues: readonly QualityIssue[]; readonly skipped: SkippedRows; readonly evidence: EvidenceRecord }
  | { readonly state: "unavailable"; readonly reason: SourceFailure } {
  const failure = verifiedBytes(bytes, source, "price");
  if (failure !== null) return { state: "unavailable", reason: failure };
  const csv = decodeSource(bytes);
  if (csv === null) return { state: "unavailable", reason: "encoding-error" };
  const normalized = normalizePriceCsv(csv, source.sourceId);
  if (source.sha256 === null || source.license === null) return { state: "unavailable", reason: "snapshot-unavailable" };
  return { state: "available", ...normalized, evidence: {
    sourceId: source.sourceId, title: source.title, publisher: source.publisher, url: source.url,
    locator: `CSV rows 2-${csvLines(csv).length}`, retrievedAt: source.retrievedAt,
    effectiveFrom: source.effectiveFrom, effectiveTo: source.effectiveTo, datasetVersion: source.datasetVersion,
    sha256: source.sha256, license: source.license, licenseVerified: true,
  } };
}

export function normalizeProcessorCsv(csv: string, sourceId: string, sourceDate: string): { readonly rows: readonly ProcessorDirectoryRow[]; readonly issues: readonly QualityIssue[] } {
  if (!validDate(sourceDate)) return { rows: [], issues: [{ kind: "date", rowNumber: 1 }] };
  const lines = csvLines(csv);
  const sanitized = lines[0]?.cells.join(",") === sanitizedProcessorHeader.join(",");
  if (!sanitized && lines[0]?.cells.join(",") !== processorHeader.join(",")) return { rows: [], issues: [{ kind: "header", rowNumber: 1 }] };
  const rows: ProcessorDirectoryRow[] = [];
  const issues: QualityIssue[] = [];
  const seen = new Set<string>();
  for (const [index, line] of lines.entries()) {
    if (index === 0) continue;
    const { cells, rowNumber } = line;
    if (cells.length !== (sanitized ? sanitizedProcessorHeader.length : processorHeader.length)) { issues.push({ kind: "row-length", rowNumber }); continue; }
    const name = cells[1]?.trim() ?? "";
    if (name === "") { issues.push({ kind: "missing-name", rowNumber }); continue; }
    const officeAddress = cells[sanitized ? 2 : 3]?.trim() ?? "";
    const key = `${name}|${officeAddress}`;
    if (seen.has(key)) { issues.push({ kind: "duplicate", rowNumber }); continue; }
    seen.add(key);
    rows.push({ sourceId, rowNumber, name, district: cells[0]?.trim() ?? "", officeAddress,
      serviceArea: cells[sanitized ? 3 : 5]?.trim() ?? "", description: cells[sanitized ? 4 : 6]?.trim() ?? "", sourceDate,
      permitStatus: "unverified", acceptedWasteCodes: [] });
  }
  return { rows, issues };
}

export function readProcessorSnapshot(bytes: Uint8Array, source: SourceManifestEntry):
  | { readonly state: "available"; readonly rows: readonly ProcessorDirectoryRow[]; readonly issues: readonly QualityIssue[] }
  | { readonly state: "unavailable"; readonly reason: SourceFailure } {
  const failure = verifiedBytes(bytes, source, "processor");
  if (failure !== null) return { state: "unavailable", reason: failure };
  const csv = decodeSource(bytes, source.derivedFrom === undefined ? "euc-kr" : "utf-8");
  if (csv === null) return { state: "unavailable", reason: "encoding-error" };
  if (source.sourceDate === null) return { state: "unavailable", reason: "snapshot-unavailable" };
  return { state: "available", ...normalizeProcessorCsv(csv, source.sourceId, source.sourceDate) };
}

export function readSanitizedProcessorSnapshot(bytes: Uint8Array, source: SourceManifestEntry): ReturnType<typeof readProcessorSnapshot> {
  if (source.derivedFrom === undefined || source.removedColumns?.join(",") !== "대표자,전화번호") return { state: "unavailable", reason: "invalid-source" };
  return readProcessorSnapshot(bytes, source);
}
