import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "../..");

export const config = {
  host: process.env.FF_BRIDGE_HOST ?? "127.0.0.1",
  port: Number.parseInt(process.env.FF_BRIDGE_PORT ?? "4317", 10),
  projectRoot,
  dataDir: resolve(process.env.FF_BRIDGE_DATA_DIR ?? resolve(projectRoot, "backend/data")),
  acceptanceLedger: resolve(process.env.FF_ACCEPTANCE_LEDGER ?? resolve(projectRoot, "backend/data/acceptance-ledger.sqlite")),
  credentialFile: process.env.FF_CREDENTIAL_FILE,
  allowedWorkspaceRoot: process.env.FF_ALLOWED_WORKSPACE_ROOT ? resolve(process.env.FF_ALLOWED_WORKSPACE_ROOT) : undefined,
  deepSeekModel: process.env.FF_DEEPSEEK_MODEL ?? "deepseek-v4-flash",
  deepSeekBaseUrl: process.env.FF_DEEPSEEK_BASE_URL ?? "https://api.deepseek.com"
};

if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
  throw new Error("FF_BRIDGE_PORT must be a valid TCP port");
}
