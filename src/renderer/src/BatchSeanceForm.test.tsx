import { act } from "react";
import { expect, it, vi } from "vitest";
import type { SeanceBatchItem, SeanceConsultation, SeanceSource, SessionSummary } from "../../shared/protocol";
import { BatchSeanceForm } from "./BatchSeanceForm";
import { click, container, render } from "./transcript-test-harness";

/** 提供稳定路径与可见名称。 */
function session(id: string): SessionSummary {
  return { path: `${id}.jsonl`, id, cwd: "/project", title: id, timestamp: "", modified: 0 };
}

/** 修改受控输入，走真实 React 输入处理。 */
async function type(input: HTMLInputElement, value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** 提交真实表单。 */
async function submit() {
  await act(() => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}

it("各来源独立选择保存或临时模型，单次批量启动且重试不包含成功项", async () => {
  const sessions = [session("alpha"), session("beta")];
  const launch = vi.fn<(requests: readonly SeanceConsultation[]) => Promise<SeanceBatchItem[]>>()
    .mockResolvedValueOnce([
      { sourceSession: "alpha.jsonl", launch: { state: "running", taskIds: ["task-a"] } },
      { sourceSession: "beta.jsonl", error: "provider unavailable" },
    ])
    .mockResolvedValueOnce([{ sourceSession: "beta.jsonl", launch: { state: "completed", taskIds: ["task-b"] } }]);
  const inspect = vi.fn(async (path: string) => ({ path, modelSelectors: [`saved/${path}`] }));
  await render(<BatchSeanceForm sessions={sessions} onInspect={inspect} onModels={async () => []} onLaunch={launch} onCancel={() => {}} />);
  expect(inspect).toHaveBeenCalledTimes(2);
  expect(launch).not.toHaveBeenCalled();
  const fields = container.querySelectorAll("fieldset");
  await click(fields[1].querySelectorAll<HTMLInputElement>('input[type="radio"]')[1]);
  await type(fields[1].querySelector<HTMLInputElement>('input[list]')!, "other/model");
  expect(fields[0].querySelector<HTMLInputElement>('input[type="radio"]')!.checked).toBe(true);
  await submit();
  expect(launch).toHaveBeenNthCalledWith(1, [
    { sourceSession: "alpha.jsonl" }, { sourceSession: "beta.jsonl", model: "other/model" },
  ]);
  expect(container.textContent).toContain("beta：provider unavailable");
  expect(fields[0].disabled).toBe(true);
  await type(fields[1].querySelector<HTMLInputElement>('input[list]')!, "repaired/model");
  await submit();
  expect(launch).toHaveBeenNthCalledWith(2, [{ sourceSession: "beta.jsonl", model: "repaired/model" }]);
  expect(container.textContent).toContain("咨询已完成");
  expect(container.textContent).toContain("已成功启动 2 个咨询");
  await submit();
  expect(launch).toHaveBeenCalledTimes(2);
});

it("来源解析失败不隐藏其他来源，缺少保存模型必须填写临时模型，取消不启动任务", async () => {
  const launch = vi.fn(async () => []);
  const cancel = vi.fn();
  const inspect = vi.fn(async (path: string) => {
    if (path === "broken.jsonl") throw new Error("invalid source");
    return { path, modelSelectors: [] };
  });
  await render(<BatchSeanceForm sessions={[session("broken"), session("valid")]} onInspect={inspect}
    onModels={async () => { throw new Error("model catalog offline"); }} onLaunch={launch} onCancel={cancel} />);
  expect(container.textContent).toContain("broken：invalid source");
  expect(container.textContent).toContain("model catalog offline");
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  await type(container.querySelector<HTMLInputElement>('[aria-label="valid 的 Seance 模型"]')!, "provider/manual");
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  await click([...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "取消")!);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(launch).not.toHaveBeenCalled();
});

it("更换来源集合后迟到的解析结果不能覆盖新来源或启动旧来源", async () => {
  const pending = new Map<string, (source: SeanceSource) => void>();
  const inspect = (path: string) => new Promise<SeanceSource>((resolve) => { pending.set(path, resolve); });
  const launch = vi.fn(async () => []);
  const models = async () => [];
  await render(<BatchSeanceForm sessions={[session("old")]} onInspect={inspect} onModels={models} onLaunch={launch} onCancel={() => {}} />);
  await render(<BatchSeanceForm sessions={[session("new")]} onInspect={inspect} onModels={models} onLaunch={launch} onCancel={() => {}} />);
  await act(async () => pending.get("old.jsonl")!({ path: "old.jsonl", modelSelectors: ["old/model"] }));
  expect(container.textContent).not.toContain("old/model");
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  await act(async () => pending.get("new.jsonl")!({ path: "new.jsonl", modelSelectors: ["new/model"] }));
  expect(container.textContent).toContain("new/model");
  expect(launch).not.toHaveBeenCalled();
});

it("批量调用整体拒绝后逐项保留错误且可以重试，不重复提交进行中的请求", async () => {
  let rejectLaunch: (reason: Error) => void = () => { throw new Error("launch not called"); };
  const launch = vi.fn<(requests: readonly SeanceConsultation[]) => Promise<SeanceBatchItem[]>>()
    .mockImplementationOnce(() => new Promise<SeanceBatchItem[]>((_, reject) => { rejectLaunch = reject; }))
    .mockResolvedValueOnce([{ sourceSession: "one.jsonl", launch: { state: "running", taskIds: ["one"] } }]);
  await render(<BatchSeanceForm sessions={[session("one")]} onInspect={async (path) => ({ path, modelSelectors: ["saved/model"] })}
    onModels={async () => []} onLaunch={launch} onCancel={() => {}} />);
  await submit();
  expect(container.textContent).toContain("正在启动咨询");
  await submit();
  expect(launch).toHaveBeenCalledTimes(1);
  await act(async () => rejectLaunch(new Error("transport failed")));
  expect(container.textContent).toContain("one：transport failed");
  await submit();
  expect(launch).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain("已成功启动 1 个咨询");
});

it("旧集合启动结果在卸载后返回不会将新集合标为成功或阻止新来源启动", async () => {
  let finish: (items: SeanceBatchItem[]) => void = () => { throw new Error("launch not called"); };
  const launch = vi.fn<(requests: readonly SeanceConsultation[]) => Promise<SeanceBatchItem[]>>()
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce([{ sourceSession: "new.jsonl", launch: { state: "completed", taskIds: ["new"] } }]);
  const inspect = async (path: string) => ({ path, modelSelectors: ["saved/model"] });
  const models = async () => [];
  await render(<BatchSeanceForm sessions={[session("old")]} onInspect={inspect} onModels={models} onLaunch={launch} onCancel={() => {}} />);
  await submit();
  await render(<BatchSeanceForm sessions={[session("new")]} onInspect={inspect} onModels={models} onLaunch={launch} onCancel={() => {}} />);
  await act(async () => finish([{ sourceSession: "old.jsonl", launch: { state: "running", taskIds: ["old"] } }]));
  expect(container.textContent).not.toContain("已成功启动");
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  await submit();
  expect(launch).toHaveBeenNthCalledWith(2, [{ sourceSession: "new.jsonl" }]);
  expect(container.textContent).toContain("咨询已完成");
});

it("部分来源缺模型时不悄悄跳过它，仅在所有可解析来源选好模型后提交", async () => {
  const launch = vi.fn(async () => []);
  await render(<BatchSeanceForm sessions={[session("saved"), session("missing")]}
    onInspect={async (path) => ({ path, modelSelectors: path === "saved.jsonl" ? ["provider/saved"] : [] })}
    onModels={async () => []} onLaunch={launch} onCancel={() => {}} />);
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  await submit();
  expect(launch).not.toHaveBeenCalled();
  await type(container.querySelector<HTMLInputElement>('[aria-label="missing 的 Seance 模型"]')!, "provider/selected");
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
});
