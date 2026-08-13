import { readFile } from "node:fs/promises";
import { BridgeError } from "../errors.js";

interface CredentialDocument {
  api_keys?: {
    deepseek?: {
      key?: unknown;
      base_url?: unknown;
    };
  };
}

export interface DeepSeekCredential {
  apiKey: string;
  baseUrl: string;
}

export class CredentialStore {
  #credential: DeepSeekCredential | undefined;

  get configured(): boolean {
    return this.#credential !== undefined;
  }

  set(apiKey: string, baseUrl: string): void {
    const key = apiKey.trim();
    if (key.length < 8) throw new BridgeError(400, "invalid_api_key", "DeepSeek API Key 格式无效。", false);
    let endpoint: URL;
    try {
      endpoint = new URL(baseUrl);
    } catch {
      throw new BridgeError(400, "invalid_base_url", "DeepSeek API 地址无效。", false);
    }
    const loopbackHttp = endpoint.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname.toLowerCase());
    if ((endpoint.protocol !== "https:" && !loopbackHttp) || endpoint.username || endpoint.password) {
      throw new BridgeError(400, "invalid_base_url", "DeepSeek API 地址必须使用 HTTPS；本机代理可使用 loopback HTTP。", false);
    }
    this.#credential = { apiKey: key, baseUrl: endpoint.toString().replace(/\/$/, "") };
  }

  async loadFromFile(path: string): Promise<void> {
    const text = await readFile(path, "utf8");
    const document = parseCredentialYaml(text);
    const key = document.api_keys?.deepseek?.key;
    const baseUrl = document.api_keys?.deepseek?.base_url;
    if (typeof key !== "string" || typeof baseUrl !== "string") {
      throw new BridgeError(400, "invalid_credential_file", "凭证文件中缺少 DeepSeek 配置。", false);
    }
    this.set(key, baseUrl);
  }

  require(): DeepSeekCredential {
    if (!this.#credential) throw new BridgeError(409, "model_unconfigured", "请先连接 DeepSeek。", false);
    return this.#credential;
  }

  clear(): void {
    this.#credential = undefined;
  }
}

function parseCredentialYaml(text: string): CredentialDocument {
  const lines = text.split(/\r?\n/);
  let inApiKeys = false;
  let inDeepSeek = false;
  let key: string | undefined;
  let baseUrl: string | undefined;
  for (const line of lines) {
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (indent === 0) {
      inApiKeys = trimmed === "api_keys:";
      inDeepSeek = false;
      continue;
    }
    if (inApiKeys && indent === 2) {
      inDeepSeek = trimmed === "deepseek:";
      continue;
    }
    if (inApiKeys && inDeepSeek && indent >= 4) {
      const separator = trimmed.indexOf(":");
      if (separator < 0) continue;
      const field = trimmed.slice(0, separator).trim();
      const value = stripYamlScalar(trimmed.slice(separator + 1).trim());
      if (field === "key") key = value;
      if (field === "base_url") baseUrl = value;
    }
  }
  return { api_keys: { deepseek: { ...(key ? { key } : {}), ...(baseUrl ? { base_url: baseUrl } : {}) } } };
}

function stripYamlScalar(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
