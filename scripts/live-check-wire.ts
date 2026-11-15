import { SessionFailure } from "../src/session.ts";

/** Bound actual SSE bytes; inspect only token counters, never retain prompt/error text. */
export function boundedResponse(response: Response, completedUsage: () => void, outputLimit: () => void): Response {
  const reader = response.body?.getReader();
  if (!reader) return response;
  let bytes = 0, pending = "", completed = false;
  const decoder = new TextDecoder();
  const inspect = (line: string) => {
    if (!line.startsWith("data: ")) return;
    try {
      const event: unknown = JSON.parse(line.slice(6));
      if (typeof event !== "object" || event === null || Reflect.get(event, "type") !== "response.completed") return;
      const result: unknown = Reflect.get(event, "response");
      if (typeof result !== "object" || result === null) return;
      const usage: unknown = Reflect.get(result, "usage");
      if (typeof usage !== "object" || usage === null) return;
      if (["input_tokens", "output_tokens", "total_tokens"].every(key => {
        const value: unknown = Reflect.get(usage, key);
        return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
      }) && !completed) { completed = true; completedUsage(); }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      // The SDK owns invalid SSE handling; malformed data cannot establish usage.
    }
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) { if (pending) inspect(pending); controller.close(); return; }
        bytes += chunk.value.byteLength;
        if (bytes > 524288) throw new SessionFailure("invalid-model-output");
        pending += decoder.decode(chunk.value, { stream: true });
        let end: number;
        while ((end = pending.indexOf("\n")) >= 0) { inspect(pending.slice(0, end).trimEnd()); pending = pending.slice(end + 1); }
        if (pending.length > 524288) throw new SessionFailure("invalid-model-output");
        controller.enqueue(chunk.value);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        outputLimit();
        try { await reader.cancel(); }
        finally { controller.error(new SessionFailure("provider")); }
      }
    },
    async cancel(reason: unknown) { await reader.cancel(reason); },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
