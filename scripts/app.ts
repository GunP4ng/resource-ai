import { createServer } from "node:http";
import { createResourceApp } from "../src/session.ts";
// Run with Bun 1.4.2. Node HTTP keeps launch types within existing dependencies.
const port = Number(process.env["PORT"] ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError("Invalid PORT");
const origin = `http://localhost:${port}`;
const app = createResourceApp({ origin, timeoutMs: 10000 });
const server = createServer(async (incoming, outgoing) => {
  const controller = new AbortController();
  incoming.on("aborted", () => controller.abort());
  outgoing.once("close", () => { if (!outgoing.writableEnded) controller.abort(); });
  const headers = new Headers();
  for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    // Bound the Node transport too; do not buffer arbitrary input before the app's limit.
    for await (const chunk of incoming) {
      if (!(chunk instanceof Uint8Array)) throw new TypeError("Invalid body chunk");
      size += chunk.byteLength;
      if (size > 16384) { outgoing.writeHead(413); outgoing.end("Request too large"); return; }
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    const request = new Request(new URL(incoming.url ?? "/", origin), { method: incoming.method, headers, signal: controller.signal, ...(bytes.byteLength ? { body: bytes } : {}) });
    const result = await app.fetch(request);
    outgoing.writeHead(result.status, Object.fromEntries(result.headers));
    outgoing.end(await result.text());
  } catch (error) {
    if (error instanceof Error) { outgoing.writeHead(502); outgoing.end("Execution failed"); return; }
    throw error;
  }
});
server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
let shuttingDown = false;
function shutdown(exitCode: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => {
    clearTimeout(deadline);
    process.exitCode = exitCode;
  });
  app.dispose();
  const deadline = setTimeout(() => {
    server.closeAllConnections();
    process.exit(exitCode);
  }, 1000);
  deadline.unref();
}
process.once("SIGTERM", () => shutdown(0));
process.once("SIGINT", () => shutdown(0));
server.once("error", () => {
  console.error("Re:Source app startup failed; local assessment stopped.");
  shutdown(1);
});
try {
  server.listen(port, "127.0.0.1", () => console.log(`Re:Source app: ${origin} (local assessment enabled; model calls disabled; operational resources unavailable; Azure not verified)`));
} catch (error) {
  app.dispose();
  if (error instanceof Error) {
    console.error("Re:Source app startup failed; local assessment stopped.");
    process.exitCode = 1;
  } else throw error;
}
