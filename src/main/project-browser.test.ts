// @vitest-environment node
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createProjectBrowser } from "./project-browser";

let root: string;
const browser = createProjectBrowser(fs);
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "omp-project-browser-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

it("不依赖 Git 或 OMP，按目录优先枚举真实项目并保留中文文件名", async () => {
  await fs.mkdir(join(root, "src"));
  await fs.writeFile(join(root, "文件.ts"), "export const 文本 = '你好';\r\n");
  await fs.writeFile(join(root, ".gitignore"), "out\n");
  const entries = await browser.listProjectDirectory(root);
  expect(entries[0]).toEqual({
    name: "src",
    path: join(root, "src"),
    kind: "directory",
  });
  expect(entries.map((entry) => entry.name)).toContain(".gitignore");
  expect(await browser.readProjectFile(join(root, "文件.ts"))).toBe(
    "export const 文本 = '你好';\r\n",
  );
  expect(await fs.readFile(join(root, "文件.ts"), "utf8")).toBe(
    "export const 文本 = '你好';\r\n",
  );
});

it("读取空文件与完整长文本，不截断；刷新读取磁盘最新内容", async () => {
  const path = join(root, "source.ts");
  await fs.writeFile(path, "");
  expect(await browser.readProjectFile(path)).toBe("");
  const source = "const 文本 = '完整内容';\n".repeat(50000);
  await fs.writeFile(path, source);
  expect(await browser.readProjectFile(path)).toBe(source);
  await fs.writeFile(path, "已修改");
  expect(await browser.readProjectFile(path)).toBe("已修改");
});

it("二进制、非法编码、目录及缺失路径明确报错", async () => {
  const binary = join(root, "binary");
  const invalid = join(root, "invalid");
  await fs.writeFile(binary, Buffer.from([0, 1, 2]));
  await fs.writeFile(invalid, Buffer.from([0xff]));
  await expect(browser.readProjectFile(binary)).rejects.toThrow("二进制");
  await expect(browser.readProjectFile(invalid)).rejects.toThrow("UTF-8");
  await expect(browser.readProjectFile(root)).rejects.toThrow();
  await expect(
    browser.readProjectFile(join(root, "missing")),
  ).rejects.toThrow();
  await expect(
    browser.listProjectDirectory(join(root, "missing")),
  ).rejects.toThrow();
});

it("图片按扩展名白名单返回原始字节与 MIME，非图片及非普通文件拒绝", async () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0xff, 0x0a]);
  const image = join(root, "图标.PNG");
  await fs.writeFile(image, bytes);
  const result = await browser.readProjectImage(image);
  expect(result.mimeType).toBe("image/png");
  expect(result.byteSize).toBe(bytes.length);
  expect(Buffer.from(result.data, "base64")).toEqual(bytes);
  await fs.writeFile(join(root, "source.ts"), "x");
  await expect(
    browser.readProjectImage(join(root, "source.ts")),
  ).rejects.toThrow("图片格式");
  await fs.mkdir(join(root, "folder.png"));
  await expect(
    browser.readProjectImage(join(root, "folder.png")),
  ).rejects.toThrow();
  await expect(
    browser.readProjectImage(join(root, "missing.png")),
  ).rejects.toThrow();
});
