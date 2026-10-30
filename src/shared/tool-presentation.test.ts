// @vitest-environment node
import { describe, expect, it } from "vitest";
import { describeToolCall } from "./tool-presentation";

/** 注册原生工具说明的用户可见与授权边界回归。参数：无。返回值：无。 */
function toolPresentationConsumers(): void {
  /** 验证截图中的 hashline 头变为真实文件而不是调用 ID。参数：无。返回值：无。 */
  function screenshotEdit(): void {
    const result = describeToolCall("edit", {
      input:
        "*** Begin Patch\n[~/.omp/agent/agents/committer.md#398A]\nPUT 3.=4:\n+description: Handles Git commits.\n*** End Patch\n",
      id: "call_aUWcsh09W9hyvT4BDzYZYimA",
    });
    expect(result.verb).toBe("编辑");
    expect(result.targets).toEqual([
      {
        kind: "file",
        label: "committer.md",
        path: "~/.omp/agent/agents/committer.md",
      },
    ]);
  }
  it("截图 edit 的完整文件路径可读且没有 hash 或调用 ID 垃圾", screenshotEdit);

  /** 验证多文件补丁去重并保留 Unicode、Windows 与 UNC。参数：无。返回值：无。 */
  function multiFilePatch(): void {
    const result = describeToolCall(
      "functions.edit",
      JSON.stringify({
        input:
          "*** Begin Patch\n[目录/你好.ts#A1B2]\nPUT 1.=1:\n+内容\n[D:\\Code\\工作.ts#C3D4]\nPUT 1.=1:\n+内容\n[目录/你好.ts#A1B2]\nPUT 2.=2:\n+内容\n[\\\\server\\共享\\文档.md#ABCD]\nREM\n*** End Patch\n",
      }),
    );
    expect(result.targets).toEqual([
      { kind: "file", label: "你好.ts", path: "目录/你好.ts" },
      { kind: "file", label: "工作.ts", path: "D:\\Code\\工作.ts" },
      { kind: "file", label: "文档.md", path: "\\\\server\\共享\\文档.md" },
    ]);
  }
  it("namespaced edit 的多个显式文件保真并去重", multiFilePatch);

  /** 验证阅读选择器与快照不污染授权文件名。参数：无。返回值：无。 */
  function selectedRead(): void {
    const selections = [
      "src/你好.ts:50-80",
      "src/你好.ts:50+150",
      "src/你好.ts:-60",
      "src/你好.ts:5-16,19,59",
      "src/你好.ts:raw:2-4",
      "src/你好.ts:2-4:raw",
      "[src/你好.ts#ABCD]",
      "src/你好.ts:conflicts",
    ];
    for (const path of selections) {
      expect(describeToolCall("functions.read", { path }).targets).toEqual([
        { kind: "file", label: "你好.ts", path: "src/你好.ts" },
      ]);
    }
    expect(
      describeToolCall("mcp__serena_read_file", {
        relative_path: "D:/工作/文件.md",
        start_line: 9,
      }).targets,
    ).toEqual([{ kind: "file", label: "文件.md", path: "D:/工作/文件.md" }]);
    for (const selection of [
      "notes.txt:4-8",
      "notes.txt:raw",
      "notes.txt:conflicts",
      "[notes.txt#ABCD]:4-8",
    ]) {
      expect(describeToolCall("read", { path: selection }).targets).toEqual([
        { kind: "file", label: "notes.txt", path: "notes.txt" },
      ]);
    }
    expect(describeToolCall("read", { path: "README:20" }).targets).toEqual([
      { kind: "file", label: "README", path: "README" },
    ]);
  }
  it("原生 line/raw/snapshot 选择器只移除已识别后缀", selectedRead);

  /** 验证资源地址、归档成员、模式和 ADS 不授权为磁盘文件。参数：无。返回值：无。 */
  function nonDiskResources(): void {
    const resources = [
      "skill://mmx-cli",
      "artifact://opaque:1-10",
      "agent://Main",
      "local://note.md",
      "file:///C:/secret.txt",
      "javascript:alert(1)",
      "data:text/html,hello",
      "bundle.zip:src/文件.ts",
      "bundle.tar.gz:42",
      "data.db:users:1",
      "data.json?q=.path",
      "src/*.ts",
      "D:/secret.txt:private",
      "note.md:unknown",
      "xd://tool:4-8",
      "local://note.md:raw",
      "mcp://resource:conflicts",
      "javascript:4",
      "urn:4",
      "custom://file.txt:4-8",
    ];
    for (const path of resources) {
      expect(describeToolCall("read", { path }).targets).toEqual([
        { kind: "query", label: path, text: path },
      ]);
    }
    const url = "https://example.com/file.md:10-20";
    expect(describeToolCall("read", { path: url }).targets).toEqual([
      { kind: "url", label: url, url },
    ]);
  }
  it("URI/归档/数据库/模式永不伪装成可读取磁盘文件", nonDiskResources);

  /** 验证无效参数或不透明 ID 不产生文件授权。参数：无。返回值：无。 */
  function incompleteEvidence(): void {
    const args = [
      '{"path":"secret.txt"',
      '{"path":"secret.txt",',
      '{"input":"*** Begin Patch\\n[secret.txt#ABCD]',
      null,
      undefined,
      [],
      { id: "secret.txt" },
      { path: 12 },
      { id: "call_abcd1234" },
      { toolCallId: "550e8400-e29b-41d4-a716-446655440000" },
      '{"path":"目录/未完成.md',
      '{"path":"目录/\\uD83D',
      { path: "bad\u0000name.txt" },
      { content: "secret.txt" },
      "secret.txt",
    ];
    for (const value of args) {
      expect(describeToolCall("read", value).targets).toEqual([]);
      expect(describeToolCall("edit", value).targets).toEqual([]);
    }
    expect(describeToolCall("unknown", { path: "secret.txt" })).toEqual({
      verb: "调用工具",
      targets: [],
      summary: "unknown",
    });
  }
  it("部分 JSON 与调用标识不能制造文件授权", incompleteEvidence);

  /** 验证文件证据取决于字段来源而非文件名形状。参数：无。返回值：无。 */
  function explicitIdentifierFilenames(): void {
    const filenames = [
      "call_abcd1234",
      "toolu_1234",
      "550e8400-e29b-41d4-a716-446655440000",
    ];
    for (const path of filenames) {
      expect(describeToolCall("read", { id: path }).targets).toEqual([]);
      expect(describeToolCall("read", { path }).targets).toEqual([
        { kind: "file", label: path, path },
      ]);
      expect(
        describeToolCall("edit", {
          input: `*** Begin Patch\n[${path}#ABCD]\nREM\n*** End Patch\n`,
        }).targets,
      ).toEqual([{ kind: "file", label: path, path }]);
    }
    for (const path of ["[call_abcd1234#ABCD]:10-20", "call_abcd1234:raw"]) {
      expect(describeToolCall("read", { path }).targets).toEqual([
        { kind: "file", label: "call_abcd1234", path: "call_abcd1234" },
      ]);
    }
  }
  it(
    "显式 path 和补丁文件头可以引用合法的调用标识形状文件名",
    explicitIdentifierFilenames,
  );

  /** 验证 literal 写入与补丁路径不能经阅读选择器变成另一份授权文件。参数：无。返回值：无。 */
  function literalPathSemantics(): void {
    const paths = [
      "notes:1",
      "notes:raw",
      "notes:conflicts",
      "D:/notes.txt:1",
      "[notes#ABCD]",
    ];
    for (const path of paths) {
      const evidence = { kind: "query", label: path, text: path };
      expect(describeToolCall("write", { path }).targets).toEqual([evidence]);
      expect(describeToolCall("edit", { path }).targets).toEqual([evidence]);
      expect(
        describeToolCall("mcp__serena_read_file", { relative_path: path })
          .targets,
      ).toEqual([evidence]);
      expect(
        describeToolCall("edit", { patch: `--- a/${path}\n+++ b/${path}\n` })
          .targets,
      ).toEqual([evidence]);
      expect(
        describeToolCall("edit", {
          input: `*** Begin Patch\n[${path}#ABCD]\nREM\n*** End Patch\n`,
        }).targets,
      ).toEqual([evidence]);
    }
    const path = "notes#ABCD";
    const file = { kind: "file", label: path, path };
    expect(describeToolCall("write", { path }).targets).toEqual([file]);
    expect(
      describeToolCall("edit", { patch: `--- a/${path}\n+++ b/${path}\n` })
        .targets,
    ).toEqual([file]);
    expect(
      describeToolCall("edit", {
        input: `*** Begin Patch\n[${path}#EF12]\nREM\n*** End Patch\n`,
      }).targets,
    ).toEqual([file]);
  }
  it(
    "literal write/edit 路径和 ADS 不删除后缀制造不同文件授权",
    literalPathSemantics,
  );

  /** 验证 unified 文件头及新增正文中的伪头不扩大授权。参数：无。返回值：无。 */
  function unifiedPatch(): void {
    const patch =
      "--- a/src/真实.ts\n+++ b/src/真实.ts\n@@ -1,1 +1,1 @@\n--- secret.txt\n+++ stolen.txt\n--- /dev/null\n+++ b/目录/new.md\n@@ -0,0 +1,1 @@\n+正文\n";
    expect(
      describeToolCall("functions.apply_patch", { patch }).targets,
    ).toEqual([
      { kind: "file", label: "真实.ts", path: "src/真实.ts" },
      { kind: "file", label: "new.md", path: "目录/new.md" },
    ]);
    expect(
      describeToolCall("edit", {
        input:
          "*** Begin Patch\n*** Update File: old.md\n*** Move to: 新/new.md\n*** Add File: second.md\n+*** Update File: fake.md\n*** End Patch\n",
      }).targets,
    ).toEqual([
      { kind: "file", label: "old.md", path: "old.md" },
      { kind: "file", label: "new.md", path: "新/new.md" },
      { kind: "file", label: "second.md", path: "second.md" },
    ]);
    expect(
      describeToolCall("edit", {
        input:
          '*** Begin Patch\n[old.md#ABCD]\nMV "目录/new file.md"\n*** End Patch\n',
      }).targets,
    ).toEqual([
      { kind: "file", label: "old.md", path: "old.md" },
      { kind: "file", label: "new file.md", path: "目录/new file.md" },
    ]);
  }
  it("unified 和 apply_patch 只授权文件头而非 hunk 内容", unifiedPatch);

  /** 验证命令原文不拆成路径且不执行。参数：无。返回值：无。 */
  function literalCommands(): void {
    const command =
      "node -e 'globalThis.__toolPresentationExecuted = true'; cat secret.txt > output.txt";
    const globals = globalThis as typeof globalThis & {
      __toolPresentationExecuted?: boolean;
    };
    expect(globals.__toolPresentationExecuted).toBeUndefined();
    expect(
      describeToolCall("functions.bash", { command, cwd: "secret.txt" }),
    ).toEqual({
      verb: "执行命令",
      targets: [{ kind: "command", label: command, command }],
    });
    expect(globals.__toolPresentationExecuted).toBeUndefined();
    expect(
      describeToolCall("mcp__serena__execute_shell_command", { command })
        .targets[0],
    ).toEqual({
      kind: "command",
      label: command,
      command,
    });
    expect(
      describeToolCall("bash", '{"command":"cat secret.txt"').targets,
    ).toEqual([]);
  }
  it("命令只作为字面证据，不执行且不猜 shell 中的文件", literalCommands);

  /** 验证搜索路径列表与查询原文各自保留语义。参数：无。返回值：无。 */
  function searchEvidence(): void {
    expect(
      describeToolCall("functions.grep", {
        pattern: "你好|world",
        path: "src/entry.ts;src/**/*.ts;local://*.md",
        i: "查找使用处",
      }),
    ).toEqual({
      verb: "搜索",
      summary: "查找使用处",
      targets: [
        { kind: "file", label: "entry.ts", path: "src/entry.ts" },
        { kind: "query", label: "src/**/*.ts", text: "src/**/*.ts" },
        { kind: "query", label: "local://*.md", text: "local://*.md" },
        { kind: "query", label: "你好|world", text: "你好|world" },
      ],
    });
    expect(describeToolCall("glob", { path: "**/*.md" }).targets).toEqual([
      { kind: "query", label: "**/*.md", text: "**/*.md" },
    ]);
    expect(
      describeToolCall("write", {
        path: "docs/说明.md",
        content: "path: secret.txt",
      }).targets,
    ).toEqual([{ kind: "file", label: "说明.md", path: "docs/说明.md" }]);
  }
  it("搜索模式和正文不能伪造额外的文件目标", searchEvidence);
}

describe("原生工具目标说明", toolPresentationConsumers);
