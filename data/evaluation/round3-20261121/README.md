# Third follow-up: deterministic development remeasurement

Run from the repository root:

```sh
bun data/evaluation/round3-20261121/remeasure.ts
```

The same 18 exposed text inputs and original assessment dates are retained.
Photos and provider/model calls are excluded. Each original byte hash is checked
against the development manifest. This is not independent human accuracy.

Observed results:
- 8 compared, 4 needs-review, 6 needs-information; zero state changes.
- All eight compared outputs retain their previous canonical hashes.
- Cited recommendation or four-source conditional-route support: 13/18 → 14/18.
  Only HYEOB-20261112-008 gains the conditional chain. Actual strict eligibility
  remains unknown and execution stays held.
- H009, H010, O006 and O008 remain unsupported for a specific route because
  material, contamination or classification facts are missing.
- Seven inputs have an exact PET/HDPE material and positive mass, so they can
  display the separate private public-calculation scenario. This does not
  authorize their treatment, change recommendations or validate template premises.
- Incineration cost remains null. Domestic GIR electricity and incineration
  parameters are contextual references with different units/boundaries, not
  replacements for the US WARM lifecycle figures.

`results.json` retains each decision, hashes and scenario numbers.
`summary.json` aggregates those rows and records implementation/source hashes.
The original scoring, baseline and sensitivity artifacts were not rewritten.
