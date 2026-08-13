import type { ModelInfo } from "./contracts";

export async function connectModelEphemeral(input: {
  apiKey?: string;
  credentialSource?: "configured-file";
  modelId: string;
  thinkingLevel: "high" | "max";
  verify: boolean;
}): Promise<ModelInfo> {
  const response = await fetch("/api/model/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    credentials: "same-origin"
  });
  const body = await response.json() as ModelInfo | { error?: { message?: string } };
  if (!response.ok) {
    const message = "error" in body && typeof body.error?.message === "string" ? body.error.message : "DeepSeek 连接检查失败。";
    throw new Error(message);
  }
  return body as ModelInfo;
}
