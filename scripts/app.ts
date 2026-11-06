import { createServer } from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import { Readable } from "node:stream";
import { createOperationalApp } from "../src/operations.ts";
import { createAzureRunner, createSubscriptionRunner } from "../src/session.ts";
// Run with Bun 1.4.2. Node HTTP keeps launch types within existing dependencies.
/** Streaming bridge shared by the launcher and task-local synthetic QA harness. */
export function requestBridge(origin: string, fetchRequest: (request: Request) => Promise<Response>) {
  return async (incoming: Readable & { readonly headers: IncomingHttpHeaders; readonly method?: string; readonly url?: string }, outgoing: {
    readonly writableEnded: boolean;
    once(event: "close", listener: () => void): unknown;
    writeHead(status: number, headers?: Record<string, string>): unknown;
    end(bytes: string | Uint8Array): unknown;
  }) => {
    const controller = new AbortController();
    incoming.once("aborted", () => controller.abort());
    outgoing.once("close", () => { if (!outgoing.writableEnded) controller.abort(); });
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    try {
      const hasBody = incoming.method !== "GET" && incoming.method !== "HEAD";
      const request = new Request(new URL(incoming.url ?? "/", origin), { method: incoming.method, headers, signal: controller.signal,
        ...(hasBody ? { body: Readable.toWeb(incoming), duplex: "half" } : {}) } as RequestInit & { duplex?: "half" });
      const result = await fetchRequest(request);
      outgoing.writeHead(result.status, Object.fromEntries(result.headers));
      outgoing.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      if (error instanceof Error) { outgoing.writeHead(502); outgoing.end("Execution failed"); return; }
      throw error;
    }
  };
}

function startApp() {
const port = Number(process.env["PORT"] ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError("Invalid PORT");
const origin = `http://localhost:${port}`;
const mode = process.env["RESOURCE_MODEL_RUNNER"] ?? "subscription";
if (!["subscription", "azure", "local"].includes(mode)) throw new RangeError("Invalid RESOURCE_MODEL_RUNNER");
const runner = mode === "subscription"
  ? createSubscriptionRunner({ enabled: true, modelId: process.env["RESOURCE_MODEL_ID"], authPath: process.env["RESOURCE_AUTH_PATH"] })
  : mode === "azure" ? createAzureRunner({ enabled: true, modelId: process.env["RESOURCE_MODEL_ID"] }) : undefined;
const app = createOperationalApp({ origin, runner, timeoutMs: 10000 });
const server = createServer(requestBridge(origin, app.fetch));
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
  server.listen(port, "127.0.0.1", () => console.log(`Re:Source app: ${origin} (runner=${mode}; operational resources unavailable; live provider not verified)`));
} catch (error) {
  app.dispose();
  if (error instanceof Error) {
    console.error("Re:Source app startup failed; local assessment stopped.");
    process.exitCode = 1;
  } else throw error;
}
}
if (import.meta.main) startApp();
