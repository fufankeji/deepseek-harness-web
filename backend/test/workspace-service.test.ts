import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rename, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseGitUrl, WorkspaceService } from "../src/workspace/workspace-service.js";

test("Git URL validation accepts the SSH transport user but rejects embedded secrets", () => {
  const ssh = parseGitUrl("ssh://git@github.com/fufankeji/DeepSeekHarnessWeb.git");
  assert.equal(ssh.protocol, "ssh:");
  assert.equal(ssh.username, "git");
  assert.equal(
    parseGitUrl("git@github.com:fufankeji/DeepSeekHarnessWeb.git").toString(),
    "ssh://git@github.com/fufankeji/DeepSeekHarnessWeb.git"
  );
  assert.throws(
    () => parseGitUrl("https://user:secret@example.com/repository.git"),
    /不含内嵌凭证/
  );
  assert.throws(
    () => parseGitUrl("ssh://git:secret@example.com/repository.git"),
    /不含内嵌凭证/
  );
});

test("restoring a user workspace rechecks the configured allowed root", async () => {
  const root = await mkdtemp(join(tmpdir(), "ff-workspace-restore-root-"));
  const allowed = join(root, "allowed");
  const outside = join(root, "outside");
  await mkdir(allowed, { recursive: true });
  await mkdir(outside, { recursive: true });
  const service = new WorkspaceService(join(root, "data"), join(root, "templates"), allowed);

  await assert.rejects(
    () => service.restore({
      path: outside,
      displayPath: "outside",
      projectTrusted: false,
      templateVersion: "user-workspace",
      acceptance: false
    }),
    /不在已授权范围内/
  );
});

test("acceptance workspace is retained and Git changes are observable", async () => {
  const root = await mkdtemp(join(tmpdir(), "ff-workspace-test-"));
  const dataDir = join(root, "data");
  const template = join(root, "template");
  await mkdir(join(template, "src"), { recursive: true });
  await writeFile(join(template, "src", "counter.js"), "export const value = 1;\n");
  await writeFile(join(template, "test.mjs"), "console.log('ok');\n");
  const templates = join(root, "templates");
  await mkdir(templates, { recursive: true });
  await import("node:fs/promises").then(({ rename }) => rename(template, join(templates, "counter-v1")));
  const service = new WorkspaceService(dataDir, templates);

  const info = await service.createAcceptanceWorkspace();
  assert.equal(info.name, "DeepSeek 代码验收项目");
  assert.equal(info.git, true);
  const persistedPath = service.requireCurrent().path;
  await writeFile(join(persistedPath, "src", "counter.js"), "export const value = 2;\n");

  const changes = await service.listChanges();
  assert.deepEqual(changes, [{ path: "src/counter.js", status: "modified", staged: false, unstaged: true }]);
  assert.match((await service.diff("src/counter.js")).unstaged, /value = 2/);
  assert.equal(await readFile(join(persistedPath, "src", "counter.js"), "utf8"), "export const value = 2;\n");

  const restored = new WorkspaceService(dataDir, templates);
  await restored.restore({ ...service.persistedCurrent()!, displayName: "旧时间戳名称" });
  assert.equal(restored.requireCurrent().info.name, "DeepSeek 代码验收项目");
});

test("starter workspace is usable without Git or acceptance-only behavior", async () => {
  const root = await mkdtemp(join(tmpdir(), "ff-workspace-starter-"));
  const templates = join(root, "templates");
  await mkdir(join(templates, "counter-v1", "src"), { recursive: true });
  await writeFile(join(templates, "counter-v1", "src", "counter.js"), "export const value = 1;\n");
  const service = new WorkspaceService(join(root, "data"), templates);

  const info = await service.createStarterWorkspace();
  assert.equal(info.name, "DeepSeek 示例项目");
  assert.equal(info.git, false);
  assert.equal(service.requireCurrent().acceptance, false);
  assert.equal(service.requireCurrent().templateVersion, "starter-v1");
  assert.equal((await service.listFiles()).some((entry) => entry.path === "src/counter.js"), true);

  const restored = new WorkspaceService(join(root, "data"), templates);
  await restored.restore(service.persistedCurrent()!);
  assert.equal(restored.requireCurrent().info.name, "DeepSeek 示例项目");
});

test("Git status preserves Unicode, spaces and rename destinations", async () => {
  const root = await mkdtemp(join(tmpdir(), "ff-workspace-git-paths-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "旧 文件.txt"), "same\n");
  await run("git", ["init", "--quiet"], workspace);
  await run("git", ["config", "user.name", "FF Test"], workspace);
  await run("git", ["config", "user.email", "test@local.invalid"], workspace);
  await run("git", ["add", "--all"], workspace);
  await run("git", ["commit", "--quiet", "-m", "baseline"], workspace);
  await rename(join(workspace, "旧 文件.txt"), join(workspace, "新 文件.txt"));
  await run("git", ["add", "--all"], workspace);

  const service = new WorkspaceService(join(root, "data"), join(root, "templates"));
  await service.select(workspace);
  assert.deepEqual(await service.listChanges(), [{ path: "新 文件.txt", previousPath: "旧 文件.txt", status: "renamed", staged: true, unstaged: false }]);
  const renamedView = await service.fileView("新 文件.txt");
  assert.equal(renamedView.baseline, "same\n");
  assert.equal(renamedView.current, "same\n");
});

test("file reads reject parent traversal and escaping symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "ff-workspace-security-"));
  const workspace = join(root, "workspace");
  const outside = join(root, "outside.txt");
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "inside.txt"), "inside\n");
  await writeFile(outside, "outside\n");
  await symlink(outside, join(workspace, "escape.txt"));
  const service = new WorkspaceService(join(root, "data"), join(root, "templates"));
  await service.select(workspace);

  assert.equal(await service.readText("inside.txt"), "inside\n");
  await assert.rejects(() => service.readText("../outside.txt"), /超出当前工作区/);
  await assert.rejects(() => service.readText("escape.txt"), /超出当前工作区/);
});

test("deep file trees report an explicit scan limit instead of pretending to be complete", async () => {
  const root = await mkdtemp(join(tmpdir(), "ff-workspace-depth-"));
  const workspace = join(root, "workspace");
  let directory = workspace;
  await mkdir(directory, { recursive: true });
  for (let index = 0; index < 24; index += 1) {
    directory = join(directory, `level-${index}`);
    await mkdir(directory);
  }
  await writeFile(join(directory, "deep.txt"), "too deep\n");
  const service = new WorkspaceService(join(root, "data"), join(root, "templates"));
  const info = await service.select(workspace);

  assert.equal(info.fileScanLimited, true);
  assert.equal((await service.listFiles()).some((entry) => entry.path.endsWith("deep.txt")), false);
});

test("workspace scans omit common dependency and cache directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "ff-workspace-ignored-dirs-"));
  const workspace = join(root, "workspace");
  for (const directory of ["node_modules", ".venv", "venv", "__pycache__", ".next", ".pytest_cache"]) {
    await mkdir(join(workspace, directory), { recursive: true });
    await writeFile(join(workspace, directory, "noise.txt"), "generated\n");
  }
  await mkdir(join(workspace, "src"), { recursive: true });
  await writeFile(join(workspace, "src", "app.ts"), "export const app = true;\n");
  const service = new WorkspaceService(join(root, "data"), join(root, "templates"));
  const info = await service.select(workspace);

  const paths = (await service.listFiles()).map((entry) => entry.path);
  assert.equal(info.fileCount, 1);
  assert.equal(info.fileScanLimited, false);
  assert.equal(paths.includes("src/app.ts"), true);
  assert.equal(paths.some((path) => path.endsWith("noise.txt")), false);
});

test("file preview classifies text, image, HTML and unsupported data", async () => {
  const root = await mkdtemp(join(tmpdir(), "ff-workspace-preview-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "readme.md"), "# 你好\n");
  await writeFile(join(workspace, "page.html"), "<h1>preview</h1><script>window.top.location='https://example.com'</script>");
  await writeFile(join(workspace, "pixel.png"), Buffer.from("89504e470d0a1a0a", "hex"));
  await writeFile(join(workspace, "binary.bin"), Buffer.from([0, 1, 2, 3]));
  const service = new WorkspaceService(join(root, "data"), join(root, "templates"));
  await service.select(workspace);

  assert.equal((await service.preview("readme.md")).kind, "text");
  assert.equal((await service.preview("page.html")).kind, "html");
  const image = await service.preview("pixel.png");
  assert.equal(image.kind, "image");
  assert.match(image.dataUrl ?? "", /^data:image\/png;base64,/);
  assert.equal((await service.preview("binary.bin")).kind, "unsupported");
  const download = await service.download("binary.bin");
  assert.equal(download.name, "binary.bin");
  assert.equal(download.size, 4);
  await assert.rejects(() => service.download("../outside.bin"), /超出当前工作区/);
});

test("non-Git workspace reports added, modified, deleted and renamed files against its selected baseline", async () => {
  const root = await mkdtemp(join(tmpdir(), "ff-workspace-nongit-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "modify.txt"), "before\n");
  await writeFile(join(workspace, "delete.txt"), "delete me\n");
  await writeFile(join(workspace, "rename.txt"), "same content\n");
  const service = new WorkspaceService(join(root, "data"), join(root, "templates"));
  await service.select(workspace);

  await writeFile(join(workspace, "modify.txt"), "after\n");
  await unlink(join(workspace, "delete.txt"));
  await rename(join(workspace, "rename.txt"), join(workspace, "renamed.txt"));
  await writeFile(join(workspace, "added.txt"), "new\n");

  assert.deepEqual(await service.listChanges(), [
    { path: "added.txt", status: "added", staged: false, unstaged: true },
    { path: "delete.txt", status: "deleted", staged: false, unstaged: true },
    { path: "modify.txt", status: "modified", staged: false, unstaged: true },
    { path: "renamed.txt", previousPath: "rename.txt", status: "renamed", staged: false, unstaged: true }
  ]);
  const view = await service.fileView("modify.txt");
  assert.equal(view.baseline, "before\n");
  assert.equal(view.current, "after\n");
  assert.match(view.diff, /-before/);
  assert.match(view.diff, /\+after/);
});

test("run baseline shows a later edit as modified without requiring Git", async () => {
  const root = await mkdtemp(join(tmpdir(), "ff-workspace-run-baseline-"));
  const workspace = join(root, "workspace");
  const dataDir = join(root, "data");
  await mkdir(workspace, { recursive: true });
  const service = new WorkspaceService(dataDir, join(root, "templates"));
  await service.select(workspace);

  await writeFile(join(workspace, "example.py"), "print('first')\n");
  await service.captureRunBaseline("run-edit");
  await writeFile(join(workspace, "example.py"), "print('second')\n");

  const snapshot = await service.snapshot("run-edit");
  assert.equal(snapshot.changeScope, "run");
  assert.equal(snapshot.comparisonRunId, "run-edit");
  assert.deepEqual(snapshot.changes, [
    { path: "example.py", status: "modified", staged: false, unstaged: true }
  ]);
  const view = await service.fileView("example.py", "run-edit");
  assert.equal(view.baselineSource, "run");
  assert.equal(view.baselineAvailable, true);
  assert.equal(view.baseline, "print('first')\n");
  assert.equal(view.current, "print('second')\n");
});

test("persisted run baseline survives Bridge service recreation", async () => {
  const root = await mkdtemp(join(tmpdir(), "ff-workspace-run-restore-"));
  const workspace = join(root, "workspace");
  const dataDir = join(root, "data");
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "example.py"), "before\n");
  const first = new WorkspaceService(dataDir, join(root, "templates"));
  await first.select(workspace);
  await first.captureRunBaseline("run-persisted");
  await writeFile(join(workspace, "example.py"), "after\n");

  const restored = new WorkspaceService(dataDir, join(root, "templates"));
  await restored.select(workspace);
  const view = await restored.fileView("example.py", "run-persisted");
  assert.equal(view.baselineSource, "run");
  assert.equal(view.baseline, "before\n");
  assert.equal(view.current, "after\n");
});

test("an unknown run never falls back to a misleading Git or workspace baseline", async () => {
  const root = await mkdtemp(join(tmpdir(), "ff-workspace-run-missing-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "example.py"), "current\n");
  const service = new WorkspaceService(join(root, "data"), join(root, "templates"));
  await service.select(workspace);

  const snapshot = await service.snapshot("missing-run");
  assert.equal(snapshot.changeScope, "unavailable");
  assert.deepEqual(snapshot.changes, []);
  const view = await service.fileView("example.py", "missing-run");
  assert.equal(view.baselineSource, "unavailable");
  assert.equal(view.baselineAvailable, false);
  assert.equal(view.current, "current\n");
});

async function run(command: string, args: string[], cwd: string): Promise<void> {
  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: "ignore" });
    child.once("error", rejectRun);
    child.once("close", (code) => code === 0 ? resolveRun() : rejectRun(new Error(`${command} failed with ${code}`)));
  });
}
