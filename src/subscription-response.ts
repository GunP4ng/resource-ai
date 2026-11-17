import { SessionFailure } from "./session.ts";

/** A 200 or a partial assistant message cannot establish SiWC success. */
export function completedSubscriptionResponse(response: Response): Response {
  if (!response.ok || !response.body) return response;
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = "", completed = false, bytes = 0;
  const inspect = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (data === "[DONE]") return;
    const event: unknown = JSON.parse(data);
    if (!event || typeof event !== "object") throw new SessionFailure("provider");
    switch (Reflect.get(event, "type")) {
      case "response.completed": completed = true; break;
      case "response.failed": case "response.incomplete": case "error": throw new SessionFailure("provider");
    }
  };
  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          pending += decoder.decode();
          if (pending.trim()) inspect(pending.trimEnd());
          if (!completed) throw new SessionFailure("provider");
          controller.close(); return;
        }
        bytes += chunk.value.byteLength;
        if (bytes > 524288) throw new SessionFailure("invalid-model-output");
        pending += decoder.decode(chunk.value, { stream: true });
        let end: number;
        while ((end = pending.indexOf("\n")) >= 0) { inspect(pending.slice(0, end).trimEnd()); pending = pending.slice(end + 1); }
        controller.enqueue(chunk.value);
      } catch (error) {
        await reader.cancel(error);
        controller.error(error instanceof SessionFailure ? error : new SessionFailure("provider"));
      }
    },
    async cancel(reason: unknown) { await reader.cancel(reason); },
  }), { status: response.status, statusText: response.statusText, headers: response.headers });
}
