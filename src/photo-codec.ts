import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";

export class PhotoStorageError extends Error {
  constructor(readonly code: "invalid-image" | "image-limit" | "decode-timeout" | "cancelled" | "busy" | "denied" | "unavailable" | "invalid-policy") {
    super(`photo-store:${code}`); this.name = "PhotoStorageError";
  }
}
export interface SanitizedPhoto { readonly data: Uint8Array; readonly width: number; readonly height: number; readonly mimeType: "image/png" }
const limit = 10 * 1024 * 1024, maxPixels = 12_000_000;
const invalid = (): never => { throw new PhotoStorageError("invalid-image"); };
const dimensions = (w: number, h: number) => {
  if (!w || !h || w > 8192 || h > 8192 || w * h > maxPixels) throw new PhotoStorageError("image-limit");
};
function crc(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
  return (value ^ 0xffffffff) >>> 0;
}
function orientation(tiff: Buffer): number {
  if (tiff.length < 8) return invalid();
  const order = tiff.toString("ascii", 0, 2);
  if (order !== "II" && order !== "MM") return invalid();
  const u16 = (p: number) => order === "II" ? tiff.readUInt16LE(p) : tiff.readUInt16BE(p);
  const u32 = (p: number) => order === "II" ? tiff.readUInt32LE(p) : tiff.readUInt32BE(p);
  if (u16(2) !== 42) return invalid();
  const at = u32(4);
  if (at < 8 || at + 2 > tiff.length) return invalid();
  const count = u16(at); if (at + 2 + count * 12 > tiff.length) return invalid();
  let result = 1, seen = false;
  for (let i = 0; i < count; i++) {
    const p = at + 2 + i * 12;
    if (u16(p) !== 0x112) continue;
    if (seen || u16(p + 2) !== 3 || u32(p + 4) !== 1) return invalid();
    seen = true; result = u16(p + 8);
    if (result < 1 || result > 8) return invalid();
  }
  return result;
}

/** Bound dimensions before decoding and remove metadata before it reaches the decoder. */
function prepare(bytes: Buffer, mime: string): { bytes: Buffer; width: number; height: number; orientation: number } {
  let width = 0, height = 0, rotate = 1, exif = false;
  const parts: Buffer[] = [];
  if (mime === "image/png" && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    parts.push(bytes.subarray(0, 8)); let at = 8, ended = false, header = false, pixels = false;
    while (at < bytes.length) {
      if (at + 12 > bytes.length) return invalid();
      const n = bytes.readUInt32BE(at), end = at + 12 + n;
      if (end > bytes.length || crc(bytes.subarray(at + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) return invalid();
      const kind = bytes.toString("ascii", at + 4, at + 8);
      if (!header && kind !== "IHDR") return invalid();
      if (kind === "IHDR") {
        if (header || n !== 13) return invalid();
        header = true; width = bytes.readUInt32BE(at + 8); height = bytes.readUInt32BE(at + 12); dimensions(width, height);
      }
      if (["acTL", "fcTL", "fdAT"].includes(kind)) return invalid(); // No silently dropped animation frames.
      if (kind === "eXIf") { if (exif) return invalid(); exif = true; rotate = orientation(bytes.subarray(at + 8, end - 4)); }
      if (["IHDR", "PLTE", "tRNS", "IDAT", "IEND"].includes(kind)) parts.push(bytes.subarray(at, end));
      else if (kind[0] === kind[0]?.toUpperCase()) return invalid();
      if (kind === "IDAT") pixels = true;
      if (kind === "IEND") { if (n !== 0 || end !== bytes.length || !pixels) return invalid(); ended = true; }
      at = end;
    }
    if (!ended) return invalid();
  } else if (mime === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8) {
    parts.push(bytes.subarray(0, 2)); let at = 2, ended = false, frames = 0;
    while (at < bytes.length) {
      const start = at; if (bytes[at++] !== 0xff) return invalid();
      while (bytes[at] === 0xff) at++;
      const marker = bytes[at++]; if (marker === undefined) return invalid();
      if (marker === 0xd9) { if (at !== bytes.length) return invalid(); parts.push(bytes.subarray(start, at)); ended = true; break; }
      if (marker === 0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || at + 2 > bytes.length) return invalid();
      const n = bytes.readUInt16BE(at), end = at + n;
      if (n < 2 || end > bytes.length) return invalid();
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (++frames !== 1 || n < 8) return invalid();
        height = bytes.readUInt16BE(at + 3); width = bytes.readUInt16BE(at + 5); dimensions(width, height);
      } else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return invalid();
      if (marker === 0xe1 && bytes.toString("ascii", at + 2, at + 8) === "Exif\0\0") {
        if (exif) return invalid(); exif = true; rotate = orientation(bytes.subarray(at + 8, end));
      }
      if (!(marker >= 0xe0 && marker <= 0xef && marker !== 0xee) && marker !== 0xfe) parts.push(bytes.subarray(start, end));
      at = end;
      if (marker === 0xda) {
        const scan = at;
        while (at < bytes.length) {
          if (bytes[at] !== 0xff) { at++; continue; }
          let next = at + 1; while (bytes[next] === 0xff) next++;
          const code = bytes[next];
          if (code === 0 || (code !== undefined && code >= 0xd0 && code <= 0xd7)) { at = next + 1; continue; }
          break;
        }
        parts.push(bytes.subarray(scan, at));
      }
    }
    if (!ended || frames !== 1) return invalid();
  } else return invalid();
  return { bytes: Buffer.concat(parts), width, height, orientation: rotate };
}

// Photon 0.3.4 is supplied by the pinned senpi dependency/lock. Resolve through senpi
// rather than depending on package-manager hoisting. Each worker owns fresh WASM memory.
const photonPath = createRequire(import.meta.resolve("@code-yeongyu/senpi")).resolve("@silvia-odwyer/photon-node");
const workerSource = `
const {parentPort, workerData:d} = require('node:worker_threads');
let decoded, clean;
try {
  const {PhotonImage} = require(d.module);
  decoded = PhotonImage.new_from_byteslice(d.bytes);
  const w = decoded.get_width(), h = decoded.get_height();
  if (w !== d.width || h !== d.height) throw Error('dimensions');
  const src = decoded.get_raw_pixels();
  if (src.length !== w*h*4) throw Error('pixels');
  const o=d.orientation, nw=o>=5?h:w, nh=o>=5?w:h, pixels=new Uint8Array(src.length);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    let dx=x,dy=y;
    if(o===2) dx=w-1-x; if(o===3){dx=w-1-x;dy=h-1-y;} if(o===4)dy=h-1-y;
    if(o===5){dx=y;dy=x;} if(o===6){dx=h-1-y;dy=x;}
    if(o===7){dx=h-1-y;dy=w-1-x;} if(o===8){dx=y;dy=w-1-x;}
    pixels.set(src.subarray((y*w+x)*4,(y*w+x)*4+4),(dy*nw+dx)*4);
  }
  clean=new PhotonImage(pixels,nw,nh);
  const data=clean.get_bytes();
  if(data.length>d.limit) throw Error('size');
  parentPort.postMessage({data,width:nw,height:nh});
} catch { parentPort.postMessage(null); }
finally { if(clean)clean.free(); if(decoded)decoded.free(); }
`;
let active = 0;
/** Full PNG/JPEG decode + orientation normalization + metadata-free PNG re-encode. */
export async function sanitizePhoto(data: Uint8Array, mime: string, signal: AbortSignal, timeoutMs = 5000): Promise<SanitizedPhoto> {
  if (signal.aborted) throw new PhotoStorageError("cancelled");
  if (!(data instanceof Uint8Array) || !data.byteLength) return invalid();
  if (data.byteLength > limit) throw new PhotoStorageError("image-limit");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) throw new PhotoStorageError("invalid-policy");
  if (active >= 2) throw new PhotoStorageError("busy");
  const input = prepare(Buffer.from(data), mime); active++;
  let worker: Worker | undefined, timer: ReturnType<typeof setTimeout> | undefined, abort = () => {};
  try {
    return await new Promise<SanitizedPhoto>((resolve, reject) => {
      worker = new Worker(workerSource, { eval: true, workerData: { ...input, module: photonPath, limit }, stdout: true, stderr: true });
      worker.stdout?.resume(); worker.stderr?.resume(); // Do not forward decoder diagnostics or input data.
      abort = () => reject(new PhotoStorageError("cancelled"));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      timer = setTimeout(() => reject(new PhotoStorageError("decode-timeout")), timeoutMs);
      worker.once("error", () => reject(new PhotoStorageError("invalid-image")));
      worker.once("exit", () => reject(new PhotoStorageError("invalid-image")));
      worker.once("message", (value: { data: Uint8Array; width: number; height: number } | null) => {
        if (!value) reject(new PhotoStorageError("invalid-image"));
        else resolve({ ...value, data: new Uint8Array(value.data), mimeType: "image/png" });
      });
    });
  } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); await worker?.terminate(); active--; }
}
