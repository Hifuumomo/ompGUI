import { act } from "react";
import { expect, it, vi } from "vitest";
import {
  createTranscriptView,
  toolCall,
} from "./inline-transcript-test-helpers";

it("psh 命令按需格式化详情，原始参数和摘要保持完整", async () => {
  const view = createTranscriptView();
  const command = "Get-Process | Select-Object Name";
  const args = { command };
  const formatCommand = vi.fn(async () => "Get-Process |\nSelect-Object Name");
  vi.stubGlobal("desktop", { formatCommand });
  await view.render({ messages: [toolCall("ps", "psh", args)] });
  expect(formatCommand).not.toHaveBeenCalled();
  await view.click(view.target("ps"));
  expect(formatCommand).toHaveBeenCalledExactlyOnceWith("psh", command);
  expect(view.container.querySelector(".inline-tool-source")?.textContent).toBe(
    "$ Get-Process |\nSelect-Object Name",
  );
  expect(args.command).toBe(command);
  expect(view.target("ps").textContent).toBe(command);
});

it("格式化失败继续展示原文", async () => {
  const view = createTranscriptView();
  const command = "Get-Process | Select-Object Name";
  vi.stubGlobal("desktop", {
    formatCommand: vi.fn().mockRejectedValue(new Error("unavailable")),
  });
  await view.render({ messages: [toolCall("ps", "psh", { command })] });
  await view.click(view.target("ps"));
  expect(view.container.querySelector(".inline-tool-source")?.textContent).toBe(
    `$ ${command}`,
  );
});

it("切换命令后忽略旧格式化结果", async () => {
  const view = createTranscriptView();
  let finishOld!: (value: string) => void;
  const formatCommand = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockResolvedValue("Get-Date |\nOut-String");
  vi.stubGlobal("desktop", { formatCommand });
  await view.render({
    messages: [toolCall("ps", "psh", { command: "Get-Process | Out-String" })],
  });
  await view.click(view.target("ps"));
  await view.render({
    messages: [toolCall("ps", "psh", { command: "Get-Date | Out-String" })],
  });
  await act(async () => finishOld("OLD RESULT"));
  expect(view.container.querySelector(".inline-tool-source")?.textContent).toBe(
    "$ Get-Date |\nOut-String",
  );
});

/** 创建带指定行数输出的命令调用与结果。[in] lines：输出行数。返回值：原生消息与完整输出文本。 */
function outputScenario(lines: number) {
  const text = Array.from({ length: lines }, (_, index) => `line ${index + 1}`).join("\n");
  return {
    text,
    messages: [
      toolCall("out", "bash", { command: "npm test" }),
      {
        role: "toolResult" as const,
        toolCallId: "out",
        content: [{ type: "text" as const, text }],
      },
    ],
  };
}

it("输出超过 12 行时只显示前 3 行和后 4 行，中间给出省略按钮", async () => {
  const view = createTranscriptView();
  const { messages } = outputScenario(20);
  await view.render({ messages });
  await view.click(view.target("out"));
  const pres = [...view.row("out").querySelectorAll(".inline-tool-output pre")];
  expect(pres.map((pre) => pre.textContent)).toEqual([
    "line 1\nline 2\nline 3",
    "line 17\nline 18\nline 19\nline 20",
  ]);
  const button = view.row("out").querySelector<HTMLButtonElement>(".inline-output-omitted")!;
  expect(button.tagName).toBe("BUTTON");
  expect(button.textContent).toContain("省略中间 13 行");
  expect(button.getAttribute("aria-controls")).toBeTruthy();
});

it("点击省略按钮后显示完整输出，原始结果不被截断", async () => {
  const view = createTranscriptView();
  const { messages, text } = outputScenario(20);
  await view.render({ messages });
  await view.click(view.target("out"));
  await act(() => view.row("out").querySelector<HTMLButtonElement>(".inline-output-omitted")!.click());
  expect(view.row("out").querySelector(".inline-output-omitted")).toBeNull();
  expect(view.row("out").querySelector(".inline-tool-output pre")!.textContent).toBe(text);
  expect(messages[1].content).toEqual([{ type: "text", text }]);
});

it("输出恰好 12 行时全部显示，没有省略按钮", async () => {
  const view = createTranscriptView();
  const { messages, text } = outputScenario(12);
  await view.render({ messages });
  await view.click(view.target("out"));
  expect(view.row("out").querySelector(".inline-output-omitted")).toBeNull();
  expect(view.row("out").querySelector(".inline-tool-output pre")!.textContent).toBe(text);
});
