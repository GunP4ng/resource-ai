import { startApp } from "../scripts/app.ts";
import { parseCaseInput } from "../src/input.ts";
import { decideCase } from "../src/assessment.ts";

const parsed = parseCaseInput(JSON.parse(process.argv[3] ?? "null"));
if (!parsed.ok) throw new Error("synthetic child input");
await startApp({ transport: async () => {
  console.log("transport");
  if (process.argv[2] === "held") return new Promise<Response>(() => {});
  const item = { type: "message", id: "msg_synthetic", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(decideCase(parsed.value)), annotations: [] }] };
  return new Response([{ type: "response.output_item.done", output_index: 0, item }, { type: "response.completed", response: { id: "resp_synthetic", status: "completed", output: [item], usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } } }]
    .map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream", "x-request-id": "synthetic-http" } });
} });
