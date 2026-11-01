import { offPlanBridge } from "./plan-test-fixture";
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import type { SessionSummary } from "../../shared/protocol";
import { container, render } from "./transcript-test-harness";

const key = "omp-desktop.conversation-gutter";
const sidebarHiddenKey = "omp-desktop.session-sidebar-hidden";
beforeEach(() => {
  localStorage.removeItem(key);
  localStorage.removeItem("omp-desktop.sidebar-width");
  localStorage.removeItem("omp-desktop.interface-font-size");
  localStorage.removeItem(sidebarHiddenKey);
  mediaBoundary();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.removeItem(key);
  localStorage.removeItem("omp-desktop.sidebar-width");
  localStorage.removeItem("omp-desktop.interface-font-size");
  localStorage.removeItem(sidebarHiddenKey);
});

it("侧栏拖动限制宽度并保存，结束后停止拖动且支持键盘调整", async () => {
  boundary();
  await render(<App />);
  const handle = container.querySelector<HTMLButtonElement>(
    '[aria-label="调整会话侧栏宽度"]',
  )!;
  Object.defineProperties(handle, {
    setPointerCapture: { value: vi.fn() },
    hasPointerCapture: { value: () => true },
    releasePointerCapture: { value: vi.fn() },
  });
  vi.spyOn(handle.parentElement!, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 220, 800),
  );
  const pointer = async (type: string, clientX: number) =>
    act(async () => {
      handle.dispatchEvent(
        new MouseEvent(type, {
          button: 0,
          clientX,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
  await pointer("pointerdown", 220);
  await pointer("pointermove", 320);
  expect(handle.getAttribute("aria-valuenow")).toBe("320");
  expect(localStorage.getItem("omp-desktop.sidebar-width")).toBe("320");
  await pointer("pointermove", 9000);
  expect(handle.getAttribute("aria-valuenow")).toBe(
    handle.getAttribute("aria-valuemax"),
  );
  await pointer("pointermove", -9000);
  expect(handle.getAttribute("aria-valuenow")).toBe("180");
  await pointer("pointerup", 0);
  await pointer("pointermove", 400);
  expect(handle.getAttribute("aria-valuenow")).toBe("180");
  await act(async () => {
    handle.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(handle.getAttribute("aria-valuenow")).toBe("190");
  await render(null);
  await render(<App />);
  expect(
    container
      .querySelector('[aria-label="调整会话侧栏宽度"]')
      ?.getAttribute("aria-valuenow"),
  ).toBe("190");
});

function boundary(sessions: SessionSummary[] = []) {
  const start = vi.fn();
  const setZoomFactor = vi.fn();
  vi.stubGlobal("desktop", {
    setZoomFactor,
    preferences: async () => ({ executable: "omp.exe", cwd: "D:/workspace" }),
    listSessions: async () => sessions,
    openSession: vi.fn(async (path: string) => ({
      snapshot: {
        summary: sessions.find((session) => session.path === path)!,
        messages: [],
      },
    })),
    onFrame: () => () => {},
    ...offPlanBridge,
    start,
  });
  return { start, setZoomFactor };
}

it("留白设置即时应用并保存，重新挂载仍保留，恢复默认不重连", async () => {
  const { start } = boundary();
  await render(<App />);
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(".sidebar-footer button")!
      .click(),
  );
  const slider = container.querySelector<HTMLInputElement>(
    '[aria-label="会话左右留白"]',
  )!;
  expect(slider.value).toBe("28");
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(slider, "92");
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(
    container
      .querySelector<HTMLElement>(".desktop-shell")!
      .style.getPropertyValue("--conversation-gutter"),
  ).toBe("92px");
  expect(localStorage.getItem(key)).toBe("92");
  await render(null);
  await render(<App />);
  expect(
    container
      .querySelector<HTMLElement>(".desktop-shell")!
      .style.getPropertyValue("--conversation-gutter"),
  ).toBe("92px");
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(".sidebar-footer button")!
      .click(),
  );
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "恢复默认留白")!
      .click(),
  );
  expect(localStorage.getItem(key)).toBe("28");
  expect(start).not.toHaveBeenCalled();
});

it("界面字体大小即时缩放并保存，重新挂载仍保留，恢复默认不重连", async () => {
  const { start, setZoomFactor } = boundary();
  await render(<App />);
  expect(setZoomFactor).toHaveBeenLastCalledWith(1);
  await act(async () => container.querySelector<HTMLButtonElement>(".sidebar-footer button")!.click());
  const slider = container.querySelector<HTMLInputElement>('[aria-label="界面字体大小"]')!;
  expect(slider.value).toBe("14");
  await act(async () => {
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    slider.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(slider, "18");
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(setZoomFactor).toHaveBeenLastCalledWith(expect.closeTo(18 / 14));
  expect(localStorage.getItem("omp-desktop.interface-font-size")).toBe("18");
  expect(container.textContent).toContain("界面字体大小：18px");
  await render(null);
  await render(<App />);
  expect(setZoomFactor).toHaveBeenLastCalledWith(expect.closeTo(18 / 14));
  await act(async () => container.querySelector<HTMLButtonElement>(".sidebar-footer button")!.click());
  expect(container.querySelector<HTMLInputElement>('[aria-label="界面字体大小"]')!.value).toBe("18");
  await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "恢复默认字号")!.click());
  expect(localStorage.getItem("omp-desktop.interface-font-size")).toBe("14");
  expect(setZoomFactor).toHaveBeenLastCalledWith(1);
  expect(start).not.toHaveBeenCalled();
});

it.each([["99", "20"], ["-5", "12"], ["abc", "14"], ["Infinity", "14"], ["15.6", "16"]])(
  "界面字号读取 %s 时规范化为 %s",
  async (stored, expected) => {
    localStorage.setItem("omp-desktop.interface-font-size", stored);
    const { setZoomFactor } = boundary();
    await render(<App />);
    await act(async () => container.querySelector<HTMLButtonElement>(".sidebar-footer button")!.click());
    expect(container.querySelector<HTMLInputElement>('[aria-label="界面字体大小"]')!.value).toBe(expected);
    expect(setZoomFactor).toHaveBeenLastCalledWith(expect.closeTo(Number(expected) / 14));
    expect(localStorage.getItem("omp-desktop.interface-font-size")).toBe(expected);
  },
);

/** 模拟真实断点变化，同时保留可检查的媒体查询订阅生命周期。 */
function mediaBoundary(initialWidth = 1024) {
  let width = initialWidth;
  const queries: {
    media: string;
    matches: boolean;
    listeners: Set<EventListenerOrEventListenerObject>;
  }[] = [];
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal("matchMedia", vi.fn((media: string) => {
    const query = {
      media,
      matches: media === "(max-width: 800px)" && width <= 800,
      listeners: new Set<EventListenerOrEventListenerObject>(),
    };
    queries.push(query);
    return {
      media,
      get matches() { return query.matches; },
      onchange: null,
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) =>
        query.listeners.add(listener),
      removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) =>
        query.listeners.delete(listener),
    };
  }));
  return {
    queries,
    async resize(nextWidth: number) {
      await act(async () => {
        width = nextWidth;
        vi.stubGlobal("innerWidth", width);
        for (const query of queries) {
          const matches = query.media === "(max-width: 800px)" && width <= 800;
          if (matches === query.matches) continue;
          query.matches = matches;
          const event = Object.assign(new Event("change"), {
            matches,
            media: query.media,
          });
          for (const listener of query.listeners) {
            if (typeof listener === "function") listener(event);
            else listener.handleEvent(event);
          }
        }
        window.dispatchEvent(new Event("resize"));
      });
    },
  };
}

function sidebarToggle() {
  return container.querySelector<HTMLButtonElement>(
    'button[aria-controls="session-sidebar"][aria-expanded]',
  )!;
}

function resizeHandle() {
  return container.querySelector<HTMLButtonElement>(
    '[aria-label="调整会话侧栏宽度"]',
  );
}

async function toggleSidebar() {
  await act(async () => {
    sidebarToggle().dispatchEvent(new Event("pointerdown", { bubbles: true }));
    sidebarToggle().click();
  });
}

async function changeText(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const layoutSessions: SessionSummary[] = [
  { id: "alpha-one", path: "D:/sessions/alpha-one.jsonl", cwd: "D:/alpha", title: "Alpha one", modified: 3, timestamp: "2026-10-01" },
  { id: "alpha-two", path: "D:/sessions/alpha-two.jsonl", cwd: "D:/alpha", title: "Alpha two", modified: 2, timestamp: "2026-10-01" },
  { id: "beta", path: "D:/sessions/beta.jsonl", cwd: "D:/beta", title: "Beta", modified: 1, timestamp: "2026-10-01" },
];

function sessionButton(title: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("#session-sidebar button")]
    .find((button) => button.querySelector(".session-title")?.textContent === title)!;
}

it("桌面常驻入口保存隐藏偏好，重新挂载恢复，栏宽独立且聊天 DOM 不重建", async () => {
  localStorage.setItem("omp-desktop.sidebar-width", "310");
  const { start } = boundary();
  await render(<App />);
  const aside = container.querySelector("#session-sidebar");
  const composer = container.querySelector<HTMLTextAreaElement>(
    '[aria-label="输入任务或原生 slash 命令"]',
  )!;
  await changeText(composer, "保留这份草稿");
  expect(sidebarToggle().getAttribute("aria-expanded")).toBe("true");
  expect(sidebarToggle().getAttribute("aria-label")).toBe("隐藏会话目录");
  expect(resizeHandle()?.getAttribute("aria-valuenow")).toBe("310");
  await toggleSidebar();
  expect(sidebarToggle().getAttribute("aria-expanded")).toBe("false");
  expect(sidebarToggle().getAttribute("aria-label")).toBe("显示会话目录");
  expect(document.activeElement).toBe(sidebarToggle());
  expect(resizeHandle()).toBeNull();
  expect(localStorage.getItem(sidebarHiddenKey)).toBe("true");
  expect(localStorage.getItem("omp-desktop.sidebar-width")).toBe("310");
  await toggleSidebar();
  expect(container.querySelector("#session-sidebar")).toBe(aside);
  expect(container.querySelector('[aria-label="输入任务或原生 slash 命令"]')).toBe(composer);
  expect(composer.value).toBe("保留这份草稿");
  expect(resizeHandle()?.getAttribute("aria-valuenow")).toBe("310");
  expect(start).not.toHaveBeenCalled();
  await toggleSidebar();
  await render(null);
  await render(<App />);
  expect(sidebarToggle().getAttribute("aria-expanded")).toBe("false");
  await toggleSidebar();
  expect(localStorage.getItem(sidebarHiddenKey)).toBe("false");
  await render(null);
  await render(<App />);
  expect(sidebarToggle().getAttribute("aria-expanded")).toBe("true");
});

it("非法桌面隐藏偏好不会意外隐藏导航，且仍可主动隐藏", async () => {
    localStorage.setItem(sidebarHiddenKey, "TRUE");
    boundary();
    await render(<App />);
    expect(sidebarToggle().getAttribute("aria-expanded")).toBe("true");
    expect(resizeHandle()).not.toBeNull();
    await toggleSidebar();
    expect(sidebarToggle().getAttribute("aria-expanded")).toBe("false");
});

it("偏好读取和保存均失败时，仍能在当前窗口隐藏与恢复目录", async () => {
  boundary();
  const getItem = Storage.prototype.getItem;
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key) {
    if (key === sidebarHiddenKey) throw new Error("storage unavailable");
    return getItem.call(this, key);
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key === sidebarHiddenKey) throw new Error("storage unavailable");
    return setItem.call(this, key, value);
  });
  await render(<App />);
  expect(sidebarToggle().getAttribute("aria-expanded")).toBe("true");
  await toggleSidebar();
  expect(sidebarToggle().getAttribute("aria-expanded")).toBe("false");
  await toggleSidebar();
  expect(sidebarToggle().getAttribute("aria-expanded")).toBe("true");
});

it("搜索、项目折叠、多选和目录滚动在隐藏恢复后保持，悬空菜单关闭", async () => {
  boundary(layoutSessions);
  await render(<App />);
  const search = container.querySelector<HTMLInputElement>(".sidebar-search input")!;
  await changeText(search, "Alpha");
  const project = container.querySelector<HTMLButtonElement>(
    '[aria-label="D:/alpha"] .project-toggle',
  )!;
  await act(async () => project.click());
  expect(project.getAttribute("aria-expanded")).toBe("false");
  await toggleSidebar();
  await toggleSidebar();
  expect(search.value).toBe("Alpha");
  expect(project.getAttribute("aria-expanded")).toBe("false");
  await act(async () => project.click());
  const first = sessionButton("Alpha one");
  const second = sessionButton("Alpha two");
  await act(async () => {
    first.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    second.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
  });
  expect(first.getAttribute("aria-pressed")).toBe("true");
  expect(second.getAttribute("aria-pressed")).toBe("true");
  const nav = container.querySelector<HTMLElement>("#session-sidebar nav")!;
  await act(async () => {
    nav.scrollTop = 137;
    nav.dispatchEvent(new Event("scroll", { bubbles: true }));
    first.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  expect(container.querySelector('[role="menu"]')).not.toBeNull();
  await toggleSidebar();
  expect(container.querySelector('[role="menu"]')).toBeNull();
  // 模拟 display:none 期间浏览器将布局滚动位置归零，再验证恢复。
  nav.scrollTop = 0;
  await toggleSidebar();
  expect(container.querySelector("#session-sidebar nav")).toBe(nav);
  expect(nav.scrollTop).toBe(137);
  expect(sessionButton("Alpha one")).toBe(first);
  expect(first.getAttribute("aria-pressed")).toBe("true");
  expect(second.getAttribute("aria-pressed")).toBe("true");
  expect(search.value).toBe("Alpha");
});

it("桌面打开不同会话与设置不会隐藏目录或改写可见偏好", async () => {
  boundary(layoutSessions);
  await render(<App />);
  for (const title of ["Alpha one", "Alpha two"]) {
    await act(async () => sessionButton(title).click());
    expect(sessionButton(title).getAttribute("aria-current")).toBe("page");
    expect(sidebarToggle().getAttribute("aria-expanded")).toBe("true");
    expect(resizeHandle()).not.toBeNull();
  }
  await act(async () => container.querySelector<HTMLButtonElement>(".sidebar-footer button")!.click());
  expect(container.querySelector('[role="dialog"][aria-label="设置"]')).not.toBeNull();
  expect(sidebarToggle().getAttribute("aria-expanded")).toBe("true");
  expect(localStorage.getItem(sidebarHiddenKey)).not.toBe("true");
});

it("800/801 断点独立管理临时抽屉与桌面偏好，并在隐藏焦点时迁回入口", async () => {
  const media = mediaBoundary(801);
  boundary();
  await render(<App />);
  await toggleSidebar();
  expect(localStorage.getItem(sidebarHiddenKey)).toBe("true");
  const writes = vi.spyOn(Storage.prototype, "setItem");
  await media.resize(800);
  expect(sidebarToggle().getAttribute("aria-expanded")).toBe("false");
  await toggleSidebar();
  const close = container.querySelector<HTMLButtonElement>('[aria-label="关闭会话目录"]')!;
  expect(sidebarToggle().getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(close);
  expect(resizeHandle()).toBeNull();
  await act(async () => close.click());
  expect(sidebarToggle().getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(sidebarToggle());
  await toggleSidebar();
  // Chromium 的 CSS 断点先隐藏关闭按钮，媒体查询通知到达时焦点已落到 body。
  await act(async () => close.blur());
  expect(document.activeElement).toBe(document.body);
  await media.resize(801);
  expect(sidebarToggle().getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(sidebarToggle());
  await media.resize(800);
  expect(sidebarToggle().getAttribute("aria-expanded")).toBe("false");
  expect(writes.mock.calls.filter(([key]) => key === sidebarHiddenKey)).toHaveLength(0);
  await media.resize(801);
  await toggleSidebar();
  expect(sidebarToggle().getAttribute("aria-expanded")).toBe("true");
  await media.resize(800);
  expect(sidebarToggle().getAttribute("aria-expanded")).toBe("false");
  await media.resize(801);
  expect(sidebarToggle().getAttribute("aria-expanded")).toBe("true");
});

it("窄屏选会话关闭抽屉，设置接管焦点且均不改写桌面偏好", async () => {
  mediaBoundary(800);
  localStorage.setItem(sidebarHiddenKey, "true");
  boundary(layoutSessions);
  await render(<App />);
  await toggleSidebar();
  await act(async () => {
    sessionButton("Alpha one").focus();
    sessionButton("Alpha one").click();
  });
  expect(sessionButton("Alpha one").getAttribute("aria-current")).toBe("page");
  expect(sidebarToggle().getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).not.toBe(sidebarToggle());
  await toggleSidebar();
  await act(async () => container.querySelector<HTMLButtonElement>(".sidebar-footer button")!.click());
  const dialog = container.querySelector('[role="dialog"][aria-label="设置"]')!;
  expect(dialog).not.toBeNull();
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(sidebarToggle().getAttribute("aria-expanded")).toBe("false");
  expect(localStorage.getItem(sidebarHiddenKey)).toBe("true");
});

it("卸载时清理 matchMedia 订阅，重新挂载只保留当前消费者", async () => {
  const media = mediaBoundary();
  boundary();
  await render(<App />);
  const listeners = () => media.queries.reduce((count, query) => count + query.listeners.size, 0);
  expect(listeners()).toBeGreaterThan(0);
  await render(null);
  expect(listeners()).toBe(0);
  await media.resize(800);
  await render(<App />);
  expect(sidebarToggle().getAttribute("aria-expanded")).toBe("false");
  await render(null);
  expect(listeners()).toBe(0);
});

it.each(["hide", "breakpoint"] as const)(
  "拖动中通过 %s 隐藏会话目录会释放捕获，恢复后不能继续旧拖动",
  async (reason) => {
    const media = mediaBoundary(1024);
    localStorage.setItem("omp-desktop.sidebar-width", "300");
    boundary();
    await render(<App />);
    const handle = resizeHandle()!;
    const release = vi.fn();
    Object.defineProperties(handle, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: release },
    });
    vi.spyOn(handle.parentElement!, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 300, 800));
    await act(async () => {
      handle.dispatchEvent(Object.assign(new MouseEvent("pointerdown", { button: 0, clientX: 300, bubbles: true }), { pointerId: 1 }));
      handle.dispatchEvent(new MouseEvent("pointermove", { clientX: 330, bubbles: true }));
    });
    expect(localStorage.getItem("omp-desktop.sidebar-width")).toBe("330");
    if (reason === "hide") await toggleSidebar();
    else await media.resize(800);
    expect(resizeHandle()).toBeNull();
    expect(release).toHaveBeenCalledTimes(1);
    if (reason === "hide") await toggleSidebar();
    else await media.resize(1024);
    const restored = resizeHandle()!;
    expect(restored).not.toBe(handle);
    await act(async () => {
      restored.dispatchEvent(new MouseEvent("pointermove", { clientX: 450, bubbles: true }));
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 460, bubbles: true }));
    });
    expect(restored.getAttribute("aria-valuenow")).toBe("330");
    expect(localStorage.getItem("omp-desktop.sidebar-width")).toBe("330");
  },
);
