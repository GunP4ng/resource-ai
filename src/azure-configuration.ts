/** Server secret configuration; never accepted from case/form input. */
export interface AzureConfiguration {
  readonly endpoint: string;
  readonly deployment: string;
  readonly modelId: string;
  readonly apiKey: string;
  readonly apiVersion: string;
}
export class AzureConfigurationError extends Error {}
export function checkedConfiguration(value: AzureConfiguration | null): Readonly<AzureConfiguration> {
  const id = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9_.-]{1,128}$/.test(v);
  if (!value || !id(value.deployment) || !id(value.modelId) || !id(value.apiVersion)
    || typeof value.apiKey !== "string" || !value.apiKey.trim()) throw new AzureConfigurationError();
  let url: URL;
  try { url = new URL(value.endpoint); } catch { throw new AzureConfigurationError(); }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".openai.azure.com") || url.port || url.username || url.password
    || url.search || url.hash || !["", "/", "/openai/v1"].includes(url.pathname)) throw new AzureConfigurationError();
  return Object.freeze({ endpoint: value.endpoint, deployment: value.deployment, modelId: value.modelId, apiKey: value.apiKey, apiVersion: value.apiVersion });
}
