import { watch, type FSWatcher } from "node:fs";

export class WorkspaceMonitor {
  #watcher: FSWatcher | undefined;
  #debounce: NodeJS.Timeout | undefined;

  start(root: string, onChange: () => Promise<void>): void {
    this.stop();
    try {
      this.#watcher = watch(root, { recursive: true }, (_event, filename) => {
        const path = typeof filename === "string" ? filename.replaceAll("\\", "/") : "";
        if (path === ".git" || path.startsWith(".git/") || path.includes("/node_modules/") || path.startsWith("node_modules/")) return;
        if (this.#debounce) clearTimeout(this.#debounce);
        this.#debounce = setTimeout(() => {
          this.#debounce = undefined;
          void onChange();
        }, 180);
      });
      this.#watcher.on("error", () => this.stop());
    } catch {
      this.#watcher = undefined;
    }
  }

  stop(): void {
    if (this.#debounce) clearTimeout(this.#debounce);
    this.#debounce = undefined;
    this.#watcher?.close();
    this.#watcher = undefined;
  }
}
