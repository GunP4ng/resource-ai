# Plastic public calculation scenarios

Every case and result is **공개 자료 기반 계산값(관측값 아님)**.
시나리오 추정, 현장 미검증. Model: `stage2-plastics-2026-11-15-v1`.
These are synthetic development premises, not observations, actual contracts,
quotations, shipment decisions, legal approvals or verified facility acceptance.
Unknown permits, acceptance, actual quotations, measured mass/distance and site
applicability remain execution checks. This independent dataset creates no app
review, operational quote or commercial readiness.

The original PET 001 (24 kg), HDPE 002 (18 kg) and PP 003 (unknown mass)
development JSON and complete original provenance entries are retained verbatim
as JSON values. Original files remain unchanged and are pinned individually,
along with their provenance manifest. Assessment date is 2026-11-10 and law
context is 290881; no new legal eligibility finding is made. Historical nulls,
missing evidence/photos, hazard declarations and review/allocation unknowns
remain historical facts. PP is never replaced by a one-tonne example.

`fixtures.json` contains source receipts, selected cells and the complete input
ledger, including assumed mass, allocation, costs, distances and applicability.
The CLI builds fixed recycling, landfill and energy-recovery route definitions
and nine keyed results. Formula identifiers dispatch fixed arithmetic; text is
never evaluated. All assumptions have `source_id:null`, a reason and explicit
upstream dependencies where a reference is being applied. Published prices and
their normalization are separate from hypothetical sale-price assumptions.

## Sources and rights

- **한국환경공단, 재활용가능자원 가격조사_20261026, 공공누리 제1유형**;
  [source](https://www.data.go.kr/data/3076421/fileData.do),
  [attribution licence](https://www.kogl.or.kr/info/licenseType1.do).
  Survey 2026-10-10; published 2026-10-26; original retrieval
  2026-11-05T08:53:59Z. Header-inclusive CSV cells: PET row 6/column 3,
  수도권 616.8 KRW/kg; generic PE row 4/column 5, 충북 456.5 KRW/kg;
  PP row 5/column 9, 경북 403.3 KRW/kg. Multiply by 1,000 for KRW/t.
  These are compressed, mixed-colour references. Mixed-colour does not mean
  mixed polymer. Generic PE is **not** an established HDPE-specific price.
  HDPE uses an explicit hypothetical generic PE price proxy. All sale mappings
  assume region, form, quality and preparation suitability; October VAT and
  logistics remain unverified.
  The published reference uses IDs `PE` / `price.PE`; only the separate
  `HDPE.price` scenario assumption applies that reference as a proxy.
- **US EPA WARM v16**, December 2023,
  [Containers, Packaging, and Non-Durable Goods](https://www.epa.gov/system/files/documents/2023-12/warm_containers_packaging_and_non-durable_goods_materials_v16_dec.pdf),
  Exhibit 5-3, printed 5-4/PDF 73; §5.4.2/PDF 76.
  Table data rows exclude the header: HDPE 1, PET 3, PP 5. Columns include
  Material: recycling 3, energy recovery 5, landfill 6.
  Recycling/landfill/energy recovery respectively: PET −1.04/0.02/1.24;
  HDPE −0.76/0.02/1.29; PP −0.79/0.02/1.29 MTCO2e/US short ton.
  US defaults and upstream 2011/2018 data are hypothetical mappings to these
  manufacturing scraps. Recycling models closed-loop resin; product extrusion
  is excluded. Preceding prose omits PP, while its footnote, table and §5.4.2
  include PP. This discrepancy is retained. GWP is **as published, not
  independently harmonized**, with no invented AR designation. Comparison is
  confined to the same pinned document/table, model, geography, functional unit
  and boundary. Arbitrary unknown GWP declarations do not establish compatibility.
  [EPA's document-specific rights warning](https://www.epa.gov/web-policies-and-procedures/epa-disclaimers)
  leaves this work's commercial use and redistribution unconfirmed.
- **원주시**, [생활폐기물 매립장 안내](https://www.wonju.go.kr/envi/contents.do?key=2060),
  modified 2025-03-21, retrieved 2026-11-15T15:11:06.093Z:
  facility-generated business-waste fee 99,050 KRW/t. A separate applicability
  assumption applies this fee. Facility, regional, temporal, polymer eligibility
  and tax treatment are unverified. Commercial use/redistribution are unconfirmed.

Raw SHA-256 pins and actual retrieval timestamps are in the source ledger.
No EPA PDF, Wonju HTML, unlicensed raw file or private evidence is bundled.
GIR was checked: a grid factor cannot substitute for a whole-route polymer
factor without an activity model; specific-work rights remain uncertain.
No GIR coefficient is admitted. KEITI's commercially prohibited national LCI
is excluded. UK reporting factors are unused; transport diagnostic is explicitly
null with reason `not_included_in_this_model`.

## Arithmetic and availability

Let `m=kg/1000`, `a=m*y`, `b=m-a`, `k=1000/0.90718474`.
`y` allocates WARM input after sorting; it is not another embedded yield.
Residue is assumed to remain the same polymer.

```text
recycling_cost = m*c + (m*d1+b*d2)*r + m*s + b*f + a*f_rec - a*p
landfill_cost = m*c + m*d0*r + m*f
cost_saving = landfill_cost - route_cost
recycling_carbon = (a*ef_rec+b*ef_lf)*k
landfill_carbon = m*ef_lf*k
energy_recovery_carbon = m*ef_inc*k
carbon_difference = landfill_carbon - route_carbon
```

Assumed `c=10000`, `s=20000`, `r=300`, `d1/d2/d0=30/20/20`, `f_rec=0`.
Collection excludes transport; sorting includes hypothetical preparation for the
sale form. Fixed dispatch, minimum load and empty return charges are unverified.
Costs are nominal cash amounts, without an invented VAT adjustment. No additional
transport emissions or production credit is added to WARM's embedded lifecycle
model. Changing scenario distance changes cost and leaves WARM carbon unchanged.
Negative net cost is not a profit guarantee; negative WARM carbon is not physical
capture, a Korean certified saving, an emissions credit or a product footprint.

| Case / allocation | Recycling cost KRW | Baseline KRW | Cost difference KRW | Recycling kgCO2e | Baseline kgCO2e | Carbon difference kgCO2e |
|---|---:|---:|---:|---:|---:|---:|
| PET 001 / 1 | −13867.20 | 2761.20 | 16628.40 | −27.51 | 0.53 | 28.04 |
| HDPE 002 / 0.8 | −5493.42 | 2070.90 | 7564.32 | −11.98 | 0.40 | 12.38 |
| PP 003 / 0.8 | null | null | null | null | null | null |

Unrounded PET carbon expressions are −24.96/0.90718474,
0.48/0.90718474 and 25.44/0.90718474; HDPE expressions are
−10.872/0.90718474, 0.36/0.90718474 and 11.232/0.90718474.
Finite totals are serialized unrounded; differences are computed first.
Display uses decimal half-away-from-zero: KRW 0 places, kgCO2e 2 places,
with displayed negative zero normalized. Display precision is not measurement
precision. A known zero mass produces zero supported totals and null per-tonne
values. A missing mass produces null totals, flows and self-differences.
Synthetic premise variants may change declared mass while preserving original
history; they must carry an explicit assumption reason and consistent case mass.

Research output has 3 cases / 9 rows: 4 complete cost/carbon, 2 carbon-only and
3 unavailable. Incineration fee is unknown, so its cost and cost saving are
null; supported WARM carbon remains available. Missing numeric premises are
never replaced by zero, and supported route records remain present.

## Reproduction

Verified CLI runtime: Bun **1.4.2**. No new dependency is required.
Run from the repository root with owned output/cache paths:

```bash
RUN_TMP=$(mktemp -d)
export TMPDIR="$RUN_TMP"
export NODE_COMPILE_CACHE="$TMPDIR/node-compile-cache"
export BUN_RUNTIME_TRANSPILER_CACHE_PATH="$TMPDIR/bun-transpiler"
bun scripts/o-public-calculations.ts validate --dataset data/o-public-calculations/2026-11-15
bun scripts/o-public-calculations.ts build --dataset data/o-public-calculations/2026-11-15 --mode research > "$TMPDIR/research.json"
bun scripts/o-public-calculations.ts export --dataset data/o-public-calculations/2026-11-15 --input "$TMPDIR/research.json" --mode research > "$TMPDIR/research-export.json"
bun scripts/o-public-calculations.ts export --dataset data/o-public-calculations/2026-11-15 --input "$TMPDIR/research.json" --mode commercial > "$TMPDIR/commercial.json"
bun test --timeout 30000 ./tests/o-public-calculations.test.ts
bun run typecheck
bun run typecheck:o-tests
```

`--root` selects the root for isolated upstream copies. Default validation
checks pinned transcriptions, selected KECO bytes and original bindings. It
does not claim to reopen private originals. Optional
`validate --dataset data/o-public-calculations/2026-11-15 --evidence-dir <private-directory>`
additionally hashes exactly `epa-warm-v16-containers.pdf` and
`wonju-fee-private.html`; missing or mismatched files fail. No automatic fetch.

Fixture bytes have a separate checksum. Source metadata, upstream paths/pins
and private evidence filenames/pins have a fixed SHA-256 over the existing
repository's canonical JSON representation. The manifest stores that hash and
the calculator pins it independently; updating a fixture checksum cannot
authorize changed source receipts. Output records fixture, manifest and actual
calculator hashes. Export compares the entire supplied serialized bundle with
a fresh recomputation before emitting data. Invalid data exits 1; CLI usage
errors exit 2. Stable stderr codes accompany empty stdout.
The three published KECO inputs also require their reviewed grade, unverified
tax status and absence of missing/assumption narratives. A resealed fixture
cannot introduce unsupported tax claims or restricted-source text into those
commercial fields.

Commercial export is an explicit projection: three KECO reference cells with
attribution and three normalized price inputs, empty cases/routes/results, and
excluded IDs/reason codes. No WARM/Wonju coefficients, scenario proxies, cost or
carbon formulas, result totals or blocked-source narratives survive. The KECO
unit-normalization transform is retained with its source value/unit. Transitive
dependencies participate in filtering; `source_id:null` grants no upstream
rights. Empty results do not imply commercial readiness.

Focused tests exercise the actual CLI and serialized boundary, resealed semantic
corruptions, independent Python stdlib Decimal arithmetic at precision 50,
midpoint rounding and four temporary owner mutants. The unchanged copied CLI
must pass; conversion, residue accounting, revenue sign and commercial filter
mutants must reach numeric/export assertions. Originals are never mutated.
Parent integration owns the full suite, builds, smoke checks and final review.

## Shared engine and case research contracts

The CLI is now an IO wrapper. Importing it performs no command. Production
arithmetic lives in `src/o-public-calculation-engine.ts`; the CLI and case
attachments use that same engine. The original arithmetic, units, source IDs,
dates, assumptions, nulls and commercial projection remain unchanged.

Public entry points (all paths below are repository-relative):

```ts
// src/o-public-calculation-data.ts
readPublicCalculationDataset(options?: {
  readonly root?: string;
  readonly directory?: string;
  readonly evidence?: string;
}): Promise<VerifiedPublicDataset>;
// src/o-public-calculation-engine.ts
buildPublicCalculations(data: VerifiedPublicDataset): PublicCalculationBundle;
projectCommercialReferences(bundle: PublicCalculationBundle): CommercialReferenceBundle;

// src/o-case-research.ts
readCaseResearchCatalog(options?: { readonly root?: string }): Promise<VerifiedResearchCatalog>;
buildCaseResearchAttachment(target: ResearchTarget, sourceCaseId: ResearchSourceCaseId,
  catalog: VerifiedResearchCatalog): CaseResearchAttachment;
prepareResearchCaseRecord(target: ResearchPreparationTarget, sourceCaseId: ResearchSourceCaseId,
  catalog: VerifiedResearchCatalog): Promise<ResearchCaseArtifact>;

// src/o-case-research-validation.ts
validateCaseResearchAttachment(value: unknown, target: ResearchTarget,
  catalog: VerifiedResearchCatalog): CaseResearchAttachment;
validateResearchCaseArtifact(value: unknown, target: ResearchTarget,
  catalog: VerifiedResearchCatalog, signal: AbortSignal): Promise<ResearchCaseArtifact>;
```

`ResearchTarget` is `{actorId, input: CaseInput, inputRevision}`.
`ResearchPreparationTarget` additionally requires `{codeRevision, signal}`.
The server/operator must resolve the actual active actor and owned case first;
these pure functions do not authenticate a caller-declared actor ID. The
revision must equal `revision(input)`. Only `caseId` may differ from the selected
source original. `ResearchSourceCaseId` is exactly the three original IDs
`OYS-20261110-001`, `OYS-20261110-002`, `OYS-20261110-003`.
`readCaseResearchCatalog` admits only the fixed fixture and manifest byte hashes;
it does not accept an attachment-selected dataset, path or source definition.
The general calculation reader retains CLI synthetic-premise experiments.

`CaseResearchAttachment` and its TypeBox schema are exported from
`src/o-case-research-schema.ts`. This explicit display-only type has version 1,
purpose `research-display`, exact calculation label and scenario status,
actor/case/revision/historical-date binding, `calculations`, `processors` and
`use`. Its use declarations are authenticated research display, private runtime
storage, redistribution not authorized by this package, commercial export
excluded and model transmission excluded. It is never a DomainResources,
DecisionResult, AssessmentEnvelope or model-metadata field.

`calculations` contains `sourceCaseId`, fixture/manifest/original/provenance and
provenance-manifest hashes, the implementation receipt, verification
`pinned-transcriptions`, the existing model version and full source metadata,
the selected case's transitive input ledger, one original case, three routes,
three results and limitations. Original JSON/provenance, historical date/law,
source cells, rights, boundaries, periods, units, assumptions, dependencies,
display strings and null reasons retain their existing fields. Results keep
original source-case IDs; the target binding separately identifies the app case.
Consumers render `results[].display` directly without recomputing numbers.

`CaseArtifact = LegacyCaseArtifact | ResearchCaseArtifact` is exported from
`src/o-case-artifact.ts`. The v1 type derives from `prepareCaseRecord`. The v2
record derives from that same production builder, has `version:2`, synthetic
origin, empty `resources:{}`, and `research`; its outer hash includes all of
research. `ResearchCaseArtifactSchema` is the untrusted envelope boundary.
Cached assessment/decision values remain opaque there and are never cast into
business types: full validation regenerates the typed record with the existing
domain and licensed bundled source reader, preserves the validated historical
recording timestamp, then canonical-compares the entire supplied record.
Attachment validation independently regenerates every attached field from the
fixed catalog and actual target. Recomputing an outer hash cannot authorize
changed facts, rights, source lineage, dependencies, display values or fields.
The builder returns a detached attachment to protect catalog object identity.

`CaseResearchReport` is `{artifactSha256, attachment: CaseResearchAttachment}`.
Runtime integration must return `{snapshot,research}` atomically from its saved
review hash, keep research out of model requests, and exclude it server-side
from default/commercial reports. This unit supplies contracts/builders and
validation; it does not change the store, loader, routes or renderer.

## Processor inquiry selection

`readPublicProcessorDirectory(root)` verifies the actual permitted sanitized
CSV and source manifest. `buildPublicProcessorResearch(directory, region)` is
restricted to the three original source-case regions. Both are exported from
`src/o-public-processors.ts` with `PublicProcessorResearch` and its TypeBox schema.
The parser retains original header-inclusive coordinates and every directory
row, including duplicate-company entries; it does not count facilities.

For all three cases, rows 2–22 are excluded as `municipal-collection-only`.
Rows 23–24 have explicit Ulsan service areas that do not match the source-case
regions and are excluded as `listed-service-area-not-matched`. Rows 25–28 are
incineration inquiry listings, and 29–32 are landfill inquiry listings. These
eight rows all have blank service areas (`serviceMatch:"unknown"`). Each carries
its full listing, canonical row SHA-256, purpose `disposal-inquiry`, null case
waste code, unverified permit and unconfirmed acceptance. The source entry keeps
rights, original→sanitized SHA lineage and removed personal-data columns; dataset
and source-manifest byte hashes are included separately. No recycling-directory
evidence exists. No listing establishes facility location/distance, service
coverage, waste-code eligibility, acceptance, a permit or energy recovery.

## Packaged asset requirements

Default source execution resolves the repository root relative to the module,
independently of cwd. Packaged callers pass the trusted asset root explicitly
(`--root` for the calculation CLI, `{root}` for the readers). Package exactly:

- `data/o-public-calculations/2026-11-15/{fixtures,manifest}.json`;
- every public upstream path in its pinned manifest: KECO CSV, the three
  original candidate JSON files and their candidate manifest;
- `data/reference/ulsan-processors-2025-12.sanitized.csv` and
  `data/sources/manifest.json`;
- original implementation source files named by the fixed `implementationPaths`
  list in `src/o-public-calculation-data.ts`: CLI wrapper; all nine calculation,
  processor, research and artifact modules; `o-validation.ts`, `input.ts`,
  `sources.ts` and `case-record.ts`;
- the existing licensed J registry/snapshot assets required by
  `prepareCaseRecord` (including historical 290881 assets). Missing J snapshots
  retain the existing explicit sourceIssues behavior; they are never fetched.

`implementation.files` records actual source-file byte hashes and
`implementation.sha256` is `revision(files)`; `calculator_sha256` now denotes
that aggregate, rather than only the CLI wrapper. The full fixed list is used
for both CLI and attachment receipts. Original source `.ts` files must accompany
a bundled executable because bundle bytes alone cannot stand in for this list.
Do not package private WARM PDF/Wonju HTML, the personal-data processor original,
GIR/KEITI factors, locked labels or raw700. Optional private-evidence checking
remains an explicitly operator-configured CLI action.
