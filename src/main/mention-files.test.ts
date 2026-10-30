// @vitest-environment node
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { searchMentionFiles } from "./mention-files";

let root: string;

/**
 * 为每个消费者场景创建独立真实目录。
 * 参数：无。
 * 返回值：临时目录创建完成的 Promise。
 */
async function prepareDirectory(): Promise<void> {
  root = await fs.mkdtemp(join(tmpdir(), "mention-files-"));
}

/**
 * 删除场景创建的目录与链接，不留下测试文件。
 * 参数：无。
 * 返回值：删除完成的 Promise。
 */
async function removeDirectory(): Promise<void> {
  await fs.rm(root, { recursive: true, force: true });
}

/**
 * 在场景工作目录中创建指定文件，不依赖 Git 或 OMP。
 * 参数：[in] paths 正斜线相对文件路径列表。
 * 返回值：所有真实文件创建完成的 Promise。
 */
async function createFiles(paths: string[]): Promise<void> {
  for (const path of paths) {
    const target = join(root, path);
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from([0, 0xff, 0x61]));
  }
}

beforeEach(prepareDirectory);
afterEach(removeDirectory);

/**
 * 验证目录不成为文件候选，空白、中文与二进制文件名保持原样。
 * 参数：无。
 * 返回值：断言完成的 Promise。
 */
async function matchesOnlyFiles(): Promise<void> {
  await createFiles(["src/文件 名.ts", "src/empty.txt"]);
  await fs.writeFile(join(root, "src/empty.txt"), "");
  await fs.mkdir(join(root, "文件 目录"));
  expect(await searchMentionFiles(root, "文件")).toEqual(["src/文件 名.ts"]);
  expect(await searchMentionFiles(root, "src\\文件")).toEqual([
    "src/文件 名.ts",
  ]);
  expect(await searchMentionFiles(root, "empty")).toEqual(["src/empty.txt"]);
}

/**
 * 验证精确名、前缀、包含、非连续字符与路径匹配依次排序。
 * 参数：无。
 * 返回值：断言完成的 Promise。
 */
async function ranksFuzzyMatches(): Promise<void> {
  await createFiles([
    "src/c/m/p.ts",
    "Component.ts",
    "MyCmp.ts",
    "cmp.test.ts",
    "cmp",
    "unrelated.txt",
  ]);
  expect(await searchMentionFiles(root, "CMP")).toEqual([
    "cmp",
    "cmp.test.ts",
    "MyCmp.ts",
    "Component.ts",
    "src/c/m/p.ts",
  ]);
  expect(await searchMentionFiles(root, "s/c/m/p")).toEqual(["src/c/m/p.ts"]);
}

/**
 * 验证空查询上限和稳定排序，并确认搜索不缓存已删除文件。
 * 参数：无。
 * 返回值：断言完成的 Promise。
 */
async function limitsAndRefreshesResults(): Promise<void> {
  const paths: string[] = [];
  for (let index = 39; index >= 0; index--)
    paths.push(`file${String(index).padStart(2, "0")}.ts`);
  await createFiles(paths);
  const expected = paths.toSorted().slice(0, 30);
  expect(await searchMentionFiles(root, "")).toEqual(expected);
  expect(await searchMentionFiles(root, "")).toEqual(expected);
  await fs.rm(join(root, "file00.ts"));
  const refreshed = await searchMentionFiles(root, "");
  expect(refreshed).not.toContain("file00.ts");
  expect(refreshed).toHaveLength(30);
  expect(refreshed[0]).toBe("file01.ts");
}

/**
 * 验证任意深度的 Git 与依赖目录不被遍历，但普通隐藏目录可搜索。
 * 参数：无。
 * 返回值：断言完成的 Promise。
 */
async function excludesDependencyTrees(): Promise<void> {
  await createFiles([
    "node_modules/package/needle.ts",
    ".git/objects/needle.ts",
    "nested/node_modules/package/needle.ts",
    "nested/.git/needle.ts",
    ".config/needle.ts",
    "constructor/needle.ts",
  ]);
  expect(await searchMentionFiles(root, "needle")).toEqual([
    ".config/needle.ts",
    "constructor/needle.ts",
  ]);
}

/**
 * 验证查询不能越出工作目录，junction 不泄漏外部或内部目录文件。
 * 参数：无。
 * 返回值：断言完成的 Promise。
 */
async function confinesSearchToWorkingDirectory(): Promise<void> {
  const workspace = join(root, "workspace");
  const outside = join(root, "outside");
  await createFiles(["workspace/inside.ts", "outside/secret.ts"]);
  await fs.symlink(outside, join(workspace, "external"), "junction");
  await fs.symlink(workspace, join(workspace, "cycle"), "junction");
  expect(await searchMentionFiles(workspace, "")).toEqual(["inside.ts"]);
  expect(await searchMentionFiles(workspace, "../outside/secret")).toEqual([]);
  expect(await searchMentionFiles(workspace, outside)).toEqual([]);
}

/**
 * 验证非法或不存在的根目录显式拒绝，不退回应用目录。
 * 参数：无。
 * 返回值：断言完成的 Promise。
 */
async function rejectsInvalidDirectories(): Promise<void> {
  await createFiles(["file.ts"]);
  await expect(searchMentionFiles(".", "")).rejects.toThrow("绝对路径");
  await expect(searchMentionFiles(join(root, "missing"), "")).rejects.toThrow();
  await expect(searchMentionFiles(join(root, "file.ts"), "")).rejects.toThrow();
}

it("只匹配真实文件，保留中文空格与正斜线路径，不读取二进制内容", matchesOnlyFiles);
it("文件名和相对路径支持不区分大小写的确定模糊排序", ranksFuzzyMatches);
it("空查询最多三十条，结果稳定并反映当前磁盘文件", limitsAndRefreshesResults);
it("不遍历任何层级的 node_modules 和 .git", excludesDependencyTrees);
it("工作目录边界拒绝路径穿越并跳过 junction 与循环链接", confinesSearchToWorkingDirectory);
it("相对、缺失及文件根目录明确报错", rejectsInvalidDirectories);
