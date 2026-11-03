// @vitest-environment jsdom
import { useState, type ComponentType } from "react";
import { expect, it } from "vitest";
import type { ToolEvidence } from "../transcript-types";
import type { ProcessContext } from "../TranscriptToolRow";
import { container, click, render } from "../transcript-test-harness";
import { hubInvalid, mcpWrite, yieldResult, tool } from "./fixtures";
import { McpCard } from "./McpCard";
import { InvalidCard } from "./InvalidCard";
import { YieldCard } from "./YieldCard";

type Card = ComponentType<{ tool: ToolEvidence; context: ProcessContext }>;

/** 用真实受控过程上下文验证卡片展开交互。 */
function Example({ Card, evidence }: { Card: Card; evidence: ToolEvidence }) {
  const [expanded, setExpanded] = useState<Record<string, number>>({});
  const context: ProcessContext = {
    sessionId: "metadata",
    expanded,
    /** 按工具标识切换展开状态。 */
    toggle(id, index) {
      setExpanded((current) => {
        const next = { ...current };
        if (next[id] !== undefined) delete next[id];
        else next[id] = index;
        return next;
      });
    },
    /** 为展开区域生成确定性标识。 */
    panelId: (id) => `metadata-${id}`,
  };
  return <Card tool={evidence} context={context} />;
}

/** 真实 MCP 样本保持紧凑摘要，参数和结果仅在展开时出现。 */
it("MCP 使用原生身份、参数与结果字符数并可展开收起", async () => {
  await render(<Example Card={McpCard} evidence={mcpWrite} />);
  expect(container.textContent).toContain("调用 MCP");
  expect(container.textContent).toContain("serena/initial_instructions");
  expect(container.textContent).toContain("参数 {}");
  const result = "<serena>\nYou have semantic coding tools…";
  expect(container.textContent).toContain(`结果 ${result.length} 字符`);
  expect(container.querySelector("pre")).toBeNull();
  expect(
    container.querySelector(".tool-card")?.getAttribute("data-variant"),
  ).toBe("tool");
  const header = container.querySelector<HTMLElement>(
    '[role="button"][aria-expanded]',
  )!;
  await click(header);
  expect(header.getAttribute("aria-expanded")).toBe("true");
  expect(container.querySelector('[aria-label="MCP 参数"]')?.textContent).toBe(
    "{}",
  );
  expect(container.querySelector('[aria-label="MCP 结果"]')?.textContent).toBe(
    result,
  );
  expect(container.querySelector("a")).toBeNull();
  await click(container.querySelector<HTMLButtonElement>(".tool-card-expand")!);
  expect(container.querySelector("pre")).toBeNull();
});

/** 不完整或错误类型的 MCP 元数据必须回退，不从 xd 地址伪造身份或文件链接。 */
it.each([
  undefined,
  { xdev: "bad" },
  { xdev: { inner: {} } },
  { xdev: { args: {}, inner: { serverName: "serena", mcpToolName: 1 } } },
  { xdev: { args: [], inner: { serverName: "serena", mcpToolName: "tool" } } },
])("MCP 缺少可信结构时使用通用框 %#", async (details) => {
  const evidence = tool(
    "write",
    { path: "xd://mcp__serena_initial_instructions", content: "{}" },
    { details },
  );
  await render(<Example Card={McpCard} evidence={evidence} />);
  expect(container.textContent).not.toContain("调用 MCP");
  expect(container.querySelector(".tool-card-mcp-summary")).toBeNull();
  expect(container.querySelector("a")).toBeNull();
});

/** MCP 失败不能被成功摘要覆盖，错误结果需逐字保留。 */
it("MCP 失败显示原始错误结果和错误状态", async () => {
  const error = "ToolError: permission denied\n  original detail";
  const evidence = tool(
    "write",
    { path: "xd://mcp__server_tool", content: "{}" },
    {
      details: {
        xdev: {
          args: { query: "x" },
          inner: { serverName: "server", mcpToolName: "tool", isError: true },
        },
      },
      text: error,
      isError: true,
    },
  );
  await render(<Example Card={McpCard} evidence={evidence} />);
  expect(
    container.querySelector(".tool-card")?.getAttribute("data-status"),
  ).toBe("error");
  await click(container.querySelector<HTMLElement>(".tool-card-header")!);
  expect(container.querySelector('[aria-label="MCP 结果"]')?.textContent).toBe(
    error,
  );
  expect(container.querySelector('[aria-label="MCP 参数"]')?.textContent).toBe(
    JSON.stringify({ query: "x" }, null, 2),
  );
});

/** 原生 hub 参数校验样本显示完整两行且不添加重复状态标题。 */
it("参数无效保留真实校验错误和危险色调", async () => {
  await render(<Example Card={InvalidCard} evidence={hubInvalid} />);
  expect(container.textContent).toContain("✗ 参数无效 · hub");
  expect(container.querySelector(".tool-card-invalid-error")?.textContent).toBe(
    'Validation failed for tool "hub":\n  - op: op must be hub operation (was missing)',
  );
  expect(container.querySelector(".tool-card")?.getAttribute("data-tone")).toBe(
    "danger",
  );
  expect(
    container.querySelector(".tool-card")?.getAttribute("data-status"),
  ).toBe("error");
  expect(container.querySelector(".tool-card-expand")).toBeNull();
});

/** 错误正文不裁剪缩进、空行或 CRLF，仅默认限制为前两行。 */
it("参数错误只预览前两行且展开完整原文", async () => {
  const error =
    "Validation failed:\r\n  - op: missing\r\n\r\n  exact final detail";
  const evidence = tool(
    "hub",
    {},
    { details: { error }, text: error, isError: true },
  );
  await render(<Example Card={InvalidCard} evidence={evidence} />);
  expect(container.querySelector("pre")?.textContent).toBe(
    error.split("\n").slice(0, 2).join("\n"),
  );
  await click(
    container.querySelector<HTMLElement>('[role="button"][aria-expanded]')!,
  );
  expect(container.querySelector("pre")?.textContent).toBe(error);
  await click(container.querySelector<HTMLButtonElement>(".tool-card-expand")!);
  expect(container.querySelector("pre")?.textContent).not.toContain(
    "exact final detail",
  );
});

/** 缺少结构化错误时由通用框保留结果，而非伪造校验错误。 */
it.each([undefined, { error: 7 }, { error: "" }])(
  "无效参数框缺少原始错误时回退 %#",
  async (details) => {
    const evidence = tool(
      "hub",
      {},
      { details, text: "original failure", isError: true },
    );
    await render(<Example Card={InvalidCard} evidence={evidence} />);
    expect(container.textContent).not.toContain("参数无效");
    await click(container.querySelector<HTMLElement>(".tool-card-header")!);
    expect(container.textContent).toContain("original failure");
  },
);

/** 提交样本默认仅展示键名，展开完整数据且可收起。 */
it("提交结果列出数据键并展开 JSON", async () => {
  await render(<Example Card={YieldCard} evidence={yieldResult} />);
  expect(container.textContent).toContain("提交结果");
  expect(
    container.querySelector(".tool-card-yield-keys code")?.textContent,
  ).toBe("files · implementation");
  expect(container.querySelector("pre")).toBeNull();
  await click(container.querySelector<HTMLButtonElement>(".tool-card-expand")!);
  expect(container.querySelector('[aria-label="提交数据"]')?.textContent).toBe(
    JSON.stringify({ files: ["smoke/main.cpp"], implementation: "…" }, null, 2),
  );
  await click(container.querySelector<HTMLElement>(".tool-card-header")!);
  expect(container.querySelector("pre")).toBeNull();
});

/** 空对象是合法提交；缺失、数组或标量数据不能冒充键列表。 */
it("提交结果允许空对象并保留失败状态", async () => {
  const evidence = tool("yield", {}, { details: { data: {} }, isError: true });
  await render(<Example Card={YieldCard} evidence={evidence} />);
  expect(container.textContent).toContain("提交结果");
  expect(
    container.querySelector(".tool-card")?.getAttribute("data-status"),
  ).toBe("error");
  await click(container.querySelector<HTMLElement>(".tool-card-header")!);
  expect(container.querySelector("pre")?.textContent).toBe("{}");
});

/** 不完整提交数据应回退通用结果，不吞掉原生失败文本。 */
it.each([undefined, { data: null }, { data: [] }, { data: "bad" }])(
  "提交结果缺失数据时使用通用框 %#",
  async (details) => {
    const evidence = tool(
      "yield",
      {},
      { details, text: "submission failed", isError: true },
    );
    await render(<Example Card={YieldCard} evidence={evidence} />);
    expect(container.textContent).not.toContain("提交结果");
    await click(container.querySelector<HTMLElement>(".tool-card-header")!);
    expect(container.textContent).toContain("submission failed");
  },
);
