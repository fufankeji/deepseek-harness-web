import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { loadDeepSeekCredential } from "./credentials.js";
import { DEEPSEEK_MODEL_ID, DEEPSEEK_PROVIDER_ID, writeDeepSeekModelsConfig } from "./model-config.js";

const root = await mkdtemp(join(tmpdir(), "ff-pi-probe-"));

try {
  const credential = await loadDeepSeekCredential();
  const modelsPath = await writeDeepSeekModelsConfig(root, credential.baseUrl);
  const credentials = new InMemoryCredentialStore();
  const runtime = await ModelRuntime.create({ credentials, modelsPath, signal: AbortSignal.timeout(15_000) });

  await runtime.setRuntimeApiKey(DEEPSEEK_PROVIDER_ID, credential.apiKey, {
    signal: AbortSignal.timeout(15_000)
  });

  const provider = runtime.getProviders().find((entry) => entry.id === DEEPSEEK_PROVIDER_ID);
  const model = runtime.getModel(DEEPSEEK_PROVIDER_ID, DEEPSEEK_MODEL_ID);
  const available = await runtime.getAvailable(DEEPSEEK_PROVIDER_ID, {
    signal: AbortSignal.timeout(15_000)
  });

  console.log(JSON.stringify({
    node: process.version,
    providerFound: Boolean(provider),
    modelFound: Boolean(model),
    configuredAuth: runtime.hasConfiguredAuth(DEEPSEEK_PROVIDER_ID),
    available: available.some((entry) => entry.provider === DEEPSEEK_PROVIDER_ID && entry.id === DEEPSEEK_MODEL_ID),
    modelId: model ? `${model.provider}/${model.id}` : null,
    baseUrlHost: new URL(credential.baseUrl).host
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
