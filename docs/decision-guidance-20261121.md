# Conditional decision guidance

This increment implements the current app-only scope. It does not change the
domain's treatment criteria, actual recommendations, approval state or calculator.

The Microsoft topic's page 3 describes public-data decision support and gives the
example flow: identification/classification, reuse/recycling feasibility,
regulations, industries/companies, cost/carbon comparison and a treatment proposal.
Page 4 labels its data and service lists as examples. The complete local mapping
and original quotations are in the lane's `topic-map.md`; both official PDFs were
read in full, including their rendered pages.

## App behavior

- Current authenticated cases show all six stages with existing outputs and gaps.
  Reported fields remain reports, not chemical identification or permit evidence.
- Actual rank 2 requires a recommendation whose rank is 2. A complete modeled row
  is a hypothetical comparator, never an invented actual second recommendation.
- For current PET/HDPE contexts passing the display guards, the existing engine derives
  a sufficient incineration-fee bound. Only `f_inc` varies; other source assumptions
  and the carbon boundary remain fixed. Both metrics must weakly dominate every
  modeled route. Tradeoffs, other missing inputs and incompatible boundaries are
  excluded instead of receiving arbitrary weights.
- Held-case probes change one structured field in an isolated copy and execute
  existing public rules. Unknown resins are not guessed. Photo/observation and
  reported/suspected hazardous-contact cases are limited. Zero-effect probes and
  remaining requirements remain visible; priority may be null.
- Four recycling rows distinguish historical public permit-directory listing
  from unknown current validity, case fit and acceptance. They are not promoted
  into verified processor records. The original eight disposal rows stay separate.
- An owner-bound inquiry contains current reported fields and questions, with
  bounded marked excerpts and an intact full case ID. It uses the real print
  control and an A4 sheet. Permission changes make it historical/held even when
  input bytes have not changed.
- The home example uses an existing synthetic route without application model
  inference. Explicit nonplastic input is rejected before evaluation/storage;
  prior records are not overwritten, and explicit material uncertainty is retained.
- Three KEITI EPD 2021 mixed-plastic reference rows are shown with their original
  units, raw-file hash, portal licence and boundary limitations. They are not
  PET/HDPE-specific case factors, do not replace WARM and do not fill actual
  domestic lifecycle carbon or incineration cost.

Guidance is presentation-only. It is excluded from commercial/anonymous output,
application model input and stored research artifacts. Stale or permission-changed
evaluations do not receive fresh guidance. Inquiry is owner-only and contains no
research calculation numbers.

## Original 18 measurement

Original invocation at commit `3f9083e`, from the repository root:

```sh
bun scripts/measure-guidance.ts
```

Results: `data/evaluation/round4-20261121/`.
The current replay command requires `--out NEW_DIRECTORY` and refuses to overwrite
an existing evidence directory. Keep these historical results intact.
Unchanged decision payloads use the preserved baseline's hash and JSON pointers
instead of duplicating the previous full records.

- 18/18 source hashes verified and complete decisions identical to round 3.
- 8 compared / 6 needs-information / 4 needs-review; 0 state changes.
- 7 automatic public scenarios; 6 conditional modeled optima.
- 0 actual second ranks; no second recommendation fabricated.
- 17 one-field probes; 3 held cases with a non-null priority.
- Input, decision, prepared context and catalog remain unchanged.
- Actual `f_inc` and incineration cost remain null.

These are deterministic observations on exposed development inputs. They are not
human accuracy, a locked evaluation, physical suitability or field savings.
Opening a recommendation/source-supported guidance path is not strict eligibility
or execution permission.

## Verification

Full suite: 1142 pass, 0 fail. Official typechecks, both builds and local scaffold smoke
passed on Bun 1.4.4; the package declaration remains 1.4.2. After the last reference
wording change, 7 focused tests, the app build and final 18 measurement passed.
No test was removed, skipped or weakened.

Owned Chromium 158 QA covered actual normal input, information/review holds,
same-case hazardous-contact update, six stages, conditional bounds, reference
scope, permit labels, inquiry and home entry at 390/1440 with light/dark evidence.
The final automated home click-to-result was 857.9 ms, not a human study.
Normal, hazardous and long/history/permission inquiry print fixtures each occupied
one A4 page. Full IDs and safety warnings remained.

Local evidence root:
`/home/gunp4ng/working/resource-rubric-20261120/evidence/`

- `round4-qa-matrix.md`, `round4-ui/`, `round4-sources/`
- `round4-final-corrected-checks.log`, `round4-final-copy-checks.log`

Application/provider calls for this increment: 0. Fable review calls are separate.
No deployment, video, human study, new waste type or photo material suggestion.
No actual supplier acceptance, quote or official competition score is claimed.
