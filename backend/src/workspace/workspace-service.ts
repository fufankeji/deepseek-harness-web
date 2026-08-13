import { createReadStream } from "node:fs";
import { cp, lstat, mkdir, readFile, realpath, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { ChangedFile, FileEntry, WorkspaceInfo, WorkspaceSnapshot } from "../contracts.js";
import { BridgeError } from "../errors.js";
import { runProcess } from "../runtime/process-runner.js";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".mypy_cache",
  ".next",
  ".pytest_cache",
  ".ruff_cache",
  ".turbo",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "venv"
]);
const MAX_FILES = 5_000;
const MAX_DEPTH = 20;
const MAX_DOWNLOAD_BYTES = 100_000_000;
const MAX_BASELINE_CONTENT_BYTES = 20_000_000;
const ACCEPTANCE_TEMPLATES = new Set(["counter-v1", "control-v1", "long-output-v1", "command-center-v1"]);
const STARTER_TEMPLATES = new Set(["counter-v1"]);

interface BaselineFile {
  size: number;
  hash: string;
  content?: string;
}

interface CurrentWorkspace {
  path: string;
  info: WorkspaceInfo;
  templateVersion: string;
  acceptance: boolean;
}

interface RunBaseline {
  workspaceId: string;
  runId: string;
  files: Map<string, BaselineFile>;
}

export interface PersistedWorkspace {
  path: string;
  displayPath: string;
  displayName?: string;
  projectTrusted: boolean;
  templateVersion: string;
  acceptance: boolean;
}

export class WorkspaceService {
  #current?: CurrentWorkspace;
  #nonGitBaseline: Map<string, BaselineFile> | undefined;
  #runBaseline: RunBaseline | undefined;

  constructor(
    private readonly dataDir: string,
    private readonly templatesRoot: string,
    private readonly allowedRoot?: string
  ) {}

  get current(): CurrentWorkspace | undefined {
    return this.#current;
  }

  requireCurrent(): CurrentWorkspace {
    if (!this.#current) {
      throw new BridgeError(409, "workspace_unselected", "请先选择一个工作区。", false);
    }
    return this.#current;
  }

  async select(inputPath: string, projectTrusted = false): Promise<WorkspaceInfo> {
    const requested = resolve(inputPath);
    let resolved: string;
    try {
      resolved = await realpath(requested);
      if (!(await stat(resolved)).isDirectory()) {
        throw new BridgeError(400, "workspace_not_directory", "所选路径不是目录。", false);
      }
    } catch (error) {
      if (error instanceof BridgeError) throw error;
      throw new BridgeError(404, "workspace_unavailable", "无法访问所选工作区。", false);
    }

    await this.assertWithinAllowedRoot(resolved);

    const info = await this.inspect(resolved, projectTrusted);
    this.#current = {
      path: resolved,
      info,
      templateVersion: "user-workspace",
      acceptance: false
    };
    this.#nonGitBaseline = info.git ? undefined : await captureFileBaseline(resolved, MAX_BASELINE_CONTENT_BYTES);
    this.#runBaseline = undefined;
    return info;
  }

  async createAcceptanceWorkspace(templateVersion = "counter-v1"): Promise<WorkspaceInfo> {
    if (!ACCEPTANCE_TEMPLATES.has(templateVersion)) {
      throw new BridgeError(400, "unknown_acceptance_template", "内置验收模板不存在。", false);
    }
    const templateDir = join(this.templatesRoot, templateVersion);
    const runName = `${safeTimestamp()}-${randomUUID().slice(0, 8)}`;
    const workspacePath = join(this.dataDir, "acceptance-workspaces", templateVersion, runName);
    await mkdir(workspacePath, { recursive: true, mode: 0o700 });
    await cp(templateDir, workspacePath, { recursive: true, errorOnExist: true });
    const canonicalPath = await realpath(workspacePath);

    await assertProcess("git", ["init", "--quiet"], canonicalPath, "无法初始化验收工作区 Git 仓库。");
    await assertProcess("git", ["config", "user.name", "FF Acceptance"], canonicalPath, "无法配置验收工作区 Git 用户。");
    await assertProcess("git", ["config", "user.email", "acceptance@local.invalid"], canonicalPath, "无法配置验收工作区 Git 邮箱。");
    await assertProcess("git", ["add", "--all"], canonicalPath, "无法暂存验收工作区基线。");
    await assertProcess("git", ["commit", "--quiet", "-m", "acceptance baseline"], canonicalPath, "无法提交验收工作区基线。");

    const info = await this.inspect(canonicalPath, false, `内置验收 / ${templateVersion} / ${runName}`, "DeepSeek 代码验收项目");
    this.#current = {
      path: canonicalPath,
      info,
      templateVersion,
      acceptance: true
    };
    this.#nonGitBaseline = undefined;
    this.#runBaseline = undefined;
    return info;
  }

  async createStarterWorkspace(templateVersion = "counter-v1"): Promise<WorkspaceInfo> {
    if (!STARTER_TEMPLATES.has(templateVersion)) {
      throw new BridgeError(400, "unknown_starter_template", "内置示例模板不存在。", false);
    }
    const templateDir = join(this.templatesRoot, templateVersion);
    const runName = `${safeTimestamp()}-${randomUUID().slice(0, 8)}`;
    const workspacePath = join(this.dataDir, "starter-workspaces", runName);
    await mkdir(workspacePath, { recursive: true, mode: 0o700 });
    await cp(templateDir, workspacePath, { recursive: true, errorOnExist: true });
    const canonicalPath = await realpath(workspacePath);
    const info = await this.inspect(canonicalPath, false, `内置示例 / ${runName}`, "DeepSeek 示例项目");
    this.#current = {
      path: canonicalPath,
      info,
      templateVersion: "starter-v1",
      acceptance: false
    };
    this.#nonGitBaseline = await captureFileBaseline(canonicalPath, MAX_BASELINE_CONTENT_BYTES);
    this.#runBaseline = undefined;
    return info;
  }

  async importGit(url: string): Promise<WorkspaceInfo> {
    const parsed = parseGitUrl(url);
    const name = repositoryName(parsed.pathname);
    const runName = `${safeTimestamp()}-${randomUUID().slice(0, 8)}-${name}`;
    const workspacePath = join(this.dataDir, "imported-workspaces", runName);
    await mkdir(join(this.dataDir, "imported-workspaces"), { recursive: true, mode: 0o700 });
    const result = await runProcess(
      "git",
      ["clone", "--depth=1", "--", parsed.toString(), workspacePath],
      this.dataDir,
      120_000,
      ["HOME", "USER", "LOGNAME", "SSH_AUTH_SOCK"]
    );
    if (result.exitCode !== 0) throw new BridgeError(502, "git_clone_failed", "Git 仓库导入失败，请检查地址与访问权限。", true);
    const canonicalPath = await realpath(workspacePath);
    const info = await this.inspect(canonicalPath, false, `Git 导入 / ${name}`);
    this.#current = { path: canonicalPath, info, templateVersion: "git-import", acceptance: false };
    this.#nonGitBaseline = undefined;
    this.#runBaseline = undefined;
    return info;
  }

  async restore(saved: PersistedWorkspace): Promise<WorkspaceInfo> {
    const resolved = await realpath(saved.path).catch(() => {
      throw new BridgeError(404, "workspace_unavailable", "上次工作区已移动或不可访问。", false);
    });
    const ownedWorkspace = saved.acceptance || saved.templateVersion === "git-import" || saved.templateVersion === "starter-v1";
    const dataRoot = await realpath(this.dataDir).catch(() => resolve(this.dataDir));
    if (!ownedWorkspace || !isWithin(dataRoot, resolved)) await this.assertWithinAllowedRoot(resolved);
    const info = await this.inspect(
      resolved,
      saved.projectTrusted,
      saved.displayPath,
      saved.acceptance ? "DeepSeek 代码验收项目" : saved.displayName
    );
    this.#current = {
      path: resolved,
      info,
      templateVersion: saved.templateVersion,
      acceptance: saved.acceptance
    };
    this.#nonGitBaseline = info.git ? undefined : await captureFileBaseline(resolved, MAX_BASELINE_CONTENT_BYTES);
    this.#runBaseline = undefined;
    return info;
  }

  persistedCurrent(): PersistedWorkspace | undefined {
    const current = this.#current;
    return current ? {
      path: current.path,
      displayPath: current.info.displayPath,
      displayName: current.info.name,
      projectTrusted: current.info.projectTrusted,
      templateVersion: current.templateVersion,
      acceptance: current.acceptance
    } : undefined;
  }

  async setTrust(projectTrusted: boolean): Promise<WorkspaceInfo> {
    const current = this.requireCurrent();
    const info = await this.inspect(current.path, projectTrusted, current.info.displayPath, current.info.name);
    current.info = info;
    return info;
  }

  async captureRunBaseline(runId: string): Promise<void> {
    const current = this.requireCurrent();
    const baseline: RunBaseline = {
      workspaceId: current.info.id,
      runId,
      files: await captureFileBaseline(current.path, MAX_BASELINE_CONTENT_BYTES)
    };
    await persistRunBaseline(this.dataDir, baseline);
    this.#runBaseline = baseline;
  }

  async removeRunBaselines(runIds: string[]): Promise<void> {
    const directory = join(this.dataDir, "run-baselines");
    for (const runId of new Set(runIds)) {
      await unlink(runBaselinePath(directory, runId)).catch(() => undefined);
      if (this.#runBaseline?.runId === runId) this.#runBaseline = undefined;
    }
  }

  async snapshot(runId?: string): Promise<WorkspaceSnapshot> {
    const current = this.requireCurrent();
    const info = await this.inspect(
      current.path,
      current.info.projectTrusted,
      current.info.displayPath,
      current.info.name
    );
    current.info = info;
    const runBaseline = await this.runBaselineFor(runId);
    const [files, changes] = await Promise.all([
      this.listFiles(),
      runBaseline ? changesAgainstBaseline(current.path, runBaseline.files) : runId ? Promise.resolve([]) : this.listChanges()
    ]);
    return {
      workspace: info,
      files,
      changes,
      changeScope: runBaseline ? "run" : runId ? "unavailable" : info.git ? "git" : "workspace",
      ...(runBaseline ? { comparisonRunId: runBaseline.runId } : {})
    };
  }

  async listFiles(): Promise<FileEntry[]> {
    const { path: root } = this.requireCurrent();
    return (await scanFiles(root)).entries;
  }

  async readText(relativePath: string): Promise<string> {
    const { path: root } = this.requireCurrent();
    const target = await resolveExistingPath(root, relativePath);
    const metadata = await stat(target);
    if (!metadata.isFile()) throw new BridgeError(400, "not_a_file", "目标不是普通文件。", false);
    if (metadata.size > 2_000_000) throw new BridgeError(413, "file_too_large", "文件超过 2 MB，暂不支持在线查看。", false);
    return await readFile(target, "utf8");
  }

  async preview(relativePath: string): Promise<{ path: string; kind: "text" | "image" | "html" | "unsupported"; mime: string; size: number; content?: string; dataUrl?: string; reason?: string }> {
    const { path: root } = this.requireCurrent();
    const normalized = normalizeRelativeInput(relativePath);
    const target = await resolveExistingPath(root, normalized);
    const metadata = await stat(target);
    if (!metadata.isFile()) throw new BridgeError(400, "not_a_file", "目标不是普通文件。", false);
    const mime = mimeFor(normalized);
    if (isImageMime(mime)) {
      if (metadata.size > 5_000_000) return { path: normalized, kind: "unsupported", mime, size: metadata.size, reason: "图片超过 5 MB，无法在线预览。" };
      const content = await readFile(target);
      return { path: normalized, kind: "image", mime, size: metadata.size, dataUrl: `data:${mime};base64,${content.toString("base64")}` };
    }
    if (mime === "text/html") {
      if (metadata.size > 2_000_000) return { path: normalized, kind: "unsupported", mime, size: metadata.size, reason: "HTML 超过 2 MB，无法在线预览。" };
      return { path: normalized, kind: "html", mime, size: metadata.size, content: await readFile(target, "utf8") };
    }
    if (mime === "image/svg+xml") {
      if (metadata.size > 2_000_000) return { path: normalized, kind: "unsupported", mime, size: metadata.size, reason: "SVG 超过 2 MB，无法在线预览。" };
      const svg = await readFile(target, "utf8");
      return { path: normalized, kind: "html", mime, size: metadata.size, content: `<!doctype html><html><body>${svg}</body></html>` };
    }
    if (isTextMime(mime)) {
      if (metadata.size > 2_000_000) return { path: normalized, kind: "unsupported", mime, size: metadata.size, reason: "文本超过 2 MB，无法在线预览。" };
      return { path: normalized, kind: "text", mime, size: metadata.size, content: await readFile(target, "utf8") };
    }
    return { path: normalized, kind: "unsupported", mime, size: metadata.size, reason: "该文件类型不支持在线预览。" };
  }

  async download(relativePath: string): Promise<{ target: string; name: string; mime: string; size: number }> {
    const { path: root } = this.requireCurrent();
    const normalized = normalizeRelativeInput(relativePath);
    const target = await resolveExistingPath(root, normalized);
    const metadata = await stat(target);
    if (!metadata.isFile()) throw new BridgeError(400, "not_a_file", "目标不是普通文件。", false);
    if (metadata.size > MAX_DOWNLOAD_BYTES) {
      throw new BridgeError(413, "download_too_large", "文件超过 100 MB，无法通过浏览器下载。", false);
    }
    return { target, name: basename(target), mime: mimeFor(normalized), size: metadata.size };
  }

  async fileView(relativePath: string, runId?: string): Promise<{ path: string; current: string; baseline: string; diff: string; baselineSource: "run" | "git" | "workspace" | "unavailable"; baselineAvailable: boolean; comparisonRunId?: string }> {
    const { path: root } = this.requireCurrent();
    const normalized = normalizeRelativeInput(relativePath);
    const current = await this.readText(normalized).catch((error: unknown) => {
      if (error instanceof BridgeError && error.code === "file_unavailable") return "";
      throw error;
    });
    const runBaseline = await this.runBaselineFor(runId);
    if (runBaseline) {
      const change = (await changesAgainstBaseline(root, runBaseline.files)).find((entry) => entry.path === normalized);
      const baselinePath = change?.previousPath ?? normalized;
      const baselineFile = runBaseline.files.get(baselinePath);
      const baseline = baselineFile?.content ?? "";
      const baselineAvailable = baselineFile === undefined || baselineFile.content !== undefined;
      return {
        path: normalized,
        current,
        baseline,
        diff: baselineAvailable ? simpleTextDiff(normalized, baseline, current) : "",
        baselineSource: "run",
        baselineAvailable,
        comparisonRunId: runBaseline.runId
      };
    }
    if (runId) {
      return { path: normalized, current, baseline: "", diff: "", baselineSource: "unavailable", baselineAvailable: false };
    }
    if (!(await isGitRepository(root))) {
      const baselineFile = this.#nonGitBaseline?.get(normalized);
      const baseline = baselineFile?.content ?? "";
      const baselineAvailable = baselineFile === undefined || baselineFile.content !== undefined;
      return { path: normalized, current, baseline, diff: baselineAvailable ? simpleTextDiff(normalized, baseline, current) : "", baselineSource: "workspace", baselineAvailable };
    }
    const change = (await this.listChanges()).find((entry) => entry.path === normalized);
    const baselinePath = change?.previousPath ?? normalized;
    const [baselineResult, diffResult] = await Promise.all([
      runProcess("git", ["show", `HEAD:${baselinePath}`], root),
      runProcess("git", ["diff", "--no-ext-diff", "--no-color", "--", normalized], root)
    ]);
    return {
      path: normalized,
      current,
      baseline: baselineResult.exitCode === 0 ? baselineResult.stdout : "",
      diff: diffResult.exitCode === 0 ? diffResult.stdout : "",
      baselineSource: "git",
      baselineAvailable: baselineResult.exitCode === 0 || change?.status === "added" || change?.status === "untracked"
    };
  }

  async listChanges(): Promise<ChangedFile[]> {
    const { path: root } = this.requireCurrent();
    if (!(await isGitRepository(root))) {
      const baseline = this.#nonGitBaseline ?? new Map<string, BaselineFile>();
      return await changesAgainstBaseline(root, baseline);
    }
    const result = await runProcess("git", ["-c", "core.quotepath=false", "status", "--porcelain=v1", "-z", "--untracked-files=all"], root);
    if (result.exitCode !== 0) throw new BridgeError(502, "git_status_failed", "无法读取 Git 文件状态。", true);
    return parseStatusOutput(result.stdout);
  }

  async diff(relativePath?: string): Promise<{ unstaged: string; staged: string }> {
    const { path: root } = this.requireCurrent();
    if (!(await isGitRepository(root))) return { unstaged: "", staged: "" };
    const pathArgs = relativePath ? ["--", normalizeRelativeInput(relativePath)] : [];
    const [unstaged, staged] = await Promise.all([
      runProcess("git", ["diff", "--no-ext-diff", "--no-color", ...pathArgs], root),
      runProcess("git", ["diff", "--cached", "--no-ext-diff", "--no-color", ...pathArgs], root)
    ]);
    if (unstaged.exitCode !== 0 || staged.exitCode !== 0) {
      throw new BridgeError(502, "git_diff_failed", "无法读取 Git Diff。", true);
    }
    return { unstaged: unstaged.stdout, staged: staged.stdout };
  }

  async inspect(path: string, projectTrusted: boolean, displayPath?: string, displayName?: string): Promise<WorkspaceInfo> {
    const git = await isGitRepository(path);
    const branch = git ? await gitBranch(path) : null;
    const scan = await scanFiles(path);
    return {
      id: stableWorkspaceId(path),
      name: displayName ?? basename(path),
      status: "ready",
      displayPath: displayPath ?? `…/${basename(path)}`,
      branch,
      git,
      projectTrusted,
      fileCount: scan.entries.filter((entry) => entry.kind === "file").length,
      fileScanLimited: scan.limited,
      checkedAt: new Date().toISOString()
    };
  }

  private async assertWithinAllowedRoot(path: string): Promise<void> {
    if (!this.allowedRoot) return;
    const allowed = await realpath(this.allowedRoot).catch(() => resolve(this.allowedRoot!));
    if (!isWithin(allowed, path)) {
      throw new BridgeError(403, "workspace_outside_allowed_root", "所选目录不在已授权范围内。", false);
    }
  }

  private async runBaselineFor(runId?: string): Promise<RunBaseline | undefined> {
    const current = this.#current;
    const baseline = this.#runBaseline;
    if (!runId || !current) return undefined;
    if (baseline?.runId === runId && baseline.workspaceId === current.info.id) return baseline;
    const persisted = await loadRunBaseline(this.dataDir, runId);
    if (!persisted || persisted.workspaceId !== current.info.id) return undefined;
    this.#runBaseline = persisted;
    return persisted;
  }
}

interface FileScanState {
  limited: boolean;
}

async function scanFiles(root: string): Promise<{ entries: FileEntry[]; limited: boolean }> {
  const entries: FileEntry[] = [];
  const state: FileScanState = { limited: false };
  await walk(root, "", 0, entries, state);
  return { entries, limited: state.limited };
}

async function walk(root: string, relativeDirectory: string, depth: number, output: FileEntry[], state: FileScanState): Promise<void> {
  if (depth > MAX_DEPTH || output.length >= MAX_FILES) {
    state.limited = true;
    return;
  }
  const directory = join(root, relativeDirectory);
  const children = await import("node:fs/promises")
    .then(({ readdir }) => readdir(directory, { withFileTypes: true }))
    .catch(() => {
      state.limited = true;
      return [];
    });
  children.sort((left, right) => {
    if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  for (const child of children) {
    if (output.length >= MAX_FILES) {
      state.limited = true;
      return;
    }
    if (child.isDirectory() && IGNORED_DIRECTORIES.has(child.name)) continue;
    const childRelative = relativeDirectory ? join(relativeDirectory, child.name) : child.name;
    const childPath = join(root, childRelative);
    const metadata = await lstat(childPath).catch(() => undefined);
    if (!metadata) {
      state.limited = true;
      continue;
    }
    const kind: FileEntry["kind"] = metadata.isSymbolicLink()
      ? "symlink"
      : metadata.isDirectory() ? "directory" : "file";
    output.push({
      path: childRelative.split(sep).join("/"),
      name: child.name,
      kind,
      depth,
      ...(kind === "file" ? { size: metadata.size } : {})
    });
    if (kind === "directory") await walk(root, childRelative, depth + 1, output, state);
  }
}

async function resolveExistingPath(root: string, input: string): Promise<string> {
  const normalized = normalizeRelativeInput(input);
  const target = await realpath(resolve(root, normalized)).catch(() => {
    throw new BridgeError(404, "file_unavailable", "无法访问该文件。", false);
  });
  if (!isWithin(root, target)) throw new BridgeError(403, "path_escape", "目标路径超出当前工作区。", false);
  return target;
}

function normalizeRelativeInput(input: string): string {
  if (!input || input.includes("\0")) throw new BridgeError(400, "invalid_path", "文件路径无效。", false);
  const normalized = input.replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new BridgeError(403, "path_escape", "目标路径超出当前工作区。", false);
  }
  return normalized;
}

function isWithin(root: string, target: string): boolean {
  const path = relative(resolve(root), resolve(target));
  return path === "" || (!path.startsWith("..") && !path.startsWith(sep));
}

async function isGitRepository(path: string): Promise<boolean> {
  const result = await runProcess("git", ["rev-parse", "--is-inside-work-tree"], path);
  return result.exitCode === 0 && result.stdout.trim() === "true";
}

async function gitBranch(path: string): Promise<string | null> {
  const result = await runProcess("git", ["branch", "--show-current"], path);
  return result.exitCode === 0 ? result.stdout.trim() || null : null;
}

function parseStatusOutput(output: string): ChangedFile[] {
  const records = output.split("\0");
  const changes: ChangedFile[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const indexStatus = record[0] ?? " ";
    const worktreeStatus = record[1] ?? " ";
    const firstPath = record.slice(3);
    let path = firstPath;
    let previousPath: string | undefined;
    if (indexStatus === "R" || indexStatus === "C" || worktreeStatus === "R" || worktreeStatus === "C") {
      previousPath = records[index + 1] ?? firstPath;
      index += 1;
    }
    const markers = `${indexStatus}${worktreeStatus}`;
    const status: ChangedFile["status"] = indexStatus === "?" && worktreeStatus === "?"
      ? "untracked"
      : markers.includes("R") ? "renamed"
        : markers.includes("A") ? "added"
          : markers.includes("D") ? "deleted"
            : "modified";
    changes.push({
      path,
      ...(previousPath ? { previousPath } : {}),
      status,
      staged: indexStatus !== " " && indexStatus !== "?",
      unstaged: worktreeStatus !== " " && worktreeStatus !== "?" || (indexStatus === "?" && worktreeStatus === "?")
    });
  }
  return changes;
}

function stableWorkspaceId(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 24);
}

function safeTimestamp(): string {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

export function parseGitUrl(input: string): URL {
  let parsed: URL;
  const trimmed = input.trim();
  try {
    const scpStyle = trimmed.match(/^git@([a-zA-Z0-9.-]+):([^\s]+)$/);
    parsed = new URL(scpStyle ? `ssh://git@${scpStyle[1]}/${scpStyle[2]}` : trimmed);
  } catch {
    throw new BridgeError(400, "invalid_git_url", "请输入完整的 HTTPS 或 SSH Git 地址。", false);
  }
  const hasEmbeddedCredential = parsed.protocol === "https:"
    ? Boolean(parsed.username || parsed.password)
    : Boolean(parsed.password);
  if (!["https:", "ssh:"].includes(parsed.protocol) || !parsed.hostname || hasEmbeddedCredential) {
    throw new BridgeError(400, "invalid_git_url", "仅支持不含内嵌凭证的 HTTPS 或 SSH Git 地址。", false);
  }
  return parsed;
}

function repositoryName(pathname: string): string {
  const value = basename(pathname).replace(/\.git$/i, "").replace(/[^a-zA-Z0-9._-]/g, "-");
  return value || "repository";
}

function mimeFor(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
  if (lower.endsWith(".md") || lower.endsWith(".mdx")) return "text/markdown";
  if (lower.endsWith(".json")) return "application/json";
  if (/\.(?:[cm]?[jt]sx?|css|scss|less|yaml|yml|toml|ini|txt|sh|zsh|fish|py|rs|go|java|kt|swift|c|h|cpp|hpp|sql|xml)$/.test(lower)) return "text/plain";
  return "application/octet-stream";
}

function isImageMime(mime: string): boolean {
  return ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mime);
}

function isTextMime(mime: string): boolean {
  return mime.startsWith("text/") || mime === "application/json";
}

async function assertProcess(command: string, args: string[], cwd: string, message: string): Promise<void> {
  const result = await runProcess(command, args, cwd);
  if (result.exitCode !== 0) throw new BridgeError(500, "acceptance_workspace_failed", message, false);
}

async function captureFileBaseline(root: string, contentBudget = Number.POSITIVE_INFINITY): Promise<Map<string, BaselineFile>> {
  const { entries } = await scanFiles(root);
  const baseline = new Map<string, BaselineFile>();
  let capturedContentBytes = 0;
  for (const entry of entries) {
    if (entry.kind !== "file") continue;
    const target = resolve(root, entry.path);
    const hash = await hashFile(target).catch(() => undefined);
    if (!hash) continue;
    const mime = mimeFor(entry.path);
    const content = entry.size !== undefined
      && entry.size <= 2_000_000
      && capturedContentBytes + entry.size <= contentBudget
      && isTextMime(mime)
      ? await readFile(target).catch(() => undefined)
      : undefined;
    if (content !== undefined) capturedContentBytes += content.byteLength;
    baseline.set(entry.path, {
      size: entry.size ?? 0,
      hash,
      ...(content !== undefined ? { content: content.toString("utf8") } : {})
    });
  }
  return baseline;
}

async function persistRunBaseline(dataDir: string, baseline: RunBaseline): Promise<void> {
  const directory = join(dataDir, "run-baselines");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(runBaselinePath(directory, baseline.runId), JSON.stringify({
    version: 1,
    workspaceId: baseline.workspaceId,
    runId: baseline.runId,
    files: [...baseline.files.entries()]
  }), { encoding: "utf8", mode: 0o600 });
}

async function loadRunBaseline(dataDir: string, runId: string): Promise<RunBaseline | undefined> {
  const directory = join(dataDir, "run-baselines");
  const raw = await readFile(runBaselinePath(directory, runId), "utf8").catch(() => undefined);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; workspaceId?: unknown; runId?: unknown; files?: unknown };
    if (parsed.version !== 1 || typeof parsed.workspaceId !== "string" || parsed.runId !== runId || !Array.isArray(parsed.files)) return undefined;
    const files = new Map<string, BaselineFile>();
    for (const entry of parsed.files) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !isBaselineFile(entry[1])) continue;
      files.set(entry[0], entry[1]);
    }
    return { workspaceId: parsed.workspaceId, runId, files };
  } catch {
    return undefined;
  }
}

function runBaselinePath(directory: string, runId: string): string {
  return join(directory, `${createHash("sha256").update(runId).digest("hex")}.json`);
}

function isBaselineFile(value: unknown): value is BaselineFile {
  if (typeof value !== "object" || value === null) return false;
  const file = value as Record<string, unknown>;
  return typeof file.size === "number"
    && typeof file.hash === "string"
    && (file.content === undefined || typeof file.content === "string");
}

async function changesAgainstBaseline(root: string, baseline: Map<string, BaselineFile>): Promise<ChangedFile[]> {
  const current = await captureFileBaseline(root);
  const deleted = [...baseline.entries()].filter(([path]) => !current.has(path));
  const added = [...current.entries()].filter(([path]) => !baseline.has(path));
  const changes: ChangedFile[] = [];
  const consumedDeleted = new Set<string>();
  for (const [path, file] of added) {
    const renamed = deleted.find(([oldPath, oldFile]) => !consumedDeleted.has(oldPath) && oldFile.hash === file.hash);
    if (renamed) {
      consumedDeleted.add(renamed[0]);
      changes.push({ path, previousPath: renamed[0], status: "renamed", staged: false, unstaged: true });
    } else {
      changes.push({ path, status: "added", staged: false, unstaged: true });
    }
  }
  for (const [path] of deleted) {
    if (!consumedDeleted.has(path)) changes.push({ path, status: "deleted", staged: false, unstaged: true });
  }
  for (const [path, file] of current) {
    const before = baseline.get(path);
    if (before && before.hash !== file.hash) changes.push({ path, status: "modified", staged: false, unstaged: true });
  }
  return changes.sort((left, right) => left.path.localeCompare(right.path));
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolveHash, rejectHash) => {
    const input = createReadStream(path);
    input.on("data", (chunk) => hash.update(chunk));
    input.once("error", rejectHash);
    input.once("end", resolveHash);
  });
  return hash.digest("hex");
}

function simpleTextDiff(path: string, baseline: string, current: string): string {
  if (baseline === current) return "";
  const removed = baseline.split("\n").map((line) => `-${line}`).join("\n");
  const added = current.split("\n").map((line) => `+${line}`).join("\n");
  return `--- a/${path}\n+++ b/${path}\n${removed}\n${added}\n`;
}
