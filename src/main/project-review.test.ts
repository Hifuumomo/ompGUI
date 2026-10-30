// @vitest-environment node
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { diffLines } from "diff";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createProjectBrowser } from "./project-browser";
import { listChanges } from "./project-changes";
import { readDiff } from "./project-diff";
import { gitOutput, runProjectGit } from "./project-git";
import type { ProjectEntry } from "../shared/project-browser";

let root: string;
const browser = createProjectBrowser(fs);
const deps = {
  run: runProjectGit,
  read: browser.readProjectFile,
  lstat: fs.lstat,
  readlink: fs.readlink,
  compare: async (before: string, after: string) =>
    diffLines(before, after, { stripTrailingCr: true }),
};
const changes = () => listChanges({ run: runProjectGit, stat: fs.stat }, root);
const git = (...args: string[]) => gitOutput(runProjectGit, root, args);
const write = (name: string, content: string | Uint8Array) =>
  fs.writeFile(join(root, name), content);
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "omp-review-git-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function initialize(files: Readonly<Record<string, string>>) {
  await git("init");
  for (const [name, content] of Object.entries(files))
    await write(name, content);
  await git("add", ".");
  await git(
    "-c",
    "user.name=Review Test",
    "-c",
    "user.email=review@example.invalid",
    "commit",
    "-m",
    "baseline",
  );
}
async function diff(file: ProjectEntry) {
  const snapshot = await changes();
  return readDiff(deps, { cwd: snapshot.root, base: snapshot.base, file });
}

it("非 Git 项目明确返回普通浏览；首次提交前文件使用空基线", async () => {
  expect((await changes()).kind).toBe("plain");
  await git("init");
  await write("new.ts", "const first = 1;\n");
  const snapshot = await changes();
  expect(snapshot.base).toBeNull();
  expect(snapshot.files[0].change).toBe("untracked");
  expect((await diff(snapshot.files[0])).rows).toEqual([
    {
      kind: "addition",
      text: "const first = 1;",
      ending: "\n",
      oldLine: undefined,
      newLine: 1,
    },
  ]);
});

it("HEAD 对比实际工作区，包含已暂存后又修改的内容和中文路径", async () => {
  await initialize({ "中文 文件.py": "first\nold\nlast\n" });
  await write("中文 文件.py", "first\nstaged\nlast\n");
  await git("add", ".");
  await write("中文 文件.py", "first\nworking\nextra\nlast\n");
  const snapshot = await changes();
  expect(snapshot.files).toHaveLength(1);
  expect(snapshot.files[0].change).toBe("modified");
  const result = await diff(snapshot.files[0]);
  expect(result.before).toBe("first\nold\nlast\n");
  expect(result.after).toBe("first\nworking\nextra\nlast\n");
  expect(
    result.rows.map((row) => [row.kind, row.oldLine, row.newLine]),
  ).toEqual([
    ["context", 1, 1],
    ["deletion", 2, undefined],
    ["addition", undefined, 2],
    ["addition", undefined, 3],
    ["context", 3, 4],
  ]);
});

it("删除、新增与重命名保留正确的原文件基线", async () => {
  await initialize({ "delete.ts": "removed\n", "old.ts": "renamed\n" });
  await fs.unlink(join(root, "delete.ts"));
  await git("mv", "old.ts", "renamed.ts");
  await write("new.py", "new file");
  const snapshot = await changes();
  const deleted = snapshot.files.find((file) => file.change === "deleted")!;
  const renamed = snapshot.files.find((file) => file.change === "renamed")!;
  const added = snapshot.files.find((file) => file.change === "untracked")!;
  expect((await diff(deleted)).after).toBe("");
  expect((await diff(deleted)).rows[0].kind).toBe("deletion");
  expect(renamed.previousPath).toBe(join(root, "old.ts"));
  expect((await diff(renamed)).before).toBe("renamed\n");
  expect((await diff(added)).rows[0].ending).toBe("");
});

it("项目子目录只列本目录变更，Git 根仍用于读取基线", async () => {
  await fs.mkdir(join(root, "nested"));
  await initialize({ "nested/code.ts": "old\n", "outside.ts": "old\n" });
  await write("nested/code.ts", "new\n");
  await write("outside.ts", "new\n");
  const snapshot = await listChanges(
    { run: runProjectGit, stat: fs.stat },
    join(root, "nested"),
  );
  expect(snapshot.files.map((file) => file.name)).toEqual(["code.ts"]);
  expect((await diff(snapshot.files[0])).before).toBe("old\n");
});

it("读取错误不变成空差异；二进制拒绝；不执行文件内容", async () => {
  await initialize({ binary: "old\n", "code.ts": "old\n" });
  await write("binary", new Uint8Array([0, 1, 2]));
  await write("code.ts", "new\n");
  const snapshot = await changes();
  const code = snapshot.files.find((file) => file.name === "code.ts")!;
  await fs.unlink(code.path);
  await expect(diff(code)).rejects.toThrow();
  await expect(
    diff(snapshot.files.find((file) => file.name === "binary")!),
  ).rejects.toThrow("二进制");
});

it("CRLF 不导致整文件误标，末尾换行变化仍表示为增删", async () => {
  await initialize({ "code.ts": "unchanged\nold\n" });
  await write("code.ts", "unchanged\r\nold");
  const result = await diff((await changes()).files[0]);
  expect(result.rows[0].kind).toBe("context");
  expect(result.rows.at(-1)).toMatchObject({
    kind: "addition",
    text: "old",
    ending: "",
  });
});

it("符号链接比较链接目标字符串，不读取目标文件", async () => {
  const read = vi.fn();
  const result = await readDiff(
    {
      ...deps,
      read,
      lstat: async () => ({ isSymbolicLink: () => true }),
      readlink: async () => "../target.py",
    },
    {
      cwd: root,
      base: null,
      file: {
        name: "link.py",
        path: join(root, "link.py"),
        kind: "file",
        change: "untracked",
      },
    },
  );
  expect(result.after).toBe("../target.py");
  expect(result.rows[0].kind).toBe("addition");
  expect(read).not.toHaveBeenCalled();
});
