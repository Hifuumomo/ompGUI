import { spawn } from "node:child_process";

export interface GitResult {
  readonly code: number;
  readonly stdout: Buffer;
  readonly stderr: string;
}
export type RunGit = (
  cwd: string,
  args: readonly string[],
) => Promise<GitResult>;

/** 直接启动 Git；路径不经过 shell，不运行外部 diff 或用户脚本。 */
export const runProjectGit: RunGit = (cwd, args) =>
  new Promise((resolve, reject) => {
    const child = spawn("git", ["--no-optional-locks", ...args], {
      cwd,
      windowsHide: true,
      env: { ...process.env, GIT_LITERAL_PATHSPECS: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === null) {
        reject(new Error("Git 进程被中止"));
        return;
      }
      resolve({
        code,
        stdout: Buffer.concat(output),
        stderr: Buffer.concat(errors).toString("utf8"),
      });
    });
  });

export async function gitOutput(
  run: RunGit,
  cwd: string,
  args: readonly string[],
) {
  const result = await run(cwd, args);
  if (result.code !== 0)
    throw new Error(`Git 读取失败：${result.stderr.trim() || result.code}`);
  return result.stdout;
}
