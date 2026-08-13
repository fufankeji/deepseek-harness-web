import { join } from "node:path";
import { InMemoryCredentialStore, type Model } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ModelInfo, ModelStatus, ModelThinkingLevel } from "../contracts.js";
import { BridgeError } from "../errors.js";
import type { CredentialStore } from "../secrets/credential-store.js";
import { DEEPSEEK_PROVIDER_ID, writeDeepSeekModelConfig } from "../adapters/pi/model-config.js";

export class ModelService {
  #info: ModelInfo;
  #runtime: ModelRuntime | undefined;
  #model: Model<string> | undefined;

  constructor(
    private readonly agentDir: string,
    private readonly credentialStore: CredentialStore,
    private readonly defaultModelId: string
  ) {
    this.#info = {
      provider: "deepseek",
      modelId: defaultModelId,
      thinkingLevel: "high",
      availableThinkingLevels: ["high", "max"],
      status: "unconfigured",
      credentialStorage: "memory-only"
    };
  }

  get info(): ModelInfo {
    return { ...this.#info };
  }

  requireRuntime(): ModelRuntime {
    if (!this.#runtime) throw new BridgeError(409, "model_unconfigured", "请先连接 DeepSeek。", false);
    return this.#runtime;
  }

  requireModel(): Model<string> {
    if (!this.#model) throw new BridgeError(409, "model_unconfigured", "请先连接 DeepSeek。", false);
    return this.#model;
  }

  async connect(modelId = this.defaultModelId, verify = true, thinkingLevel: ModelThinkingLevel = "high"): Promise<ModelInfo> {
    const credential = this.credentialStore.require();
    this.#info = {
      provider: "deepseek",
      modelId,
      thinkingLevel,
      availableThinkingLevels: ["high", "max"],
      status: "probing",
      credentialStorage: "memory-only",
      checkedAt: new Date().toISOString()
    };
    try {
      const modelsPath = await writeDeepSeekModelConfig(this.agentDir, credential.baseUrl, modelId);
      const credentials = new InMemoryCredentialStore();
      const runtime = await ModelRuntime.create({
        credentials,
        modelsPath,
        signal: AbortSignal.timeout(15_000),
        refreshOnCreate: false
      });
      await runtime.setRuntimeApiKey(DEEPSEEK_PROVIDER_ID, credential.apiKey, {
        signal: AbortSignal.timeout(15_000)
      });
      const model = runtime.getModel(DEEPSEEK_PROVIDER_ID, modelId);
      if (!model) throw new BridgeError(400, "model_not_found", "Pi 未找到所选 DeepSeek 模型。", false);
      this.#runtime = runtime;
      this.#model = model as Model<string>;
      if (verify) await this.verifyConnection(thinkingLevel);
      this.#info = {
        provider: "deepseek",
        modelId,
        thinkingLevel,
        availableThinkingLevels: ["high", "max"],
        status: "ready",
        credentialStorage: "memory-only",
        checkedAt: new Date().toISOString()
      };
      return this.info;
    } catch (error) {
      this.#runtime = undefined;
      this.#model = undefined;
      this.credentialStore.clear();
      const classified = classifyModelError(error);
      this.#info = {
        provider: "deepseek",
        modelId,
        thinkingLevel,
        availableThinkingLevels: ["high", "max"],
        status: classified.status,
        credentialStorage: "memory-only",
        checkedAt: new Date().toISOString(),
        errorCode: classified.code,
        errorMessage: classified.message
      };
      if (error instanceof BridgeError) throw error;
      throw new BridgeError(classified.httpStatus, classified.code, classified.message, classified.retryable);
    }
  }

  clear(): void {
    this.credentialStore.clear();
    this.#runtime = undefined;
    this.#model = undefined;
    this.#info = {
      provider: "deepseek",
      modelId: this.defaultModelId,
      thinkingLevel: "high",
      availableThinkingLevels: ["high", "max"],
      status: "unconfigured",
      credentialStorage: "memory-only"
    };
  }

  private async verifyConnection(thinkingLevel: ModelThinkingLevel): Promise<void> {
    const runtime = this.requireRuntime();
    const model = this.requireModel();
    const response = await runtime.completeSimple(
      model,
      {
        messages: [{ role: "user", content: "只回复 OK", timestamp: Date.now() }]
      },
      { signal: AbortSignal.timeout(45_000), maxTokens: 16, reasoning: thinkingLevel }
    );
    if (response.stopReason === "error" || response.stopReason === "aborted") {
      throw new Error(response.errorMessage || `DeepSeek connection ended with ${response.stopReason}`);
    }
  }
}

interface ClassifiedModelError {
  status: ModelStatus;
  code: string;
  message: string;
  httpStatus: number;
  retryable: boolean;
}

export function classifyModelError(error: unknown): ClassifiedModelError {
  if (error instanceof BridgeError) {
    return {
      status: "error",
      code: error.code,
      message: error.message,
      httpStatus: error.status,
      retryable: error.retryable
    };
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (/401|403|auth|unauthor|invalid.*key/.test(message)) {
    return { status: "auth_error", code: "deepseek_auth_error", message: "DeepSeek 凭证验证失败。", httpStatus: 401, retryable: false };
  }
  if (/quota|insufficient|balance|payment/.test(message)) {
    return { status: "quota_error", code: "deepseek_quota_error", message: "DeepSeek 账户额度不足。", httpStatus: 402, retryable: false };
  }
  if (/429|rate.?limit|too many requests/.test(message)) {
    return { status: "rate_limited", code: "deepseek_rate_limited", message: "DeepSeek 请求过于频繁，请稍后重试。", httpStatus: 429, retryable: true };
  }
  if (/model.*(not found|not exist|unsupported|unknown)|invalid.*model/.test(message)) {
    return { status: "error", code: "deepseek_model_unavailable", message: "DeepSeek 当前未开放或无法识别所选模型。", httpStatus: 400, retryable: false };
  }
  if (/timeout|timed out|econn|network|fetch failed|5\d\d/.test(message)) {
    return { status: "unavailable", code: "deepseek_unavailable", message: "暂时无法连接 DeepSeek。", httpStatus: 503, retryable: true };
  }
  return { status: "error", code: "deepseek_error", message: "DeepSeek 连接检查失败。", httpStatus: 502, retryable: true };
}

export function defaultAgentDir(dataDir: string): string {
  return join(dataDir, "pi-agent");
}
