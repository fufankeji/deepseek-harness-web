import { readFile } from "node:fs/promises";
import { parse } from "yaml";

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

export async function loadDeepSeekCredential(): Promise<DeepSeekCredential> {
  const credentialFile = process.env.FF_CREDENTIAL_FILE;
  if (!credentialFile) {
    throw new Error("FF_CREDENTIAL_FILE must point to the user-authorized local YAML file");
  }
  const document = parse(await readFile(credentialFile, "utf8")) as CredentialDocument;
  const key = document.api_keys?.deepseek?.key;
  const baseUrl = document.api_keys?.deepseek?.base_url;

  if (typeof key !== "string" || key.length < 8) {
    throw new Error("DeepSeek credential key is missing or invalid");
  }
  if (typeof baseUrl !== "string" || !URL.canParse(baseUrl)) {
    throw new Error("DeepSeek base URL is missing or invalid");
  }

  return { apiKey: key, baseUrl: baseUrl.replace(/\/$/, "") };
}
