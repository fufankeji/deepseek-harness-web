import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function commandCheckExtension(pi: ExtensionAPI) {
  pi.registerCommand("extension-check", {
    description: "验证 Extension 命令能被发现，但不会在 Web 中冒险执行",
    handler: async (_args, context) => {
      context.ui.notify("FF-COMMAND-EXTENSION-OK", "info");
    }
  });
}
