import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CapabilitySet, RuntimeInfo } from "../../contracts.js";
import { PI_VERSION } from "./model-config.js";

export const PI_CAPABILITIES: CapabilitySet = {
  structuredEvents: true,
  resumableSessions: true,
  sessionFork: true,
  steering: true,
  followUp: true,
  interrupt: true,
  tools: true,
  compaction: "unknown",
  retry: "unknown",
  approvals: false,
  sandbox: false
};

export async function probePiRuntime(): Promise<RuntimeInfo> {
  const checkedAt = new Date().toISOString();
  try {
    const installedVersion = await resolveInstalledVersion();
    const compatibleNode = process.versions.node === "24.16.0";
    const compatiblePi = installedVersion === PI_VERSION;
    return {
      adapterId: "pi",
      adapterVersion: "0.1.0",
      harnessId: "pi",
      harnessVersion: installedVersion,
      displayName: "Pi Harness + DeepSeek",
      bridgeVersion: "0.1.0",
      nodeVersion: process.versions.node,
      status: compatibleNode && compatiblePi ? "ready" : "incompatible",
      capabilities: PI_CAPABILITIES,
      checkedAt
    };
  } catch {
    return {
      adapterId: "pi",
      adapterVersion: "0.1.0",
      harnessId: "pi",
      harnessVersion: "unavailable",
      displayName: "Pi Harness + DeepSeek",
      bridgeVersion: "0.1.0",
      nodeVersion: process.versions.node,
      status: "error",
      capabilities: unknownCapabilities(),
      checkedAt
    };
  }
}

async function resolveInstalledVersion(): Promise<string> {
  let directory = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
  for (let index = 0; index < 6; index += 1) {
    const candidate = join(directory, "package.json");
    try {
      const document = JSON.parse(await readFile(candidate, "utf8")) as { name?: string; version?: string };
      if (document.name === "@earendil-works/pi-coding-agent" && typeof document.version === "string") {
        return document.version;
      }
    } catch {
      // Continue walking toward the package root.
    }
    directory = dirname(directory);
  }
  throw new Error("Pi package manifest not found");
}

function unknownCapabilities(): CapabilitySet {
  return {
    structuredEvents: "unknown",
    resumableSessions: "unknown",
    sessionFork: "unknown",
    steering: "unknown",
    followUp: "unknown",
    interrupt: "unknown",
    tools: "unknown",
    compaction: "unknown",
    retry: "unknown",
    approvals: false,
    sandbox: false
  };
}
