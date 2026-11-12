# Oyeonseok ten-candidate handoff — 2026-11-10

Prepared for the Oyeonseok handoff on branch `feat/oyeonseok-o4-operational-handoff`, starting at `74c8c3d9a3bae87b560f72e05068f991ca255265`. Candidate inputs and their manifest are under `data/candidates/oyeonseok-2026-11-10/`.

These are ten newly authored, **synthetic text-only, exposed development candidates**. They are not ten collected field cases, accepted quota entries, independently labelled data, or locked holdout data. No field records, photographs, external evidence, real businesses or third-party source URLs were supplied or invented. Every description explicitly says SYNTHETIC. Structured facts are fictional scenario premises, not observed facts or established labels. Numeric mass values are fictional parameters, not measurements; other unknown mass values remain null. No prices, emissions factors, legal eligibility or expected verdicts are supplied.

## Candidate inventory and proposed coverage

All paths below are relative to `data/candidates/oyeonseok-2026-11-10/`; full paths and SHA256 hashes of actual file bytes are recorded in [manifest.json](../data/candidates/oyeonseok-2026-11-10/manifest.json).

| Stable candidate ID | File | Proposed coverage |
|---|---|---|
| OYS-20261110-001 | oys-20261110-001-pet-trim.json | Segregated clean PET thermoforming trim; fictional mass |
| OYS-20261110-002 | oys-20261110-002-hdpe-parison.json | Segregated clean HDPE blow-moulding offcuts; fictional mass |
| OYS-20261110-003 | oys-20261110-003-pp-runners.json | Segregated clean PP injection runners; mass absent |
| OYS-20261110-004 | oys-20261110-004-ldpe-film.json | Clean LDPE extrusion trim before printing; fictional mass |
| OYS-20261110-005 | oys-20261110-005-multilayer-pouch.json | PET/PE multilayer conversion trim; adhesive composition absent |
| OYS-20261110-006 | oys-20261110-006-black-label-conflict.json | Black enclosure rejects; conflicting fictional PP/ABS identifiers; polymer null |
| OYS-20261110-007 | oys-20261110-007-oily-pp.json | PP fixtures with oil residue; oil identity/contact risk unknown |
| OYS-20261110-008 | oys-20261110-008-solvent-hdpe.json | HDPE container rejects; hazardous solvent contact stipulated, identity absent |
| OYS-20261110-009 | oys-20261110-009-pp-reuse-question.json | Retired PP transport inserts; reuse/recycling question without comparison evidence |
| OYS-20261110-010 | oys-20261110-010-pet-missing-basis.json | PET offcuts with mass/region/contamination, quote/factor/document and processor evidence gaps |

The proposed primary counts are 4 clean single resin, 2 mixed/black/identifier conflict, 2 contamination/contact uncertainty, 1 reuse comparison, and 1 missing comparison basis. These are inventory descriptions, not independent labels or acceptance decisions. Case 010 mentions missing permit/code/service-area evidence but supplies no processor: it is not a verified mismatched-processor case. No stale legal document, quantitative unit discrepancy or hostile document input is fabricated. The full 30-case plan still needs its other strata and quotas addressed by the team; this track does not claim complete coverage.

The public CaseInput contract cannot carry comparison inputs, provenance or review metadata. Only its ten public fields appear in each candidate. Metadata stays in the manifest. Every assessment date is 2026-11-10. Empty photo arrays mean no photos supplied. Unknown nullable fields stay null; the required hazardousContact enum uses "unknown" where contact is unspecified.

## Provenance, rights and independent decisions

The manifest records origin `synthetic`, source `authored for project`, creation date, distinct fictional scenario provenance, proposed duplicate group, missing photo/evidence flags and empty reference arrays for every entry. Authorship was AI-assisted for this Oyeonseok handoff track; it does not assert that Oyeonseok visited or personally collected any site record. Each group currently describes a separate imagined operation, not a real business or a deduplication clearance. External rights are not applicable to newly authored text. The rights statement does not grant a legal license on the user's behalf; license remains null.

Two reviewers **other than the collector and team lead** must independently review each candidate and decide acceptance, source/group deduplication, and allocation across the **full 30-case corpus**. They must check overlap with other contributors, not just this directory. Independent labels, reviewer identities, source/group review, acceptance and split are all null until that process occurs. The team lead or mentor resolves reviewer disagreements under docs/evaluation.md; the team lead is not one of those two independent reviewers. Record expert qualifications and review scope if expert review later occurs.

The team must allocate at source/group level under the planned 18 development / 12 locked scheme and preserve stratum balance across the full corpus. These exposed candidates cannot be presented as an unseen locked holdout. If unseen evaluation data are needed, arrange separate unexposed cases. No predicted output or parser result substitutes for an independent label. No domain evaluation was used to manufacture ground truth.

## Reproducible validation

From the repository root, with the existing Node 24 runtime, run the following read-only command. It imports the actual parseCaseInput implementation, checks exact public input keys, ten unique IDs/paths and distinct scenario/group proposals, actual byte hashes, dates, synthetic disclosure, absent labels and required metadata. It reads only; it does not call domain evaluation, contact services, add dependencies or install permanent tests. It also prints the hashes of the parser and contract read during validation, so concurrent runtime changes can be identified. Successful parsing is input-boundary validation only.

```sh
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const root = process.cwd();
const dir = "data/candidates/oyeonseok-2026-11-10";
const read = p => readFileSync(resolve(root, p));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const { parseCaseInput } = await import(pathToFileURL(resolve(root, "src/input.ts")).href);
const manifest = JSON.parse(read(dir + "/manifest.json").toString("utf8"));
assert.equal(manifest.manifestVersion, 1);
assert.equal(manifest.creationDate, "2026-11-10");
assert.equal(manifest.status, "Exposed development candidates; not locked holdout data or collected field cases.");
assert.equal(manifest.allocationStatus, "Unassigned; independent review and full-30 allocation pending.");
assert.equal(manifest.candidates.length, 10);
const fields = ["caseId", "description", "photoRefs", "process", "polymer",
  "contamination", "hazardousContact", "massKg", "region", "assessmentDate"].sort();
const metadata = ["candidateId", "path", "sha256", "origin", "source", "sourceUrl",
  "creationDate", "collector", "missingPhotos", "missingEvidence", "photoRefs",
  "evidenceRefs", "rightsStatus", "license", "proposedStratum", "duplicateGroup",
  "scenarioProvenance", "sourceGroupReview", "independentLabels", "reviewers",
  "split", "acceptance"].sort();
const ids = new Set(), paths = new Set(), groups = new Set(), provenance = new Set();
for (const [index, entry] of manifest.candidates.entries()) {
  assert.deepEqual(Object.keys(entry).sort(), metadata);
  assert.equal(entry.candidateId, "OYS-20261110-" + String(index + 1).padStart(3, "0"));
  assert.match(entry.path, /^data\/candidates\/oyeonseok-2026-11-10\/oys-20261110-\d{3}-[a-z-]+\.json$/);
  assert(!ids.has(entry.candidateId) && !paths.has(entry.path));
  assert(!groups.has(entry.duplicateGroup) && !provenance.has(entry.scenarioProvenance));
  ids.add(entry.candidateId); paths.add(entry.path);
  groups.add(entry.duplicateGroup); provenance.add(entry.scenarioProvenance);
  assert.match(entry.sha256, /^[a-f0-9]{64}$/);
  const bytes = read(entry.path);
  assert.equal(hash(bytes), entry.sha256);
  const raw = JSON.parse(bytes.toString("utf8"));
  assert.deepEqual(Object.keys(raw).sort(), fields);
  const parsed = parseCaseInput(raw);
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  assert.deepEqual(parsed.value, raw);
  assert.equal(raw.caseId, entry.candidateId);
  assert.equal(raw.assessmentDate, "2026-11-10");
  assert.match(raw.description, /^SYNTHETIC/);
  assert.match(raw.description, /text-only fictional scenario/);
  if (raw.massKg !== null) {
    assert(raw.description.includes("massKg=" + raw.massKg));
    assert.match(raw.description, /fictional scenario parameter, not a measured value/);
  }
  assert.deepEqual(raw.photoRefs, []);
  assert.equal(entry.origin, "synthetic");
  assert.equal(entry.source, "authored for project");
  assert.equal(entry.creationDate, "2026-11-10");
  assert.equal(entry.collector, "Oyeonseok handoff track (AI-assisted authorship)");
  assert.equal(entry.missingPhotos, true);
  assert.equal(entry.missingEvidence, true);
  assert.deepEqual(entry.photoRefs, []);
  assert.deepEqual(entry.evidenceRefs, []);
  assert.equal(entry.rightsStatus, "New authored text; external rights not applicable. No legal license granted on the user's behalf.");
  for (const key of ["sourceUrl", "license", "sourceGroupReview", "independentLabels",
    "reviewers", "split", "acceptance"]) assert.equal(entry[key], null);
  for (const key of ["proposedStratum", "duplicateGroup", "scenarioProvenance"])
    assert.equal(typeof entry[key] === "string" && entry[key].length > 0, true);
}
const files = readdirSync(resolve(root, dir)).filter(p => p.endsWith(".json") && p !== "manifest.json");
assert.deepEqual(files.map(p => dir + "/" + p).sort(), [...paths].sort());
console.log("PASS: 10 CaseInputs; 10 unique IDs/paths; SHA256 and metadata verified; labels/reviewers/split unassigned.");
for (const p of ["src/input.ts", "src/contracts.ts"]) console.log(hash(read(p)), p);
NODE
```

Executed the command above on 2026-11-10 from the repository root with Node v24.18.1; exit status 0:

```text
PASS: 10 CaseInputs; 10 unique IDs/paths; SHA256 and metadata verified; labels/reviewers/split unassigned.
21bfaea3f5c071a65b63a2ca2fdd3c805dfb1d2b18585c98c66021fde42c930b src/input.ts
d7359e074f106c6692c635828fd2a0b0915ef8c2c30509347842349c64a8fd6a src/contracts.ts
```

This check cannot establish legal correctness, scenario realism, independent labels, source rights for future additions, or acceptance into any quota. No production seam, runtime changes, package changes, permanent tests, credentials or external contact are part of this track.

## Remaining handoff work

J/H independently review O's candidates, and J checks source/group duplicates across all contributors. The team lead decides acceptance and group-level allocation after reviewing those results. Field-source collection remains outstanding: obtain records, authorized photos, process/material support, measured quantities, and versioned evidence before making any field-data or performance claim. Replace synthetic premises only with explicitly documented evidence in a separately reviewed revision and refresh byte hashes.
