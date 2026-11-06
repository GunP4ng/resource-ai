import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, realpath, rename, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join } from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { CaseInput } from "./contracts.ts";
import type { PhotoRequest, PhotoResolver } from "./session.ts";
import { revision } from "./o-validation.ts";
import { PhotoStorageError, sanitizePhoto } from "./photo-codec.ts";
import { matchesPhotoConsent, type PhotoExecutionAuthority, type PhotoExecutionTicket } from "./photo-execution.ts";

const id = /^[A-Za-z0-9_-]{1,128}$/, ref = /^[a-f0-9-]{36}$/;
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
// Reopened stores in this process share the same per-ref publication boundary.
const cleanupOperations = new Map<string, Promise<void>>();
const opaque = Type.String({ minLength: 1, maxLength: 128, pattern: id.source });
const digest = Type.String({ pattern: "^[a-f0-9]{64}$" });
const instant = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const ConsentSchema = Type.Object({ recordId: opaque, store: Type.Literal(true), model: Type.Boolean(),
  modelBindingId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  modelScope: Type.Optional(Type.Object({ provider: Type.String({ minLength: 1, maxLength: 200 }), purpose: Type.String({ minLength: 1, maxLength: 500 }) }, { additionalProperties: false })),
  visibleContentReviewed: Type.Boolean(), expiresAt: instant }, { additionalProperties: false });
export type PhotoConsent = Readonly<Type.Static<typeof ConsentSchema>>;
const RecordSchema = Type.Object({ version: Type.Literal(1), photoRef: Type.String({ pattern: ref.source }),
  ownerHash: digest, caseId: opaque, uploadRevision: digest, originalSha256: digest, sha256: digest,
  width: Type.Integer({ minimum: 1, maximum: 8192 }), height: Type.Integer({ minimum: 1, maximum: 8192 }),
  createdAt: instant, expiresAt: instant, consent: ConsentSchema, png: Type.String(),
}, { additionalProperties: false });
type StoredPhoto = Type.Static<typeof RecordSchema>;
const CleanupSchema = Type.Object({ version: Type.Literal(1), photoRef: Type.String({ pattern: ref.source }), ownerHash: digest }, { additionalProperties: false });
export type PhotoReceipt = Readonly<Omit<StoredPhoto, "png" | "ownerHash">>;
export interface PhotoCaseAccess {
  readonly ownerId: string;
  readonly caseRevision: string;
  readonly read: boolean;
  readonly sendToModel: boolean;
}
/** Both actor identity and case access must come from authenticated server state. */
export type PhotoAuthorizer = (actorId: string, caseId: string, signal: AbortSignal) => Promise<PhotoCaseAccess | null>;

/** Single-process private filesystem store; no public routes, URLs or caller-supplied paths. */
export async function createPhotoStore(options: { root: string; authorize: PhotoAuthorizer; retentionMs: number; maxPhotos: number; now?: () => number; photoExecution?: PhotoExecutionAuthority }) {
  if (!isAbsolute(options.root) || !Number.isSafeInteger(options.retentionMs) || options.retentionMs <= 0
    || !Number.isSafeInteger(options.maxPhotos) || options.maxPhotos <= 0) throw new PhotoStorageError("invalid-policy");
  await mkdir(options.root, { recursive: true, mode: 0o700 });
  if ((await lstat(options.root)).isSymbolicLink()) throw new PhotoStorageError("invalid-policy");
  const root = await realpath(options.root), rootIdentity = await lstat(root), now = options.now ?? Date.now;
  if (!rootIdentity.isDirectory()) throw new PhotoStorageError("invalid-policy");
  const ensureRoot = async () => {
    const current = await lstat(root);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== rootIdentity.dev || current.ino !== rootIdentity.ino
      || await realpath(root) !== root) throw new PhotoStorageError("unavailable");
  };
  const path = (photoRef: string) => { if (!ref.test(photoRef)) throw new PhotoStorageError("unavailable"); return join(root, `${photoRef}.json`); };
  const clock = () => { const value = now(); if (!Number.isSafeInteger(value) || value < 0) throw new PhotoStorageError("invalid-policy"); return value; };
  const aborted = (signal: AbortSignal) => { if (signal.aborted) throw new PhotoStorageError("cancelled"); };
  const revokedPath = (photoRef: string) => `${path(photoRef)}.revoked`;
  const cleanupPath = (photoRef: string) => `${path(photoRef)}.cleanup-owner`;
  const deniedPath = (photoRef: string) => `${path(photoRef)}.model-denied`;
  const modelDenied = async (photoRef: string) => {
    try { await lstat(deniedPath(photoRef)); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  };
  const isRevoked = async (photoRef: string) => {
    try { await lstat(revokedPath(photoRef)); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  };
  // Tombstones must outlive backups. Never restore only photo JSON without these markers.
  const erase = async (photoRef: string) => {
    await ensureRoot();
    try { const marker = await open(revokedPath(photoRef), "wx", 0o600); try { await marker.sync(); } finally { await marker.close(); } }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const markerDirectory = await open(root, constants.O_RDONLY);
    try { await markerDirectory.sync(); } finally { await markerDirectory.close(); }
    await ensureRoot();
    try {
      const target = await lstat(path(photoRef));
      if (!target.isFile() || target.isSymbolicLink() || target.nlink !== 1) throw new PhotoStorageError("unavailable");
      await unlink(path(photoRef));
    } catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error; }
    const directory = await open(root, constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
  };
  const readJSON = async (file: string, maxSize: number, durable = false): Promise<unknown> => {
    await ensureRoot();
    const before = await lstat(file);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maxSize) throw new Error();
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > maxSize) throw new Error();
      const buffer = Buffer.alloc(opened.size + 1); let length = 0;
      while (length < buffer.length) { const read = await handle.read(buffer, length, buffer.length - length, length); if (!read.bytesRead) break; length += read.bytesRead; }
      if (length !== opened.size) throw new Error();
      const after = await lstat(file); await ensureRoot();
      if (after.isSymbolicLink() || after.nlink !== 1 || after.dev !== opened.dev || after.ino !== opened.ino || after.size !== length || after.mtimeMs !== opened.mtimeMs) throw new Error();
      if (durable) await handle.sync();
      return JSON.parse(buffer.subarray(0, length).toString("utf8"));
    } finally { await handle.close(); }
  };
  const readRecord = async (photoRef: string): Promise<StoredPhoto> => {
    const value = await readJSON(path(photoRef), 14 * 1024 * 1024);
    if (!Value.Check(RecordSchema, value) || value.photoRef !== photoRef || value.width * value.height > 12_000_000
      || value.expiresAt > value.consent.expiresAt || value.expiresAt > value.createdAt + options.retentionMs) throw new PhotoStorageError("unavailable");
    return value;
  };
  // Kept separately from the legacy (possibly empty) denial marker. Never contains image data.
  const cleanupOwner = async (photoRef: string) => {
    const value = await readJSON(cleanupPath(photoRef), 1024, true);
    if (!Value.Check(CleanupSchema, value) || value.photoRef !== photoRef) throw new PhotoStorageError("unavailable");
    return value;
  };
  const serializedCleanup = async <T>(photoRef: string, work: () => Promise<T>): Promise<T> => {
    const file = cleanupPath(photoRef), previous = cleanupOperations.get(file), operation = Promise.withResolvers<void>();
    cleanupOperations.set(file, operation.promise);
    try { await previous; return await work(); }
    finally {
      operation.resolve();
      if (cleanupOperations.get(file) === operation.promise) cleanupOperations.delete(file);
    }
  };
  // Called only under serializedCleanup, using the original validated record as authority.
  const preserveOwner = async (value: StoredPhoto, signal?: AbortSignal) => {
    const photoRef = value.photoRef, file = cleanupPath(photoRef);
    let owner;
    try { owner = await cleanupOwner(photoRef); }
    catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      if (signal) aborted(signal); await ensureRoot();
      const staged = `${file}.${randomUUID()}.tmp`, handle = await open(staged, "wx", 0o600);
      let published = false;
      try {
        try {
          await handle.writeFile(JSON.stringify({ version: 1, photoRef, ownerHash: value.ownerHash }), "utf8"); await handle.sync();
        } finally { await handle.close(); }
        if (signal) aborted(signal); await ensureRoot();
        // Never replace an observed receipt, including malformed or linked files.
        try {
          const existing = await cleanupOwner(photoRef);
          if (existing.ownerHash !== value.ownerHash) throw new PhotoStorageError("denied");
        } catch (error) {
          if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
          await rename(staged, file); published = true;
        }
        const directory = await open(root, constants.O_RDONLY);
        try { await directory.sync(); } finally { await directory.close(); }
      } finally {
        if (!published) {
          await ensureRoot();
          try { await unlink(staged); }
          catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error; }
        }
      }
      owner = await cleanupOwner(photoRef);
    }
    if (owner.ownerHash !== value.ownerHash) throw new PhotoStorageError("denied");
    return owner;
  };
  const cleanupExpired = (photoRef: string) => serializedCleanup(photoRef, async () => {
    let value;
    try { value = await readRecord(photoRef); }
    catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      // A preceding serialized deletion may have completed. Missing alone is never proof.
      await cleanupOwner(photoRef); return false;
    }
    if (value.expiresAt > clock() && !await isRevoked(photoRef)) return false;
    await preserveOwner(value);
    await erase(photoRef); return true;
  });
  const authorize = async (actorId: string, caseId: string, signal: AbortSignal) => {
    aborted(signal);
    if (typeof actorId !== "string" || typeof caseId !== "string" || !id.test(actorId) || !id.test(caseId)) throw new PhotoStorageError("denied");
    const access = await options.authorize(actorId, caseId, signal); aborted(signal);
    if (!access || access.ownerId !== actorId || access.read !== true || !/^[a-f0-9]{64}$/.test(access.caseRevision)) throw new PhotoStorageError("denied");
    return { ...access };
  };
  const load = async (photoRef: string): Promise<StoredPhoto> => {
    try {
      await ensureRoot(); if (await isRevoked(photoRef)) throw new Error();
      const value = await readRecord(photoRef);
      if (await isRevoked(photoRef)) throw new Error();
      if (value.expiresAt <= clock()) { await cleanupExpired(photoRef); throw new Error(); }
      return value;
    } catch { throw new PhotoStorageError("unavailable"); }
  };
  const receipt = ({ png: _png, ownerHash: _owner, ...value }: StoredPhoto): PhotoReceipt => structuredClone(value);
  const assertTicket = (ticket?: PhotoExecutionTicket) => {
    if (!options.photoExecution || !ticket) throw new PhotoStorageError("denied");
    try { options.photoExecution.assertCurrent(ticket); } catch { throw new PhotoStorageError("denied"); }
  };
  const permitted = async (actorId: string, request: PhotoRequest, signal: AbortSignal, model: boolean, ticket?: PhotoExecutionTicket) => {
    if (model) assertTicket(ticket);
    const access = await authorize(actorId, request.caseId, signal);
    const value = await load(request.photoRef); aborted(signal);
    if (value.ownerHash !== hash(actorId) || value.caseId !== request.caseId || access.caseRevision !== request.caseRevision
      || (model && (access.sendToModel !== true || !matchesPhotoConsent(value.consent, ticket) || await modelDenied(request.photoRef)))) throw new PhotoStorageError("denied");
    if (model) assertTicket(ticket);
    return value;
  };
  let pending = 0;
  return {
    async read(actorId: string, request: PhotoRequest, signal: AbortSignal) {
      const value = await permitted(actorId, request, signal, false);
      const data = Buffer.from(value.png, "base64");
      if (data.toString("base64") !== value.png || data.length > 10 * 1024 * 1024 || hash(data) !== value.sha256) throw new PhotoStorageError("unavailable");
      await permitted(actorId, request, signal, false);
      return { receipt: receipt(value), data };
    },
    async withdrawModel(actorId: string, photoRef: string, signal: AbortSignal): Promise<void> {
      aborted(signal); const value = await load(photoRef);
      if (!id.test(actorId) || value.ownerHash !== hash(actorId)) throw new PhotoStorageError("denied");
      aborted(signal); await ensureRoot();
      try {
        const marker = await open(deniedPath(photoRef), "wx", 0o600);
        try { await marker.sync(); } finally { await marker.close(); }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new PhotoStorageError("unavailable"); }
      const directory = await open(root, constants.O_RDONLY);
      try { await directory.sync(); } finally { await directory.close(); }
    },
    async put(actorId: string, caseId: string, data: Uint8Array, mime: string, consent: PhotoConsent, signal: AbortSignal): Promise<PhotoReceipt> {
      const allowed: unknown = structuredClone(consent), createdAt = clock();
      if (!Value.Check(ConsentSchema, allowed) || allowed.expiresAt <= createdAt) throw new PhotoStorageError("denied");
      if (allowed.model && (!allowed.modelBindingId || !allowed.modelScope?.provider.trim() || !allowed.modelScope.purpose.trim())) throw new PhotoStorageError("denied");
      if (!(data instanceof Uint8Array) || data.byteLength > 10 * 1024 * 1024) throw new PhotoStorageError("image-limit");
      const owned = Buffer.from(data);
      const access = await authorize(actorId, caseId, signal);
      await ensureRoot();
      if ((await readdir(root)).filter((name) => name.endsWith(".json") || name.endsWith(".revoked")).length + pending >= options.maxPhotos) throw new PhotoStorageError("busy");
      pending++;
      let created: string | undefined;
      try {
        const clean = await sanitizePhoto(owned, mime, signal);
        if (clean.data.byteLength > 5 * 1024 * 1024) throw new PhotoStorageError("image-limit");
        const again = await authorize(actorId, caseId, signal);
        if (again.caseRevision !== access.caseRevision) throw new PhotoStorageError("denied");
        const photoRef = randomUUID(), expiresAt = Math.min(allowed.expiresAt, createdAt + options.retentionMs);
        if (!Number.isSafeInteger(expiresAt) || expiresAt <= clock()) throw new PhotoStorageError("denied");
        const value: StoredPhoto = { version: 1, photoRef, ownerHash: hash(actorId), caseId, uploadRevision: access.caseRevision,
          originalSha256: hash(owned), sha256: hash(clean.data), width: clean.width, height: clean.height,
          createdAt, expiresAt, consent: allowed, png: Buffer.from(clean.data).toString("base64") };
        await ensureRoot(); const file = path(photoRef), handle = await open(file, "wx", 0o600); created = file;
        try { await handle.writeFile(JSON.stringify(value), "utf8"); await handle.sync(); } finally { await handle.close(); }
        await ensureRoot(); aborted(signal);
        return receipt(value);
      } catch (error) {
        if (created) await ensureRoot().then(() => unlink(created!)).catch(() => undefined);
        if (error instanceof PhotoStorageError) throw error;
        throw new PhotoStorageError("unavailable");
      } finally { pending--; }
    },
    resolver(actorId: string, ticket?: PhotoExecutionTicket): PhotoResolver {
      return async (request, signal) => {
        request = { ...request };
        const value = await permitted(actorId, request, signal, true, ticket);
        const data = Buffer.from(value.png, "base64");
        if (data.toString("base64") !== value.png || data.length > 10 * 1024 * 1024 || hash(data) !== value.sha256) throw new PhotoStorageError("unavailable");
        // Recheck revocation/expiry/ownership after reading the bytes.
        const current = await permitted(actorId, request, signal, true, ticket);
        if (current.sha256 !== value.sha256) throw new PhotoStorageError("unavailable");
        assertTicket(ticket);
        return { ...request, data, mimeType: "image/png", sha256: value.sha256, approvedForModel: true };
      };
    },
    async assertCanTransmit(actorId: string, input: CaseInput, signal: AbortSignal, expected?: readonly { photoRef: string; sha256: string }[], ticket?: PhotoExecutionTicket): Promise<void> {
      assertTicket(ticket);
      for (const photoRef of input.photoRefs) {
        const value = await permitted(actorId, { photoRef, caseId: input.caseId, caseRevision: revision(input) }, signal, true, ticket);
        const bytes = Buffer.from(value.png, "base64");
        if (hash(bytes) !== value.sha256 || (expected && !expected.some((item) => item.photoRef === photoRef && item.sha256 === value.sha256))) throw new PhotoStorageError("unavailable");
      }
      assertTicket(ticket);
    },
    async revoke(actorId: string, photoRef: string, signal: AbortSignal): Promise<void> {
      aborted(signal);
      if (!id.test(actorId)) throw new PhotoStorageError("denied");
      try {
        await serializedCleanup(photoRef, async () => {
          aborted(signal);
          let owner;
          try { owner = await cleanupOwner(photoRef); }
          catch (error) {
            if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
            // Ownership checks deliberately bypass load: revoked and expired records remain cleanable.
            const value = await readRecord(photoRef);
            if (value.ownerHash !== hash(actorId)) throw new PhotoStorageError("denied");
            owner = await preserveOwner(value, signal);
          }
          if (owner.ownerHash !== hash(actorId)) throw new PhotoStorageError("denied");
          aborted(signal); await erase(photoRef);
        });
      } catch (error) {
        if (error instanceof PhotoStorageError) throw error;
        throw new PhotoStorageError("unavailable");
      }
    },
    /** Schedule on the server and at startup; reads also erase expired records. */
    async purgeExpired(): Promise<{ removed: number; unreadable: number }> {
      let removed = 0, unreadable = 0;
      await ensureRoot(); for (const name of await readdir(root)) {
        if (!name.endsWith(".json") || !ref.test(name.slice(0, -5))) continue;
        try {
          if (await cleanupExpired(name.slice(0, -5))) removed++;
        } catch { unreadable++; }
      }
      return { removed, unreadable };
    },
  };
}
