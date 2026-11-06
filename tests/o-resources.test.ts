import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm, chmod, symlink, link, truncate, rename, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareCaseRecord, createBundledSnapshotReader } from "../src/case-record.ts";
import { createCaseStore } from "../src/o-case-store.ts";
import { createFileResourceProvider, ResourceUnavailableError } from "../src/o-resources.ts";
import { createResourceDomain } from "../src/domain.ts";
import { revision } from "../src/o-validation.ts";
import { syntheticCase, syntheticReviewed } from "./h-fixtures.ts";
import type { DomainResources } from "../src/domain.ts";

type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };
type Artifact = Mutable<Awaited<ReturnType<typeof prepareCaseRecord>>>;
const mutableClone = <T>(value: T): Mutable<T> => structuredClone(value) as Mutable<T>;
const actor = "resource-test-owner", owner = `actor:${actor}`;
const input = { ...syntheticCase, caseId: "resource-loader", photoRefs: [] };
const options = () => ({ dataOrigin: { kind: "synthetic" as const, reference: "synthetic regression only; no operational approval" },
  codeRevision: "497fdb0144ddcbb36fd0974d616dfdb78e435750", signal: new AbortController().signal,
  sources: createBundledSnapshotReader(process.cwd()) });
const unavailable = (error: unknown) => {
  assert.ok(error instanceof ResourceUnavailableError);
  assert.equal(error.code, "resource-unavailable"); assert.equal(error.message, "resource-unavailable");
  assert.equal("cause" in error, false); assert.equal(error.stack?.includes("PRIVATE-CONTENT"), false); return true;
};
async function fixture(t: { after(fn: () => unknown): void }, resources: DomainResources = {}) {
  const root = await mkdtemp(join(tmpdir(), "o-resources-"));
  const store = createCaseStore();
  t.after(async () => { store.dispose(); await rm(root, { recursive: true, force: true }); });
  const directory = join(root, actor, input.caseId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${revision(input)}.json`);
  const artifact = mutableClone(await prepareCaseRecord(input, { ...options(), resources }));
  const install = (value: unknown = artifact, target = path) => writeFile(target, JSON.stringify(value), { mode: 0o600 });
  const provider = await createFileResourceProvider({ root, caseStore: store });
  const load = async (who = owner, signal?: AbortSignal, facts = input) => {
    const lease = store.begin(who, facts.caseId, null);
    try { return await store.run(lease, facts, async leaseSignal => provider(facts, signal ?? leaseSignal)); }
    finally { store.rollback(lease); }
  };
  return { root, store, directory, path, artifact, install, provider, load };
}
function rehash(artifact: Artifact) { artifact.record.resourcesSha256 = revision(artifact.record.resources); artifact.sha256 = revision(artifact.record); return artifact; }

test("corrupt configured file fails with a typed sanitized error; missing exact artifact clears staging", async t => {
  const f = await fixture(t); assert.deepEqual(await f.load(), {});
  await writeFile(f.path, "PRIVATE-CONTENT invalid JSON", { mode: 0o600 });
  await assert.rejects(f.load(), unavailable);
  await rm(f.path); assert.deepEqual(await f.load(), {});
});

test("exact synthetic artifact and actual J snapshots survive staging and commit with their origin", async t => {
  const f = await fixture(t, syntheticReviewed(input)); await f.install();
  const lease = f.store.begin(owner, input.caseId, null);
  const resources = await f.store.run(lease, input, async signal => f.provider(input, signal));
  assert.deepEqual(resources, f.artifact.record.resources);
  assert.ok(f.artifact.record.sources.some(s => s.role === "registered-source" && s.state === "verified"));
  assert.ok(f.artifact.record.sources.some(s => s.role === "review-facts" && s.state === "verified"));
  const decision = await createResourceDomain(input, resources).decide(); assert.equal(decision.state, "compared");
  f.store.commit(lease, { decision }, () => undefined);
  assert.deepEqual(f.store.read(owner, input.caseId)?.review, { hash: f.artifact.sha256,
    origin: f.artifact.record.dataOrigin, caseRevision: revision(input) });
  assert.equal(f.store.read(owner, input.caseId)?.review?.origin.kind, "synthetic");
});

test("another actor/case/revision never discovers or rebinds the installed artifact", async t => {
  const f = await fixture(t, syntheticReviewed(input)); await f.install();
  assert.deepEqual(await f.load("actor:other"), {});
  assert.deepEqual(await f.load(owner, undefined, { ...input, caseId: "other-case" }), {});
  assert.deepEqual(await f.load(owner, undefined, { ...input, massKg: 2001 }), {});
  const wrong = rehash({ ...structuredClone(f.artifact), record: { ...structuredClone(f.artifact.record), input: { ...input, massKg: 2001 } } });
  await f.install(wrong); await assert.rejects(f.load(), unavailable);
});

const corruptions: readonly [string, (a: Artifact) => void][] = [
  ["artifact hash", a => { a.sha256 = "0".repeat(64); }],
  ["resources hash", a => { a.record.resourcesSha256 = "0".repeat(64); a.sha256 = revision(a.record); }],
  ["revision", a => { a.record.caseRevision = "0".repeat(64); rehash(a); }],
  ["case", a => { a.record.input.caseId = "wrong-case"; rehash(a); }],
  ["source expected hash", a => { a.record.sources[0]!.expectedSha256 = "0".repeat(64); rehash(a); }],
  ["source actual hash", a => { a.record.sources[0]!.actualSha256 = "0".repeat(64); rehash(a); }],
  ["source bytes", a => { a.record.sources[0]!.base64 = "YWJj"; rehash(a); }],
  ["noncanonical base64", a => { a.record.sources[0]!.base64 += "\n"; rehash(a); }],
  ["raw source relabelled derived", a => { a.record.sources.find(s => s.role === "registered-source")!.role = "review-facts"; rehash(a); }],
  ["derived source relabelled raw", a => { a.record.sources.find(s => s.role === "review-facts")!.role = "registered-source"; rehash(a); }],
  ["source omission", a => { a.record.sources.pop(); rehash(a); }],
  ["source duplication", a => { a.record.sources[1] = structuredClone(a.record.sources[0]!); rehash(a); }],
  ["source issues", a => { a.record.sourceIssues = ["invented:unavailable"]; rehash(a); }],
  ["provenance", a => { a.record.codeRevision = "invalid"; rehash(a); }],
  ["date", a => { a.record.recordedAt = "2026-02-30T00:00:00.000Z"; rehash(a); }],
  ["images", a => { a.record.images.push({ photoRef: "unbound", sha256: "0".repeat(64), mimeType: "image/png" }); rehash(a); }],
  ["cached authority", a => { a.record.decision = { state: "needs-review", caseId: input.caseId, reasons: ["invented"], evidence: [] }; rehash(a); }],
  ["route context", a => { (a.record.resources.routeReviews!.reviews as unknown[])[0] = {}; rehash(a); }],
  ["processor context", a => { (a.record.resources.processors!.permits as unknown[])[0] = {}; rehash(a); }],
  ["calculation context", a => { (a.record.resources.calculations!.quotes as unknown[])[0] = {}; rehash(a); }],
  ["comparison context", a => { a.record.resources = { ...a.record.resources, comparison: {} as never }; rehash(a); }],
];
for (const [label, change] of corruptions) test(`rejects ${label} even with recomputed outer hash`, async t => {
  const f = await fixture(t, syntheticReviewed(input)); const a = structuredClone(f.artifact); change(a);
  await f.install(a); await assert.rejects(f.load(), unavailable);
});

test("failed configured revision and caller rollback preserve the previous committed case", async t => {
  const f = await fixture(t); await f.install();
  const first = f.store.begin(owner, input.caseId, null);
  await f.store.run(first, input, async signal => f.provider(input, signal));
  f.store.commit(first, { decision: f.artifact.record.decision }, () => undefined);
  const before = f.store.read(owner, input.caseId);
  const next = f.store.begin(owner, input.caseId, 1); await writeFile(f.path, "{PRIVATE-CONTENT", { mode: 0o600 });
  await assert.rejects(f.store.run(next, input, async signal => f.provider(input, signal)), unavailable); f.store.rollback(next);
  assert.deepEqual(f.store.read(owner, input.caseId), before);
});

test("missing source bytes suppress operational supplements while retaining the exact artifact", async t => {
  const f = await fixture(t, syntheticReviewed(input));
  const a = await prepareCaseRecord(input, { ...options(), resources: syntheticReviewed(input), sources: async () => null });
  await f.install(a); const lease = f.store.begin(owner, input.caseId, null);
  const resources = await f.store.run(lease, input, async signal => f.provider(input, signal)); assert.deepEqual(resources, {});
  const decision = await createResourceDomain(input, resources).decide(); assert.equal(decision.state, "needs-review");
  f.store.commit(lease, { decision }, () => undefined); assert.equal(f.store.read(owner, input.caseId)?.review?.hash, a.sha256);
});

test("unverified document reuse rights cannot silently supply operational facts", async t => {
  const resources = mutableClone(syntheticReviewed(input));
  // This shared synthetic document supports all three contexts; no real approval is fabricated.
  resources.routeReviews.documents[0]!.record.licenseVerified = false;
  resources.routeReviews.documents[0]!.record.license = null;
  const f = await fixture(t, resources); await f.install();
  assert.deepEqual(await f.load(), {});
});

test("a missing exact artifact stages null for a new evaluation after an accepted committed artifact", async t => {
  const f = await fixture(t); await f.install(); const lease = f.store.begin(owner, input.caseId, null);
  await f.store.run(lease, input, async signal => f.provider(input, signal));
  f.store.commit(lease, { decision: f.artifact.record.decision }, () => undefined);
  assert.equal(f.store.read(owner, input.caseId)?.review?.hash, f.artifact.sha256);
  await rm(f.path);
  const next = f.store.begin(owner, input.caseId, 1);
  await f.store.run(next, input, async signal => { assert.deepEqual(await f.provider(input, signal), {}); });
  f.store.commit(next, { decision: f.artifact.record.decision }, () => undefined);
  assert.equal(f.store.read(owner, input.caseId)?.review, null);
});

for (const mode of ["symlink", "hardlink", "oversize", "public-file", "nested-symlink", "public-directory"] as const) {
  test(`rejects ${mode} using real filesystem entries`, async t => {
    const f = await fixture(t); const outside = join(f.root, "source.json");
    if (mode === "symlink" || mode === "hardlink") {
      await f.install(f.artifact, outside); if (mode === "symlink") await symlink(outside, f.path); else await link(outside, f.path);
    } else if (mode === "nested-symlink") {
      await rename(f.directory, `${f.directory}-real`); await symlink(`${f.directory}-real`, f.directory);
    } else {
      await f.install();
      if (mode === "oversize") await truncate(f.path, 64 * 1024 * 1024 + 1);
      if (mode === "public-file") await chmod(f.path, 0o644);
      if (mode === "public-directory") await chmod(f.directory, 0o755);
    }
    await assert.rejects(f.load(), unavailable);
  });
}

test("pins root identity and rejects root replacement", async t => {
  const f = await fixture(t); const moved = `${f.root}-moved`;
  t.after(() => rm(moved, { recursive: true, force: true }));
  await rename(f.root, moved); await mkdir(f.root, { mode: 0o700 }); await assert.rejects(f.load(), unavailable);
});

test("detects a real file replacement after reading begins", async t => {
  const f = await fixture(t);
  const a = structuredClone(f.artifact); a.record.dataOrigin.reference = "synthetic-only ".repeat(1024 * 1024); rehash(a);
  await f.install(a); await utimes(f.path, new Date(0), new Date());
  const pending = assert.rejects(f.load(), unavailable);
  let reading = false;
  for (let attempt = 0; attempt < 1000; attempt++) {
    if ((await stat(f.path)).atimeMs > 0) { reading = true; break; }
    await new Promise<void>(done => setImmediate(done));
  }
  assert.equal(reading, true, "the real read must start before replacement");
  await rename(f.path, `${f.path}.previous`); await f.install(a);
  await pending;
});

test("factory rejects relative, linked and nonprivate configured roots", async t => {
  const f = await fixture(t); const linked = join(f.root, "linked"); await symlink(f.directory, linked);
  for (const root of ["relative", linked]) await assert.rejects(createFileResourceProvider({ root, caseStore: f.store }), unavailable);
  await chmod(f.root, 0o755); await assert.rejects(createFileResourceProvider({ root: f.root, caseStore: f.store }), unavailable);
});

test("requires the real private lease and rejects cancellation before and during asynchronous IO", async t => {
  const f = await fixture(t); await f.install();
  await assert.rejects(Promise.resolve().then(() => f.provider(input, options().signal)), unavailable);
  const early = new AbortController(); early.abort("PRIVATE-CONTENT");
  await assert.rejects(f.load(owner, early.signal), error => unavailable(error) && (error as ResourceUnavailableError).reason === "cancelled");
  const during = new AbortController(); const pending = f.load(owner, during.signal); queueMicrotask(() => during.abort());
  await assert.rejects(pending, error => unavailable(error) && (error as ResourceUnavailableError).reason === "cancelled");
});

for (const missing of ["mass", "quote", "factor", "currentness"] as const) {
  test(`valid incomplete ${missing} evidence retains domain holds/unavailable semantics`, async t => {
    const resources = mutableClone(syntheticReviewed(input));
    if (missing === "mass") resources.calculations = { ...resources.calculations, caseMass: null } as never;
    if (missing === "quote") resources.calculations = { ...resources.calculations, quotes: [] };
    if (missing === "factor") resources.calculations = { ...resources.calculations, factors: [] };
    if (missing === "currentness") {
      resources.routeReviews.documents[0]!.maxAgeDays = 0;
      resources.processors.documents[0]!.maxAgeDays = 0;
      resources.calculations.documents[0]!.maxAgeDays = 0;
    }
    const f = await fixture(t, resources); await f.install(); const loaded = await f.load();
    const decision = await createResourceDomain(input, loaded).decide();
    if (decision.state === "compared") assert.ok(decision.scenarios.every(s => s.netCost.state === "unavailable" || s.netEmissions.state === "unavailable"));
    else assert.equal(decision.state, "needs-review");
  });
}
