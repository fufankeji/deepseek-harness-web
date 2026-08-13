import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const PI_VERSION = "0.84.1";
export const DEEPSEEK_PROVIDER_ID = "deepseek";

export async function writeDeepSeekModelConfig(
  agentDir: string,
  baseUrl: string,
  modelId: string
): Promise<string> {
  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  const modelsPath = join(agentDir, "models.json");
  const config = {
    providers: {
      [DEEPSEEK_PROVIDER_ID]: {
        baseUrl,
        api: "openai-completions",
        apiKey: "$DEEPSEEK_API_KEY",
        models: [
          {
            id: modelId,
            name: modelDisplayName(modelId),
            contextWindow: 1_000_000,
            maxTokens: 384_000,
            input: ["text"],
            reasoning: true,
            thinkingLevelMap: {
              off: null,
              minimal: null,
              low: null,
              medium: null,
              high: "high",
              xhigh: null,
              max: "max"
            },
            cost: modelCost(modelId),
            compat: {
              supportsReasoningEffort: true,
              requiresReasoningContentOnAssistantMessages: true,
              thinkingFormat: "deepseek"
            }
          }
        ]
      }
    }
  };
  await writeFile(modelsPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return modelsPath;
}

function modelDisplayName(modelId: string): string {
  if (modelId === "deepseek-v4-pro") return "DeepSeek V4 Pro";
  if (modelId === "deepseek-v4-flash") return "DeepSeek V4 Flash";
  return modelId;
}

function modelCost(modelId: string): { input: number; output: number; cacheRead: number; cacheWrite: number } {
  if (modelId === "deepseek-v4-pro") {
    return { input: 1.74, output: 3.48, cacheRead: 0.145, cacheWrite: 0 };
  }
  return { input: 0.14, output: 0.28, cacheRead: 0.028, cacheWrite: 0 };
}
