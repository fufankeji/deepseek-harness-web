import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, extname, join } from "node:path";
import { BridgeError } from "../errors.js";

const EXPORT_ID = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const MAX_EXPORT_BYTES = 25_000_000;

interface ExportRecord {
  path: string;
  fileName: string;
  contentType: string;
  size: number;
}

export class CommandExportStore {
  readonly #root: string;
  readonly #records = new Map<string, ExportRecord>();

  constructor(dataDir: string) {
    this.#root = join(dataDir, "command-exports");
  }

  async capture(sourcePath: string): Promise<{ id: string; fileName: string }> {
    const metadata = await stat(sourcePath).catch(() => undefined);
    if (!metadata?.isFile()) throw new BridgeError(409, "command_export_unavailable", "Harness 没有生成可下载的导出文件。", false);
    if (metadata.size > MAX_EXPORT_BYTES) throw new BridgeError(413, "command_export_too_large", "会话导出文件超过 25 MB。", false);
    const extension = extname(sourcePath).toLowerCase();
    if (extension !== ".html" && extension !== ".jsonl") {
      throw new BridgeError(409, "command_export_type_unsupported", "只允许下载 HTML 或 JSONL 会话导出。", false);
    }
    const id = randomUUID();
    const fileName = safeFileName(basename(sourcePath));
    const target = join(this.#root, `${id}${extension}`);
    await mkdir(this.#root, { recursive: true, mode: 0o700 });
    await writeFile(target, await readFile(sourcePath), { mode: 0o600 });
    await unlink(sourcePath).catch(() => undefined);
    this.#records.set(id, {
      path: target,
      fileName,
      contentType: extension === ".html" ? "text/html; charset=utf-8" : "application/x-ndjson; charset=utf-8",
      size: metadata.size
    });
    return { id, fileName };
  }

  async open(id: string): Promise<{ stream: ReturnType<typeof createReadStream>; fileName: string; contentType: string; size: number }> {
    if (!EXPORT_ID.test(id)) throw new BridgeError(400, "invalid_command_export_id", "导出文件标识无效。", false);
    const record = this.#records.get(id);
    if (!record) throw new BridgeError(404, "command_export_not_found", "导出文件不存在或 Bridge 已重启。", false);
    const metadata = await stat(record.path).catch(() => undefined);
    if (!metadata?.isFile()) throw new BridgeError(404, "command_export_not_found", "导出文件不存在或已被移除。", false);
    return { stream: createReadStream(record.path), fileName: record.fileName, contentType: record.contentType, size: metadata.size };
  }
}

function safeFileName(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || "harness-session-export";
}
