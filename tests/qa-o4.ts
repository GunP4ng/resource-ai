/** Task-local synthetic QA only. Never deploy this constant identity resolver. */
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { requestBridge } from "../scripts/app.ts";
import { createSyntheticOperationalApp as createOperationalApp } from "./synthetic-runtime.ts";
import { createCaseStore } from "../src/o-case-store.ts";
import { createPhotoStore } from "../src/photos.ts";

const origin = "http://localhost:3001";
const cases = createCaseStore();
const photos = await createPhotoStore({ root: fileURLToPath(new URL("../.qa-o4-photos", import.meta.url)), retentionMs: 1800000, maxPhotos: 30, authorize: cases.authorize });
const app = createOperationalApp({ origin, caseStore: cases, photoStore: photos, photoPolicy: { retentionMs: 1800000 },
  actorForRequest: async () => ({ actorId: "synthetic-desktop-qa", validUntil: Date.now() + 60000 }) });
const server = createServer(requestBridge(origin, app.fetch));
server.listen(3001, "127.0.0.1", () => console.log(`SYNTHETIC QA ONLY: ${origin}; local text, private storage, no model transmission`));
const close = () => { app.dispose(); server.close(); server.closeAllConnections(); };
process.once("SIGTERM", close); process.once("SIGINT", close);
