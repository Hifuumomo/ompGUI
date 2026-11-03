// @vitest-environment jsdom
import { act, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { ProcessItem, ToolEvidence } from "../transcript-types";
import { container, click, render } from "../transcript-test-harness";
import { groupCardItems } from "../tool-card-model";
import { ReadOnlyCard } from "./ReadOnlyCard";
import { artifactRead, localRead, tool } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

/** 为测试保留每个工具的独立原生标识。 */
function entries(
  tools: ToolEvidence[],
): Extract<ProcessItem, { kind: "tool" }>[] {
  return tools.map((evidence) => ({
    kind: "tool",
    key: evidence.id,
    tool: evidence,
  }));
}

/** 用真实受控展开状态模拟 App 的收起、重开与最新证据更新。 */
function Example({ tools }: { tools: ToolEvidence[] }) {
  const [expanded, setExpanded] = useState<Record<string, number>>({});
  return (
    <ReadOnlyCard
      items={entries(tools)}
      context={{
        sessionId: "readonly-session",
        expanded,
        panelId: (id) => `panel-${id}`,
        toggle: (id, index) =>
          setExpanded((previous) => {
            const next = { ...previous };
            if (next[id] !== undefined) delete next[id];
            else next[id] = index;
            return next;
          }),
      }}
    />
  );
}

/** 相邻读取合并，但思考和普通消息是不可跨越的边界。 */
it("groups readonly tools without crossing thinking or message boundaries", () => {
  const reads = entries([localRead, artifactRead]);
  const thinking: ProcessItem = {
    kind: "thinking",
    key: "thinking",
    part: { type: "thinking", thinking: "分析" },
    streaming: false,
  };
  const message: ProcessItem = {
    kind: "message",
    key: "message",
    message: { role: "assistant", content: [{ type: "text", text: "说明" }] },
    streaming: false,
  };
  const groups = groupCardItems([
    ...reads,
    thinking,
    reads[0],
    message,
    reads[1],
  ]);
  expect(groups.map((group) => group.kind)).toEqual([
    "readonly",
    "thinking",
    "readonly",
    "message",
    "readonly",
  ]);
  expect(groups[0].kind === "readonly" && groups[0].items).toHaveLength(2);
});

/** 框状态以执行中优先，失败子行仍可独立展开原生错误。 */
it("prioritizes running over child errors and exposes child failure output", async () => {
  const failed = tool(
    "read",
    { path: "missing.txt" },
    { text: "ENOENT native error", isError: true },
  );
  const running: ToolEvidence = {
    id: "running",
    name: "read",
    args: { path: "pending.txt" },
    streamingArgs: {},
  };
  await render(<Example tools={[failed, running]} />);
  expect(
    container
      .querySelector('.tool-card[data-kind="readonly"]')
      ?.getAttribute("data-status"),
  ).toBe("running");
  const failedRow = container.querySelector<HTMLElement>(
    `.tool-card-readonly-item[data-tool-id="${failed.id}"]`,
  )!;
  expect(failedRow.dataset.status).toBe("error");
  await click(
    failedRow.querySelector<HTMLElement>('[role="button"][aria-expanded]')!,
  );
  expect(failedRow.textContent).toContain("ENOENT native error");
  await render(<Example tools={[failed]} />);
  expect(
    container
      .querySelector('.tool-card[data-kind="readonly"]')
      ?.getAttribute("data-status"),
  ).toBe("error");
});

/** 文件展开始终使用历史原生正文，不通过 RPC 或磁盘重新读取。 */
it("expands native file evidence and reopens the newest result without disk access", async () => {
  const previewToolFile = vi.fn();
  const rpc = vi.fn();
  vi.stubGlobal("desktop", { previewToolFile, rpc });
  const evidence = {
    ...tool(
      "read",
      { path: "src/config.ts:4-5" },
      {
        details: {
          totalLines: 20,
          displayContent: { text: "const first = 1;", startLine: 4 },
        },
        text: "4|const first = 1;",
      },
    ),
    id: "config",
  };
  await render(<Example tools={[evidence]} />);
  const control = () =>
    container.querySelector<HTMLElement>(
      '[data-tool-id="config"] [role="button"][aria-expanded]',
    )!;
  await click(control());
  expect(container.querySelector(".file-review-source")?.textContent).toContain(
    "const first = 1;",
  );
  await click(control());
  const updated = {
    ...tool("read", evidence.args, {
      details: {
        totalLines: 20,
        displayContent: { text: "const latest = 2;", startLine: 4 },
      },
      text: "4|const latest = 2;",
    }),
    id: "config",
  };
  await render(<Example tools={[updated]} />);
  await click(control());
  expect(container.querySelector(".file-review-source")?.textContent).toContain(
    "const latest = 2;",
  );
  expect(previewToolFile).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});

/** 虚拟标签只用于显示：资源仍为查询，不会变成文件授权。 */
it("labels every virtual readonly resource without invoking file preview", async () => {
  const previewToolFile = vi.fn();
  vi.stubGlobal("desktop", { previewToolFile });
  const schemes = [
    "local",
    "artifact",
    "history",
    "http",
    "https",
    "omp",
    "cfg",
    "ssh",
    "xd",
    "attachment",
  ];
  const tools = schemes.map((scheme) =>
    tool(
      "read",
      { path: `${scheme}://native/sample.md` },
      {
        details: {
          totalLines: 1,
          displayContent: { text: "**native body**", startLine: 1 },
        },
        text: "native body",
      },
    ),
  );
  await render(<Example tools={tools} />);
  expect(container.querySelectorAll(".tool-card-chip")).toHaveLength(
    schemes.length,
  );
  expect(container.querySelector('[data-target-kind="file"]')).toBeNull();
  for (const row of container.querySelectorAll<HTMLElement>(
    ".tool-card-readonly-row",
  ))
    await click(row);
  expect(previewToolFile).not.toHaveBeenCalled();
  expect(
    container.querySelectorAll(".tool-card-readonly-details strong").length,
  ).toBeGreaterThanOrEqual(3);
});

/** 缺失或错误类型的搜索统计交回通用框，不把字符串数量伪装为零。 */
it("falls back for missing or ill-typed structured search details", async () => {
  const invalid = [
    tool(
      "grep",
      { pattern: "needle", path: "src" },
      {
        details: { matchCount: "2", fileCount: 1 },
        text: "native grep output",
      },
    ),
    tool("glob", { pattern: "*.ts" }, { text: "native glob output" }),
  ];
  await render(<Example tools={invalid} />);
  expect(container.querySelectorAll(".tool-card-readonly-row")).toHaveLength(0);
  expect(
    container.querySelectorAll('.tool-card-header[role="button"]'),
  ).toHaveLength(2);
});

/** 多行同时展开时，Esc 只关闭焦点所属行，并把焦点还给该行。 */
it("keeps the group sticky and collapses only the focused expanded row on Escape", async () => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  await render(<Example tools={[localRead, artifactRead]} />);
  const rows = container.querySelectorAll<HTMLElement>(
    ".tool-card-readonly-row",
  );
  const group = container.querySelector<HTMLElement>(
    `[data-tool-id="readonly:${localRead.id}"]`,
  )!;
  const body = group.querySelector<HTMLElement>(".tool-card-body")!;
  Object.defineProperty(body, "offsetHeight", {
    configurable: true,
    value: window.innerHeight,
  });
  await click(rows[0]);
  await click(rows[1]);
  expect(group.dataset.expanded).toBe("true");
  expect(group.dataset.sticky).toBe("true");
  expect(
    group.querySelector(":scope > .tool-card-box > header")?.getAttribute("role"),
  ).toBeNull();
  const focusedTarget = rows[1].querySelector<HTMLElement>("button")!;
  focusedTarget.focus();
  await act(() => {
    focusedTarget.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(rows[0].getAttribute("aria-expanded")).toBe("true");
  expect(rows[1].getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(rows[1]);
  expect(group.dataset.expanded).toBe("true");
  expect(group.dataset.sticky).toBe("true");
  await act(() => {
    rows[0].dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(document.activeElement).toBe(rows[0]);
  expect(group.dataset.expanded).toBe("false");
  expect(group.dataset.sticky).toBe("false");
});

/** 统计忠实展示范围、目录、截断、匹配数量与不存在路径。 */
it("renders native read and search statistics", async () => {
  await render(
    <Example
      tools={[
        artifactRead,
        tool("read", { path: "src" }, { details: { isDirectory: true } }),
        tool(
          "grep",
          { pattern: "needle", path: "src" },
          { details: { matchCount: 7, fileCount: 3 } },
        ),
        tool(
          "glob",
          { pattern: "*.ts" },
          { details: { fileCount: 8, missingPaths: ["missing"] } },
        ),
      ]}
    />,
  );
  expect(container.textContent).toContain("1–240 行 / 共 517 行 · 已截断");
  expect(container.textContent).toContain("目录");
  expect(container.textContent).toContain("7 处 · 3 个文件");
  expect(container.textContent).toContain("8 个文件 · 部分路径不存在");
});

/** 收起时不挂载 Markdown；展开后预览十二行，再独立切换全文。 */
it("mounts native Markdown only after row expansion with a twelve-line preview and full toggle", async () => {
  const previewToolFile = vi.fn();
  const rpc = vi.fn();
  vi.stubGlobal("desktop", { previewToolFile, rpc });
  const text = Array.from(
    { length: 13 },
    (_, index) => `第${index + 1}行`,
  ).join("\n");
  const evidence = tool(
    "read",
    { path: "local://notes.md" },
    {
      details: { totalLines: 13, displayContent: { text, startLine: 1 } },
      text: "model wrapper must not render",
    },
  );
  await render(<Example tools={[evidence]} />);
  const row = () =>
    container.querySelector<HTMLElement>(".tool-card-readonly-row")!;
  expect(container.querySelector(".tool-card-readonly-details")).toBeNull();
  expect(container.querySelector(".rich-content")).toBeNull();
  expect(container.textContent).not.toContain("第1行");
  await click(row());
  expect(row().getAttribute("aria-expanded")).toBe("true");
  expect(
    container.querySelector(".tool-card-readonly-details .rich-content"),
  ).not.toBeNull();
  expect(container.textContent).toContain("第12行");
  expect(container.textContent).toContain("Markdown 渲染 · 前 12 行");
  expect(container.textContent).not.toContain("第13行");
  expect(container.textContent).not.toContain("model wrapper must not render");
  const fullToggle = container.querySelector<HTMLButtonElement>(
    ".tool-card-readonly-details button[aria-expanded]",
  )!;
  await click(fullToggle);
  expect(container.textContent).toContain("第13行");
  await click(fullToggle);
  expect(container.textContent).not.toContain("第13行");
  await click(row());
  expect(container.querySelector(".tool-card-readonly-details")).toBeNull();
  expect(container.querySelector(".rich-content")).toBeNull();
  await click(row());
  expect(container.textContent).toContain("第12行");
  expect(container.textContent).not.toContain("第13行");
  expect(previewToolFile).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});

/** 只读框收起只保留原生目标行，数量紧随左侧标题。 */
it("keeps two collapsed targets compact and places their count beside the title", async () => {
  await render(<Example tools={[localRead, artifactRead]} />);
  expect(container.querySelectorAll(".tool-card-readonly-row")).toHaveLength(2);
  expect(container.querySelector(".tool-card-readonly-details")).toBeNull();
  const header = container.querySelector(".tool-card-header")!;
  expect(header.querySelector(".tool-card-title")?.textContent).toContain(
    "2 项",
  );
  expect(header.querySelector(".tool-card-meta")).toBeNull();
  expect(header.querySelector(".tool-card-duration")).toBeNull();
  expect(header.querySelector(".tool-card-icon")?.textContent).toBe("✓");
  expect(header.querySelector(".tool-card-status")).toBeNull();
});
