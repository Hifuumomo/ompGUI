// @vitest-environment node
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { formatCommand } from "./command-format";

afterEach(() => vi.unstubAllEnvs());

it.skipIf(process.platform !== "win32").each([
  [
    "Get-Process | Where-Object CPU | Select-Object Name",
    "Get-Process |\nWhere-Object CPU |\nSelect-Object Name",
  ],
  [
    "Write-Output '中文😀|原文' | Select-Object -First 1 # 保留 | 注释",
    "Write-Output '中文😀|原文' |\nSelect-Object -First 1 # 保留 | 注释",
  ],
  [
    "Write-Output @'\na|b\n'@ | Select-Object -First 1",
    "Write-Output @'\na|b\n'@ |\nSelect-Object -First 1",
  ],
  [
    "Get-Process |\r\n  Select-Object Name",
    "Get-Process |\r\n  Select-Object Name",
  ],
  [
    "Write-Output 'unterminated | Select-Object Name",
    "Write-Output 'unterminated | Select-Object Name",
  ],
])(
  "原生解析管道并保留字面值或错误原文：%s",
  async (source, expected) => {
    expect(await formatCommand("psh", source)).toBe(expected);
  },
  10000,
);

it.skipIf(process.platform !== "win32")(
  "格式化不执行输入命令",
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "omp-format-"));
    const target = join(directory, "must-not-exist.txt");
    try {
      const command = `Set-Content -LiteralPath '${target.replaceAll("'", "''")}' -Value 'changed' | Out-Null`;
      expect(await formatCommand("powershell", command)).toBe(
        command.replace("| ", "|\n"),
      );
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true });
    }
  },
  10000,
);

it("不支持的工具、无管道或过长命令保留原文", async () => {
  for (const [tool, source] of [
    ["bash", "echo x | cat"],
    ["psh", "Write-Output '中文'"],
    ["psh", "x".repeat(262145) + " | y"],
  ])
    expect(await formatCommand(tool, source)).toBe(source);
});

it.skipIf(process.platform !== "win32")("解析器缺失时返回原文", async () => {
  vi.stubEnv("SystemRoot", join(tmpdir(), "omp-missing-powershell-runtime"));
  const source = "Get-Process | Select-Object Name";
  expect(await formatCommand("psh", source)).toBe(source);
});
