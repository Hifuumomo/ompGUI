import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SessionEntry } from "../../shared/protocol";
import { render, container } from "./transcript-test-harness";
import { RewindTranscript } from "./RewindTranscript";
import { RewindToolbar } from "./RewindToolbar";
import { useRewind } from "./useRewind";

const entries: SessionEntry[] = [
  {
    type: "message",
    id: "u",
    parentId: null,
    timestamp: "2026-10-15",
    message: { role: "user", content: "原始问题" },
  },
  {
    type: "message",
    id: "tool",
    parentId: "u",
    timestamp: "2026-10-15",
    message: {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "read",
          name: "read",
          arguments: { path: "file.txt" },
        },
      ],
    },
  },
  {
    type: "message",
    id: "result",
    parentId: "tool",
    timestamp: "2026-10-15",
    message: {
      role: "toolResult",
      toolCallId: "read",
      toolName: "read",
      content: "测试正文",
    },
  },
  {
    type: "message",
    id: "answer",
    parentId: "result",
    timestamp: "2026-10-15",
    message: { role: "assistant", content: "最终答复" },
  },
  {
    type: "message",
    id: "alternative",
    parentId: "u",
    timestamp: "2026-10-15",
    message: { role: "user", content: "替代请求" },
  },
  {
    type: "message",
    id: "alternative-answer",
    parentId: "alternative",
    timestamp: "2026-10-15",
    message: { role: "assistant", content: "分支答复" },
  },
];

const originalScroll = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollIntoView",
);
beforeEach(() =>
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  }),
);
afterEach(() => {
  vi.restoreAllMocks();
  if (originalScroll)
    Object.defineProperty(Element.prototype, "scrollIntoView", originalScroll);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

function Consumer({
  navigate,
  history = entries,
}: {
  navigate: (entry: SessionEntry) => void;
  history?: SessionEntry[];
}) {
  const rewind = useRewind({
    enabled: true,
    entries: history,
    leafId: "answer",
    onNavigate: navigate,
    onCancel: vi.fn(),
  });
  return (
    <>
      <RewindTranscript rewind={rewind} sessionId="session" />
      <RewindToolbar rewind={rewind} />
    </>
  );
}

async function key(value: string) {
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: value, bubbles: true }),
    ),
  );
}

it("回退正文滚轮上下移动目标，连续滚动节流且不触发导航", async () => {
  const navigate = vi.fn();
  const now = vi.spyOn(Date, "now").mockReturnValue(1000);
  await render(<Consumer navigate={navigate} />);
  const selected = () =>
    container.querySelector(".rewind-target")?.getAttribute("data-rewind-id");
  async function wheel(deltaY: number, ctrlKey = false) {
    const event = new WheelEvent("wheel", {
      deltaY,
      ctrlKey,
      bubbles: true,
      cancelable: true,
    });
    await act(async () =>
      container.querySelector(".rewind-transcript")!.dispatchEvent(event),
    );
    return event;
  }
  expect((await wheel(-100)).defaultPrevented).toBe(true);
  expect(selected()).toBe("tool");
  await wheel(-100);
  expect(selected()).toBe("tool");
  now.mockReturnValue(1200);
  expect((await wheel(100, true)).defaultPrevented).toBe(false);
  expect(selected()).toBe("tool");
  await wheel(100);
  expect(selected()).toBe("answer");
  expect(navigate).not.toHaveBeenCalled();
});

it("工具详情的独立滚动不移动回退框", async () => {
  await render(<Consumer navigate={vi.fn()} />);
  const region = container.querySelector<HTMLElement>(".process-evidence")!;
  region.style.overflowY = "auto";
  Object.defineProperty(region, "scrollHeight", { value: 400 });
  Object.defineProperty(region, "clientHeight", { value: 200 });
  const event = new WheelEvent("wheel", {
    deltaY: -100,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => region.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(false);
  expect(
    container.querySelector(".rewind-target")?.getAttribute("data-rewind-id"),
  ).toBe("answer");
});

it("回退直接展示工具操作，手动折叠仍保留原有写入标题", async () => {
  const history = entries.slice(0, 4).map((entry) =>
    entry.id === "tool"
      ? {
          ...entry,
          message: {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "准备写入两个文件" },
              ...["a.txt", "b.txt"].map((path) => ({
                type: "toolCall",
                id: path,
                name: "write",
                arguments: { path, content: "正文" },
              })),
            ],
          },
        }
      : entry.id === "result"
        ? {
            ...entry,
            message: {
              role: "toolResult",
              toolCallId: "a.txt",
              toolName: "write",
              content: "写入完成",
            },
          }
        : entry,
  );
  await render(<Consumer navigate={vi.fn()} history={history} />);
  expect(container.querySelector(".process-group")).toBeNull();
  expect(container.textContent).toContain("准备写入两个文件");
  const group =
    container.querySelector<HTMLDetailsElement>(".tool-type-group")!;
  const summary = group.querySelector("summary")!;
  expect(summary.textContent).toContain("写入了多个对象");
  await act(async () => summary.click());
  expect(group.open).toBe(true);
  expect(group.querySelectorAll(".tool-row")).toHaveLength(2);
  await key("ArrowDown");
  expect(group.open).toBe(true);
  await act(async () => summary.click());
  expect(group.open).toBe(false);
  expect(summary.textContent).toContain("写入了多个对象");
  expect(container.textContent).not.toContain("折叠过程");
});

it("虚线框随键盘移动、后续消息暗化，工具结果包含在调用回退点", async () => {
  const navigate = vi.fn();
  await render(<Consumer navigate={navigate} />);
  expect(container.querySelector(".process-group")).toBeNull();
  expect(
    container.querySelector('[data-tool-id="read"] summary')?.textContent,
  ).toContain("读取");
  expect(
    container.querySelector(".rewind-target")?.getAttribute("data-rewind-id"),
  ).toBe("answer");
  await key("ArrowUp");
  expect(
    container.querySelector(".rewind-target")?.getAttribute("data-rewind-id"),
  ).toBe("tool");
  expect(container.querySelector('[data-rewind-id="result"]')).toBeNull();
  expect(
    container.querySelector('.rewind-dropped[data-rewind-id="answer"]'),
  ).not.toBeNull();
  expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
  await key("Enter");
  expect(navigate).toHaveBeenCalledExactlyOnceWith(entries[2]);
});

it("分岔列并排显示，点击其他分支消息切换虚线框并保持同文件导航", async () => {
  const navigate = vi.fn();
  await render(<Consumer navigate={navigate} />);
  await key("ArrowUp");
  expect(container.querySelectorAll(".rewind-branch-column")).toHaveLength(2);
  expect(container.querySelector(".process-group")).toBeNull();
  await act(async () =>
    container
      .querySelector<HTMLElement>('[data-rewind-id="alternative-answer"]')!
      .click(),
  );
  expect(
    container.querySelector(".rewind-target")?.getAttribute("data-rewind-id"),
  ).toBe("alternative-answer");
  await key("Enter");
  expect(navigate).toHaveBeenCalledExactlyOnceWith(entries[5]);
});

it("经过分岔点保留主路径工具的手动展开状态", async () => {
  await render(<Consumer navigate={vi.fn()} />);
  const tool = container.querySelector<HTMLDetailsElement>(
    '[data-tool-id="read"]',
  )!;
  await act(() => tool.querySelector("summary")!.click());
  expect(tool.open).toBe(true);
  for (const direction of [
    "ArrowUp",
    "ArrowDown",
    "ArrowUp",
    "ArrowRight",
    "ArrowLeft",
  ]) {
    await key(direction);
    expect(container.querySelector('[data-tool-id="read"]')).toBe(tool);
    expect(tool.open).toBe(true);
  }
});

it("过滤只显示命中的主路径消息，退出过滤恢复全文", async () => {
  await render(<Consumer navigate={vi.fn()} />);
  await key("f");
  await act(async () => {
    const input = container.querySelector("input")!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "原始问题");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.querySelectorAll(".rewind-message")).toHaveLength(1);
  expect(
    container.querySelector(".rewind-target")?.getAttribute("data-rewind-id"),
  ).toBe("u");
  await key("Escape");
  expect(container.querySelectorAll(".rewind-message")).toHaveLength(3);
  expect(
    container.querySelector(".rewind-target")?.getAttribute("data-rewind-id"),
  ).toBe("u");
});
