// @vitest-environment jsdom
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentMessage, RpcCommand } from "../../shared/protocol";
import type { SessionHistorySnapshot } from "../../shared/session-history";
import { createAppFixture } from "./inline-app-test-fixture";

const initialMessages: AgentMessage[] = [
  { role: "user", content: "原始问题" },
  { role: "assistant", content: "原始长回答" },
];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** jsdom 不计算布局；模拟浏览器夹紧 scrollTop，但不把程序写入误当成用户输入。 */
function mockLayout() {
  let height = 1400;
  let viewport = 400;
  const positions = new WeakMap<Element, number>();
  const writes: number[] = [];
  const observers = new Set<TestResizeObserver>();
  const originalHeight = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight")!.get!;
  const originalViewport = Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight")!.get!;
  const isTranscript = (element: Element) => element.classList.contains("transcript");

  vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (this: Element) {
    return isTranscript(this) ? height : originalHeight.call(this);
  });
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) {
    return isTranscript(this) ? viewport : originalViewport.call(this);
  });
  vi.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(function (this: Element) {
    return positions.get(this) ?? 0;
  });
  vi.spyOn(Element.prototype, "scrollTop", "set").mockImplementation(function (this: Element, value: number) {
    if (isTranscript(this)) {
      writes.push(value);
      positions.set(this, Math.max(0, Math.min(value, height - viewport)));
    } else positions.set(this, value);
  });

  class TestResizeObserver {
    readonly targets = new Set<Element>();
    constructor(readonly callback: ResizeObserverCallback) {
      observers.add(this);
    }
    observe(target: Element) { this.targets.add(target); }
    unobserve(target: Element) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); observers.delete(this); }
  }
  vi.stubGlobal("ResizeObserver", TestResizeObserver);

  return {
    writes,
    bottom: () => Math.max(0, height - viewport),
    setHeight(value: number) { height = value; },
    setViewport(value: number) { viewport = value; },
    // 浏览器布局或用户拖动直接改变位置，不经过应用的 scrollTop setter。
    position(element: Element, value: number) { positions.set(element, value); },
    async resize(target: Element) {
      await act(async () => {
        for (const observer of [...observers]) {
          if (observer.targets.has(target)) {
            observer.callback(
              [{ target } as ResizeObserverEntry],
              observer as unknown as ResizeObserver,
            );
          }
        }
      });
    },
  };
}

async function mount() {
  const layout = mockLayout();
  const app = await createAppFixture(initialMessages);
  const transcript = app.container.querySelector<HTMLElement>(".transcript")!;
  expect(transcript).not.toBeNull();
  expect(transcript.scrollTop).toBe(layout.bottom());
  const content = () => {
    const node = transcript.querySelector<HTMLElement>(".transcript-content");
    expect(node, "异步内容高度由正文内层容器观察").not.toBeNull();
    return node!;
  };
  const jump = () => app.container.querySelector<HTMLButtonElement>(".jump-button");
  const message = async (text = "新增流式回答") => {
    await app.emit({
      type: "message_end",
      messageId: text,
      message: { role: "assistant", content: text },
    });
    expect(transcript.textContent).toContain(text);
  };
  const scrollTo = async (top: number) => {
    await act(async () => {
      layout.position(transcript, top);
      transcript.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
  };
  const leaveBottom = async () => {
    await dispatch(transcript, new WheelEvent("wheel", { deltaY: -300, bubbles: true }));
    await scrollTo(layout.bottom() - 300);
  };
  return { ...app, layout, transcript, content, jump, message, scrollTo, leaveBottom };
}


async function dispatch(target: EventTarget, event: Event) {
  await act(async () => { target.dispatchEvent(event); });
}
async function submit(app: { container: HTMLElement }, text: string) {
  const input = app.container.querySelector<HTMLTextAreaElement>(".composer-box textarea")!;
  expect(input.disabled).toBe(false);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await dispatch(input, new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
}

function promptResponse() {
  const acceptance = Promise.withResolvers<{ agentInvoked?: boolean }>();
  const original = window.desktop.request;
  const request = vi.spyOn(window.desktop, "request").mockImplementation(
    <T,>(command: RpcCommand): Promise<T> => command.type === "prompt"
      ? acceptance.promise as Promise<T>
      : original<T>(command),
  );
  return { ...acceptance, request };
}

it("agent_end 历史替换的非用户归零不会关闭跟随，内容恢复后仍贴底", async () => {
  const app = await mount();
  await app.message("历史替换前的流式正文");
  const history = Promise.withResolvers<SessionHistorySnapshot>();
  const original = window.desktop.request;
  const request = vi.spyOn(window.desktop, "request").mockImplementation(
    <T,>(command: RpcCommand): Promise<T> => command.type === "get_entries"
      ? history.promise as Promise<T>
      : original<T>(command),
  );
  await app.emit({ type: "agent_end", isTerminal: true });
  expect(request.mock.calls.some(([command]) => command.type === "get_entries")).toBe(true);
  expect(app.transcript.textContent).toContain("读取原生会话");
  await act(async () => history.resolve({
    entries: [{
      type: "message", id: "native-answer", parentId: null,
      timestamp: "2026-10-26T00:00:00Z",
      message: { role: "assistant", content: "历史重建后的最终回答" },
    }],
    leafId: "native-answer",
  }));
  expect(app.transcript.textContent).toContain("历史重建后的最终回答");
  expect(app.transcript.textContent).not.toContain("历史替换前的流式正文");
  // 模拟历史节点重挂载后的布局夹紧和 scroll 通知，没有 wheel/pointer/key 输入。
  await app.scrollTo(0);
  expect(app.jump()).toBeNull();
  app.layout.setHeight(1900);
  await app.layout.resize(app.content());
  expect(app.transcript.scrollTop).toBe(app.layout.bottom());
  expect(app.jump()).toBeNull();
});

it("wheel 离底超过 90px 后新消息和异步内容增长保留阅读位置，跳转可恢复跟随", async () => {
  const app = await mount();
  await app.leaveBottom();
  const position = app.transcript.scrollTop;
  app.layout.setHeight(1700);
  await app.message();
  await app.layout.resize(app.content());
  expect(app.transcript.scrollTop).toBe(position);
  expect(app.jump()).not.toBeNull();
  await app.click(app.jump()!);
  expect(app.transcript.scrollTop).toBe(app.layout.bottom());
  expect(app.jump()).toBeNull();
  app.layout.setHeight(2100);
  await app.layout.resize(app.content());
  expect(app.transcript.scrollTop).toBe(app.layout.bottom());
});

it("提示等待接受时不滚动，真正接受后立即恢复贴底并跟随后续消息", async () => {
  const app = await mount();
  await app.leaveBottom();
  await app.message("阅读中的新消息");
  const response = promptResponse();
  const position = app.transcript.scrollTop;
  await submit(app, "继续回答");
  expect(response.request.mock.calls.filter(([command]) => command.type === "prompt")).toHaveLength(1);
  app.layout.setHeight(1800);
  await app.layout.resize(app.content());
  expect(app.transcript.scrollTop).toBe(position);
  expect(app.jump()).not.toBeNull();
  await act(async () => response.resolve({ agentInvoked: true }));
  expect(app.transcript.scrollTop).toBe(app.layout.bottom());
  expect(app.jump()).toBeNull();
  app.layout.setHeight(2200);
  await app.message("接受后的回答");
  expect(app.transcript.scrollTop).toBe(app.layout.bottom());
});

it.each(["rejected", "not-invoked"] as const)("提示 %s 不重置主正文阅读位置", async outcome => {
  const app = await mount();
  await app.leaveBottom();
  await app.message("阅读旧消息");
  const position = app.transcript.scrollTop;
  const response = promptResponse();
  await submit(app, "未被引擎执行的提示");
  await act(async () => {
    if (outcome === "rejected") response.reject(new Error("测试拒绝提示"));
    else response.resolve({ agentInvoked: false });
  });
  app.layout.setHeight(1800);
  await app.message("失败后的旁路消息");
  await app.layout.resize(app.content());
  expect(app.transcript.scrollTop).toBe(position);
  expect(app.jump()).not.toBeNull();
});

it("/btw 命令被接受也不恢复主正文跟随", async () => {
  const app = await mount();
  await app.leaveBottom();
  await app.message("旁问前的主正文");
  const position = app.transcript.scrollTop;
  const original = window.desktop.request;
  const request = vi.spyOn(window.desktop, "request").mockImplementation(
    async <T,>(command: RpcCommand): Promise<T> => command.type === "btw"
      ? { record: {
        id: "scroll-btw", leafId: null, question: "旁问内容", answer: "",
        status: "running", createdAt: 1, updatedAt: 1,
      } } as T
      : original<T>(command),
  );
  await submit(app, "/btw 旁问内容");
  expect(request.mock.calls.filter(([command]) => command.type === "btw")).toHaveLength(1);
  expect(request.mock.calls.some(([command]) => command.type === "prompt")).toBe(false);
  app.layout.setHeight(1900);
  await app.message("旁问期间的主正文更新");
  await app.layout.resize(app.content());
  expect(app.transcript.scrollTop).toBe(position);
  expect(app.jump()).not.toBeNull();
});

it.each(["pointerup", "pointercancel", "lostpointercapture", "blur"])(
  "%s 结束指针交互：按住时消息和尺寸变化不写 scrollTop，未拖离时释放恢复跟随",
  async release => {
    const app = await mount();
    await dispatch(app.transcript, new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    const position = app.transcript.scrollTop;
    app.layout.writes.length = 0;
    app.layout.setHeight(1800);
    await app.message();
    await app.layout.resize(app.content());
    app.layout.setViewport(300);
    await app.layout.resize(app.transcript);
    expect(app.layout.writes).toEqual([]);
    expect(app.transcript.scrollTop).toBe(position);
    await dispatch(release === "blur" ? window : document, new Event(release, { bubbles: true }));
    expect(app.transcript.scrollTop).toBe(app.layout.bottom());
    expect(app.jump()).toBeNull();
    app.layout.setHeight(2200);
    await app.layout.resize(app.content());
    expect(app.transcript.scrollTop).toBe(app.layout.bottom());
  },
);

it("指针拖动离开底部后释放不会抢回位置，后续新消息仍可阅读旧内容", async () => {
  const app = await mount();
  await dispatch(app.transcript, new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
  await app.scrollTo(350);
  app.layout.writes.length = 0;
  app.layout.setHeight(1800);
  await app.message("拖动期间的回答");
  await app.layout.resize(app.content());
  expect(app.layout.writes).toEqual([]);
  await dispatch(document, new Event("pointerup", { bubbles: true }));
  expect(app.transcript.scrollTop).toBe(350);
  expect(app.jump()).not.toBeNull();
  app.layout.setHeight(2100);
  await app.message("拖动完成后的回答");
  await app.layout.resize(app.content());
  expect(app.transcript.scrollTop).toBe(350);
  expect(app.jump()).not.toBeNull();
});

it("无新 RPC 消息的异步内容增高和视口缩小也保持贴底", async () => {
  const app = await mount();
  const content = app.content();
  const rpcCount = app.commands.length;
  app.layout.setHeight(2300);
  await app.layout.resize(content);
  expect(app.transcript.scrollTop).toBe(app.layout.bottom());
  app.layout.setViewport(250);
  await app.layout.resize(app.transcript);
  expect(app.transcript.scrollTop).toBe(app.layout.bottom());
  expect(app.jump()).toBeNull();
  expect(app.commands).toHaveLength(rpcCount);
});
