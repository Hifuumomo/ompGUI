import { execFile } from "node:child_process";
import { join } from "node:path";

// 命令正文仅经标准输入传给解析器；此固定脚本不会调用或求值正文。
const parserScript = `
$ErrorActionPreference = 'Stop'
$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd()))
$tokens = $null
$errors = $null
$null = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) { exit 1 }
$offsets = @($tokens | Where-Object { $_.Kind -eq 'Pipe' } | ForEach-Object { $_.Extent.EndOffset })
[Console]::Out.Write((ConvertTo-Json -InputObject $offsets -Compress))
`;

/** 只格式化展示副本；解析器缺失、超时或语法错误时原样返回。 */
export async function formatCommand(
  toolName: string,
  command: string,
): Promise<string> {
  const name = toolName
    .toLowerCase()
    .split(/__|[.:/]/)
    .at(-1);
  if (
    !name ||
    !["psh", "pwsh", "powershell"].includes(name) ||
    !command.includes("|") ||
    command.length > 262144
  )
    return command;
  const executable =
    process.platform === "win32"
      ? join(
          process.env.SystemRoot ?? "C:\\Windows",
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        )
      : "pwsh";
  return new Promise((resolve) => {
    const child = execFile(
      executable,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(parserScript, "utf16le").toString("base64"),
      ],
      { windowsHide: true, timeout: 3000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) return resolve(command);
        try {
          const offsets: unknown = JSON.parse(stdout);
          if (
            !Array.isArray(offsets) ||
            offsets.some(
              (offset) =>
                !Number.isInteger(offset) ||
                offset < 1 ||
                offset > command.length ||
                command[offset - 1] !== "|",
            )
          )
            return resolve(command);
          let formatted = command;
          const newline = command.includes("\r\n") ? "\r\n" : "\n";
          // 从末尾插入，原生 UTF-16 偏移与 JavaScript 字符串索引一致。
          for (const offset of offsets.sort((a, b) => b - a)) {
            const remainder = formatted.slice(offset).replace(/^[ \t]+/, "");
            if (!remainder || /^[\r\n]/.test(remainder)) continue;
            formatted = formatted.slice(0, offset) + newline + remainder;
          }
          resolve(formatted);
        } catch {
          resolve(command);
        }
      },
    );
    child.stdin?.on("error", () => resolve(command));
    child.stdin?.end(Buffer.from(command, "utf8").toString("base64"));
  });
}
