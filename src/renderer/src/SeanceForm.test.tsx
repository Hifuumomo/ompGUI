import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { SeanceForm } from "./SeanceForm";
import { container, render } from "./transcript-test-harness";
import type { SeanceSource } from "../../shared/protocol";

afterEach(() => vi.useRealTimers());

it("切换来源后迟到的旧查询不能覆盖当前来源或启用错误咨询", async () => {
  vi.useFakeTimers();
  const pending: Record<string, (source: SeanceSource) => void> = {};
  const inspect = (source: string) => new Promise<SeanceSource>((resolve) => { pending[source] = resolve; });
  const launch = vi.fn(async () => {});
  await render(<SeanceForm sessions={[]} initialSource="old" onInspect={inspect}
    onModels={async () => []} onLaunch={launch} onCancel={() => {}} />);
  await act(() => vi.advanceTimersByTime(200));
  const input = container.querySelector<HTMLInputElement>('[aria-label="Seance 源会话"]')!;
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "new");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => vi.advanceTimersByTime(200));
  await act(async () => pending.old({ path: "old.jsonl", modelSelectors: ["old/model"] }));
  expect(container.textContent).not.toContain("old/model");
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  await act(async () => pending.new({ path: "new.jsonl", modelSelectors: [] }));
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  expect(container.querySelector('[aria-label="Seance 模型"]')).not.toBeNull();
  expect(launch).not.toHaveBeenCalled();
});

it("长路径连续编辑不触发逐次同步 effect 更新循环，完成解析后才可咨询", async () => {
  vi.useFakeTimers();
  const sourcePath = "C:/some-project/with-a-long-directory-name/saved-sessions/history/source.jsonl";
  await render(<SeanceForm sessions={[]} onInspect={async () => ({ path: sourcePath, modelSelectors: ["provider/model"] })}
    onModels={async () => []} onLaunch={async () => {}} onCancel={() => {}} />);
  const input = container.querySelector<HTMLInputElement>('[aria-label="Seance 源会话"]')!;
  for (let length = 1; length <= sourcePath.length; length++) {
    await act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, sourcePath.slice(0, length));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  await act(async () => vi.advanceTimersByTime(200));
  expect(container.textContent).toContain(sourcePath);
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
});
