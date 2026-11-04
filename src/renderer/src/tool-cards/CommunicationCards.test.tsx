// @vitest-environment jsdom
import { act, useState } from "react";
import { expect, it, vi } from "vitest";
import type { ToolEvidence } from "../transcript-types";
import type { ProcessContext } from "../TranscriptToolRow";
import { container, click, render } from "../transcript-test-harness";
import {
  AgentMessageCard,
  AgentMessageStrip,
  IncomingAgentMessage,
} from "./AgentMessageStrip";
import { AgentOutputCard } from "./AgentOutputCard";
import { TranscriptActions } from "./actions";
import { agentRead, agentSend, hubInbox, ircIncoming, tool } from "./fixtures";

/** 为工具卡提供与实际转录相同的展开状态。 */
function Example({
  evidence,
  output = false,
}: {
  evidence: ToolEvidence;
  output?: boolean;
}) {
  const [expanded, setExpanded] = useState<Record<string, number>>({});
  const context: ProcessContext = {
    sessionId: "communication",
    expanded,
    panelId: (id) => `panel-${id}`,
    toggle: (id) =>
      setExpanded((previous) =>
        previous[id] === undefined ? { [id]: 0 } : {},
      ),
  };
  return output ? (
    <AgentOutputCard tool={evidence} context={context} />
  ) : (
    <AgentMessageCard tool={evidence} context={context} />
  );
}

it("发送使用实际正文、目标和唤醒回执", async () => {
  await render(<Example evidence={agentSend} />);
  expect(
    container
      .querySelector(".agent-message-strip")
      ?.getAttribute("data-direction"),
  ).toBe("out");
  expect(
    container.querySelector("[data-tool-id]")?.getAttribute("data-tool-id"),
  ).toBe(agentSend.id);
  expect(container.textContent).toContain("→ 发给 BaselineRecord");
  expect(container.textContent).toContain("Parent live capture complete.");
  expect(container.querySelector("[data-outcome=woken]")?.textContent).toBe(
    "已唤醒",
  );
});

it("来信使用结构化消息、真实时间并调用既有代理操作", async () => {
  const open = vi.fn();
  await render(
    <TranscriptActions.Provider value={{ onOpenSubagent: open }}>
      <IncomingAgentMessage message={ircIncoming} />
    </TranscriptActions.Provider>,
  );
  expect(container.textContent).toContain("← 来自 LiveData");
  expect(container.querySelector(".agent-message-aside")?.textContent).toMatch(
    /^\d{2}:\d{2}$/,
  );
  expect(container.textContent).not.toContain("Incoming IRC");
  await click(
    container.querySelector<HTMLButtonElement>("button.agent-message-peer")!,
  );
  expect(open).toHaveBeenCalledOnce();
});

it("缺失来信详情时剥离原生信封与说明首行，纯文本不执行 HTML", async () => {
  await render(
    <IncomingAgentMessage
      message={{
        ...ircIncoming,
        details: undefined,
        content:
          "<irc>\nIncoming IRC message from agent `Peer`:\n\n正文 <script>unsafe()</script>\n</irc>",
      }}
    />,
  );
  expect(container.textContent).toContain("正文 <script>unsafe()</script>");
  expect(container.textContent).not.toContain("<irc>");
  expect(container.textContent).not.toContain("Incoming IRC");
  expect(container.querySelector("script")).toBeNull();
});

it("通讯条保留完整换行正文，以展开属性控制三行预览", async () => {
  const text = "一\n二\n三\n四";
  await render(<AgentMessageStrip direction="in" peer="Peer" text={text} />);
  const body = container.querySelector(".agent-message-text")!;
  const button = container.querySelector<HTMLButtonElement>(
    ".agent-message-expand",
  )!;
  expect(body.textContent).toBe(text);
  expect(body.getAttribute("data-expanded")).toBe("false");
  expect(button.type).toBe("button");
  expect(button.getAttribute("aria-controls")).toBe(body.id);
  // 「展开全部」嵌在底部边框里，方向与对方名称在顶部边框的 legend 里。
  expect(button.closest(".agent-message-footer")).not.toBeNull();
  expect(
    container.querySelector(".agent-message-header .agent-message-legend")
      ?.textContent,
  ).toContain("Peer");
  await click(button);
  expect(body.textContent).toBe(text);
  expect(body.getAttribute("data-expanded")).toBe("true");
  expect(button.getAttribute("aria-expanded")).toBe("true");
  await click(button);
  expect(body.getAttribute("data-expanded")).toBe("false");
  expect(body.textContent).toBe(text);
});

it("单段换行预览根据测得高度展开，并在容器与窗口变宽后移除多余展开按钮", async () => {
  const text = "A long single paragraph without any explicit newline. ".repeat(
    20,
  );
  let height = 80;
  const resize = { current: () => {} };
  const disconnect = vi.fn();
  const observe = vi.fn();
  const style = vi.spyOn(window, "getComputedStyle").mockReturnValue({
    lineHeight: "20px",
  } as CSSStyleDeclaration);
  const scrollHeight = vi
    .spyOn(HTMLElement.prototype, "scrollHeight", "get")
    .mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("agent-message-text") ? height : 0;
    });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize.current = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  try {
    await render(<AgentMessageStrip direction="in" peer="Peer" text={text} />);
    const body = container.querySelector(".agent-message-text")!;
    expect(body.textContent).toBe(text);
    expect(body.getAttribute("data-expanded")).toBe("false");
    expect(observe).toHaveBeenCalledWith(body);
    await click(
      container.querySelector<HTMLButtonElement>(".agent-message-expand")!,
    );
    expect(body.getAttribute("data-expanded")).toBe("true");
    expect(body.textContent).toBe(text);
    await click(
      container.querySelector<HTMLButtonElement>(".agent-message-expand")!,
    );
    height = 40;
    await act(() => resize.current());
    expect(container.querySelector(".agent-message-expand")).toBeNull();
    height = 80;
    await act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(container.querySelector(".agent-message-expand")).not.toBeNull();
    await render(<div />);
    expect(disconnect).toHaveBeenCalled();
  } finally {
    style.mockRestore();
    scrollHeight.mockRestore();
    vi.unstubAllGlobals();
  }
});

it("短消息无需展开", async () => {
  await render(<AgentMessageStrip direction="out" peer="Peer" text="短消息" />);
  expect(container.querySelector(".agent-message-expand")).toBeNull();
  expect(container.querySelector(".agent-message-text")?.textContent).toBe(
    "短消息",
  );
});

it("发送支持有回执的 JSON 正文、路径目标回退与受控展开", async () => {
  await render(
    <Example
      evidence={tool(
        "write",
        { path: "agent://Fallback", content: { result: "ok" } },
        { details: { message: { receipts: [{ outcome: "delivered" }] } } },
      )}
    />,
  );
  expect(container.textContent).toContain("→ 发给 Fallback");
  expect(container.textContent).toContain('{"result":"ok"}');
  const evidence = tool(
    "write",
    { path: "agent://Peer", content: "1\n2\n3\nlast-line" },
    {
      details: {
        message: { to: "Peer", receipts: [{ outcome: "delivered" }] },
      },
    },
  );
  await render(<Example evidence={evidence} />);
  expect(container.textContent).toContain("delivered");
  expect(
    container
      .querySelector(".agent-message-text")
      ?.getAttribute("data-expanded"),
  ).toBe("false");
  await click(
    container.querySelector<HTMLButtonElement>(".agent-message-expand")!,
  );
  expect(
    container
      .querySelector(".agent-message-text")
      ?.getAttribute("data-expanded"),
  ).toBe("true");
  expect(container.textContent).toContain("last-line");
});

it.each(["error", "cancelled"] as const)(
  "未成功发送保留 %s 状态和原始错误，不显示成功回执",
  async (status) => {
    const evidence = tool(
      "write",
      { path: "agent://Peer", content: "Do not imply delivery" },
      {
        isError: true,
        text: "Agent send failed: original transport error",
        details: {
          status,
          message: { to: "Peer", receipts: [{ outcome: "delivered" }] },
        },
      },
    );
    await render(<Example evidence={evidence} />);
    expect(container.querySelector(".agent-message-strip")).toBeNull();
    expect(
      container.querySelector(".tool-card")?.getAttribute("data-status"),
    ).toBe(status);
    await click(
      container.querySelector<HTMLElement>('.tool-card-header[role="button"]')!,
    );
    expect(container.textContent).toContain(
      "Agent send failed: original transport error",
    );
    expect(container.querySelector("[data-outcome]")).toBeNull();
  },
);

it.each([
  undefined,
  {},
  { message: { to: "Peer" } },
  { message: { receipts: [{}] } },
])("缺失有效发送详情或回执时回退并保留结果：%j", async (details) => {
  await render(
    <Example
      evidence={tool(
        "write",
        { path: "agent://Peer", content: "Requested send" },
        { details, text: "No delivery receipt available" },
      )}
    />,
  );
  expect(container.querySelector(".agent-message-strip")).toBeNull();
  expect(container.querySelector(".tool-card")).not.toBeNull();
  await click(
    container.querySelector<HTMLElement>('.tool-card-header[role="button"]')!,
  );
  expect(container.textContent).toContain("No delivery receipt available");
});

it("空收件箱与多条来信都保留真实数量", async () => {
  await render(<Example evidence={hubInbox} />);
  expect(container.textContent).toContain("收件箱 · 0 条");
  expect(container.textContent).toContain("收件箱为空");
  await render(
    <Example
      evidence={tool(
        "hub",
        { op: "inbox" },
        {
          details: {
            inbox: [
              { id: "a", from: "Alpha", message: "第一条" },
              { id: "b", from: "Beta", message: "第二条" },
            ],
          },
        },
      )}
    />,
  );
  expect(container.textContent).toContain("收件箱 · 2 条");
  expect(
    container.querySelectorAll('.agent-message-strip[data-direction="in"]'),
  ).toHaveLength(2);
  expect(container.textContent).toContain("第一条");
  expect(container.textContent).toContain("第二条");
});

it("损坏收件箱和缺失代理输出详情回退通用框", async () => {
  await render(
    <Example
      evidence={tool("hub", { op: "inbox" }, { details: { inbox: [{}] } })}
    />,
  );
  expect(container.querySelector(".agent-message-inbox")).toBeNull();
  expect(container.querySelector(".tool-card")).not.toBeNull();
  await render(
    <Example output evidence={tool("read", { path: "agent://Peer" }, {})} />,
  );
  expect(container.textContent).not.toContain("子代理输出");
  expect(container.querySelector(".tool-card")).not.toBeNull();
});

it("子代理输出使用详情的总行数和 Markdown，不把代理路径变为文件", async () => {
  await render(<Example output evidence={agentRead} />);
  expect(container.textContent).toContain("子代理输出");
  expect(container.textContent).toContain("NativeSamples");
  expect(container.textContent).toContain("55 行");
  expect(container.querySelector(".rich-content h2")?.textContent).toBe(
    "Summary",
  );
  expect(container.querySelector('a[href^="agent://"]')).toBeNull();
});

it("子代理输出默认十二行，点击标题展开全部", async () => {
  const text = Array.from(
    { length: 14 },
    (_, index) => `line-${index + 1}`,
  ).join("\n");
  await render(
    <Example
      output
      evidence={tool(
        "read",
        { path: "agent://Peer" },
        { details: { totalLines: 50, displayContent: { text } } },
      )}
    />,
  );
  expect(container.textContent).toContain("line-12");
  expect(container.textContent).not.toContain("line-13");
  await click(
    container.querySelector<HTMLElement>('.tool-card-header[role="button"]')!,
  );
  expect(container.textContent).toContain("line-14");
  expect(container.textContent).toContain("50 行");
});
