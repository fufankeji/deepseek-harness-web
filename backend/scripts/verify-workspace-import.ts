import assert from "node:assert/strict";
import { resolve } from "node:path";
import type { WorkspaceInfo, WorkspaceSnapshot } from "../src/contracts.js";
import { BridgeApp } from "../src/app.js";

const projectRoot = resolve(import.meta.dirname, "../..");
const dataDir = resolve(process.env.FF_VERIFICATION_DATA_DIR ?? resolve(projectRoot, "backend/data/verification"), "workspace-import");
const acceptanceLedger = resolve(projectRoot, "backend/data/acceptance-ledger.sqlite");
const app = new BridgeApp({ host: "127.0.0.1", port: 0, dataDir, acceptanceLedger, projectRoot });

try {
  const { url } = await app.start();
  const workspace = await post<WorkspaceInfo>(`${url}/api/workspaces/import`, {
    url: "https://github.com/fufankeji/DeepSeekHarnessWeb.git"
  });
  assert.equal(workspace.git, true);
  assert.equal(workspace.projectTrusted, false);
  assert.ok(workspace.fileCount > 0);
  const snapshot = await get<WorkspaceSnapshot>(`${url}/api/workspaces/current`);
  assert.equal(snapshot.workspace.id, workspace.id);
  assert.ok(snapshot.files.some((entry) => entry.path === "README.md"));
  assert.deepEqual(snapshot.changes, []);
  process.stdout.write(`${JSON.stringify({ success: true, workspace: workspace.displayPath, branch: workspace.branch, fileCount: workspace.fileCount, projectTrusted: workspace.projectTrusted, retained: true }, null, 2)}\n`);
} finally {
  await app.stop();
}

async function get<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const text = await response.text();
  assert.equal(response.ok, true, text);
  return JSON.parse(text) as T;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await response.text();
  assert.equal(response.ok, true, text);
  return JSON.parse(text) as T;
}
