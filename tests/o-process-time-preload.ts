import { readProcessTime } from "./o-process-time.ts";

// TEST ONLY. Loaded explicitly by lifecycle tests, never by a production entrypoint.
Date.now = readProcessTime();
