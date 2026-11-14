import { startApp } from "../scripts/app.ts";
import { parseCaseInput } from "../src/input.ts";
import { decideCase } from "../src/assessment.ts";
import { supplierFixture } from "./o-supplier-fixture.ts";
import { parseHOperationalConfiguration } from "../src/o-operations-config.ts";
import { authTimeState } from "./o-process-time.ts";

const parsed = parseCaseInput(JSON.parse(process.argv[3] ?? "null"));
if (!parsed.ok) throw new Error("synthetic child input");
const h = process.argv[2]?.startsWith("h-") ? await supplierFixture(process.argv[5] ?? "") : undefined;
const stateRoot = process.env["RESOURCE_STATE_DIR"];
if (stateRoot) console.log("test-auth-time " + JSON.stringify(authTimeState(stateRoot)));
await startApp({ ...(h ? { suppliers: { configuration: parseHOperationalConfiguration(JSON.parse(process.argv[4] ?? "null")), open: h.open } } : {}), transport: async () => {
  console.log("transport");
  if (process.argv[2]?.endsWith("held")) return new Promise<Response>(() => {});
  const item = { type: "message", id: "msg_synthetic", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(decideCase(parsed.value)), annotations: [] }] };
  return new Response([{ type: "response.output_item.done", output_index: 0, item }, { type: "response.completed", response: { id: "resp_synthetic", status: "completed", output: [item], usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } } }]
    .map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream", "x-request-id": "synthetic-http" } });
} });
