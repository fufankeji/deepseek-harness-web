import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const DEEPSEEK_PROVIDER_ID = "deepseek";
export const DEEPSEEK_MODEL_ID = process.env.FF_DEEPSEEK_MODEL || "deepseek-v4-flash";

export async function writeDeepSeekModelsConfig(agentDir: string, baseUrl: string): Promise<string> {
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
            id: DEEPSEEK_MODEL_ID,
            name: DEEPSEEK_MODEL_ID === "deepseek-v4-pro" ? "DeepSeek V4 Pro" : "DeepSeek V4 Flash",
            contextWindow: 1_000_000,
            maxTokens: 384_000,
            input: ["text"],
            reasoning: true,
            cost: {
              input: DEEPSEEK_MODEL_ID === "deepseek-v4-pro" ? 1.74 : 0.14,
              output: DEEPSEEK_MODEL_ID === "deepseek-v4-pro" ? 3.48 : 0.28,
              cacheRead: DEEPSEEK_MODEL_ID === "deepseek-v4-pro" ? 0.145 : 0.028,
              cacheWrite: 0
            },
            compat: {
              requiresReasoningContentOnAssistantMessages: true,
              thinkingFormat: "deepseek",
              reasoningEffortMap: {
                minimal: "high",
                low: "high",
                medium: "high",
                high: "high",
                xhigh: "max"
              }
            }
          }
        ]
      }
    }
  };

  await writeFile(modelsPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return modelsPath;
}
