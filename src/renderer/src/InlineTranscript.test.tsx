// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import type { AgentMessage } from "../../shared/protocol";
import type { ToolActivity } from "./session";
import {
  commandCall,
  createTranscriptView,
  structuredScenario,
  toolCall,
} from "./inline-transcript-test-helpers";

/** 验证先展开过程组再点击命令目标，并在收起组后保留该行状态。参数：无。返回值：测试完成 Promise。 */
async function summaryTargetToggle() {
  const view = createTranscriptView();
  await view.render({
    messages: [
      commandCall("first", "echo first"),
      commandCall("second", "echo second"),
    ],
  });
  const group =
    view.container.querySelector<HTMLDetailsElement>(".process-group")!;
  const target = view.target("first");
  expect(group.open).toBe(false);
  expect(target.getAttribute("aria-expanded")).toBe("false");
  await view.click(target);
  expect(group.open).toBe(true);
  expect(view.row("first").open).toBe(true);
  expect(view.row("second").open).toBe(false);
  expect(
    view.container.querySelectorAll('.tool-row[data-tool-id="first"]'),
  ).toHaveLength(1);
  expect(target.getAttribute("aria-expanded")).toBe("true");
  const panel = document.getElementById(target.getAttribute("aria-controls")!);
  expect(panel?.closest(".tool-row")).toBe(view.row("first"));
  expect(panel?.textContent).toContain("echo first");
  await view.click(group.querySelector<HTMLElement>(":scope > summary")!);
  expect(group.open).toBe(false);
  expect(view.row("first").open).toBe(true);
  await view.click(group.querySelector<HTMLElement>(":scope > summary")!);
  expect(group.open).toBe(true);
  expect(view.row("first").open).toBe(true);
  await view.click(target);
  expect(view.row("first").open).toBe(false);
  expect(target.getAttribute("aria-expanded")).toBe("false");
}
it(
  "展开过程组后命令目标同步可访问性状态，组折叠不丢失行状态",
  summaryTargetToggle,
);

/** 验证工具行和摘要入口共享开合状态，多个命令保持独立。参数：无。返回值：测试完成 Promise。 */
async function independentRows() {
  const view = createTranscriptView();
  await view.render({
    messages: [
      commandCall("first", "echo first"),
      commandCall("second", "echo second"),
    ],
  });
  await view.click(view.target("first"));
  await view.click(view.target("second"));
  expect(view.row("first").open).toBe(true);
  expect(view.row("second").open).toBe(true);
  await view.click(view.row("first").querySelector<HTMLElement>("summary")!);
  expect(view.row("first").open).toBe(false);
  expect(view.row("second").open).toBe(true);
  expect(view.target("first").getAttribute("aria-expanded")).toBe("false");
  await view.click(
    view.row("first").querySelector<HTMLButtonElement>(".tool-target")!,
  );
  expect(view.row("first").open).toBe(true);
  expect(view.target("first").getAttribute("aria-expanded")).toBe("true");
}
it("工具行摘要与目标共享开合状态，多个命令独立展开", independentRows);

/** 验证资源、查询及文件目标统一内嵌展示。参数：无。返回值：测试完成 Promise。 */
async function resourceTargets() {
  const view = createTranscriptView();
  await view.render({
    messages: [
      toolCall("search", "grep", {
        path: "https://example.test/log",
        pattern: "failed",
      }),
      toolCall("file", "read", { path: "C:\\Code\\example.txt" }),
      { role: "toolResult", toolCallId: "file", content: "native file text" },
    ],
  });
  await view.click(
    view.row("search").querySelector<HTMLElement>(":scope > summary")!,
  );
  const row = view.row("search");
  const buttons = row.querySelectorAll<HTMLButtonElement>(
    ".tool-target-list .tool-target",
  );
  expect(row.querySelector(".inline-tool-source")).toBeNull();
  await view.click(buttons[0]);
  expect(row.querySelector(".inline-tool-source")).toBeNull();
  expect(
    row.querySelector('.inline-tool-details[data-kind="target"]'),
  ).not.toBeNull();
  await view.click(buttons[1]);
  expect(row.open).toBe(true);
  expect(row.querySelector(".inline-tool-source")).toBeNull();
  expect(
    row.querySelector('.inline-tool-details[data-kind="target"]'),
  ).not.toBeNull();
  expect(buttons[0].getAttribute("aria-expanded")).toBe("false");
  expect(buttons[1].getAttribute("aria-expanded")).toBe("true");
  await view.click(view.target("file"));
  expect(view.row("file").open).toBe(true);
  expect(view.row("file").textContent).toContain("native file text");
  expect(
    view.container.querySelector('[role="dialog"], .file-review-pane'),
  ).toBeNull();
}
it("资源、查询和文件目标统一在会话内切换与展开", resourceTargets);

/** 验证展开内容追随实时输出更新，历史终态证据优先于旧实时记录。参数：无。返回值：测试完成 Promise。 */
async function latestOutput() {
  const view = createTranscriptView();
  const messages = [commandCall("run", "echo progress")];
  const live: ToolActivity = {
    id: "run",
    name: "bash",
    args: { command: "echo progress" },
    running: true,
    result: { output: "first partial" },
  };
  await view.render({
    messages,
    tools: [live],
    messageKeys: ["live:assistant"],
  });
  await view.click(view.target("run"));
  expect(
    view.row("run").querySelector(".inline-tool-output")?.textContent,
  ).toContain("first partial");
  await view.render({
    messages,
    tools: [{ ...live, result: { output: "latest partial" } }],
    messageKeys: ["live:assistant"],
  });
  expect(view.row("run").open).toBe(true);
  expect(
    view.row("run").querySelector(".inline-tool-output")?.textContent,
  ).toContain("latest partial");
  const complete: AgentMessage = {
    role: "toolResult",
    toolCallId: "run",
    content: [{ type: "text", text: "final result" }],
  };
  await view.render({
    messages: [...messages, complete],
    tools: [live],
    messageKeys: ["history:0:assistant", "history:1:toolResult"],
  });
  expect(view.row("run").open).toBe(true);
  expect(
    view.row("run").querySelector(".inline-tool-output")?.textContent,
  ).toBe("final result");
  expect(view.row("run").querySelector("summary")?.textContent).not.toContain(
    "已完成",
  );
  expect(view.row("run").querySelector("summary")?.textContent).not.toContain(
    "执行中",
  );
}
it("保持展开并展示最新实时输出，最终历史结果覆盖旧实时状态", latestOutput);

/** 验证相同工具标识在切换会话后不会继承展开状态。参数：无。返回值：测试完成 Promise。 */
async function sessionSwitch() {
  const view = createTranscriptView();
  const messages = [commandCall("same-id", "echo isolated")];
  await view.render({ messages, sessionId: "session-a" });
  await view.click(view.target("same-id"));
  expect(view.row("same-id").open).toBe(true);
  await view.render({ messages, sessionId: "session-b" });
  expect(view.row("same-id").open).toBe(false);
  expect(view.target("same-id").getAttribute("aria-expanded")).toBe("false");
  expect(
    view.container.querySelector<HTMLDetailsElement>(".process-group")?.open,
  ).toBe(false);
}
it("切换会话后清除展开状态", sessionSwitch);

/** 验证 Shell 输出按字面文本呈现，不提供技术详情或序列化原始载荷。参数：无。返回值：测试完成 Promise。 */
async function literalOutputAndLazyEvidence() {
  const view = createTranscriptView();
  const literal = "**raw** <img src=x> [link](https://example.test)";
  const serialize = vi.fn(() => ({ raw: "serialized-evidence" }));
  const live: ToolActivity = {
    id: "raw",
    name: "bash",
    args: { command: "echo raw" },
    running: false,
    result: { content: [{ type: "text", text: literal }], toJSON: serialize },
  };
  await view.render({
    messages: [commandCall("raw", "echo raw")],
    tools: [live],
  });
  await view.click(view.target("raw"));
  const output = view.row("raw").querySelector(".inline-tool-output")!;
  expect(output.textContent).toBe(literal);
  expect(output.querySelector("strong, a, img")).toBeNull();
  expect(view.row("raw").querySelector(".inline-tool-technical")).toBeNull();
  expect(serialize).not.toHaveBeenCalled();
  expect(output.querySelector("summary")).toBeNull();
  for (const label of [
    "技术详情",
    "原始调用参数",
    "完整调用载荷",
    "完整原始结果",
  ])
    expect(view.container.textContent).not.toContain(label);
}
it(
  "命令输出保留字面文本且没有技术详情或原始载荷入口",
  literalOutputAndLazyEvidence,
);

/** 验证结构化与未知输出可见，同时保留错误和取消状态。参数：无。返回值：测试完成 Promise。 */
async function structuredOutputAndStatuses() {
  const view = createTranscriptView();
  await view.render(structuredScenario());
  await view.click(view.target("structured"));
  expect(
    view.row("structured").querySelector(".inline-tool-output")?.textContent,
  ).toContain('"count": 17');
  for (const field of ["structuredContent", "toolCallId", "arguments"])
    expect(view.row("structured").textContent).not.toContain(field);
  await view.click(view.target("unknown"));
  expect(
    view.row("unknown").querySelector(".inline-tool-output")?.textContent,
  ).toContain("native-evidence");
  await view.click(view.target("failed"));
  expect(
    view.row("failed").querySelector("summary")?.textContent,
  ).not.toContain("错误");
  expect(view.row("failed").classList.contains("process-error")).toBe(true);
  expect(
    view.row("failed").querySelector(".inline-tool-output")?.textContent,
  ).toBe("failure output");
  await view.click(view.target("cancelled"));
  expect(view.row("cancelled").querySelector("summary")?.textContent).toContain(
    "已取消",
  );
  expect(
    view.row("cancelled").querySelector(".inline-tool-output")?.textContent,
  ).toBe("cancelled output");
}
it(
  "纯结构化和未知输出不会丢失，错误与取消状态保持可见",
  structuredOutputAndStatuses,
);

/** 结构化实际数据与可读正文并存时两者均保留，但不展示原生协议封装。参数：无。返回值：测试完成 Promise。 */
async function combinedStructuredContent() {
  const view = createTranscriptView();
  await view.render({
    messages: [commandCall("combined", "echo combined")],
    tools: [
      {
        id: "combined",
        name: "bash",
        args: {},
        running: false,
        result: {
          content: [{ type: "text", text: "actual readable output" }],
          structuredContent: { count: 23 },
        },
      },
    ],
  });
  await view.click(view.target("combined"));
  const output = view.row("combined").querySelector(".inline-tool-output")!;
  expect(output.textContent).toContain("actual readable output");
  expect(output.textContent).toContain('"count": 23');
  expect(output.textContent).not.toContain("structuredContent");
  expect(output.textContent).not.toContain("未记录输出");
}
it(
  "可读正文与结构化实际数据并存时完整显示且不显示协议封装",
  combinedStructuredContent,
);
