import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { render } from "./transcript-test-harness";
import { ContextActionsMenu } from "./ContextActionsMenu";
import { PromptContexts, type PromptContextActions } from "./PromptContexts";

const context = { kind: "file" as const, path: "/project/a.ts", text: "source\n", representation: "source" as const, startLine: 1, endLine: 1 };
afterEach(() => vi.unstubAllGlobals());

it("无草稿 provider 只提供复制，键盘跳过禁用项并显示复制错误", async () => {
  vi.stubGlobal("desktop", { copyText: vi.fn(async () => { throw new Error("复制失败"); }) });
  await render(<ContextActionsMenu x={10} y={10} copyText="source\n" context={context} onClose={vi.fn()} />);
  const menu = document.body.querySelector('[aria-label="正文操作"]')!;
  expect(menu.querySelectorAll("button")).toHaveLength(1);
  await act(() => menu.querySelector<HTMLButtonElement>("button")!.click());
  expect(menu.querySelector('[role="alert"]')?.textContent).toBe("复制失败");
});

it("评论失败保留菜单，空复制时 Home/End 只定位可用操作", async () => {
  const actions: PromptContextActions = { comment: vi.fn(() => { throw new Error("请先完成或取消当前评论"); }), append: vi.fn() };
  const close = vi.fn();
  await render(<PromptContexts.Provider value={actions}><ContextActionsMenu x={10} y={10} copyText="" context={context} onClose={close} allowAppend /></PromptContexts.Provider>);
  const menu = document.body.querySelector('[aria-label="正文操作"]')!;
  const buttons = [...menu.querySelectorAll<HTMLButtonElement>("button")];
  expect(buttons[0].disabled).toBe(true);
  expect(document.activeElement).toBe(buttons[1]);
  await act(() => buttons[1].click());
  expect(close).not.toHaveBeenCalled();
  expect(menu.querySelector('[role="alert"]')?.textContent).toContain("请先完成");
  await act(() => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(buttons[2]);
  await act(() => buttons[2].click());
  expect(actions.append).toHaveBeenCalledWith(context);
  expect(close).toHaveBeenCalledTimes(1);
});
