# Legacy mixed-resin resource envelope

`legacy-mixed-resin-artifact.json` was serialized by the unchanged
`prepareCaseRecord` implementation at commit
`fad796cbf2fbaae892add8988f11e7faaecdf266`, before conditional alternatives.
Its input is the existing
`data/h-candidates/2026-11-12/inputs/HYEOB-20261112-003.json`.
The builder used `createBundledSnapshotReader` from that checkout, empty
resources, and no photos or model requests. All source snapshot bytes and
their hashes are retained.

This is a compatibility fixture regenerated with the old production builder,
not a claim that this exact envelope was collected on the historical input date.
The existing `data/evaluation/recommendation-quality-20261120/host-baseline.jsonl`
also retains the same case's pre-alternative decision (with its then-generated
case ID); the evidence records match this envelope's two fact-based records.

The sealed record SHA-256 is
`338bf46894d636bee2245f5ce160dd672823a5f3ca531c07f55790cb3eb49ba4`.
Its decision is `needs-review`, with no `conditionalAlternatives` property.
It contains two decision evidence records and three source snapshots.
Do not regenerate it with the current builder: doing so would remove the
historical compatibility regression.
