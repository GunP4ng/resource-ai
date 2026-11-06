/** Bounded native multipart ingress. File bytes never pass through a text decoder. */
export class PhotoHttpFailure extends Error { constructor(readonly status: number) { super("photo-request-rejected"); } }
export const uploadLimit = 5 * 1024 * 1024 + 16384;
export async function photoForm(request: Request, signal: AbortSignal): Promise<FormData> {
  if (!/^multipart\/form-data;\s*boundary=/i.test(request.headers.get("content-type") ?? "")) throw new PhotoHttpFailure(415);
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > uploadLimit)) throw new PhotoHttpFailure(413);
  const reader = request.body?.getReader(); if (!reader) throw new PhotoHttpFailure(400);
  const chunks: Uint8Array[] = []; let size = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted(); const next = await reader.read(); if (next.done) break;
      size += next.value.length; if (size > uploadLimit) { await reader.cancel(); throw new PhotoHttpFailure(413); }
      chunks.push(next.value);
    }
    signal.throwIfAborted();
    const bytes = Buffer.concat(chunks);
    let form: FormData;
    try { form = await new Response(bytes, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData(); }
    catch { throw new PhotoHttpFailure(400); }
    const keys = [...form.keys()];
    if (keys.length > 5 || new Set(keys).size !== keys.length || keys.some(key => !["file", "baseVersion", "store", "model", "visible"].includes(key))) throw new PhotoHttpFailure(400);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 5 * 1024 * 1024) throw new PhotoHttpFailure(413);
    if (!["image/png", "image/jpeg"].includes(file.type)) throw new PhotoHttpFailure(415);
    for (const key of ["baseVersion", "store", "model", "visible"]) if (form.has(key) && typeof form.get(key) !== "string") throw new PhotoHttpFailure(400);
    return form;
  } finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}
