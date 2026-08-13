import { BridgeError } from "../errors.js";
import { runProcess, type ProcessResult } from "../runtime/process-runner.js";

const PICKER_TIMEOUT_MS = 10 * 60 * 1_000;

export async function pickLocalDirectory(): Promise<string | null> {
  if (process.platform === "darwin") {
    const result = await runProcess(
      "/usr/bin/osascript",
      ["-e", 'POSIX path of (choose folder with prompt "选择代码工作区")'],
      process.cwd(),
      PICKER_TIMEOUT_MS,
      ["HOME", "USER", "LOGNAME"]
    );
    if (isMacOsCancellation(result)) return null;
    return selectedPath(result);
  }

  if (process.platform === "win32") {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      "$dialog.Description = '选择代码工作区'",
      "$dialog.ShowNewFolderButton = $false",
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
      "  [Console]::Out.Write($dialog.SelectedPath)",
      "  exit 0",
      "}",
      "exit 2"
    ].join("; ");
    const result = await runProcess(
      "powershell.exe",
      ["-NoProfile", "-STA", "-Command", script],
      process.cwd(),
      PICKER_TIMEOUT_MS,
      ["USERPROFILE"]
    );
    if (result.exitCode === 2) return null;
    return selectedPath(result);
  }

  const zenity = await tryLinuxPicker("zenity", ["--file-selection", "--directory", "--title=选择代码工作区"]);
  if (zenity !== undefined) return zenity;
  const kdialog = await tryLinuxPicker("kdialog", ["--getexistingdirectory", process.cwd(), "--title", "选择代码工作区"]);
  if (kdialog !== undefined) return kdialog;
  throw new BridgeError(501, "directory_picker_unavailable", "当前系统缺少可用的目录选择器，请安装 zenity 或 kdialog。", false);
}

async function tryLinuxPicker(command: string, args: string[]): Promise<string | null | undefined> {
  try {
    const result = await runProcess(command, args, process.cwd(), PICKER_TIMEOUT_MS, ["HOME", "USER", "DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS"]);
    if (result.exitCode === 1) return null;
    return selectedPath(result);
  } catch (error) {
    if (isMissingCommand(error)) return undefined;
    throw error;
  }
}

function selectedPath(result: ProcessResult): string {
  if (result.exitCode !== 0) {
    throw new BridgeError(503, "directory_picker_failed", "无法打开本机目录选择器，请重试。", true);
  }
  const path = result.stdout.replace(/[\r\n]+$/, "");
  if (!path) throw new BridgeError(503, "directory_picker_failed", "目录选择器没有返回有效路径。", true);
  return path;
}

function isMacOsCancellation(result: ProcessResult): boolean {
  return result.exitCode === 1 && (result.stderr.includes("-128") || /cancel(?:l)?ed/i.test(result.stderr));
}

function isMissingCommand(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
