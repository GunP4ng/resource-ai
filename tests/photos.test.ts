import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, readFile, readdir, rm, writeFile, rename, symlink, link, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { sanitizePhoto, PhotoStorageError } from "../src/photo-codec.ts";
import { createPhotoStore, type PhotoConsent } from "../src/photos.ts";
import { revision } from "../src/o-validation.ts";
import type { CaseInput } from "../src/contracts.ts";

// Generated pixels are synthetic test material, never a field case.
const photon = createRequire(import.meta.resolve("@code-yeongyu/senpi"))("@silvia-odwyer/photon-node") as typeof import("@silvia-odwyer/photon-node");
const pixels = new Uint8Array([255,0,0,255,0,255,0,255]);
function image(mime = "image/png") {
  const value = new photon.PhotonImage(pixels, 2, 1);
  try { return Buffer.from(mime === "image/png" ? value.get_bytes() : value.get_bytes_jpeg(90)); } finally { value.free(); }
}
function chunk(kind: string, data: Uint8Array) {
  const result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length);
  result.write(kind, 4, "ascii"); result.set(data, 8); let crc = 0xffffffff;
  for (const byte of result.subarray(4, -4)) { crc ^= byte; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4); return result;
}
function withChunk(kind: string, bytes: Uint8Array) { const png = image(); return Buffer.concat([png.subarray(0, 33), chunk(kind, bytes), png.subarray(33)]); }
const signal = () => new AbortController().signal;
const failure = (code: PhotoStorageError["code"]) => (error: unknown) => error instanceof PhotoStorageError && error.code === code;
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const facts: CaseInput = { caseId: "synthetic-case", description: "synthetic test pixels", photoRefs: [], process: null,
  polymer: null, contamination: null, hazardousContact: "unknown", massKg: null, region: null, assessmentDate: "2026-11-06" };

test("full PNG/JPEG decode produces fresh PNG pixels and removes metadata", async () => {
  const png = withChunk("tEXt", Buffer.from("Comment\0private-gps-and-name"));
  const clean = await sanitizePhoto(png, "image/png", signal());
  assert.equal(clean.width, 2); assert.equal(clean.height, 1); assert.equal(clean.mimeType, "image/png");
  assert.equal(Buffer.from(clean.data).includes(Buffer.from("private-gps-and-name")), false);
  const decoded = photon.PhotonImage.new_from_byteslice(clean.data);
  try { assert.deepEqual(decoded.get_raw_pixels(), pixels); } finally { decoded.free(); }
  const jpeg = await sanitizePhoto(image("image/jpeg"), "image/jpeg", signal());
  assert.equal(jpeg.mimeType, "image/png"); assert.equal(jpeg.width, 2);
});

test("EXIF orientation is applied to pixels, then EXIF is discarded", async () => {
  const tiff = Buffer.alloc(26); tiff.write("II"); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8); tiff.writeUInt16LE(0x112, 10); tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14); tiff.writeUInt16LE(6, 18);
  const clean = await sanitizePhoto(withChunk("eXIf", tiff), "image/png", signal());
  assert.equal(clean.width, 1); assert.equal(clean.height, 2);
  assert.equal(Buffer.from(clean.data).includes(Buffer.from("eXIf")), false);
  const decoded = photon.PhotonImage.new_from_byteslice(clean.data);
  try { assert.deepEqual(decoded.get_raw_pixels(), pixels); } finally { decoded.free(); }
});

test("headers alone, corrupt compressed pixels, bad CRC, animations and MIME mismatch are refused", async () => {
  const png = image(), broken = Buffer.from(png); broken[broken.length - 1] = broken[broken.length - 1]! ^ 1;
  const corruptPixels = Buffer.concat([png.subarray(0, 33), chunk("IDAT", Buffer.from([1,2,3,4])), chunk("IEND", Buffer.alloc(0))]);
  for (const data of [png.subarray(0, 33), broken, corruptPixels, withChunk("acTL", Buffer.alloc(8)), Buffer.from("<svg/>")]) {
    await assert.rejects(sanitizePhoto(data, "image/png", signal()), failure("invalid-image"));
  }
  await assert.rejects(sanitizePhoto(png, "image/jpeg", signal()), failure("invalid-image"));
  await assert.rejects(sanitizePhoto(image("image/jpeg").subarray(0, -2), "image/jpeg", signal()), failure("invalid-image"));
});

test("pixel/byte limits and cancellation bound decoder work", async () => {
  const png = image(), header = Buffer.from(png.subarray(16, 29)); header.writeUInt32BE(9000);
  const huge = Buffer.concat([png.subarray(0, 8), chunk("IHDR", header), png.subarray(33)]);
  await assert.rejects(sanitizePhoto(huge, "image/png", signal()), failure("image-limit"));
  await assert.rejects(sanitizePhoto(new Uint8Array(10 * 1024 * 1024 + 1), "image/png", signal()), failure("image-limit"));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(sanitizePhoto(png, "image/png", controller.signal), failure("cancelled"));
  await assert.rejects(sanitizePhoto(png, "image/png", signal(), 1), failure("decode-timeout"));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "resource-h-photos-"));
  let now = 1000, current = facts, readable = true, model = true;
  const options = { root, retentionMs: 500, maxPhotos: 10, now: () => now,
    authorize: async (actor: string, caseId: string) => actor === "owner" && caseId === facts.caseId
      ? { ownerId: "owner", caseRevision: revision(current), read: readable, sendToModel: model } : null };
  const store = await createPhotoStore(options);
  const consent: PhotoConsent = { recordId: "synthetic-consent", store: true, model: true, visibleContentReviewed: true, expiresAt: 2000 };
  return { root, options, store, consent, setNow: (v: number) => now = v, setCase: (v: CaseInput) => current = v,
    setRead: (v: boolean) => readable = v, setModel: (v: boolean) => model = v,
    request: (photoRef: string) => ({ caseId: current.caseId, caseRevision: revision(current), photoRef }),
    close: () => rm(root, { recursive: true, force: true }) };
}

test("private disk store survives restart; returns only sanitized bytes and permits current case revisions", async () => {
  const f = await fixture(); try {
    const original = withChunk("tEXt", Buffer.from("Comment\0private-location"));
    const receipt = await f.store.put("owner", facts.caseId, original, "image/png", f.consent, signal());
    assert.equal(receipt.expiresAt, 1500); assert.equal(receipt.originalSha256, sha(original));
    assert.notEqual(receipt.sha256, receipt.originalSha256);
    const stored = await readFile(join(f.root, `${receipt.photoRef}.json`), "utf8");
    assert.equal(Buffer.from(JSON.parse(stored).png, "base64").includes(Buffer.from("private-location")), false);
    const restarted = await createPhotoStore(f.options);
    const result = await restarted.resolver("owner")(f.request(receipt.photoRef), signal());
    assert.equal(result?.sha256, sha(result!.data)); assert.equal(result?.approvedForModel, true);
    const next = { ...facts, process: "changed process", photoRefs: [receipt.photoRef] }; f.setCase(next);
    assert.equal((await restarted.resolver("owner")(f.request(receipt.photoRef), signal()))?.caseRevision, revision(next));
    await assert.rejects(restarted.resolver("owner")({ ...f.request(receipt.photoRef), caseRevision: revision(facts) }, signal()), failure("denied"));
  } finally { await f.close(); }
});

test("ownership, access, consent and last-moment revocation fail closed", async () => {
  const f = await fixture(); try {
    await assert.rejects(f.store.put("intruder", facts.caseId, image(), "image/png", f.consent, signal()), failure("denied"));
    await assert.rejects(f.store.put("owner", facts.caseId, image(), "image/png", { ...f.consent, store: false } as unknown as PhotoConsent, signal()), failure("denied"));
    for (const denied of [{ model: false }, { visibleContentReviewed: false }]) {
      const photo = await f.store.put("owner", facts.caseId, image(), "image/png", { ...f.consent, ...denied }, signal());
      await assert.rejects(f.store.resolver("owner")(f.request(photo.photoRef), signal()), failure("denied"));
    }
    const photo = await f.store.put("owner", facts.caseId, image(), "image/png", f.consent, signal());
    await assert.rejects(f.store.resolver("intruder")(f.request(photo.photoRef), signal()), failure("denied"));
    await assert.rejects(f.store.resolver("owner")({ ...f.request(photo.photoRef), caseId: "other-case" }, signal()), failure("denied"));
    f.setRead(false); await assert.rejects(f.store.resolver("owner")(f.request(photo.photoRef), signal()), failure("denied")); f.setRead(true);
    f.setModel(false); await assert.rejects(f.store.resolver("owner")(f.request(photo.photoRef), signal()), failure("denied")); f.setModel(true);
    const current = { ...facts, photoRefs: [photo.photoRef] }; f.setCase(current);
    await f.store.resolver("owner")(f.request(photo.photoRef), signal());
    await f.store.revoke("owner", photo.photoRef, signal());
    await assert.rejects(f.store.assertCanTransmit("owner", current, signal()), failure("unavailable"));
  } finally { await f.close(); }
});

test("expiry deletes inaccessible data and scheduled sweep removes expired files", async () => {
  const f = await fixture(); try {
    const a = await f.store.put("owner", facts.caseId, image(), "image/png", f.consent, signal());
    await f.store.put("owner", facts.caseId, image(), "image/png", f.consent, signal());
    f.setNow(1500);
    await assert.rejects(f.store.resolver("owner")(f.request(a.photoRef), signal()), failure("unavailable"));
    assert.deepEqual(await f.store.purgeExpired(), { removed: 1, unreadable: 0 });
    assert.deepEqual(await readdir(f.root), []);
  } finally { await f.close(); }
});

test("corrupt stored bytes never reach the runner; upload copies caller data before authorization awaits", async () => {
  const f = await fixture(); try {
    const data = image(), expected = sha(data), consent = { ...f.consent };
    const pending = f.store.put("owner", facts.caseId, data, "image/png", consent, signal()); data.fill(0); consent.model = false;
    const receipt = await pending; assert.equal(receipt.originalSha256, expected); assert.equal(receipt.consent.model, true);
    const file = join(f.root, `${receipt.photoRef}.json`), stored = JSON.parse(await readFile(file, "utf8"));
    stored.png = Buffer.from("corrupt").toString("base64"); await writeFile(file, JSON.stringify(stored));
    await assert.rejects(f.store.resolver("owner")(f.request(receipt.photoRef), signal()), failure("unavailable"));
  } finally { await f.close(); }
});

test("replaced store root and hard-linked records cannot escape the private store", async () => {
  const f = await fixture(), outside = await mkdtemp(join(tmpdir(), "resource-h-outside-"));
  const moved = `${f.root}-moved`; let replaced = false;
  try {
    const receipt = await f.store.put("owner", facts.caseId, image(), "image/png", f.consent, signal());
    const name = `${receipt.photoRef}.json`, bytes = await readFile(join(f.root, name));
    const foreign = join(outside, name); await writeFile(foreign, bytes);
    await unlink(join(f.root, name)); await link(foreign, join(f.root, name));
    await assert.rejects(f.store.resolver("owner")(f.request(receipt.photoRef), signal()), failure("unavailable"));
    await rename(f.root, moved); replaced = true; await symlink(outside, f.root, "junction");
    await assert.rejects(f.store.resolver("owner")(f.request(receipt.photoRef), signal()), failure("unavailable"));
    await assert.rejects(f.store.put("owner", facts.caseId, image(), "image/png", f.consent, signal()));
    assert.deepEqual(await readFile(foreign), bytes);
  } finally { await f.close(); if (replaced) await rm(moved, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test("revocation survives reopening and accidental restoration of an old photo record", async () => {
  const f = await fixture(); try {
    const receipt = await f.store.put("owner", facts.caseId, image(), "image/png", f.consent, signal());
    const file = join(f.root, `${receipt.photoRef}.json`), backup = await readFile(file);
    await f.store.revoke("owner", receipt.photoRef, signal());
    await writeFile(file, backup);
    const reopened = await createPhotoStore(f.options);
    await assert.rejects(reopened.resolver("owner")(f.request(receipt.photoRef), signal()), failure("unavailable"));
  } finally { await f.close(); }
});

test("photo refs cannot select a filesystem path or remote URL", async () => {
  const f = await fixture(); try {
    for (const ref of ["../secret", "..\\secret", "C:\\private\\photo.png", "file:///private/photo.png", "https://example.invalid/photo.png", "%2e%2e%2fsecret"]) {
      await assert.rejects(f.store.resolver("owner")(f.request(ref), signal()), failure("unavailable"));
    }
    assert.deepEqual(await readdir(f.root), []);
  } finally { await f.close(); }
});

test("decoder concurrency limit releases capacity after cancellation", async () => {
  const a = new AbortController(), b = new AbortController();
  const first = sanitizePhoto(image(), "image/png", a.signal), second = sanitizePhoto(image(), "image/png", b.signal);
  await assert.rejects(sanitizePhoto(image(), "image/png", signal()), failure("busy"));
  a.abort(); b.abort(); await Promise.allSettled([first, second]);
  assert.equal((await sanitizePhoto(image(), "image/png", signal())).width, 2);
});
