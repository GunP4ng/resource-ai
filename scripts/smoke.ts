import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  discoverAndLoadExtensions,
  ModelRuntime,
  SessionManager,
} from "@code-yeongyu/senpi";
import { projectStatusTool } from "../src/extension.ts";

// Real loader/SDK smoke, no model prompt and no paid/cloud request.
const root = await mkdtemp(join(tmpdir(), "resource-smoke-"));
const cwd = join(root, "workspace");
const agentDir = join(root, "agent");
try {
  await mkdir(cwd);
  await mkdir(agentDir);
  for (const entry of ["src/extension.ts", "dist/extension.js"]) {
    const loaded = await discoverAndLoadExtensions([resolve(entry)], cwd, agentDir);
    assert.deepEqual(loaded.errors, [], `Extension loader errors: ${entry}`);
    assert(loaded.extensions.some((extension) => extension.tools.has("resource_project_status")));
    console.log(`EXTENSION_LOAD_PASS ${entry}`);
  }

  const modelRuntime = await ModelRuntime.create({
    agentDir,
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const model = modelRuntime.getModel("azure-openai-responses", "gpt-4.1");
  assert(model, "Pinned catalog must expose the selected Azure provider model");
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: "This is an offline scaffold registration check. Do not perform inference.",
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    model,
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
    customTools: [projectStatusTool],
    tools: ["resource_project_status"],
  });
  try {
    assert.equal(session.model?.provider, "azure-openai-responses");
    assert.deepEqual(session.getActiveToolNames(), ["resource_project_status"]);
    console.log("SDK_SELECTION_PASS azure-openai-responses resource_project_status");
    console.log("SCAFFOLD_ONLY no prompt sent; Azure connectivity and domain behavior untested");
  } finally {
    session.dispose();
  }
} finally {
  await rm(root, { recursive: true, force: true });
  console.log("OWNED_SMOKE_RESOURCES_REMOVED");
}
