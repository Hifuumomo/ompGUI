import { act } from "react";
import { expect, it, vi } from "vitest";
import type { SessionSummary } from "../../shared/protocol";
import { SessionMenu, type SessionDeletionResult } from "./SessionMenu";
import { click, container, render } from "./transcript-test-harness";

/** 构造两个路径不同的真实菜单目标。 */
function session(id: string): SessionSummary {
  return { path: `${id}.jsonl`, id, cwd: "/project", title: id, timestamp: "", modified: 0 };
}

/** 按可见文本查找用户可点击的按钮。 */
function button(text: string) {
  const result = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === text);
  expect(result).toBeDefined();
  return result!;
}

it("多选菜单只暴露批量操作，键盘导航及直接复制保留完整选择", async () => {
  const sessions = [session("alpha"), session("beta")];
  const copy = vi.fn(async () => {});
  const close = vi.fn();
  await render(<SessionMenu engines={[]} onEngine={async () => {}} target={{ sessions, x: 9000, y: 9000 }} current={false} onClose={close}
    onRename={async () => {}} onDelete={async () => []} onCopy={copy} onSeance={async () => {}} />);
  expect(container.textContent).toContain("已选择 2 个会话");
  expect(container.textContent).not.toContain("重命名");
  expect(container.textContent).not.toContain("主要内容");
  expect(container.querySelector('[aria-haspopup="menu"]')).toBeNull();
  const remove = button("删除");
  expect(document.activeElement).toBe(button("开启 omp（2）"));
  remove.focus();
  await act(() => remove.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  expect(document.activeElement).toBe(button("复制所选会话 JSONL 路径"));
  await click(button("复制所选会话 JSONL 路径"));
  expect(copy).toHaveBeenCalledExactlyOnceWith(sessions, "paths");
  expect(close).toHaveBeenCalledTimes(1);
});

it("部分删除逐项显示失败及成功数，重试只提交失败路径", async () => {
  const sessions = [session("alpha"), session("beta"), session("gamma")];
  const remove = vi.fn<(items: readonly SessionSummary[]) => Promise<SessionDeletionResult[]>>()
    .mockResolvedValueOnce([
      { path: sessions[0].path },
      { path: sessions[1].path, error: "SESSION_OCCUPIED" },
      { path: sessions[2].path, error: "permission denied" },
    ])
    .mockResolvedValueOnce([{ path: sessions[1].path }, { path: sessions[2].path, error: "permission denied" }])
    .mockResolvedValueOnce([{ path: sessions[2].path }]);
  const close = vi.fn();
  await render(<SessionMenu engines={[]} onEngine={async () => {}} target={{ sessions, x: 10, y: 10 }} current onClose={close}
    onRename={async () => {}} onDelete={remove} onCopy={async () => {}} onSeance={async () => {}} />);
  await click(button("删除"));
  expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
  expect(container.textContent).toContain("包含当前打开的会话");
  expect(container.querySelectorAll(".session-delete-list li")).toHaveLength(3);
  await click(button("确认删除"));
  expect(remove).toHaveBeenNthCalledWith(1, sessions);
  expect(close).not.toHaveBeenCalled();
  expect(container.textContent).toContain("已成功删除 1 个会话");
  expect(container.querySelectorAll('[role="alert"]')).toHaveLength(2);
  expect(container.textContent).toContain("其他 omp 实例");
  await click(button("重试失败项"));
  expect(remove).toHaveBeenNthCalledWith(2, sessions.slice(1));
  expect(container.textContent).toContain("已成功删除 2 个会话");
  await click(button("重试失败项"));
  expect(remove).toHaveBeenNthCalledWith(3, [sessions[2]]);
  expect(close).toHaveBeenCalledTimes(1);
});

it("单选保留重命名和键盘子菜单，Esc 先回到父菜单再关闭", async () => {
  const close = vi.fn();
  await render(<SessionMenu engines={[]} onEngine={async () => {}} target={{ sessions: [session("alpha")], x: 10, y: 10 }} current={false} onClose={close}
    onRename={async () => {}} onDelete={async () => []} onCopy={async () => {}} onSeance={async () => {}} />);
  expect(button("重命名")).toBeDefined();
  const submenu = container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
  await act(() => {
    submenu.focus();
    submenu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  });
  expect(document.activeElement).toBe(button("复制会话 JSONL 路径"));
  expect(button("复制会话主要内容")).toBeDefined();
  await act(() => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.activeElement).toBe(submenu);
  expect(close).not.toHaveBeenCalled();
  await act(() => submenu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(close).toHaveBeenCalledTimes(1);
});

it("会话引擎批量菜单只操作合条件目标，单会话状态禁用互斥操作", async () => {
  const alpha = session("alpha");
  const beta = session("beta");
  const onEngine = vi.fn(async () => {});
  const props = { current: false, onClose: vi.fn(), onRename: async () => {}, onDelete: async () => [], onCopy: async () => {}, onSeance: async () => {}, onEngine };
  await render(<SessionMenu {...props} target={{ sessions: [alpha, beta], x: 0, y: 0 }}
    engines={[{ id: "alpha-engine", sessionPath: alpha.path, state: "active" }]} />);
  await click(button("开启 omp（1）"));
  expect(onEngine).toHaveBeenLastCalledWith([beta], true);
  await render(<SessionMenu key="single-live" {...props} target={{ sessions: [alpha], x: 0, y: 0 }}
    engines={[{ id: "alpha-engine", sessionPath: alpha.path, state: "idle" }]} />);
  expect(button("开启 omp").disabled).toBe(true);
  expect(button("关闭 omp").disabled).toBe(false);
  await click(button("关闭 omp"));
  expect(onEngine).toHaveBeenLastCalledWith([alpha], false);
  await render(<SessionMenu key="single-closed" {...props} target={{ sessions: [beta], x: 0, y: 0 }} engines={[]} />);
  expect(button("开启 omp").disabled).toBe(false);
  expect(button("关闭 omp").disabled).toBe(true);
});
