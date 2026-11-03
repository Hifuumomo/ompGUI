// @vitest-environment jsdom
import { act, useState } from "react";
import { expect, it } from "vitest";
import type { ToolEvidence } from "../transcript-types";
import type { ProcessContext } from "../TranscriptToolRow";
import { container, click, image, render } from "../transcript-test-harness";
import { ToolCard } from "./ToolCard";
import { CardItems } from "./CardItems";
import { cardKind } from "../tool-card-model";
import { ProcessFold } from "../ProcessFold";
import {
  editOk,
  editDelete,
  localWrite,
  bashOk,
  evalCells,
  waitJobs,
  taskProgress,
  askAnswered,
  webSearch,
  hubStart,
  agentSend,
  hubInbox,
  agentRead,
  mcpWrite,
  yieldResult,
  hubInvalid,
  localRead,
  artifactRead,
  tool,
} from "./fixtures";

/** 创建固定展开状态的过程上下文。参数：[in] evidence 工具证据，[in] expanded 展开状态。返回值：受控上下文。 */
function context(evidence: ToolEvidence, expanded = false): ProcessContext {
  return {
    sessionId: "card-integration",
    expanded: expanded ? { [evidence.id]: 0 } : {},
    /** 集成图片用例不触发展开切换。 */
    toggle() {},
    /** 生成详情面板标识。参数：[in] id 工具标识。返回值：面板标识。 */
    panelId: (id) => `integration-${id}`,
  };
}

/** 所有专用分发路径均把重复原生图片合并并放在正文末尾。 */
it.each([
  editOk,
  editDelete,
  localWrite,
  bashOk,
  evalCells,
  waitJobs,
  taskProgress,
  askAnswered,
  webSearch,
  hubStart,
  agentSend,
  hubInbox,
  agentRead,
  mcpWrite,
  yieldResult,
  hubInvalid,
  localRead,
  tool("unknown", {}, { text: "原生输出" }),
])("每个工具种类的图片仅出现一次 $name $id", async (original) => {
  const evidence: ToolEvidence = {
    ...original,
    resultMessage: {
      ...original.resultMessage!,
      content: [
        ...(Array.isArray(original.resultMessage?.content)
          ? original.resultMessage.content
          : []),
        image,
      ],
      images: [image],
    },
  };
  for (const expanded of [false, true]) {
    await render(
      <ToolCard tool={evidence} context={context(evidence, expanded)} />,
    );
    expect(container.querySelectorAll(".tool-card-images img")).toHaveLength(1);
    expect(
      container.querySelectorAll('button[aria-label="放大图片：工具输出图片"]'),
    ).toHaveLength(1);
    expect(
      container.querySelector(`[data-tool-id="${evidence.id}"]`),
    ).not.toBeNull();
    const images = container.querySelector(".tool-card-images")!;
    expect(images.nextElementSibling).toBeNull();
    if (!["message-in", "message-out"].includes(cardKind(evidence))) {
      expect(
        container.querySelector(`[data-kind="${cardKind(evidence)}"]`),
      ).not.toBeNull();
    }
  }
});

/** 相邻只读操作保留为同一个外框，而不是多个工具框。 */
it("相邻只读工具只渲染一个可访问的只读框", async () => {
  await render(
    <CardItems
      items={[
        { kind: "tool", key: localRead.id, tool: localRead },
        { kind: "tool", key: artifactRead.id, tool: artifactRead },
      ]}
      context={context(localRead)}
    />,
  );
  expect(
    container.querySelectorAll('.tool-card[data-kind="readonly"]'),
  ).toHaveLength(1);
  expect(
    container.querySelectorAll(
      '.tool-card-readonly-row[role="button"][aria-expanded]',
    ),
  ).toHaveLength(2);
});

/** 原生行和通用回退各自拥有图片，不在组框重复渲染。 */
it.each([
  localRead,
  tool("grep", { pattern: "needle", path: "src" }, { text: "fallback result" }),
  tool("read", {}, { text: "missing target fallback" }),
])("只读原生与回退图片在收起和展开时都只出现一次 $id", async (original) => {
  const evidence: ToolEvidence = {
    ...original,
    resultMessage: {
      ...original.resultMessage!,
      content: [image],
      images: [image],
    },
  };
  for (const expanded of [false, true]) {
    await render(
      <CardItems
        items={[{ kind: "tool", key: evidence.id, tool: evidence }]}
        context={context(evidence, expanded)}
      />,
    );
    expect(container.querySelectorAll(".tool-card-images img")).toHaveLength(1);
    const thumbnails = container.querySelector(".tool-card-images")!;
    expect(thumbnails.nextElementSibling).toBeNull();
  }
});

/** 真实工具框和过程折叠共享受控状态，供图片预览的键盘回归使用。 */
function FoldedImageTool({ evidence }: { evidence: ToolEvidence }) {
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, number>>({});
  return (
    <ProcessFold
      collapsed={collapsed}
      onToggle={() => setCollapsed(!collapsed)}
      failures={0}
    >
      <ToolCard
        tool={evidence}
        context={{
          ...context(evidence),
          expanded,
          toggle: (id, index) =>
            setExpanded((previous) =>
              previous[id] === undefined ? { [id]: index } : {},
            ),
        }}
      />
    </ProcessFold>
  );
}

/** 图片预览不修改工具展开、过程折叠或原生图片来源。 */
it("enlarges one safe image in a portal and Escape restores its trigger only", async () => {
  const evidence: ToolEvidence = {
    ...bashOk,
    resultMessage: {
      ...bashOk.resultMessage!,
      content: [image],
      images: [image],
    },
  };
  await render(<FoldedImageTool evidence={evidence} />);
  const header = () =>
    container.querySelector<HTMLElement>(".tool-card-header")!;
  const fold = () =>
    container.querySelector<HTMLButtonElement>(".process-fold-header")!;
  await click(header());
  expect(header().getAttribute("aria-expanded")).toBe("true");
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-label="放大图片：工具输出图片"]',
  )!;
  const thumbnail = trigger.querySelector("img")!;
  trigger.focus();
  await click(trigger);

  const dialogs =
    document.body.querySelectorAll<HTMLElement>('[role="dialog"]');
  expect(dialogs).toHaveLength(1);
  const dialog = dialogs[0];
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(dialog.closest(".tool-card")).toBeNull();
  expect(container.contains(dialog)).toBe(false);
  const fullImage = dialog.querySelector<HTMLImageElement>(".tool-image-full")!;
  expect(fullImage).not.toBeNull();
  expect(fullImage.getAttribute("src")).toBe(thumbnail.getAttribute("src"));
  expect(fullImage.src.startsWith("data:image/png;base64,")).toBe(true);
  expect(dialog.querySelectorAll("img")).toHaveLength(1);
  expect(container.querySelectorAll("img")).toHaveLength(1);
  expect(document.body.querySelectorAll("img")).toHaveLength(2);
  expect(header().getAttribute("aria-expanded")).toBe("true");
  expect(fold().getAttribute("aria-expanded")).toBe("true");

  await act(() => {
    dialog
      .querySelector<HTMLButtonElement>('button[aria-label="关闭图片预览"]')!
      .dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
  });
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(header().getAttribute("aria-expanded")).toBe("true");
  expect(fold().getAttribute("aria-expanded")).toBe("true");
  expect(container.querySelectorAll(".tool-card-images img")).toHaveLength(1);

  await click(fold());
  expect(container.querySelector(".tool-card")).toBeNull();
  await click(fold());
  expect(header().getAttribute("aria-expanded")).toBe("true");
  expect(container.querySelectorAll(".tool-card-images img")).toHaveLength(1);
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
});

/** 不受支持的图片继续显示原生证据，不暴露放大入口或发起加载。 */
it.each([localRead, tool("unknown", {}, { text: "invalid image fallback" })])(
  "keeps invalid native image evidence without a preview trigger $id",
  async (original) => {
    const invalidImage = {
      type: "image",
      mimeType: "image/svg+xml",
      data: "PHN2Zz48L3N2Zz4=",
    };
    const evidence: ToolEvidence = {
      ...original,
      resultMessage: {
        ...original.resultMessage!,
        content: [invalidImage],
        images: [invalidImage],
      },
    };
    await render(<ToolCard tool={evidence} context={context(evidence)} />);
    expect(
      container.querySelectorAll(".tool-card-images .transcript-evidence"),
    ).toHaveLength(1);
    expect(container.querySelector(".tool-card-images")?.textContent).toContain(
      "image/svg+xml",
    );
    expect(container.querySelector(".tool-image-trigger")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  },
);

/** 过程卸载正文后仍由外层上下文保留每个原生行的展开状态。 */
function FoldedReadOnly() {
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, number>>({});
  return (
    <ProcessFold
      collapsed={collapsed}
      onToggle={() => setCollapsed(!collapsed)}
      failures={0}
    >
      <CardItems
        items={[localRead, artifactRead].map((evidence) => ({
          kind: "tool" as const,
          key: evidence.id,
          tool: evidence,
        }))}
        context={{
          ...context(localRead),
          expanded,
          toggle: (id, index) =>
            setExpanded((previous) => {
              const next = { ...previous };
              if (next[id] !== undefined) delete next[id];
              else next[id] = index;
              return next;
            }),
        }}
      />
    </ProcessFold>
  );
}

/** 重开过程不会把独立展开状态合并或清空，Esc 仍落在当前行。 */
it("restores independent readonly expansions after process fold reopen", async () => {
  await render(<FoldedReadOnly />);
  const rows = () =>
    container.querySelectorAll<HTMLElement>(".tool-card-readonly-row");
  const fold = () =>
    container.querySelector<HTMLButtonElement>(".process-fold-header")!;
  await click(rows()[1]);
  expect(rows()[0].getAttribute("aria-expanded")).toBe("false");
  await click(fold());
  expect(rows()).toHaveLength(0);
  await click(fold());
  expect(rows()[0].getAttribute("aria-expanded")).toBe("false");
  expect(rows()[1].getAttribute("aria-expanded")).toBe("true");
  expect(
    container.querySelectorAll(".tool-card-readonly-details"),
  ).toHaveLength(1);
  const restoredRow = rows()[1];
  restoredRow.focus();
  await act(() => {
    restoredRow.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(document.activeElement).toBe(restoredRow);
  expect(restoredRow.getAttribute("aria-expanded")).toBe("false");
  await click(fold());
  await click(fold());
  expect(
    [...rows()].every((row) => row.getAttribute("aria-expanded") === "false"),
  ).toBe(true);
});
