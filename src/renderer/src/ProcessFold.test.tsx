// @vitest-environment jsdom
import { act, useState, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  container,
  click,
  render,
  timeline,
  call,
} from "./transcript-test-harness";
import { Transcript } from "./Transcript";
import { ProcessFold } from "./ProcessFold";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** 真实主会话折叠保留外部回复和各工具的展开状态。 */
it("full 过程默认展开，折叠卸载正文并保留工具展开状态", async () => {
  await render(
    <Transcript
      mode="full"
      sessionId="full"
      tools={[]}
      messages={timeline([
        { role: "user", content: "开始" },
        {
          role: "assistant",
          content: [{ type: "thinking", thinking: "完整思考" }],
        },
        call("one", "unknown"),
        call("two", "unknown"),
        call("todo", "todo"),
        { role: "assistant", content: "最终回复" },
      ])}
    />,
  );
  expect(container.querySelector(".process-group")).toBeNull();
  expect(container.querySelectorAll(".tool-card")).toHaveLength(2);
  const card = container.querySelector<HTMLElement>(".tool-card-header")!;
  await click(card);
  expect(card.getAttribute("aria-expanded")).toBe("true");
  await click(container.querySelector<HTMLElement>(".process-fold-header")!);
  expect(container.querySelector(".tool-card")).toBeNull();
  expect(container.querySelector(".thinking-block")).toBeNull();
  expect(container.textContent).toContain("最终回复");
  expect(container.querySelector(".process-fold-chevron")?.textContent).toBe(
    "›",
  );
  await click(container.querySelector<HTMLElement>(".process-fold-header")!);
  expect(
    container.querySelector(".tool-card-header")?.getAttribute("aria-expanded"),
  ).toBe("true");
  expect(container.querySelector(".process-fold-chevron")?.textContent).toBe(
    "⌄",
  );
});

/** 原生命令失败计入折叠标题，取消终态不误报失败。 */
it("full 失败徽标与命令卡片一致，折叠后仍显示", async () => {
  await render(
    <Transcript
      mode="full"
      sessionId="native-errors"
      tools={[]}
      messages={timeline([
        { role: "user", content: "运行命令" },
        {
          role: "bashExecution",
          command: "fail",
          output: "failed",
          exitCode: 2,
        },
        {
          role: "bashExecution",
          command: "cancel",
          output: "cancelled",
          exitCode: 130,
          cancelled: true,
        },
        { role: "assistant", content: "已处理" },
      ])}
    />,
  );
  expect(
    container.querySelector(".process-fold-failures")?.textContent,
  ).toContain("1 个失败");
  await click(container.querySelector<HTMLElement>(".process-fold-header")!);
  expect(container.querySelector(".tool-card")).toBeNull();
  expect(
    container.querySelector(".process-fold-failures")?.textContent,
  ).toContain("1 个失败");
});

/** 折叠不停止运行标题的计时，结束后释放计时器。 */
it("运行中可折叠并继续计时，结束时停止，显示失败计数", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  /** 为测试提供受控折叠状态。参数：[in] active 是否运行。返回值：折叠容器。 */
  function Example({ active }: { active: boolean }) {
    const [collapsed, setCollapsed] = useState(false);
    return (
      <ProcessFold
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
        active={active}
        startedAt={1_000}
        endedAt={12_000}
        failures={2}
      >
        <p>正文</p>
      </ProcessFold>
    );
  }
  await render(<Example active />);
  await click(container.querySelector<HTMLElement>(".process-fold-header")!);
  const before = container.querySelector(".process-fold-time")!.textContent;
  await act(() => {
    vi.advanceTimersByTime(2_000);
  });
  expect(container.querySelector(".process-fold-time")!.textContent).not.toBe(
    before,
  );
  expect(container.textContent).toContain("2 个失败");
  expect(container.textContent).not.toContain("正文");
  await render(<Example active={false} />);
  const ended = container.textContent;
  await act(() => {
    vi.advanceTimersByTime(5_000);
  });
  expect(container.textContent).toBe(ended);
  expect(vi.getTimerCount()).toBe(0);
});

/** 模拟滚动区布局：标题文档坐标为 headerAt，正文高 bodyHeight，标题高 30。返回值：读写 scrollTop 的句柄。 */
function fakeLayout(headerAt: number, bodyHeight: number) {
  let scrollTop = 0;
  /** 判断元素是否为测试滚动区。参数：[in] el 元素。返回值：是否为滚动区。 */
  const isScroller = (el: Element) => el.classList.contains("scroller");
  vi.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(
    function (this: Element) {
      return isScroller(this) ? scrollTop : 0;
    },
  );
  vi.spyOn(Element.prototype, "scrollTop", "set").mockImplementation(
    function (this: Element, value: number) {
      if (isScroller(this)) scrollTop = Math.max(0, value);
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      if (this.classList.contains("process-fold-body")) return bodyHeight;
      if (this.classList.contains("process-fold-header")) return 30;
      return 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      /** 构造给定顶边的矩形。参数：[in] top 顶边。返回值：矩形。 */
      const rect = (top: number) =>
        ({
          top,
          bottom: top + 30,
          left: 0,
          right: 600,
          width: 600,
          height: 30,
          x: 0,
          y: top,
          toJSON() {},
        }) as DOMRect;
      if (isScroller(this)) return rect(0);
      const open = !!container.querySelector(".process-fold-body");
      const sticky = !!container.querySelector(
        '.process-fold[data-sticky="true"]',
      );
      if (this.classList.contains("process-fold-header")) {
        const natural = headerAt - scrollTop;
        return rect(open && sticky ? Math.max(0, natural) : natural);
      }
      if (this.classList.contains("process-fold-footer"))
        return rect(headerAt + bodyHeight - scrollTop);
      return rect(0);
    },
  );
  return {
    get top() {
      return scrollTop;
    },
    set top(value: number) {
      scrollTop = value;
    },
  };
}

/** 在滚动区内渲染受控折叠容器；参数：[in] children 正文。返回值：折叠容器。 */
function Fold({ children }: { children?: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="scroller" style={{ overflowY: "auto" }}>
      <ProcessFold
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
        failures={0}
      >
        {children ?? <p>正文</p>}
      </ProcessFold>
    </div>
  );
}

/** 取得折叠容器。参数：无。返回值：section。 */
const section = () => container.querySelector<HTMLElement>(".process-fold")!;
/** 取得标题按钮。参数：无。返回值：标题。 */
const header = () =>
  container.querySelector<HTMLButtonElement>(".process-fold-header")!;
/** 取得底部收起条。参数：无。返回值：收起条或 null。 */
const footer = () =>
  container.querySelector<HTMLButtonElement>(".process-fold-footer");

it("短正文不吸顶，也没有底部收起条", async () => {
  fakeLayout(100, 200);
  await render(<Fold />);
  expect(section().dataset.sticky).toBe("false");
  expect(footer()).toBeNull();
});

it("正文有展开卡片但不到半屏时不吸顶", async () => {
  fakeLayout(100, 200);
  await render(
    <Fold>
      <div data-expanded="true">卡片</div>
    </Fold>,
  );
  expect(section().dataset.sticky).toBe("false");
});

it("长正文吸顶，写入标题高度并显示底部收起条；收起后清除", async () => {
  fakeLayout(1000, 2000);
  await render(<Fold />);
  expect(section().dataset.sticky).toBe("true");
  expect(footer()).not.toBeNull();
  expect(section().style.getPropertyValue("--process-sticky-top")).toBe(
    "30px",
  );
  await click(header());
  expect(section().dataset.sticky).toBe("false");
  expect(footer()).toBeNull();
});

it("从底部条收起：标题移到底部条原位置，焦点落在标题", async () => {
  const layout = fakeLayout(1000, 2000);
  await render(<Fold />);
  layout.top = 2600;
  await click(footer()!);
  expect(layout.top).toBe(600);
  expect(document.activeElement).toBe(header());
});

it("从吸顶标题收起：标题留在滚动区顶部，焦点仍在标题", async () => {
  const layout = fakeLayout(1000, 2000);
  await render(<Fold />);
  layout.top = 1500;
  header().focus();
  await click(header());
  expect(layout.top).toBe(1000);
  expect(document.activeElement).toBe(header());
});

it("标题在视口内收起时不滚动", async () => {
  const layout = fakeLayout(100, 200);
  await render(<Fold />);
  await click(header());
  expect(layout.top).toBe(0);
});

it("未吸顶但标题在视口上方时收起，标题对齐到顶部", async () => {
  const layout = fakeLayout(100, 200);
  await render(<Fold />);
  layout.top = 150;
  await click(header());
  expect(layout.top).toBe(100);
});

it("键盘激活底部收起条后已收起且焦点在标题", async () => {
  fakeLayout(1000, 2000);
  await render(<Fold />);
  footer()!.focus();
  await click(footer()!);
  expect(header().getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(header());
});

it("收起后再展开：正文恢复且滚动位置不变", async () => {
  const layout = fakeLayout(1000, 2000);
  await render(<Fold />);
  layout.top = 2600;
  await click(footer()!);
  const collapsedTop = layout.top;
  await click(header());
  expect(container.textContent).toContain("正文");
  expect(layout.top).toBe(collapsedTop);
});
