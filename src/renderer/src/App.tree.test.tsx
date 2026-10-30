import { offPlanBridge } from "./plan-test-fixture";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { RpcCommand, RpcFrame, TreeNode } from "../../shared/protocol";
import App from "./App";
import { container, render } from "./transcript-test-harness";

const tree: TreeNode[] = [
  {
    entry: {
      id: "user",
      parentId: null,
      timestamp: "2026-10-15",
      type: "message",
      message: { role: "user", content: "第一个问题" },
    },
    children: [
      {
        entry: {
          id: "assistant",
          parentId: "user",
          timestamp: "2026-10-15",
          type: "message",
          message: { role: "assistant", content: "第一个回答" },
        },
        children: [],
      },
    ],
  },
];
const labelRecord = {
  id: "label-record",
  parentId: "assistant",
  timestamp: "2026-10-15",
  type: "label",
};

function labeledTree(label: string | undefined): TreeNode[] {
  return [
    {
      ...tree[0],
      label,
      children: [
        {
          ...tree[0].children[0],
          children: [{ entry: labelRecord, children: [] }],
        },
      ],
    },
  ];
}

afterEach(() => vi.unstubAllGlobals());

function boundary() {
  const listeners = new Set<(frame: RpcFrame) => void>();
  let currentTree = tree;
  let currentEntries = [tree[0].entry, tree[0].children[0].entry];
  let currentLeaf: string | null = "assistant";
  const emit = (frame: RpcFrame) =>
    listeners.forEach((listener) => listener(frame));
  const request = vi.fn(async ({ type }: RpcCommand) => {
    const responses: Record<string, unknown> = {
      get_state: { sessionId: "one", sessionName: "树测试", isSettled: true },
      get_entries: {
        entries: currentEntries,
        leafId: currentLeaf,
      },
      get_tree: { tree: currentTree, leafId: "assistant" },
      get_btw_history: { records: [] },
    };
    if (!Object.hasOwn(responses, type)) throw new Error(`意外 RPC：${type}`);
    return responses[type];
  });
  const navigateTree = vi.fn(async (..._args: unknown[]) => {});
  const setTreeLabel = vi.fn(async (_id: string, label: string | undefined) => {
    currentTree = labeledTree(label);
    currentEntries = [
      ...currentEntries,
      { ...labelRecord, targetId: _id, label },
    ];
  });
  const respondUI = vi.fn(async (_response: unknown) => {});
  const cancelTreeNavigation = vi.fn(async () => {});
  const deleteTree = vi.fn(async (request: { entryIds: string[] }) => {
    currentEntries = currentEntries.filter(
      (entry) => !request.entryIds.includes(entry.id),
    );
    currentLeaf = currentEntries.at(-1)?.id ?? null;
  });
  vi.stubGlobal("desktop", {
    setZoomFactor: () => {},
    preferences: async () => ({ executable: "omp.exe", cwd: "D:/workspace" }),
    listSessions: async () => [],
    request,
    navigateTree,
    setTreeLabel,
    respondUI,
    cancelTreeNavigation,
    deleteTree,
    ...offPlanBridge,
    onFrame: (listener: (frame: RpcFrame) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  return {
    emit,
    request,
    navigateTree,
    setTreeLabel,
    respondUI,
    cancelTreeNavigation,
    deleteTree,
  };
}

async function input(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(element),
      "value",
    )!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function key(key: string, options: KeyboardEventInit = {}) {
  await act(async () => {
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, ...options }),
    );
  });
}

async function mount() {
  const api = boundary();
  await render(<App />);
  await act(async () => {
    api.emit({ type: "desktop_status", status: "connected" });
    api.emit({ type: "session_info_update" });
  });
  await input(
    container.querySelector<HTMLTextAreaElement>(".composer-box textarea")!,
    "/tree",
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>(".send-button")!.click(),
  );
  return api;
}

it.each([false, true])(
  "/tree 使用全屏原生选择器并传递摘要语义（Shift：%s）",
  async (shiftKey) => {
    const api = await mount();
    expect(container.querySelector(".native-tree-screen")).not.toBeNull();
    expect(container.querySelector(".modal-backdrop")).toBeNull();
    await key("Home");
    await key("Enter", { shiftKey });
    expect(api.navigateTree).toHaveBeenCalledExactlyOnceWith(
      "user",
      shiftKey ? { summarize: true } : { askSummary: true },
    );
    expect(container.querySelector(".native-tree-screen")).toBeNull();
    expect(
      container.querySelector<HTMLTextAreaElement>(".composer-box textarea")
        ?.value,
    ).toBe("第一个问题");
  },
);

it("删除确认传入会话标识并刷新会话树和聊天上下文", async () => {
  const api = await mount();
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "删除节点及子节点")!
      .click(),
  );
  expect(api.deleteTree).not.toHaveBeenCalled();
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "确认删除")!
      .click(),
  );
  expect(api.deleteTree).toHaveBeenCalledExactlyOnceWith({
    sessionId: "one",
    entryId: "assistant",
    entryIds: ["assistant"],
  });
  expect(container.querySelector("#native-tree-assistant")).toBeNull();
  expect(container.querySelector("#native-tree-user")).not.toBeNull();
  expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  expect(
    container.querySelector(".transcript")?.textContent ?? "",
  ).not.toContain("第一个回答");
});

it("标签保存经过原生桥接并重新读取会话树", async () => {
  const api = await mount();
  await key("Home");
  await key("L", { shiftKey: true });
  await input(
    container.querySelector<HTMLInputElement>('[aria-label="条目标签"]')!,
    "重要问题",
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        '.native-tree-label-editor button[type="submit"]',
      )!
      .click(),
  );
  expect(api.setTreeLabel).toHaveBeenCalledExactlyOnceWith("user", "重要问题");
  expect(container.querySelector(".native-tree-label")?.textContent).toContain(
    "重要问题",
  );
  expect(api.navigateTree).not.toHaveBeenCalled();
  await key("a", { altKey: true });
  await key("End");
  await key("Enter");
  expect(api.navigateTree).toHaveBeenCalledExactlyOnceWith("label-record", {
    askSummary: true,
  });
});

it("摘要问答暂停树键盘，取消后保留当前选择并显示原生取消原因", async () => {
  const api = await mount();
  let rejectNavigation: (error: Error) => void = () => {
    throw new Error("导航尚未开始");
  };
  api.navigateTree.mockImplementation(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectNavigation = reject;
        api.emit({
          type: "extension_ui_request",
          id: "summary",
          method: "select",
          title: "是否生成摘要",
          options: ["No summary", "Summarize"],
        });
      }),
  );
  api.respondUI.mockImplementation(async () =>
    rejectNavigation(new Error("树导航已取消")),
  );
  await key("Home");
  await key("Enter");
  expect(
    container.querySelector(".native-tree-screen")?.hasAttribute("inert"),
  ).toBe(true);
  expect(container.querySelector(".modal-backdrop")).not.toBeNull();
  await key("Escape");
  expect(api.respondUI).toHaveBeenCalledWith({
    id: "summary",
    cancelled: true,
  });
  expect(container.querySelector(".modal-backdrop")).toBeNull();
  expect(
    container.querySelector('.native-tree-row[aria-selected="true"]')?.id,
  ).toBe("native-tree-user");
  expect(container.querySelector(".native-tree-error")?.textContent).toBe(
    "树导航已取消",
  );
});

it("摘要进行中 Esc 调用专用原生中止，保留会话树直到导航结束", async () => {
  const api = await mount();
  let rejectNavigation: (error: Error) => void = () => {
    throw new Error("导航尚未开始");
  };
  api.navigateTree.mockImplementation(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectNavigation = reject;
      }),
  );
  await key("Enter", { shiftKey: true });
  await key("Escape");
  expect(api.cancelTreeNavigation).toHaveBeenCalledOnce();
  expect(container.querySelector(".native-tree-screen")).not.toBeNull();
  await act(async () => rejectNavigation(new Error("树导航已取消")));
  expect(container.querySelector(".native-tree-error")?.textContent).toBe(
    "树导航已取消",
  );
  expect(container.querySelector(".native-tree-screen")).not.toBeNull();
});
