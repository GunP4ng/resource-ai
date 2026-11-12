import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaseInput } from "../src/contracts.ts";
import { photoObservationParser, assertPhotoObservations, PhotoObservationError } from "../src/photo-observations.ts";
import type { PhotoObservations } from "../src/photo-observations.ts";
import { assessCase, decideCase } from "../src/assessment.ts";
import { createResourceDomain } from "../src/domain.ts";
import { createAssessmentAdapter, SessionFailure } from "../src/session.ts";
import { syntheticReviewed } from "./h-fixtures.ts";

// Synthetic observation payloads and attachments only; no field/vision accuracy claim.
const facts: CaseInput = { caseId: "synthetic-photo-observations", description: "SYNTHETIC observation connection fixture", photoRefs: ["synthetic-photo"],
  process: "사출", polymer: "PP", contamination: "없음", hazardousContact: "no", massKg: 2000, region: "울산", assessmentDate: "2026-11-05" };
const binding = [{ photoRef: facts.photoRefs[0]!, sha256: "a".repeat(64) }];
const payload = (resins = ["PET"]) => ({ images: [{ imageIndex: 0, usable: true, resinCandidates: resins, visibleFeatures: ["SYNTHETIC visible mark"] }] });
const signal = () => new AbortController().signal;

test("observations preserve raw facts and bind an immutable single snapshot to attached image SHA/ref/revision", () => {
  const before = structuredClone(facts), raw = payload(), attachments = structuredClone(binding);
  const parse = photoObservationParser(facts, attachments);
  attachments[0]!.sha256 = "b".repeat(64);
  const result = parse(raw); raw.images[0]!.resinCandidates[0] = "changed after validation";
  assertPhotoObservations(facts, result);
  assert.deepEqual(facts, before);
  assert.equal(result.images[0]?.sha256, binding[0]!.sha256);
  assert.deepEqual(result.images[0]?.resinCandidates, ["PET"]);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.images) && Object.isFrozen(result.images[0]!.resinCandidates));
});

for (const [name, value] of [
  ["missing payload", null], ["wrong images type", { images: "photo" }], ["missing image", { images: [] }],
  ["sparse image", { images: Array(1) }], ["invented rights", { ...payload(), approvedForModel: true }],
  ["index coercion", { images: [{ ...payload().images[0], imageIndex: "0" }] }],
  ["out of range image", { images: [{ ...payload().images[0], imageIndex: 1 }] }],
  ["negative image", { images: [{ ...payload().images[0], imageIndex: -1 }] }],
  ["fractional image", { images: [{ ...payload().images[0], imageIndex: 0.5 }] }],
  ["wrong usable type", { images: [{ ...payload().images[0], usable: "yes" }] }],
  ["wrong candidate type", { images: [{ ...payload().images[0], resinCandidates: [4] }] }],
  ["sparse candidates", { images: [{ ...payload().images[0], resinCandidates: Array(1) }] }],
  ["blank candidate", payload([" "])], ["oversized candidate list", payload(["a", "b", "c", "d", "e", "f"])],
  ["model hazardous contact", { images: [{ ...payload().images[0], hazardousContact: "no" }] }],
  ["model legal code", { images: [{ ...payload().images[0], wasteCode: "51-03-01" }] }],
  ["unusable with candidate", { images: [{ ...payload().images[0], usable: false }] }],
] as const) {
  test(`strict photo observation parsing rejects ${name}`, () => {
    assert.throws(() => photoObservationParser(facts, binding)(value), PhotoObservationError);
  });
}

test("model observations cannot choose a source photo/hash and duplicate or reordered indices are checked", () => {
  const input = { ...facts, photoRefs: ["photo-a", "photo-b"] };
  const parse = photoObservationParser(input, [{ photoRef: "photo-a", sha256: "a".repeat(64) }, { photoRef: "photo-b", sha256: "b".repeat(64) }]);
  const one = payload().images[0]!;
  assert.throws(() => parse({ images: [one, one] }), PhotoObservationError);
  assert.throws(() => parse({ images: [{ ...one, sha256: "c".repeat(64) }, { ...one, imageIndex: 1 }] }), PhotoObservationError);
  const result = parse({ images: [{ ...one, imageIndex: 1 }, one] });
  assert.deepEqual(result.images.map(i => [i.photoRef, i.sha256]), [["photo-a", "a".repeat(64)], ["photo-b", "b".repeat(64)]]);
});

test("observation arrays are copied once by bounded indices without invoking a hostile iterator", () => {
  let reads = 0;
  const candidates = ["PET"];
  Object.defineProperty(candidates, "0", { get: () => ++reads === 1 ? "PET" : 7 });
  Object.defineProperty(candidates, Symbol.iterator, { value: () => { throw new Error("must not run model iterators"); } });
  const result = photoObservationParser(facts, binding)({ images: [{ imageIndex: 0, usable: true, resinCandidates: candidates, visibleFeatures: [] }] });
  assert.equal(reads, 1); assert.deepEqual(result.images[0]?.resinCandidates, ["PET"]);
});

test("untrusted JSON, another case and any changed input revision cannot reuse an observation set", () => {
  const result = photoObservationParser(facts, binding)(payload());
  assert.throws(() => assertPhotoObservations(facts, structuredClone(result)), PhotoObservationError);
  assert.throws(() => assertPhotoObservations({ ...facts, caseId: "another-case" }, result), PhotoObservationError);
  assert.throws(() => assertPhotoObservations({ ...facts, massKg: 101 }, result), PhotoObservationError);
  assert.throws(() => assertPhotoObservations({ ...facts, photoRefs: ["different-photo"] }, result), PhotoObservationError);
  assert.throws(() => photoObservationParser(facts, []), PhotoObservationError);
});

test("free resin labels remain unverified candidates, never facts/hazard/legal code or eligible routes", () => {
  const input = { ...facts, polymer: null, hazardousContact: "unknown" as const }, before = structuredClone(input);
  const observations = photoObservationParser(input, binding)(payload(["custom resin label"]));
  const assessment = assessCase(input, {}, undefined, observations);
  assert.deepEqual(input, before);
  assert.deepEqual(assessment.candidates.resins, []);
  assert.equal(assessment.candidates.photoInference, "unverified-model-observations");
  assert.equal(assessment.candidates.photoResins?.[0]?.value, "custom resin label");
  assert.equal(assessment.candidates.photoResins?.[0]?.basis, "unverified-photo");
  assert.ok(assessment.questions.some(q => q.includes("custom resin label")));
  assert.ok(assessment.routes.every(r => r.eligibility.state === "unknown"));
  assert.notEqual(decideCase(input, undefined, {}, undefined, observations).state, "compared");
});

test("a conflicting photo cannot overwrite a known resin or promote a server-reviewed comparison", async () => {
  const before = structuredClone(facts), observations = photoObservationParser(facts, binding)(payload(["PET"]));
  const resources = syntheticReviewed(facts), domain = createResourceDomain(facts, resources, observations);
  const assessment = domain.assess();
  assert.deepEqual(assessment.candidates.resins, [{ value: "PP", basis: "reported-input" }]);
  assert.ok(assessment.questions.some(q => q.includes("PET") && q.includes("PP")));
  assert.ok(assessment.routes.every(r => r.eligibility.state === "unknown"));
  assert.notEqual((await domain.decide()).state, "compared");
  assert.deepEqual(facts, before);
});

test("consistent photo candidates do not alter an independently reviewed comparison", async () => {
  const resources = syntheticReviewed(facts), observations = photoObservationParser(facts, binding)(payload(["PP"]));
  const baseline = await createResourceDomain(facts, resources).decide();
  assert.equal(baseline.state, "compared");
  assert.deepEqual(await createResourceDomain(facts, resources, observations).decide(), baseline);
});

test("case and whitespace variants of a known resin do not create a redundant material question", () => {
  const observations = photoObservationParser(facts, binding)(payload(["PP", " pp "]));
  const assessment = assessCase(facts, {}, undefined, observations);
  assert.deepEqual(assessment.questions, []);
  assert.equal(facts.polymer, "PP");
});

test("unusable and inconclusive photos preserve unknown material and ask for source records", () => {
  const input = { ...facts, polymer: null };
  const observations = photoObservationParser(input, binding)({ images: [{ imageIndex: 0, usable: false, resinCandidates: [], visibleFeatures: [] }] });
  const assessment = assessCase(input, {}, undefined, observations);
  assert.deepEqual(assessment.candidates.resins, []);
  assert.deepEqual(assessment.candidates.photoResins, []);
  assert.ok(assessment.questions.some(q => q.includes("재촬영")));
  assert.ok(assessment.questions.some(q => q.includes("후보를 제시하지 못")));
});

test("adapter presents photo candidates through existing questions and rejects forged/stale results without committing answers", async () => {
  let stale = false, first: PhotoObservations | undefined;
  const seen: CaseInput[] = [];
  const adapter = createAssessmentAdapter({ runner: async input => {
    seen.push(structuredClone(input));
    const observations = stale ? first! : photoObservationParser(input, binding)(payload(["PET"]));
    first ??= observations;
    return { proposal: decideCase(input), photoObservations: observations };
  } });
  const { caseId: _id, ...fields } = { ...facts, polymer: null };
  try {
    const initial = await adapter.submit(fields, signal());
    assert.ok("decision" in initial);
    assert.ok(JSON.stringify(initial.decision).includes("PET"));
    stale = true;
    await assert.rejects(adapter.answer(initial.decision.caseId, { massKg: 999 }, signal()), e => e instanceof SessionFailure && e.code === "provider");
    stale = false;
    await adapter.answer(initial.decision.caseId, { region: "경기도" }, signal());
    assert.equal(seen.at(-1)?.massKg, facts.massKg);
    assert.equal(seen.at(-1)?.polymer, null);
  } finally { adapter.dispose(); }
});
