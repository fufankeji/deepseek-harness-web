import { createReadStream } from "node:fs";
import { mkdir, readFile, realpath, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { BridgeError } from "../errors.js";

const MAX_OUTPUT_BYTES = 20_000_000;
const OUTPUT_ID = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;

export class ToolOutputStore {
  readonly #root: string;

  constructor(dataDir: string) {
    this.#root = join(dataDir, "tool-outputs");
  }

  async capturePiTempFile(sourcePath: string): Promise<{ outputId: string; size: number } | undefined> {
    const source = await realpath(sourcePath).catch(() => undefined);
    const tempRoot = await realpath(tmpdir()).catch(() => resolve(tmpdir()));
    if (!source || !isWithin(tempRoot, source)) return undefined;
    const metadata = await stat(source).catch(() => undefined);
    if (!metadata?.isFile() || metadata.size > MAX_OUTPUT_BYTES) return undefined;
    const text = await readFile(source, "utf8");
    const sanitized = sanitizeOutput(text);
    const outputId = randomUUID();
    await mkdir(this.#root, { recursive: true, mode: 0o700 });
    await writeFile(join(this.#root, `${outputId}.txt`), sanitized, { mode: 0o600 });
    return { outputId, size: Buffer.byteLength(sanitized) };
  }

  async open(outputId: string): Promise<{ stream: ReturnType<typeof createReadStream>; size: number }> {
    if (!OUTPUT_ID.test(outputId)) throw new BridgeError(400, "invalid_output_id", "完整输出标识无效。", false);
    const target = join(this.#root, `${outputId}.txt`);
    const metadata = await stat(target).catch(() => undefined);
    if (!metadata?.isFile()) throw new BridgeError(404, "tool_output_unavailable", "完整工具输出不存在或尚未保留。", false);
    return { stream: createReadStream(target), size: metadata.size };
  }

  async remove(outputId: string): Promise<void> {
    if (!OUTPUT_ID.test(outputId)) return;
    try {
      await unlink(join(this.#root, `${outputId}.txt`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function sanitizeOutput(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/(authorization\s*[:=]\s*)([^\s,;]+)/gi, "$1[REDACTED]");
}

function isWithin(root: string, target: string): boolean {
  const path = relative(resolve(root), resolve(target));
  return path === "" || (!path.startsWith("..") && !path.startsWith(sep));
}
