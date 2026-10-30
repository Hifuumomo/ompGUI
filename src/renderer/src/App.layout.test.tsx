import { offPlanBridge } from "./plan-test-fixture";
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { container, render } from "./transcript-test-harness";

const key = "omp-desktop.conversation-gutter";
beforeEach(() => {
  localStorage.removeItem(key);
  localStorage.removeItem("omp-desktop.sidebar-width");
  localStorage.removeItem("omp-desktop.interface-font-size");
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.removeItem(key);
  localStorage.removeItem("omp-desktop.sidebar-width");
  localStorage.removeItem("omp-desktop.interface-font-size");
  vi.restoreAllMocks();
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

function boundary() {
  const start = vi.fn();
  const setZoomFactor = vi.fn();
  vi.stubGlobal("desktop", {
    setZoomFactor,
    preferences: async () => ({ executable: "omp.exe", cwd: "D:/workspace" }),
    listSessions: async () => [],
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
