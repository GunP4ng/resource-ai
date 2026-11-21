# Reported reply and sensitivity guidance

This increment adds a follow-up to the existing inquiry without changing actual
decisions or treating a reported offer as verified evidence.

Authenticated case owners can enter a company reply and one price assumption.
The native preview is not saved. Acceptance, permit-check date and source notes
remain user-reported and unverified. Existing rules, case records and actual
missing prices stay unchanged.

The three selectable amounts use the existing model's units: incineration fee
per input tonne, or recycling treatment/sale price per modeled recycling tonne.
Collection, transport and sorting remain separate assumptions. The app does not
normalize an unknown quote's tax, currency or coverage. Blank is unknown;
explicit zero is a hypothesis. A fee of zero does not zero other cost components.

The same engine recalculates the preview. Overridden values carry no false KECO
source attribution. The comparison shows net cost, including modeled sale revenue;
negative values are not promised profit. These price inputs do not change carbon.
Foreign owners, unauthenticated requests and changed versions are rejected.
Held, hazardous, photo-containing, stale and permission-changed cases receive no
numerical reply recommendation or approval.

Current reports also show:

- The host method behind each of six stages, with actual record availability.
  Configuration or a trace does not prove provider success. Missing stage-level
  model contribution/success/failure records remain explicitly absent.
- The required facts for held cases without a useful one-fact hypothesis.
- Literal full province-name comparison against directory addresses. Ambiguous
  names remain unknown; no distance, acceptance or suitability is inferred.
- Nine price/allocation samples using the existing engine and sufficient fee
  bound. Price factors are 0.8/1/1.2 and model allocation values 0.6/0.8/1.
  These are finite samples, not an interval proof or measured substitution.
- A keyboard-accessible legend for recommendation, conditional optimum,
  hypothesis, reference and missing values.

Reproduce the 18-input measurement into a new directory:

```sh
bun scripts/measure-guidance.ts --out data/evaluation/local-guidance-replay
```

The command refuses existing output directories. Historical results are not
overwritten. Final artifacts are under `data/evaluation/round5-20261121/`:
18 complete decisions remain identical (8 compared / 6 information / 4 review), all
7 held cases without a priority have required facts, and 54 samples across 6 contexts
retain the scoped conditional advantage. These are exposed-development observations.

Canonical checks: `bun run typecheck`, `bun test --timeout 30000 ./tests`,
`bun run build`, `bun run build:app`, and local `bun run smoke`.
Final suite: 1161 pass / 0 fail. Native 390/1440 light/dark QA covered the new flow,
blank/zero, DOM escaping, held cases and a one-page A4 inquiry with a full ID.

The technical QA record is in the lane's `evidence/round5-qa-matrix.md`.
Application inference calls for this increment: 0. Earlier real synthetic execution
receipts are historical evidence, not a new-main run or accuracy/field-benefit proof.
No deployment, video, human study, new waste type or photo material suggestion.
