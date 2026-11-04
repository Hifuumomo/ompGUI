// @vitest-environment jsdom
import { useState, type ComponentType } from "react";
import { expect, it, vi } from "vitest";
import { container, click, render } from "../transcript-test-harness";
import type { ToolEvidence } from "../transcript-types";
import type { ProcessContext } from "../TranscriptToolRow";
import { WebLinks } from "../WebLinks";
import { EvalCard } from "./EvalCard";
import { AskCard } from "./AskCard";
import { SearchCard } from "./SearchCard";
import { evalCells, askAnswered, webSearch, tool } from "./fixtures";

type Card = ComponentType<{ tool: ToolEvidence; context: ProcessContext }>;

/** 为专用框提供与真实过程相同的受控展开状态。 */
function Example({ Card, evidence }: { Card: Card; evidence: ToolEvidence }) {
  const [expanded, setExpanded] = useState<Record<string, number>>({});
  const context: ProcessContext = {
    sessionId: "interactive",
    expanded,
    toggle: (id, index) =>
      setExpanded((previous) => {
        const next = { ...previous };
        if (next[id] !== undefined) delete next[id];
        else next[id] = index;
        return next;
      }),
    panelId: (id) => `panel-${id}`,
  };
  return <Card tool={evidence} context={context} />;
}

/** 真实 eval 样本只默认展开错误 cell，标题行可分别展开代码与输出。 */
it("展示真实 eval cell 并默认展开失败项", async () => {
  await render(<Example Card={EvalCard} evidence={evalCells} />);
  expect(container.textContent).toContain("运行 JS");
  expect(container.textContent).toContain("3 个 cell");
  const rows = container.querySelectorAll<HTMLButtonElement>(
    ".tool-card-cell-toggle",
  );
  expect([...rows].map((row) => row.getAttribute("aria-expanded"))).toEqual([
    "false",
    "false",
    "true",
  ]);
  expect(container.textContent).toContain("tab killed");
  expect(container.textContent).not.toContain("var fs");
  await click(rows[0]);
  expect(container.textContent).toContain("var fs");
  expect(container.textContent).toContain("ok");
  await click(rows[2]);
  expect(container.textContent).not.toContain("tab killed");
});

/** 保存帧中的 status:error 和非零退出码都必须展开，不能只依赖 isError。 */
it("识别原生 Python cell 状态与退出码", async () => {
  const evidence = tool(
    "eval",
    { language: "py" },
    {
      details: {
        language: "py",
        cells: [
          {
            index: 0,
            title: "Status failure",
            code: "raise RuntimeError()",
            output: "native status error",
            status: "error",
          },
          {
            index: 1,
            title: "Exit failure",
            code: "exit(1)",
            output: "native exit error",
            exitCode: 1,
          },
          {
            index: 2,
            title: "Explicit failure",
            output: "explicit error",
            isError: true,
          },
        ],
      },
    },
  );
  await render(<Example Card={EvalCard} evidence={evidence} />);
  expect(container.textContent).toContain("运行 Python");
  expect(
    container.querySelectorAll('.tool-card-cell[data-status="error"]'),
  ).toHaveLength(3);
  expect(
    container.querySelectorAll('.tool-card-cell-toggle[aria-expanded="true"]'),
  ).toHaveLength(3);
  expect(container.textContent).toContain("native status error");
  expect(container.textContent).toContain("native exit error");
});

/** 成功 cell 默认折叠，整个框展开时展示全部 cell。 */
it("整框展开成功 cell 并展示各 cell 耗时", async () => {
  const evidence = tool(
    "eval",
    {},
    {
      details: {
        language: "js",
        wallTimeMs: 2000,
        cells: [
          {
            title: "Done",
            code: "print(1)",
            output: "cell output",
            durationMs: 1000,
          },
        ],
      },
    },
  );
  await render(<Example Card={EvalCard} evidence={evidence} />);
  expect(container.textContent).not.toContain("cell output");
  expect(container.textContent).toContain("1秒");
  await click(
    container.querySelector<HTMLElement>('.tool-card-header[role="button"]')!,
  );
  expect(container.textContent).toContain("cell output");
});

/** 只有出错 cell 展开时，输出放在 Output 区，标签带 cell 序号并为红色。 */
it("eval 出错 cell 的输出显示在 Output · cell 3 下", async () => {
  await render(<Example Card={EvalCard} evidence={evalCells} />);
  expect(container.querySelector(".tool-card-divider")?.textContent).toBe(
    "Output · cell 3",
  );
  const result = container.querySelector(".tool-card-result")!;
  expect(result.textContent).toContain("tab killed");
  expect(result.querySelector(".tool-card-danger-text")).not.toBeNull();
  expect(container.querySelector(".tool-card-input")?.textContent).not.toContain(
    "tab killed",
  );
  expect(container.querySelector(".tool-card-footer")?.textContent).toBe(
    "3 个 cell",
  );
});

/** 两个 cell 展开时，每段输出前有 cell N 标签，分隔线只写 Output。 */
it("eval 两个 cell 展开时 Output 区有两段 cell 标签", async () => {
  await render(<Example Card={EvalCard} evidence={evalCells} />);
  await click(
    container.querySelectorAll<HTMLButtonElement>(".tool-card-cell-toggle")[0],
  );
  expect(container.querySelector(".tool-card-divider")?.textContent).toBe(
    "Output",
  );
  const labels = [
    ...container.querySelectorAll(".tool-card-result .tool-card-code-label"),
  ].map((node) => node.textContent?.trim());
  expect(labels).toEqual(["cell 1", "cell 3"]);
});

/** Status 树按 statusEvents 逐行列出，最后一行用 └─，错误事件取 error 文字。 */
it("eval 的 Status 树最后一行使用 └─", async () => {
  const evidence = tool(
    "eval",
    { language: "js" },
    {
      details: {
        language: "js",
        cells: [{ title: "Open", output: "x", isError: true }],
        statusEvents: [
          { op: "browser", detail: "open ld https://linux.do/login" },
          { op: "browser", detail: "ld.title()" },
          { op: "browser", error: "Browser selector must be a string" },
        ],
      },
    },
  );
  await render(<Example Card={EvalCard} evidence={evidence} />);
  const rows = [
    ...container.querySelectorAll(".tool-card-status-tree > div"),
  ].map((node) => node.textContent);
  expect(rows).toEqual([
    "Status",
    "├─ open ld https://linux.do/login",
    "├─ ld.title()",
    "└─ Browser selector must be a string",
  ]);
});

/** 真实回答为字符串数组，展示为只读选中条而不是提问表单。 */
it("展示真实已回答单选", async () => {
  await render(<Example Card={AskCard} evidence={askAnswered} />);
  expect(container.textContent).toContain("两个数值使用哪种含义？");
  expect(container.textContent).toContain("单选");
  expect(
    container.querySelectorAll('.tool-card-option[data-selected="true"]'),
  ).toHaveLength(1);
  expect(
    container.querySelector('.tool-card-option[data-selected="true"]')
      ?.textContent,
  ).toContain("实际距离、像素距离");
  expect(container.querySelector("input,select,form")).toBeNull();
});

/** 安全结构化选项用明确标签显示，多选和自定义回答均保留。 */
it("展示多选、结构化标签与自定义输入", async () => {
  const evidence = tool(
    "ask",
    {},
    {
      details: {
        question: "Choose",
        options: [
          { label: "Alpha", value: "a" },
          { label: "Beta", id: "b" },
          "Gamma",
        ],
        selectedOptions: ["a", { label: "Beta", id: "b" }],
        multi: true,
        customInput: "Other answer",
      },
    },
  );
  await render(<Example Card={AskCard} evidence={evidence} />);
  expect(container.textContent).toContain("多选");
  expect(container.textContent).toContain("Other answer");
  expect(
    container.querySelectorAll('.tool-card-option[data-selected="true"]'),
  ).toHaveLength(3);
  expect(container.textContent).not.toContain("[object Object]");
});

/** 搜索来源遵守 WebLinks 导航上下文，不向系统浏览器旁路。 */
it("真实搜索来源通过安全网页入口打开", async () => {
  const open = vi.fn().mockResolvedValue("opened");
  await render(
    <WebLinks.Provider value={open}>
      <Example Card={SearchCard} evidence={webSearch} />
    </WebLinks.Provider>,
  );
  expect(container.textContent).toContain("omp changelog");
  expect(container.textContent).toContain("2 个来源");
  await click(
    container.querySelector<HTMLAnchorElement>(".tool-card-source a")!,
  );
  expect(open).toHaveBeenCalledWith("https://example.com/changelog");
});

/** 默认三条来源，用户展开后保留全部摘要；非网页地址绝不授权文件入口。 */
it("截断三条来源、单行摘要并阻止危险或文件链接", async () => {
  const open = vi.fn().mockResolvedValue("opened");
  const evidence = tool(
    "web_search",
    { query: "sources" },
    {
      details: {
        response: {
          sources: [
            {
              title: "One",
              url: "https://example.com/1",
              snippet: "first\nsecond\tthird",
            },
            { title: "Script", url: "javascript:alert(1)", snippet: "unsafe" },
            {
              title: "Virtual",
              url: "local://notes.md",
              snippet: "not a webpage",
            },
            { title: "Four", url: "https://example.com/4", snippet: "fourth" },
          ],
        },
      },
    },
  );
  await render(
    <WebLinks.Provider value={open}>
      <Example Card={SearchCard} evidence={evidence} />
    </WebLinks.Provider>,
  );
  expect(container.querySelectorAll(".tool-card-source")).toHaveLength(3);
  expect(
    container.querySelector(".tool-card-source-snippet")?.textContent,
  ).toBe("first second third");
  expect(container.querySelectorAll(".tool-card-source a")).toHaveLength(1);
  await click(container.querySelector<HTMLButtonElement>(".tool-card-more")!);
  expect(container.querySelectorAll(".tool-card-source")).toHaveLength(4);
  expect(container.textContent).toContain("fourth");
  await click(container.querySelector<HTMLButtonElement>(".tool-card-more")!);
  expect(container.querySelectorAll(".tool-card-source")).toHaveLength(3);
  expect(open).not.toHaveBeenCalled();
});

/** 缺失及错误类型的详情必须交给通用框，不能画出虚假的专用内容。 */
it("缺失或无效结构回退通用框", async () => {
  const samples: [Card, ToolEvidence][] = [
    [EvalCard, tool("eval", {}, { text: "raw eval" })],
    [
      EvalCard,
      tool(
        "eval",
        {},
        { details: { language: "js", cells: [{ title: "Bad", output: {} }] } },
      ),
    ],
    [AskCard, tool("ask", {}, { text: "raw ask" })],
    [
      AskCard,
      tool(
        "ask",
        {},
        { details: { question: "Bad", options: [{}], selectedOptions: [] } },
      ),
    ],
    [SearchCard, tool("web_search", { query: "q" }, { text: "raw search" })],
    [
      SearchCard,
      tool(
        "web_search",
        { query: "q" },
        { details: { response: { sources: [{ title: "Bad", url: 4 }] } } },
      ),
    ],
  ];
  for (const [Card, evidence] of samples) {
    await render(<Example Card={Card} evidence={evidence} />);
    expect(
      container.querySelector(
        ".tool-card-cell,.tool-card-question,.tool-card-source",
      ),
    ).toBeNull();
    expect(
      container.querySelector(
        '.tool-card-header[role="button"][aria-expanded]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(".tool-card")?.getAttribute("data-tool-id"),
    ).toBe(evidence.id);
  }
});
