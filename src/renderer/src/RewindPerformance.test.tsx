import { act } from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import ReactMarkdown from "react-markdown";
import type { SessionEntry } from "../../shared/protocol";
import { RewindTranscript } from "./RewindTranscript";
import { useRewind } from "./useRewind";
import { transcriptUnits } from "./transcript-model";
import { container, render } from "./transcript-test-harness";

vi.mock("./transcript-model", { spy: true });
vi.mock("react-markdown", { spy: true });

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
  vi.clearAllMocks();
  if (originalScroll)
    Object.defineProperty(Element.prototype, "scrollIntoView", originalScroll);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

/** 构造足以暴露全量重绘的稳定历史，正文包含真实 Markdown。 */
function history(size: number): SessionEntry[] {
  return Array.from({ length: size }, (_, index) => ({
    id: `m${index}`,
    parentId: index ? `m${index - 1}` : null,
    type: "message",
    timestamp: "2026-10-17T00:00:00Z",
    message: {
      role: index % 2 ? "assistant" : "user",
      content: `消息 ${index}\n\n**正文**\n\n- 项目一\n- 项目二`,
    },
  }));
}

function Consumer({
  entries,
  leafId,
}: {
  entries: SessionEntry[];
  leafId: string;
}) {
  const rewind = useRewind({
    enabled: true,
    entries,
    leafId,
    onNavigate: () => {},
    onCancel: () => {},
  });
  return <RewindTranscript rewind={rewind} sessionId="performance" />;
}

async function key(value: string) {
  await act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: value, bubbles: true, repeat: true }),
    );
  });
}

it("连续上下按键逐次更新选中项且不重建未变化的正文模型", async () => {
  const entries = history(200);
  await render(<Consumer entries={entries} leafId="m199" />);
  vi.clearAllMocks();
  for (let index = 198; index >= 188; index--) {
    await key("ArrowUp");
    expect(
      container.querySelector(".rewind-target")?.getAttribute("data-rewind-id"),
    ).toBe(`m${index}`);
  }
  for (let index = 189; index <= 199; index++) {
    await key("ArrowDown");
    expect(
      container.querySelector(".rewind-target")?.getAttribute("data-rewind-id"),
    ).toBe(`m${index}`);
  }
  expect(transcriptUnits).not.toHaveBeenCalled();
  expect(ReactMarkdown).not.toHaveBeenCalled();
  expect(Element.prototype.scrollIntoView).toHaveBeenLastCalledWith({
    behavior: "instant",
    block: "nearest",
    inline: "nearest",
  });
});

it("切换多个分岔位置时保留整条主路径 DOM 与正文缓存", async () => {
  const entries = history(100);
  entries.push({
    ...entries[98],
    id: "fork98",
    message: { role: "user", content: "旁支 98" },
  });
  entries.push({
    ...entries[96],
    id: "fork96",
    message: { role: "user", content: "旁支 96" },
  });
  await render(<Consumer entries={entries} leafId="m99" />);
  const nodes = [...container.querySelectorAll(".rewind-message")];
  vi.clearAllMocks();
  for (const direction of [
    "ArrowUp",
    "ArrowUp",
    "ArrowUp",
    "ArrowDown",
    "ArrowDown",
    "ArrowDown",
  ]) {
    await key(direction);
    for (const node of nodes)
      expect(
        container.querySelector(
          `[data-rewind-id="${node.getAttribute("data-rewind-id")}"]`,
        ),
      ).toBe(node);
  }
  expect(
    vi
      .mocked(ReactMarkdown)
      .mock.calls.every(([props]) => String(props.children).startsWith("旁支")),
  ).toBe(true);
  expect(container.querySelectorAll(".rewind-branch-column")).toHaveLength(0);
});
