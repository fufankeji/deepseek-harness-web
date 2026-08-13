import { spawn } from "node:child_process";

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = 15_000,
  inheritedEnvironment: readonly string[] = []
): Promise<ProcessResult> {
  return await new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: childEnvironment(inheritedEnvironment),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
  });
}

function childEnvironment(inheritedEnvironment: readonly string[]): NodeJS.ProcessEnv {
  const allowed = new Set(["PATH", "LANG", "LC_ALL", "TMPDIR", "SystemRoot", "ComSpec", "PATHEXT", ...inheritedEnvironment]);
  return Object.fromEntries(
    [...allowed].flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]]])
  );
}
