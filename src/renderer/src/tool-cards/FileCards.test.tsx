// @vitest-environment jsdom
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { container, render, click } from "../transcript-test-harness";
import { parseNativeDiff, diffStats, outputTail } from "../tool-card-model";
import type { ToolEvidence } from "../transcript-types";
import type { ProcessContext } from "../TranscriptToolRow";
import { streamingToolPreview } from "../tool-stream-preview";
import { MessageFileLinks } from "../MessageFileLinks";
import { EditCard } from "./EditCard";
import { WriteCard } from "./WriteCard";
import { DeleteCard } from "./DeleteCard";
import {
  editOk,
  editFailed,
  editMove,
  editDelete,
  localWrite,
  tool,
} from "./fixtures";

/** 提供真实消费者所用的受控展开接口。 */
function Example({
  evidence,
  kind = "edit",
}: {
  evidence: ToolEvidence;
  kind?: "edit" | "write" | "delete";
}) {
  const [expanded, setExpanded] = useState(false);
  const context: ProcessContext = {
    sessionId: "file-cards",
    cwd: "C:/Code/ompGUI",
    expanded: expanded ? { [evidence.id]: 0 } : {},
    toggle: () => setExpanded((value) => !value),
    panelId: (id) => id,
  };
  return kind === "write" ? (
    <WriteCard tool={evidence} context={context} />
  ) : kind === "delete" ? (
    <DeleteCard tool={evidence} context={context} />
  ) : (
    <EditCard tool={evidence} context={context} />
  );
}

/** 差异解析不能丢弃未知行、内容中的竖线或真实间隔。 */
it("解析原生差异及未知文本并计算增删和间隔", () => {
  const lines = parseNativeDiff(
    " 101|left|right\n-102|before\n+102|after\n\n 110|tail\nunknown",
  );
  expect(lines).toEqual([
    { kind: "context", line: 101, text: "left|right" },
    { kind: "del", line: 102, text: "before" },
    { kind: "add", line: 102, text: "after" },
    { kind: "gap", hidden: 7 },
    { kind: "context", line: 110, text: "tail" },
    { kind: "context", text: "unknown" },
  ]);
  expect(diffStats(lines)).toEqual({ added: 1, removed: 1 });
  expect(parseNativeDiff("")).toEqual([]);
  expect(parseNativeDiff("unknown\n\n 5|x")[1]).toEqual({ kind: "gap" });
});

/** 命令输出尾部不将终结换行算成多余空行。 */
it("输出尾部处理空、边界、末尾换行和零行", () => {
  expect(outputTail("", 3)).toEqual({ lines: [], total: 0 });
  expect(outputTail("a\nb\n", 2)).toEqual({ lines: ["a", "b"], total: 2 });
  expect(outputTail("a\nb\nc", 2)).toEqual({ lines: ["b", "c"], total: 3 });
  expect(outputTail("a", 4)).toEqual({ lines: ["a"], total: 1 });
  expect(outputTail("a\n\n", 1)).toEqual({ lines: [""], total: 2 });
  expect(outputTail("a", 0)).toEqual({ lines: [], total: 1 });
});

/** 默认正文始终可见，路径继续经过原有链接上下文。 */
it("显示完成差异、统计、真实路径链接和未改动间隔", async () => {
  const open = vi.fn(async () => {});
  await render(
    <MessageFileLinks.Provider value={open}>
      <Example evidence={editOk} />
    </MessageFileLinks.Provider>,
  );
  expect(container.querySelectorAll('[data-kind="add"]')).toHaveLength(2);
  expect(container.querySelectorAll('[data-kind="del"]')).toHaveLength(1);
  expect(container.textContent).toContain("43 行未修改");
  expect(container.querySelector(".tool-card-meta")?.textContent).toBe("+2 −1");
  expect(
    container.querySelector(".tool-card-header")?.getAttribute("aria-expanded"),
  ).toBe("false");
  await click(
    container.querySelector<HTMLAnchorElement>(".tool-card-title a")!,
  );
  expect(open).toHaveBeenCalledTimes(1);
});

/** 单文件默认 30 行，而多文件每段最多 15 行；展开保留全部内容。 */
it("单文件和多文件各自截断并可完整展开", async () => {
  const diff = Array.from(
    { length: 35 },
    (_, index) => `+${index + 1}|line-${index}`,
  ).join("\n");
  await render(
    <Example
      evidence={tool("edit", { path: "a.ts" }, { details: { diff } })}
    />,
  );
  expect(container.querySelectorAll(".tool-card-diff-line")).toHaveLength(30);
  expect(container.textContent).toContain("共 35 行");
  await click(container.querySelector<HTMLElement>(".tool-card-header")!);
  expect(container.querySelectorAll(".tool-card-diff-line")).toHaveLength(35);
  await render(
    <Example
      key="multi"
      evidence={tool(
        "edit",
        { input: "*** Begin Patch\n[a.ts#1234]\n[b.ts#5678]\n*** End Patch" },
        {
          details: {
            perFileResults: [
              { path: "a.ts", diff },
              { path: "b.ts", diff },
            ],
          },
        },
      )}
    />,
  );
  expect(container.querySelectorAll(".tool-card-diff-line")).toHaveLength(30);
  expect(container.querySelectorAll(".tool-card-row")).toHaveLength(2);
  await click(container.querySelector<HTMLElement>(".tool-card-header")!);
  expect(container.querySelectorAll(".tool-card-diff-line")).toHaveLength(70);
});

/** 没有原生差异时沿用历史替换证据，不读取当前文件冒充结果。 */
it("无 diff 回退既有文件证据，失败直接显示原文和错误种类", async () => {
  await render(
    <Example
      evidence={tool(
        "edit",
        {
          input:
            "*** Begin Patch\n[a.ts#1234]\nPUT 1.=1:\n+unique-after\n*** End Patch\n",
        },
        {
          details: {
            path: "a.ts",
            op: "update",
            oldText: "unique-before",
            newText: "unique-after",
          },
          text: "replaced",
        },
      )}
    />,
  );
  expect(container.querySelector(".tool-card-body")?.textContent).toContain(
    "unique-before",
  );
  expect(container.querySelector(".tool-card-body")?.textContent).toContain(
    "unique-after",
  );
  await render(<Example evidence={editFailed} />);
  expect(container.textContent).toContain("old_string 在文件中出现 0 次");
  expect(container.textContent).toContain("errorKind: no_match");
  expect(
    container.querySelector(".tool-card-result")?.textContent,
  ).toContain("文件未改动");
  expect(container.querySelector(".tool-card")?.getAttribute("data-status")).toBe(
    "error",
  );
  // 有旧文本参数：输入区显示参数名和旧文本，Output 区是错误原文。
  expect(container.querySelector(".tool-card-input")?.textContent).toContain(
    "old_string",
  );
  expect(container.querySelector(".tool-card-input")?.textContent).toContain("x");
  expect(container.querySelector(".tool-card-divider")?.textContent).toBe(
    "Output",
  );
  expect(container.querySelector(".tool-card-footer")).toBeNull();
  // 没有旧文本参数：不渲染输入区，也就没有分隔线。
  await render(
    <Example
      evidence={{
        ...editFailed,
        args: { path: "src/main/rpc.ts" },
      }}
    />,
  );
  expect(container.querySelector(".tool-card-input")).toBeNull();
  expect(container.querySelector(".tool-card-divider")).toBeNull();
  expect(container.querySelector(".tool-card-result")?.textContent).toContain(
    "old_string 在文件中出现 0 次",
  );
});

/** 未截断的编辑框没有底部信息。 */
it("未截断的编辑框不渲染底部边框", async () => {
  await render(<Example evidence={editOk} />);
  expect(container.querySelector(".tool-card-footer")).toBeNull();
});

/** 移动仅从完整补丁读取，不改变链接授权。 */
it("hashline 和 apply_patch 移动均显示源到目标", async () => {
  for (const evidence of [
    editMove,
    tool(
      "edit",
      {
        input:
          "*** Begin Patch\n*** Update File: README.md\n*** Move to: docs/README.md\n*** End Patch",
      },
      { details: { diff: "-1|a\n+1|b" } },
    ),
  ]) {
    await render(<Example evidence={evidence} />);
    expect(container.querySelector(".tool-card-title")?.textContent).toContain(
      "移动",
    );
    expect(container.querySelector(".tool-card-title")?.textContent).toContain(
      "README.md → docs/README.md",
    );
  }
});

/** 写入预览保留空正文，虚拟笔记使用 Markdown 而非文件证据。 */
it("普通写入默认十二行，空文件为零行，本地笔记渲染 Markdown", async () => {
  await render(
    <Example
      kind="write"
      evidence={tool(
        "write",
        {
          path: "a.ts",
          content: Array.from({ length: 20 }, (_, index) => `row${index}`).join(
            "\n",
          ),
        },
        {},
      )}
    />,
  );
  expect(container.querySelector(".tool-card-body")?.textContent).toContain(
    "row11",
  );
  expect(container.querySelector(".tool-card-body")?.textContent).not.toContain(
    "row12",
  );
  await render(
    <Example
      kind="write"
      evidence={tool("write", { path: "a.ts", content: "" }, {})}
    />,
  );
  expect(container.textContent).toContain("0 行");
  expect(container.textContent).toContain("空文件");
  await render(<Example kind="write" evidence={localWrite} />);
  expect(container.textContent).toContain("会话笔记");
  expect(container.querySelector(".rich-content")).not.toBeNull();
  expect(container.querySelector(".tool-card-footer")?.textContent).toContain(
    "Markdown",
  );
});

/** 删除只消费结果旧正文，显示相对路径且默认六行。 */
it("删除路径相对 cwd、旧正文为红行、缺失正文保留结果", async () => {
  await render(<Example kind="delete" evidence={editDelete} />);
  expect(container.querySelector(".tool-card-title")?.textContent).toBe(
    "删除 src/renderer/parity-smoke.js",
  );
  expect(container.querySelectorAll('[data-kind="del"]')).toHaveLength(3);
  await render(
    <Example
      key="long-delete"
      kind="delete"
      evidence={tool(
        "edit",
        {},
        { details: { path: "a.ts", oldText: "1\n2\n3\n4\n5\n6\n7\n" } },
      )}
    />,
  );
  expect(container.querySelectorAll('[data-kind="del"]')).toHaveLength(6);
  expect(container.textContent).toContain("−7 行");
  await click(container.querySelector<HTMLElement>(".tool-card-header")!);
  expect(container.querySelectorAll('[data-kind="del"]')).toHaveLength(7);
  await render(
    <Example
      kind="delete"
      evidence={tool(
        "edit",
        {},
        { details: { path: "a.ts" }, text: "Deleted a.ts" },
      )}
    />,
  );
  expect(container.querySelector(".tool-card-body")?.textContent).toContain(
    "Deleted a.ts",
  );
});

/** 流式正文只是无行号展示；终态替换正文而不丢失用户展开状态。 */
it("参数流替换为最终 diff，展开保持，hashline 与写入显示光标", async () => {
  const pending: ToolEvidence = {
    id: "stream",
    name: "edit",
    args: undefined,
    streamingArgs: { old_text: "old", new_text: "new" },
  };
  await render(<Example evidence={pending} />);
  expect(container.querySelector(".tool-card-cursor")).not.toBeNull();
  expect(container.querySelector(".tool-card-line-number")).toBeNull();
  expect(container.textContent).toContain("无行号");
  await click(container.querySelector<HTMLElement>(".tool-card-header")!);
  await render(<Example evidence={{ ...editOk, id: "stream" }} />);
  expect(container.querySelector(".tool-card-cursor")).toBeNull();
  expect(
    container.querySelector(".tool-card-header")?.getAttribute("aria-expanded"),
  ).toBe("true");
  expect(container.querySelector(".tool-card-line-number")).not.toBeNull();
  await render(
    <Example
      evidence={{
        id: "hash",
        name: "edit",
        args: undefined,
        streamingArgs: {
          input: "*** Begin Patch\n[a.ts#ABCD]\nPUT 1.=1:\n+value",
        },
      }}
    />,
  );
  expect(container.textContent).not.toContain("PUT 1.=1:");
  expect(container.querySelector('[data-kind="add"]')?.textContent).toContain(
    "value",
  );
  await render(
    <Example
      kind="write"
      evidence={{
        id: "write-stream",
        name: "write",
        args: undefined,
        streamingArgs: { path: "untrusted.ts", content: "growing" },
      }}
    />,
  );
  expect(container.querySelector(".tool-card-output")?.textContent).toBe(
    "growing▍",
  );
});

/** 实际 freeform 原文只生成展示预览，终态才使用完整参数和结果链接。 */
it("原始补丁预览保留源码与光标，完成后切换原生差异和授权链接", async () => {
  const open = vi.fn(async () => {});
  const raw = "*** Begin Patch\n[parity-sample.txt#0063]\nPUT 2.=2:\n+gamma";
  const show = (evidence: ToolEvidence) =>
    render(
      <MessageFileLinks.Provider value={open}>
        <Example evidence={evidence} />
      </MessageFileLinks.Provider>,
    );
  const pending: ToolEvidence = {
    id: "raw-patch-stream",
    name: "edit",
    args: undefined,
    streamingArgs: streamingToolPreview({
      type: "toolCall",
      name: "edit",
      partialArguments: raw,
    }),
  };
  await show(pending);
  expect(container.querySelector(".tool-card-title code")?.textContent).toBe(
    "parity-sample.txt",
  );
  expect(container.querySelector('[data-kind="add"]')?.textContent).toBe(
    "+gamma▍",
  );
  expect(container.querySelector("a")).toBeNull();
  expect(container.querySelector(".tool-card-line-number")).toBeNull();
  expect(container.querySelector(".tool-card-meta")).toBeNull();
  expect(container.textContent).not.toMatch(/Begin Patch|#0063|PUT 2/);
  expect(container.querySelector('[data-kind="del"]')).toBeNull();
  await click(container.querySelector<HTMLElement>(".tool-card-header")!);

  const source = `${raw} + 中文🙂\n++sourcePlus\nCUT 3.=3\nMV other.txt`;
  await show({
    ...pending,
    streamingArgs: streamingToolPreview({
      type: "toolCall",
      name: "edit",
      partialArguments: source,
    }),
  });
  expect(
    Array.from(container.querySelectorAll('[data-kind="add"]')).map(
      (line) => line.textContent,
    ),
  ).toEqual(["+gamma + 中文🙂", "++sourcePlus▍"]);
  expect(container.textContent).not.toMatch(/CUT 3|MV other/);
  expect(container.querySelector("a")).toBeNull();
  expect(open).not.toHaveBeenCalled();

  const patch = `${source}\n*** End Patch`;
  await show({
    ...tool(
      "edit",
      { input: patch },
      {
        details: {
          path: "parity-sample.txt",
          diff: "-2|beta\n+2|gamma + 中文🙂\n+3|+sourcePlus",
        },
      },
    ),
    id: pending.id,
  });
  expect(container.querySelector(".tool-card-cursor")).toBeNull();
  expect(container.querySelector(".tool-card-line-number")?.textContent).toBe(
    "2",
  );
  expect(container.querySelector(".tool-card-meta")?.textContent).toBe("+2 −1");
  expect(
    container.querySelector(".tool-card-header")?.getAttribute("aria-expanded"),
  ).toBe("true");
  expect(container.querySelector('[data-kind="del"]')?.textContent).toContain(
    "beta",
  );
  await click(
    container.querySelector<HTMLAnchorElement>(".tool-card-title a")!,
  );
  expect(open).toHaveBeenCalledTimes(1);
});

/** 缺少源码的删除指令不得伪造旧正文；标准补丁也仅显示增删行。 */
it("空补丁预览保留光标，标准 Update File 标题始终为纯文本", async () => {
  for (const input of [
    "*** Begin Patch\n[a.ts#ABCD]\nCUT 1.=2",
    "*** Begin Patch\n*** Update File: a.ts\n@@\n-before + 中文\n+after + 中文",
  ]) {
    await render(
      <Example
        evidence={{
          id: "patch-preview",
          name: "edit",
          args: undefined,
          streamingArgs: { input },
        }}
      />,
    );
    expect(container.querySelector(".tool-card-title code")?.textContent).toBe(
      "a.ts",
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector(".tool-card-cursor")).not.toBeNull();
    expect(container.textContent).not.toMatch(
      /Begin Patch|#ABCD|CUT 1|Update File|@@/,
    );
    if (input.includes("CUT")) {
      expect(container.querySelectorAll(".tool-card-diff-line")).toHaveLength(
        0,
      );
    } else {
      expect(container.querySelector('[data-kind="del"]')?.textContent).toBe(
        "−before + 中文",
      );
      expect(container.querySelector('[data-kind="add"]')?.textContent).toBe(
        "+after + 中文▍",
      );
    }
  }
});

/** 错类型结构不得抛出或伪装成有效差异。 */
it("畸形结构安全回退通用卡", async () => {
  for (const details of [
    { diff: 42 },
    { perFileResults: [null] },
    { perFileResults: [{ path: "a.ts", diff: {} }] },
  ]) {
    await render(
      <Example
        key={JSON.stringify(details)}
        evidence={tool(
          "edit",
          { path: "a.ts" },
          { details, text: "native fallback" },
        )}
      />,
    );
    expect(container.querySelector(".tool-card-diff")).toBeNull();
    expect(
      container
        .querySelector(".tool-card-header")
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
    expect(container.textContent).not.toContain("native fallback");
    await click(container.querySelector<HTMLElement>(".tool-card-header")!);
    expect(
      container
        .querySelector(".tool-card-header")
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(container.querySelector(".tool-card-diff")).toBeNull();
    expect(container.textContent).toContain("native fallback");
  }
});

/** 原生逐文件结果即使只有一项，也采用每文件十五行上限。 */
it("单项 perFileResults 仍显示子标题并限制十五行", async () => {
  const diff = Array.from(
    { length: 20 },
    (_, index) => `+${index + 1}|line`,
  ).join("\n");
  await render(
    <Example
      evidence={tool(
        "edit",
        { path: "a.ts" },
        { details: { perFileResults: [{ path: "a.ts", diff }] } },
      )}
    />,
  );
  expect(container.querySelectorAll(".tool-card-row")).toHaveLength(1);
  expect(container.querySelectorAll(".tool-card-diff-line")).toHaveLength(15);
});
