import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import manifestJson from "../data/sources/manifest.json" with { type: "json" };
import { sourceManifest, normalizeProcessorCsv } from "./sources.ts";
import { parse, requireData, required, sha } from "./o-public-calculation-validation.ts";
import { canonical, revision } from "./o-validation.ts";
import { digest, strict } from "./o-public-calculation-schema.ts";
import type { DeepReadonly } from "./o-public-calculation-schema.ts";

const source = required(sourceManifest.find(s => s.sourceId === "ulsan-processors-2025-12-sanitized"));
const text = Type.String();
const maybeText = Type.Union([text, Type.Null()]);
const sourceSchema = Type.Object({
  sourceId: text, category: Type.Literal("processor"), title: text, publisher: text,
  url: text, downloadUrl: maybeText, retrievedAt: text, datasetVersion: text,
  sourceDate: maybeText, effectiveFrom: maybeText, effectiveTo: maybeText, sha256: maybeText,
  license: maybeText, licenseVerified: Type.Boolean(), access: Type.Literal("bundled"),
  localPath: maybeText, derivedFrom: digest, removedColumns: Type.Array(text),
  verifiedFields: Type.Array(text), missing: Type.Array(text),
}, strict);
const listingSchema = Type.Object({
  sourceId: text, rowNumber: Type.Integer({ minimum: 2 }), name: text, district: text,
  officeAddress: text, serviceArea: text, description: text, sourceDate: text,
  permitStatus: Type.Literal("unverified"), acceptedWasteCodes: Type.Array(Type.Never()),
}, strict);
export const PublicProcessorResearchSchema = Type.Object({
  provenance: Type.Literal("public"), source: sourceSchema, datasetSha256: digest, sourceManifestSha256: digest,
  rows: Type.Array(Type.Object({
    listing: listingSchema, rowSha256: digest, purpose: Type.Literal("disposal-inquiry"),
    serviceMatch: Type.Literal("unknown"), caseWasteCode: Type.Null(),
    permit: Type.Literal("unverified"), acceptance: Type.Literal("unconfirmed"),
  }, strict)),
  excludedRows: Type.Array(Type.Object({ rowNumber: Type.Integer(),
    reason: Type.Union([Type.Literal("municipal-collection-only"), Type.Literal("listed-service-area-not-matched")]),
  }, strict)),
  missing: Type.Array(text),
}, strict);
export type PublicProcessorResearch = DeepReadonly<Type.Static<typeof PublicProcessorResearchSchema>>;
export interface VerifiedProcessorDirectory {
  readonly source: Type.Static<typeof sourceSchema>;
  readonly datasetSha256: string;
  readonly sourceManifestSha256: string;
  readonly rows: readonly Type.Static<typeof listingSchema>[];
}

/** Fixed permitted derivative only. No original personal-data CSV is opened. */
export async function readPublicProcessorDirectory(root: string): Promise<VerifiedProcessorDirectory> {
  const manifestBytes = await readFile(join(root, "data/sources/manifest.json"));
  requireData(canonical(JSON.parse(manifestBytes.toString("utf8"))) === canonical(manifestJson), "E_PROCESSOR_MANIFEST");
  const bytes = await readFile(join(root, "data/reference/ulsan-processors-2025-12.sanitized.csv"));
  requireData(sha(bytes) === source.sha256 && source.licenseVerified && source.derivedFrom !== undefined
    && source.removedColumns?.join(",") === "대표자,전화번호", "E_PROCESSOR_SOURCE");
  const lines = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trimEnd().split(/\r?\n/);
  const header = required(lines[0]);
  // Parse one original row at a time: the shared normalizer otherwise deduplicates companies.
  const rows = lines.slice(1).map((line, index) => {
    const normalized = normalizeProcessorCsv(`${header}\n${line}\n`, source.sourceId, required(source.sourceDate ?? undefined));
    requireData(normalized.issues.length === 0 && normalized.rows.length === 1, "E_PROCESSOR_ROW");
    return { ...required(normalized.rows[0]), rowNumber: index + 2, acceptedWasteCodes: [] };
  });
  requireData(rows.length === 31, "E_PROCESSOR_ROW");
  return { source: parse(sourceSchema, source), datasetSha256: sha(bytes), sourceManifestSha256: sha(manifestBytes), rows };
}

/** These three source cases are outside every explicit listed Ulsan service area. */
export function buildPublicProcessorResearch(directory: VerifiedProcessorDirectory, region: string | null): PublicProcessorResearch {
  requireData(["경기도", "충청북도", "경상북도"].includes(region ?? ""), "E_PROCESSOR_REGION");
  return {
    provenance: "public", source: directory.source, datasetSha256: directory.datasetSha256, sourceManifestSha256: directory.sourceManifestSha256,
    rows: directory.rows.filter(row => row.description !== "생활폐기물수집운반" && row.serviceArea === "").map(listing => ({
      listing, rowSha256: revision(listing), purpose: "disposal-inquiry", serviceMatch: "unknown",
      caseWasteCode: null, permit: "unverified", acceptance: "unconfirmed",
    })),
    excludedRows: directory.rows.filter(row => row.description === "생활폐기물수집운반" || row.serviceArea !== "").map(row => ({
      rowNumber: row.rowNumber,
      reason: row.description === "생활폐기물수집운반" ? "municipal-collection-only" : "listed-service-area-not-matched",
    })),
    missing: ["기계적 재활용 시설 근거 없음", "영업권역 미확인", "폐기물 코드·허가·인수 미확인",
      "사무실 주소는 시설 위치·거리 근거 아님", "소각 등재는 에너지 회수 확인 아님", "복수 등재 행은 독립 시설 수가 아님"],
  };
}
