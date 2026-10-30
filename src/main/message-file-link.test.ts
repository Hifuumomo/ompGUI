import { expect, it } from "vitest";
import {
  inspectProjectFileLink,
  resolveProjectFileLink,
} from "./message-file-link";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { messageFileHref, messageFilePath } from "../shared/message-file-link";

it("点击时验证实际文件、目录与不存在的路径", async () => {
  const directory = await mkdtemp(join(tmpdir(), "omp-link-"));
  try {
    await writeFile(join(directory, "sample.txt"), "hello");
    expect(
      (await inspectProjectFileLink(encodeURI(directory), directory, stat))
        .kind,
    ).toBe("directory");
    expect(
      (await inspectProjectFileLink("sample.txt", directory, stat)).kind,
    ).toBe("file");
    await expect(
      inspectProjectFileLink("missing", directory, stat),
    ).rejects.toThrow("路径不存在或无法访问");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("仅侧栏跳转允许缺失文件，严格文件操作仍拒绝且不会创建目标", async () => {
  const directory = await mkdtemp(join(tmpdir(), "omp-missing-link-"));
  try {
    const entry = await inspectProjectFileLink("missing/note.txt", directory, stat, true);
    expect(entry).toEqual({
      name: "note.txt",
      path: join(directory, "missing", "note.txt"),
      kind: "file",
    });
    await expect(
      inspectProjectFileLink("missing/note.txt", directory, stat),
    ).rejects.toThrow("路径不存在或无法访问");
    expect(await readdir(directory)).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("允许缺失文件时也不将权限错误当成不存在", async () => {
  const denied: typeof stat = async () => {
    throw Object.assign(new Error("permission denied"), { code: "EACCES" });
  };
  await expect(
    inspectProjectFileLink("note.txt", "C:/project", denied, true),
  ).rejects.toThrow("路径不存在或无法访问");
});

it.each([
  [
    "./decompiled/README.md",
    "D:\\work\\project",
    "D:\\work\\project\\decompiled\\README.md",
  ],
  ["../说明%20文档.cpp", "D:/work/project", "D:\\work\\说明 文档.cpp"],
  ["E:/output/main.cpp", "D:/work/project", "E:\\output\\main.cpp"],
  ["E:\\output\\main.cpp", "D:/work/project", "E:\\output\\main.cpp"],
  ["E:%5Coutput%5Cmain.cpp", "D:/work/project", "E:\\output\\main.cpp"],
  [
    "file:///E:/output/main%20file.cpp",
    "D:/work/project",
    "E:\\output\\main file.cpp",
  ],
  [
    "file://localhost/E:/output/main.cpp",
    "D:/work/project",
    "E:\\output\\main.cpp",
  ],
  ["./src/../README.md#intro", "/work/project", "/work/project/README.md"],
  ["/tmp/a%23b.txt", "/work/project", "/tmp/a#b.txt"],
])("按会话目录解析 %s", (href, cwd, expected) => {
  expect(resolveProjectFileLink(href, cwd).path).toBe(expected);
});

it.each([
  "https://example.com",
  "javascript:alert(1)",
  "data:text/plain,test",
  "sandbox:/mnt/data/test.txt",
  "mailto:test@example.com",
  "#section",
  "//server/share/file",
  "\\\\server\\share\\file",
  "file://server/share/file",
  "C:relative.txt",
  "javascript%3Aalert(1)",
  "%00file.txt",
  "%ZZ",
])("拒绝非本地文件目标 %s", (href) => {
  expect(messageFilePath(href)).toBeUndefined();
  expect(() => resolveProjectFileLink(href, "D:/project")).toThrow();
});

it("相对地址缺少工作目录时不使用应用进程目录猜测", () => {
  expect(() => resolveProjectFileLink("src/main.ts", "")).toThrow("工作目录");
});

it.each([
  "design notes/file #1.png",
  "literal%20name.txt",
  "images/foo@bar.png",
  "relative/question?.txt",
  "D:\\project\\中文 图.png",
])("引用编码保留字面文件名 %s", (path) => {
  const decoded = messageFilePath(messageFileHref(path));
  expect(decoded).toBe(path.replace(/\\/g, "/"));
});
