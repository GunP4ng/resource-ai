import assert from "node:assert/strict";
/// <reference types="bun-types/test" />
import { test } from "node:test";
import { spyOn } from "bun:test";
import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import { mkdtemp, readFile, readdir, rm, writeFile, rename, symlink, link, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { sanitizePhoto, PhotoStorageError } from "../src/photo-codec.ts";
import { createPhotoStore, type PhotoConsent } from "../src/photos.ts";
import { revision } from "../src/o-validation.ts";
import type { CaseInput } from "../src/contracts.ts";
import { createPhotoExecutionAuthority } from "../src/photo-execution.ts";

const photoExecution = createPhotoExecutionAuthority();
const target = { endpoint: "https://synthetic.openai.azure.com", deployment: "synthetic", modelId: "gpt-4.1", apiVersion: "v1" };
photoExecution.publish({ ...target, apiKey: "synthetic-key" }, [{ target, scope: { provider: "synthetic provider", purpose: "synthetic purpose" } }]);
const photoTicket = photoExecution.current()!;
const scopedConsent = { modelScope: photoTicket.scope, modelBindingId: photoTicket.bindingId };

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

test("legacy boolean-only model consent is previewable but cannot resolve or transmit without authority", async () => {
  const root = await mkdtemp(join(tmpdir(), "photo-unscoped-"));
  try {
    const store = await createPhotoStore({ root, retentionMs: 60000, maxPhotos: 2,
      authorize: async () => ({ ownerId: "owner", caseRevision: revision(facts), read: true, sendToModel: true }) });
    const photo = await store.put("owner", facts.caseId, image(), "image/png",
      { recordId: "legacy", store: true, model: false, visibleContentReviewed: true, expiresAt: Date.now() + 60000 }, signal());
    const file = join(root, `${photo.photoRef}.json`), stored = JSON.parse(await readFile(file, "utf8"));
    await writeFile(file, JSON.stringify({ ...stored, consent: { ...stored.consent, model: true } }));
    const request = { caseId: facts.caseId, caseRevision: revision(facts), photoRef: photo.photoRef };
    assert.ok((await store.read("owner", request, signal())).data.length);
    await assert.rejects(store.resolver("owner")(request, signal()), failure("denied"));
    await assert.rejects(store.assertCanTransmit("owner", { ...facts, photoRefs: [photo.photoRef] }, signal()), failure("denied"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("irreversible model withdrawal survives store reopen and restoration of photo JSON while retaining storage preview", async () => {
  const root = await mkdtemp(join(tmpdir(), "photo-denial-"));
  const options = { root, photoExecution, retentionMs: 60000, maxPhotos: 5, authorize: async () => ({ ownerId: "owner", caseRevision: revision(facts), read: true, sendToModel: true }) };
  try {
    const store = await createPhotoStore(options);
    const photo = await store.put("owner", facts.caseId, image(), "image/png", { ...scopedConsent, recordId: "synthetic", store: true, model: true, visibleContentReviewed: true, expiresAt: Date.now() + 60000 }, signal());
    const request = { caseId: facts.caseId, caseRevision: revision(facts), photoRef: photo.photoRef };
    assert.equal((await store.resolver("owner", photoTicket)(request, signal()))?.approvedForModel, true);
    const backup = await readFile(join(root, `${photo.photoRef}.json`));
    await store.withdrawModel("owner", photo.photoRef, signal());
    await writeFile(join(root, `${photo.photoRef}.json`), backup);
    const reopened = await createPhotoStore(options);
    await assert.rejects(reopened.resolver("owner", photoTicket)(request, signal()), failure("denied"));
    await assert.rejects(reopened.assertCanTransmit("owner", { ...facts, photoRefs: [photo.photoRef] }, signal(), undefined, photoTicket), failure("denied"));
    assert.equal((await reopened.read("owner", request, signal())).receipt.sha256, photo.sha256);
  } finally { await rm(root, { recursive: true, force: true }); }
});

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
  const options = { root, photoExecution, retentionMs: 500, maxPhotos: 10, now: () => now,
    authorize: async (actor: string, caseId: string) => actor === "owner" && caseId === facts.caseId
      ? { ownerId: "owner", caseRevision: revision(current), read: readable, sendToModel: model } : null };
  const store = await createPhotoStore(options);
  const consent: PhotoConsent = { ...scopedConsent, recordId: "synthetic-consent", store: true, model: true, visibleContentReviewed: true, expiresAt: 2000 };
  return { root, options, store, consent, setNow: (v: number) => now = v, setCase: (v: CaseInput) => current = v,
    setRead: (v: boolean) => readable = v, setModel: (v: boolean) => model = v,
    request: (photoRef: string) => ({ caseId: current.caseId, caseRevision: revision(current), photoRef }),
    close: () => rm(root, { recursive: true, force: true }) };
}

test("revocation retries after durable denial and unlink failure, retaining owner authorization after expiry and deletion", async () => {
  const f = await fixture();
  const original = fs.unlink;
  let fault: ReturnType<typeof spyOn> | undefined;
  try {
    const photo = await f.store.put("owner", facts.caseId, image(), "image/png", f.consent, signal());
    const file = join(f.root, `${photo.photoRef}.json`), marker = `${file}.revoked`;
    fault = spyOn(fs, "unlink").mockImplementation(async target => {
      if (target === file) {
        await readFile(marker); // Fault occurs only after the durable marker was created.
        throw Object.assign(new Error("synthetic unlink failure"), { code: "EIO" });
      }
      return original(target);
    });
    await assert.rejects(f.store.revoke("owner", photo.photoRef, signal()));
    await readFile(marker); await readFile(file);
    await assert.rejects(f.store.read("owner", f.request(photo.photoRef), signal()), failure("unavailable"));
    await assert.rejects(f.store.resolver("owner", photoTicket)(f.request(photo.photoRef), signal()), failure("unavailable"));
    await assert.rejects(f.store.assertCanTransmit("owner", { ...facts, photoRefs: [photo.photoRef] }, signal(), undefined, photoTicket), failure("unavailable"));
    await assert.rejects(f.store.revoke("intruder", photo.photoRef, signal()), failure("denied"));
    fault.mockRestore(); fault = undefined;
    f.setNow(2000);
    const reopened = await createPhotoStore(f.options);
    await reopened.revoke("owner", photo.photoRef, signal());
    await assert.rejects(readFile(file), { code: "ENOENT" });
    await reopened.revoke("owner", photo.photoRef, signal());
    await assert.rejects(reopened.revoke("intruder", photo.photoRef, signal()), failure("denied"));
    await assert.rejects(reopened.revoke("owner", "../forged", signal()));
    await assert.rejects(reopened.revoke("owner", "00000000-0000-0000-0000-000000000000", signal()), failure("unavailable"));
  } finally { fault?.mockRestore(); await f.close(); }
});

test("partial cleanup receipt writes stay unpublished and the same revoke API recovers after restart", async () => {
  const f = await fixture(), originalOpen = fs.open;
  const originalUnlink = fs.unlink;
  let fault: ReturnType<typeof spyOn> | undefined, cleanupFault: ReturnType<typeof spyOn> | undefined;
  let injections = 0, cleanupInjections = 0, staged = "";
  try {
    const photo = await f.store.put("owner", facts.caseId, image(), "image/png", f.consent, signal());
    const file = join(f.root, `${photo.photoRef}.json`), ownerFile = `${file}.cleanup-owner`, marker = `${file}.revoked`;
    const backup = await readFile(file);
    await writeFile(marker, ""); // Existing denial must survive receipt initialization failure.
    fault = spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (String(args[0]).startsWith(ownerFile) && args[1] === "wx") {
        staged = String(args[0]);
        return new Proxy(handle, {
          get(target, key) {
            if (key === "writeFile") return async () => {
              injections++;
              await target.writeFile('{"version":');
              await target.sync();
              throw Object.assign(new Error("synthetic partial receipt write"), { code: "EIO" });
            };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      }
      return handle;
    });
    cleanupFault = spyOn(fs, "unlink").mockImplementation(async target => {
      if (target === staged) {
        cleanupInjections++;
        throw Object.assign(new Error("synthetic interrupted staging cleanup"), { code: "EIO" });
      }
      return originalUnlink(target);
    });
    await assert.rejects(f.store.revoke("owner", photo.photoRef, signal()), failure("unavailable"));
    assert.equal(injections, 1);
    await assert.rejects(readFile(ownerFile), { code: "ENOENT" });
    assert.notEqual(staged, ownerFile); assert.ok(staged.endsWith(".tmp"));
    assert.equal(cleanupInjections, 1); assert.equal(await readFile(staged, "utf8"), '{"version":');
    assert.deepEqual(await readFile(file), backup); assert.equal((await readFile(marker)).length, 0);
    await assert.rejects(f.store.read("owner", f.request(photo.photoRef), signal()), failure("unavailable"));
    fault.mockRestore(); fault = undefined; cleanupFault.mockRestore(); cleanupFault = undefined;
    const reopened = await createPhotoStore(f.options);
    await reopened.revoke("owner", photo.photoRef, signal());
    await assert.rejects(readFile(file), { code: "ENOENT" });
    await reopened.revoke("owner", photo.photoRef, signal());
    await assert.rejects(reopened.revoke("intruder", photo.photoRef, signal()), failure("denied"));
    assert.equal((await fs.lstat(ownerFile)).nlink, 1);
  } finally { fault?.mockRestore(); cleanupFault?.mockRestore(); await f.close(); }
});

for (const interruption of ["file-sync", "publication", "directory-sync"] as const) {
  test(`cleanup receipt ${interruption} failure recovers with concurrent same-owner revokes`, async () => {
    const f = await fixture(), originalOpen = fs.open, originalRename = fs.rename;
    let openFault: ReturnType<typeof spyOn> | undefined, renameFault: ReturnType<typeof spyOn> | undefined, injections = 0;
    try {
      const photo = await f.store.put("owner", facts.caseId, image(), "image/png", f.consent, signal());
      const file = join(f.root, `${photo.photoRef}.json`), ownerFile = `${file}.cleanup-owner`, marker = `${file}.revoked`;
      const backup = await readFile(file); await writeFile(marker, "");
      openFault = spyOn(fs, "open").mockImplementation(async (...args) => {
        const handle = await originalOpen(...args);
        const inject = interruption === "file-sync" ? String(args[0]).startsWith(ownerFile) && args[1] === "wx"
          : interruption === "directory-sync" && args[0] === f.root;
        if (!inject) return handle;
        return new Proxy(handle, {
          get(target, key) {
            if (key === "sync") return async () => {
              injections++;
              throw Object.assign(new Error(`synthetic ${interruption} failure`), { code: "EIO" });
            };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      });
      renameFault = spyOn(fs, "rename").mockImplementation(async (from, to) => {
        if (interruption === "publication" && to === ownerFile) {
          injections++;
          throw Object.assign(new Error("synthetic publication failure"), { code: "EIO" });
        }
        return originalRename(from, to);
      });
      await assert.rejects(f.store.revoke("owner", photo.photoRef, signal()), failure("unavailable"));
      assert.equal(injections, 1); assert.deepEqual(await readFile(file), backup);
      assert.equal((await readFile(marker)).length, 0);
      if (interruption === "directory-sync") {
        assert.deepEqual(JSON.parse(await readFile(ownerFile, "utf8")), { version: 1, photoRef: photo.photoRef, ownerHash: sha(Buffer.from("owner")) });
      } else await assert.rejects(readFile(ownerFile), { code: "ENOENT" });
      openFault.mockRestore(); openFault = undefined; renameFault.mockRestore(); renameFault = undefined;
      const reopened = await createPhotoStore(f.options);
      await Promise.all([f.store.revoke("owner", photo.photoRef, signal()), reopened.revoke("owner", photo.photoRef, signal())]);
      await assert.rejects(readFile(file), { code: "ENOENT" });
      assert.equal((await fs.lstat(ownerFile)).nlink, 1);
      await reopened.revoke("owner", photo.photoRef, signal());
      await assert.rejects(reopened.revoke("intruder", photo.photoRef, signal()), failure("denied"));
    } finally { openFault?.mockRestore(); renameFault?.mockRestore(); await f.close(); }
  });
}

test("expired preview preserves owner evidence for subsequent same-API withdrawal", async () => {
  const f = await fixture();
  try {
    const photo = await f.store.put("owner", facts.caseId, image(), "image/png", f.consent, signal());
    f.setNow(2000);
    await assert.rejects(f.store.read("owner", f.request(photo.photoRef), signal()), failure("unavailable"));
    await assert.rejects(readFile(join(f.root, `${photo.photoRef}.json`)), { code: "ENOENT" });
    const reopened = await createPhotoStore(f.options);
    await reopened.revoke("owner", photo.photoRef, signal());
    await reopened.revoke("owner", photo.photoRef, signal());
    await assert.rejects(reopened.revoke("intruder", photo.photoRef, signal()), failure("denied"));
    await assert.rejects(reopened.revoke("owner", "00000000-0000-0000-0000-000000000000", signal()), failure("unavailable"));
  } finally { await f.close(); }
});

test("expiry sweep after interrupted receipt staging preserves same-API withdrawal recovery", async () => {
  const f = await fixture(), originalOpen = fs.open;
  let fault: ReturnType<typeof spyOn> | undefined, injections = 0;
  try {
    const photo = await f.store.put("owner", facts.caseId, image(), "image/png", f.consent, signal());
    const file = join(f.root, `${photo.photoRef}.json`), ownerFile = `${file}.cleanup-owner`, backup = await readFile(file);
    fault = spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (!String(args[0]).startsWith(`${ownerFile}.`) || args[1] !== "wx") return handle;
      return new Proxy(handle, { get(target, key) {
        if (key === "writeFile") return async () => {
          injections++; await target.writeFile('{"version":'); await target.sync();
          throw Object.assign(new Error("synthetic partial staging write"), { code: "EIO" });
        };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
    });
    await assert.rejects(f.store.revoke("owner", photo.photoRef, signal()), failure("unavailable"));
    assert.equal(injections, 1); assert.deepEqual(await readFile(file), backup);
    await assert.rejects(readFile(ownerFile), { code: "ENOENT" });
    fault.mockRestore(); fault = undefined;
    f.setNow(2000);
    assert.deepEqual(await f.store.purgeExpired(), { removed: 1, unreadable: 0 });
    await assert.rejects(readFile(file), { code: "ENOENT" });
    const reopened = await createPhotoStore(f.options);
    await reopened.revoke("owner", photo.photoRef, signal());
    await reopened.revoke("owner", photo.photoRef, signal());
    await assert.rejects(reopened.revoke("intruder", photo.photoRef, signal()), failure("denied"));
  } finally { fault?.mockRestore(); await f.close(); }
});

test("expiry read, sweep and revoke serialize without losing owner evidence or deadlocking", { timeout: 5000 }, async () => {
  const f = await fixture(), originalUnlink = fs.unlink;
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let fault: ReturnType<typeof spyOn> | undefined, reading: Promise<unknown> | undefined;
  let cleanup: Promise<unknown> | undefined;
  try {
    const photo = await f.store.put("owner", facts.caseId, image(), "image/png", f.consent, signal());
    const file = join(f.root, `${photo.photoRef}.json`); f.setNow(2000);
    fault = spyOn(fs, "unlink").mockImplementation(async target => {
      if (target === file) { entered.resolve(); await release.promise; }
      return originalUnlink(target);
    });
    reading = assert.rejects(f.store.read("owner", f.request(photo.photoRef), signal()), failure("unavailable"));
    await entered.promise;
    assert.deepEqual(JSON.parse(await readFile(`${file}.cleanup-owner`, "utf8")), { version: 1, photoRef: photo.photoRef, ownerHash: sha(Buffer.from("owner")) });
    const reopened = await createPhotoStore(f.options);
    const revoke = reopened.revoke("owner", photo.photoRef, signal()), sweep = f.store.purgeExpired();
    cleanup = Promise.all([revoke, sweep]);
    release.resolve(); await reading; await cleanup;
    assert.deepEqual(await sweep, { removed: 0, unreadable: 0 });
    await assert.rejects(readFile(file), { code: "ENOENT" });
    await reopened.revoke("owner", photo.photoRef, signal());
    await assert.rejects(reopened.revoke("intruder", photo.photoRef, signal()), failure("denied"));
  } finally {
    release.resolve(); await Promise.allSettled([reading, cleanup]); fault?.mockRestore(); await f.close();
  }
});

test("legacy empty revocation markers retain denial while an expired owned record can be cleaned idempotently", async () => {
  const f = await fixture();
  try {
    const photo = await f.store.put("owner", facts.caseId, image(), "image/png", f.consent, signal());
    const file = join(f.root, `${photo.photoRef}.json`), marker = `${file}.revoked`;
    await writeFile(marker, ""); f.setNow(2000);
    await assert.rejects(f.store.read("owner", f.request(photo.photoRef), signal()), failure("unavailable"));
    await assert.rejects(f.store.revoke("intruder", photo.photoRef, signal()), failure("denied"));
    await f.store.revoke("owner", photo.photoRef, signal());
    await assert.rejects(readFile(file), { code: "ENOENT" });
    assert.equal((await readFile(marker)).length, 0);
    await f.store.revoke("owner", photo.photoRef, signal());
  } finally { await f.close(); }
});

test("cleanup receipts reject symlinks, hard links and mismatched refs without deleting restored records", async () => {
  const f = await fixture(), outside = await mkdtemp(join(tmpdir(), "photo-cleanup-outside-"));
  try {
    const photo = await f.store.put("owner", facts.caseId, image(), "image/png", f.consent, signal());
    const file = join(f.root, `${photo.photoRef}.json`), receiptFile = `${file}.cleanup-owner`, backup = await readFile(file);
    await f.store.revoke("owner", photo.photoRef, signal());
    const receipt = await readFile(receiptFile), foreign = join(outside, "receipt.json");
    await writeFile(foreign, receipt); await writeFile(file, backup);
    for (const attach of [symlink, link]) {
      await unlink(receiptFile); await attach(foreign, receiptFile);
      await assert.rejects(f.store.revoke("owner", photo.photoRef, signal()), failure("unavailable"));
      assert.deepEqual(await readFile(file), backup); assert.deepEqual(await readFile(foreign), receipt);
    }
    await unlink(receiptFile);
    await writeFile(receiptFile, JSON.stringify({ version: 1, photoRef: "00000000-0000-0000-0000-000000000000", ownerHash: sha(Buffer.from("owner")) }));
    await assert.rejects(f.store.revoke("owner", photo.photoRef, signal()), failure("unavailable"));
    assert.deepEqual(await readFile(file), backup);
    await assert.rejects(f.store.resolver("owner", photoTicket)(f.request(photo.photoRef), signal()), failure("unavailable"));
  } finally { await f.close(); await rm(outside, { recursive: true, force: true }); }
});

test("private disk store survives restart; returns only sanitized bytes and permits current case revisions", async () => {
  const f = await fixture(); try {
    const original = withChunk("tEXt", Buffer.from("Comment\0private-location"));
    const receipt = await f.store.put("owner", facts.caseId, original, "image/png", f.consent, signal());
    assert.equal(receipt.expiresAt, 1500); assert.equal(receipt.originalSha256, sha(original));
    assert.notEqual(receipt.sha256, receipt.originalSha256);
    const stored = await readFile(join(f.root, `${receipt.photoRef}.json`), "utf8");
    assert.equal(Buffer.from(JSON.parse(stored).png, "base64").includes(Buffer.from("private-location")), false);
    const restarted = await createPhotoStore(f.options);
    const result = await restarted.resolver("owner", photoTicket)(f.request(receipt.photoRef), signal());
    assert.equal(result?.sha256, sha(result!.data)); assert.equal(result?.approvedForModel, true);
    const next = { ...facts, process: "changed process", photoRefs: [receipt.photoRef] }; f.setCase(next);
    assert.equal((await restarted.resolver("owner", photoTicket)(f.request(receipt.photoRef), signal()))?.caseRevision, revision(next));
    await assert.rejects(restarted.resolver("owner", photoTicket)({ ...f.request(receipt.photoRef), caseRevision: revision(facts) }, signal()), failure("denied"));
  } finally { await f.close(); }
});

test("ownership, access, consent and last-moment revocation fail closed", async () => {
  const f = await fixture(); try {
    await assert.rejects(f.store.put("intruder", facts.caseId, image(), "image/png", f.consent, signal()), failure("denied"));
    await assert.rejects(f.store.put("owner", facts.caseId, image(), "image/png", { ...f.consent, store: false } as unknown as PhotoConsent, signal()), failure("denied"));
    for (const denied of [{ model: false }, { visibleContentReviewed: false }]) {
      const photo = await f.store.put("owner", facts.caseId, image(), "image/png", { ...f.consent, ...denied }, signal());
      await assert.rejects(f.store.resolver("owner", photoTicket)(f.request(photo.photoRef), signal()), failure("denied"));
    }
    const photo = await f.store.put("owner", facts.caseId, image(), "image/png", f.consent, signal());
    await assert.rejects(f.store.resolver("intruder", photoTicket)(f.request(photo.photoRef), signal()), failure("denied"));
    await assert.rejects(f.store.resolver("owner", photoTicket)({ ...f.request(photo.photoRef), caseId: "other-case" }, signal()), failure("denied"));
    f.setRead(false); await assert.rejects(f.store.resolver("owner", photoTicket)(f.request(photo.photoRef), signal()), failure("denied")); f.setRead(true);
    f.setModel(false); await assert.rejects(f.store.resolver("owner", photoTicket)(f.request(photo.photoRef), signal()), failure("denied")); f.setModel(true);
    const current = { ...facts, photoRefs: [photo.photoRef] }; f.setCase(current);
    await f.store.resolver("owner", photoTicket)(f.request(photo.photoRef), signal());
    await f.store.revoke("owner", photo.photoRef, signal());
    await assert.rejects(f.store.assertCanTransmit("owner", current, signal(), undefined, photoTicket), failure("unavailable"));
  } finally { await f.close(); }
});

test("exact issued scope is enforced independently by direct resolution and transmission after async authorization", async () => {
  const f = await fixture();
  try {
    for (const changed of [{ modelScope: undefined }, { modelBindingId: undefined }, { modelBindingId: "wrong" },
      { modelScope: { ...photoTicket.scope, provider: "other" } }, { modelScope: { ...photoTicket.scope, purpose: "other" } }]) {
      if ((Object.hasOwn(changed, "modelScope") && changed.modelScope === undefined) || (Object.hasOwn(changed, "modelBindingId") && changed.modelBindingId === undefined)) {
        await assert.rejects(f.store.put("owner", facts.caseId, image(), "image/png", { ...f.consent, ...changed }, signal()), failure("denied"));
      }
      const photo = await f.store.put("owner", facts.caseId, image(), "image/png", f.consent, signal());
      const file = join(f.root, `${photo.photoRef}.json`), stored = JSON.parse(await readFile(file, "utf8"));
      await writeFile(file, JSON.stringify({ ...stored, consent: { ...stored.consent, ...changed } }));
      f.setCase({ ...facts, photoRefs: [photo.photoRef] });
      assert.ok((await f.store.read("owner", f.request(photo.photoRef), signal())).data.length);
      await assert.rejects(f.store.resolver("owner", photoTicket)(f.request(photo.photoRef), signal()), failure("denied"));
      await assert.rejects(f.store.assertCanTransmit("owner", { ...facts, photoRefs: [photo.photoRef] }, signal(), undefined, photoTicket), failure("denied"));
    }
    const photo = await f.store.put("owner", facts.caseId, image(), "image/png", f.consent, signal());
    f.setCase({ ...facts, photoRefs: [photo.photoRef] });
    await f.store.assertCanTransmit("owner", { ...facts, photoRefs: [photo.photoRef] }, signal(), [{ photoRef: photo.photoRef, sha256: photo.sha256 }], photoTicket);
    const other = createPhotoExecutionAuthority(); other.publish({ ...target, apiKey: "synthetic" }, [{ target, scope: photoTicket.scope }]);
    for (const ticket of [undefined, { ...photoTicket }, other.current()!]) {
      await assert.rejects(f.store.resolver("owner", ticket)(f.request(photo.photoRef), signal()), failure("denied"));
      await assert.rejects(f.store.assertCanTransmit("owner", { ...facts, photoRefs: [photo.photoRef] }, signal(), undefined, ticket), failure("denied"));
    }
    const authority = createPhotoExecutionAuthority(); authority.publish({ ...target, apiKey: "synthetic" }, [{ target, scope: photoTicket.scope }]);
    const pinned = authority.current()!;
    let rotate = false;
    let current = facts;
    const store = await createPhotoStore({ ...f.options, photoExecution: authority, authorize: async () => {
      if (rotate) authority.publish({ ...target, apiKey: "synthetic-rotation" }, [{ target, scope: photoTicket.scope }]);
      return { ownerId: "owner", read: true, sendToModel: true, caseRevision: revision(current) };
    } });
    const bound = await store.put("owner", facts.caseId, image(), "image/png", { ...f.consent, modelScope: pinned.scope, modelBindingId: pinned.bindingId }, signal());
    rotate = true;
    await assert.rejects(store.resolver("owner", pinned)({ caseId: facts.caseId, caseRevision: revision(facts), photoRef: bound.photoRef }, signal()), failure("denied"));
    current = { ...facts, photoRefs: [bound.photoRef] };
    await assert.rejects(store.assertCanTransmit("owner", current, signal(), undefined, authority.current()!), failure("denied"));
  } finally { await f.close(); }
});

test("expiry deletes inaccessible data and scheduled sweep removes expired files", async () => {
  const f = await fixture(); try {
    const a = await f.store.put("owner", facts.caseId, image(), "image/png", f.consent, signal());
    const b = await f.store.put("owner", facts.caseId, image(), "image/png", f.consent, signal());
    f.setNow(1500);
    await assert.rejects(f.store.resolver("owner", photoTicket)(f.request(a.photoRef), signal()), failure("unavailable"));
    assert.deepEqual(await f.store.purgeExpired(), { removed: 1, unreadable: 0 });
    assert.deepEqual((await readdir(f.root)).sort(), [a, b].flatMap(photo => [
      `${photo.photoRef}.json.cleanup-owner`, `${photo.photoRef}.json.revoked`,
    ]).sort());
  } finally { await f.close(); }
});

test("corrupt stored bytes never reach the runner; upload copies caller data before authorization awaits", async () => {
  const f = await fixture(); try {
    const data = image(), expected = sha(data), consent = { ...f.consent };
    const pending = f.store.put("owner", facts.caseId, data, "image/png", consent, signal()); data.fill(0); consent.model = false;
    const receipt = await pending; assert.equal(receipt.originalSha256, expected); assert.equal(receipt.consent.model, true);
    const file = join(f.root, `${receipt.photoRef}.json`), stored = JSON.parse(await readFile(file, "utf8"));
    stored.png = Buffer.from("corrupt").toString("base64"); await writeFile(file, JSON.stringify(stored));
    await assert.rejects(f.store.resolver("owner", photoTicket)(f.request(receipt.photoRef), signal()), failure("unavailable"));
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
    await assert.rejects(f.store.resolver("owner", photoTicket)(f.request(receipt.photoRef), signal()), failure("unavailable"));
    await rename(f.root, moved); replaced = true; await symlink(outside, f.root, "junction");
    await assert.rejects(f.store.resolver("owner", photoTicket)(f.request(receipt.photoRef), signal()), failure("unavailable"));
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
    await assert.rejects(reopened.resolver("owner", photoTicket)(f.request(receipt.photoRef), signal()), failure("unavailable"));
  } finally { await f.close(); }
});

test("photo refs cannot select a filesystem path or remote URL", async () => {
  const f = await fixture(); try {
    for (const ref of ["../secret", "..\\secret", "C:\\private\\photo.png", "file:///private/photo.png", "https://example.invalid/photo.png", "%2e%2e%2fsecret"]) {
      await assert.rejects(f.store.resolver("owner", photoTicket)(f.request(ref), signal()), failure("unavailable"));
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
