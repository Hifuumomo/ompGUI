// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, onTestFinished, vi } from "vitest";
import type { AgentMessage } from "../../shared/protocol";
import { OutputFileProbe } from "./output-file-links";
import { toolCall } from "./inline-transcript-test-helpers";
import { Transcript } from "./Transcript";

/** 挂载带存在性确认与打开入口的真实时间线。[in] messages：原生消息；[in] probe：存在性确认；[in] open：文件打开入口。返回值：挂载容器。 */
async function mount(
  messages: AgentMessage[],
  probe: ((path: string) => Promise<boolean>) | undefined,
  open: (href: string) => Promise<void>,
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  onTestFinished(async () => {
    await act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  await act(() =>
    root.render(
      <OutputFileProbe.Provider value={probe}>
        <Transcript
          messages={messages.map((message, index) => ({
            key: `message:${index}`,
            message,
            streaming: false,
          }))}
          tools={[]}
          sessionId="session-a"
          onOpenFile={open}
        />
      </OutputFileProbe.Provider>,
    ),
  );
  return container;
}

/** 展开过程组并点击工具行目标，再等待存在性确认完成。[in] container：挂载容器；[in] id：工具调用标识。返回值：工具行。 */
async function expand(container: HTMLElement, id: string) {
  const row = container.querySelector<HTMLDetailsElement>(`.tool-row[data-tool-id="${id}"]`)!;
  const group = row.closest<HTMLDetailsElement>(".process-group");
  if (group && !group.open)
    await act(() => group.querySelector<HTMLElement>(":scope > summary")!.click());
  await act(() => row.querySelector<HTMLButtonElement>("summary button.tool-target")!.click());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return row;
}

const opener = () => vi.fn(async (_href: string) => {});

it("搜索结果中存在的路径渲染为链接，点击在侧栏打开，行号用次要色文本", async () => {
  const open = opener();
  const probe = vi.fn(async (path: string) => path === "src/a/one.ts");
  const container = await mount(
    [
      toolCall("s", "grep", { pattern: "needle" }),
      {
        role: "toolResult",
        toolCallId: "s",
        content: "src/a/one.ts:12:needle here\nsrc/a/two.ts:3:needle",
      },
    ],
    probe,
    open,
  );
  const row = await expand(container, "s");
  const links = row.querySelectorAll<HTMLAnchorElement>(".inline-tool-output a.rich-file-link");
  expect(links).toHaveLength(1);
  expect(links[0].textContent).toContain("src/a/one.ts");
  expect(row.querySelector(".inline-tool-output")?.textContent).toContain("src/a/two.ts:3:needle");
  expect(row.querySelector(".inline-output-location")?.textContent).toBe(":12");
  expect(probe).toHaveBeenCalledTimes(2);
  await act(() => links[0].click());
  expect(open).toHaveBeenCalledExactlyOnceWith("src/a/one.ts");
});

it("Shell 输出中不存在的路径保持纯文本，存在的路径成为链接", async () => {
  const container = await mount(
    [
      toolCall("t", "bash", { command: "npx tsc --noEmit" }),
      {
        role: "toolResult",
        toolCallId: "t",
        content: [
          { type: "text", text: "src/App.tsx(12,3): error TS2322\nsrc/gone.ts(1,1): error TS2304" },
        ],
      },
    ],
    async (path) => path === "src/App.tsx",
    opener(),
  );
  const row = await expand(container, "t");
  const output = row.querySelector(".inline-tool-output")!;
  const links = output.querySelectorAll("a");
  expect(links).toHaveLength(1);
  expect(links[0].textContent).toContain("src/App.tsx");
  expect(output.textContent).toBe("src/App.tsx(12,3): error TS2322\nsrc/gone.ts(1,1): error TS2304");
});

it("存在性确认完成之前输出保持纯文本", async () => {
  const container = await mount(
    [
      toolCall("t", "bash", { command: "git status --short" }),
      { role: "toolResult", toolCallId: "t", content: [{ type: "text", text: " M src/a.ts" }] },
    ],
    () => new Promise<boolean>(() => {}),
    opener(),
  );
  const row = await expand(container, "t");
  expect(row.querySelector(".inline-tool-output a")).toBeNull();
  expect(row.querySelector(".inline-tool-output")?.textContent).toBe(" M src/a.ts");
});

it("文件目标行尾的「↗」在侧栏打开文件，不展开详情", async () => {
  const open = opener();
  const container = await mount(
    [toolCall("r", "read", { path: "src/a.ts" })],
    undefined,
    open,
  );
  const row = container.querySelector<HTMLDetailsElement>('.tool-row[data-tool-id="r"]')!;
  const button = row.querySelector<HTMLButtonElement>("summary .tool-target-open")!;
  expect(button.getAttribute("aria-label")).toBe("在侧栏打开 src/a.ts");
  await act(() => button.click());
  expect(open).toHaveBeenCalledExactlyOnceWith("src/a.ts");
  expect(row.open).toBe(false);
  expect(row.querySelector(".inline-file-details")).toBeNull();
});

it("工具行右侧显示结果摘要：命令为输出行数，搜索为结果处数", async () => {
  const container = await mount(
    [
      toolCall("b", "bash", { command: "npm test" }),
      { role: "toolResult", toolCallId: "b", content: [{ type: "text", text: "l1\nl2\nl3\nl4" }] },
      toolCall("g", "grep", { pattern: "x" }),
      { role: "toolResult", toolCallId: "g", content: "a/b.ts:1:x\na/c.ts:2:x\na/d.ts:3:x" },
    ],
    undefined,
    opener(),
  );
  const summary = (id: string) =>
    container.querySelector(`.tool-row[data-tool-id="${id}"] .tool-row-result`)?.textContent;
  expect(summary("b")).toBe("4 行");
  expect(summary("g")).toBe("3 处");
});
