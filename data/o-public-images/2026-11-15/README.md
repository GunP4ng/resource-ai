# Public reference photographs — exposed development bundle

Three real public photographs accompany one non-field synthetic/unknown CaseInput, PUBLIC-IMG-DEV-001. These distinct photographs are not one field lot or independent examples. All three are exposed development pictures. Strapping shares its source with HYEOB-20261112-006: zero new independent field cases, zero independent human labels, zero unseen holdout. Parent inspection was AI-assisted; it provides no operator or model approval. Publisher material descriptions remain claims, not verified resin, process, contamination or contact facts. Declared dates are publisher metadata, not independently established capture or field dates.

From the repository root, with the existing pinned dependencies installed:

```sh
bun scripts/o-public-images.ts prepare [bundle-directory]
bun scripts/o-public-images.ts verify [bundle-directory]
bun test tests/o-public-images.test.ts
bun run typecheck
```

Omit the optional directory argument to use this bundle. Prepare reads only bundled declarations, input and PNGs, uses existing domain APIs with resources {}, records the current Git HEAD, and regenerates lineage/artifact. No task-local research file or network is needed. Timestamped artifact hashes change on preparation; verification is read-only. The tests use private temporary copies. Verification checks the exact sample set, raw bytes, actual decoded dimensions, selected declaration anchors, input revision, lineage file hashes and the existing artifact validator; it preserves unknown eligibility and needs-information for the 11/15 synthetic case after the 291947 legal-source update. It pins the recorded crop declarations, but cannot rederive crops from unbundled JPEG inputs. It is integrity verification, not third-party rights clearance or approval. The app proof and 808-test count in qa.json record the earlier source snapshot, not a fresh runtime acceptance of this updated artifact.

Manifest selection retains creator names, source URLs, publisher dates, original and publisher-input identities, exact two crop rectangles, metadata removal and parent inspection. Original river JPEG and publisher thumbnail inputs have observed hashes; unfetched full-resolution gannet/strapping originals have null hashes. Raw JPEGs, EXIF, HTML and contacts are not bundled. Curated PNG hashes differ conceptually from both publisher inputs and any later uploads. The manifest leaves uploadedCuratedSha256 and sanitizedStorageSha256 null because no runtime upload exists here. The verifier's resanitizedSha256 is a local decode/re-encode check, not a runtime storage receipt.

Source and license snapshot text is a selected/reordered declaration, not complete original HTML. Hashes cover exact UTF-8 text with LF line endings, including final newline. CC0 deed and actually-read legal-code URLs and observed raw page hashes are retained as provenance; their full pages are not included or revalidated offline. Literal API Copyrighted="True" and attributionRequired="false" coexist with the observed CC0 declaration. CC0 does not clear trademarks, patents or third-party permissions, and does not supply runtime consent. RealWaste is excluded: UCI's BY declaration conflicts with the original author's NC-SA declaration; no RealWaste image is admitted.

Runtime use is storage-only private upload: actually upload a curated PNG, obtain private receipts, and bind them to the real case revision and public lineage. Runtime originalSha256 means the uploaded curated PNG bytes; sha256 means the subsequently sanitized storage bytes. Empty photoRefs are intentional here and cannot be replaced with invented runtime IDs. Actual upload/consent is required before runtime references or model execution. No image inference occurred; offline local domain decisions do not establish image understanding. Authenticated storage/check/install/explicit reassessment app proof is complete; final review status is recorded in qa.json.

Hash quantities remain separate: raw file SHA-256 for manifest/snapshots/PNGs/input/lineage/artifact; canonical revision(input), revision(resources), and revision(artifact.record); selected text SHA-256; publisher original and input hashes. The synthetic dataOrigin reference contains the exact public lineage file SHA-256. Bundled images are bound through lineage, not artifact.record.images, which remains empty.

## J/H runtime handoff

O supplies this public reference bundle and its byte/canonical hashes. J checks source relevance, unknown facts and unavailable calculations. H supplies any real provider/model/purpose authority and execution tickets; none are issued by this bundle. The known H006 source overlap is retained, and these exposed images add no independent field cases, human labels or unseen holdout.

For storage-only reproduction, create a private local-operator account with the existing account CLI and run the app with RESOURCE_MODEL_RUNNER=local, RESOURCE_APP_AUTH=local-operator and RESOURCE_PRIVATE_PHOTOS=on, plus fresh private state/resources directories. Log in, create a case with the bundled description/date and unknown factual fields, and upload the three samples. Check storage consent and visible-content review only. Model consent and image-selection controls remain disabled.

Export that actual case input through its authenticated input link. The committed artifact is fixed to PUBLIC-IMG-DEV-001 and cannot be installed for the server-generated case id. Generate a private artifact through the existing prepareCaseRecord/createBundledSnapshotReader APIs using the actual exported input, resources {}, synthetic dataOrigin and current code revision. Before preparation, bind an exact private lineage file: public manifest/lineage hashes, actual input revision, and actual photo receipts whose caseId/uploadRevision match the export. Match each receipt originalSha256 to the curated sample SHA; sha256 is the sanitized storage SHA. Keep those private ids, consent records and receipts outside Git. Use the private lineage file SHA in dataOrigin.reference; the existing checker does not resolve sidecars, so independently verify this binding. Empty photoRefs and record.images remain intentional: storing pictures does not approve model use.

With actual values obtained above, run the unchanged CLI:

```sh
bun scripts/o-artifact.ts check --state-dir "$STATE_DIR" --resources-dir "$RESOURCES_DIR" --username "$QA_USERNAME" --case-id "$ACTUAL_CASE_ID" --expected-revision "$EXPORTED_INPUT_REVISION" --artifact "$PRIVATE_ARTIFACT"
bun scripts/o-artifact.ts install --state-dir "$STATE_DIR" --resources-dir "$RESOURCES_DIR" --username "$QA_USERNAME" --case-id "$ACTUAL_CASE_ID" --expected-revision "$EXPORTED_INPUT_REVISION" --artifact "$PRIVATE_ARTIFACT"
```

Use canonical absolute private paths (directories0700, files0600) and the current unexpired case. Check must not publish; install must leave the saved report unchanged. Submit {} through the authenticated answers form with the current baseVersion to explicitly reassess. The actual run showed the exact installed artifact hash, synthetic/non-field provenance, review-required and offline/no-model labels, all three authenticated previews, and unknown/unavailable facts. Desktop/mobile light/dark views were inspected. A second login replaces the same actor's earlier session; reauthenticate the client that will submit.

Actual negative results: wrong revision exited1 without changing the saved case/resources; anonymous preview returned403; a model-consent upload without available approval returned400 and preserved case/photos/resources; successful storage withdrawal returned303, then the deleted preview404, preserving the previous assessment. Three previews were verified before intentionally withdrawing one. Full ordinary-clone regression:808pass/0fail, both configured typecheck commands, both builds and scaffold smoke passed. No real field/provider acceptance or image inference is established.
