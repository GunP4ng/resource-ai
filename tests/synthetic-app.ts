import { pathToFileURL } from "node:url";
import { syntheticRunner } from "./synthetic-runtime.ts";
import type { startApp as AppLauncher } from "../scripts/app.ts";

// An optional absolute launcher path lets packaging tests exercise the built app.
const launcher: { readonly startApp: typeof AppLauncher } = process.argv[2]
  ? await import(pathToFileURL(process.argv[2]).href)
  : await import("../scripts/app.ts");
await launcher.startApp({ runner: syntheticRunner });
