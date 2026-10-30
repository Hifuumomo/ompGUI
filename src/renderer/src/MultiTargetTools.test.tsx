// @vitest-environment jsdom
import { expect, it, onTestFinished, vi } from "vitest";
import type { AgentMessage } from "../../shared/protocol";
import {
  createTranscriptView,
  toolCall,
} from "./inline-transcript-test-helpers";

const paths = ["omp://one.md", "omp://two.md", "omp://three.md"];

function searchMessages(resources: readonly string[] = paths): AgentMessage[] {
  return [
    toolCall("search", "grep", {
      path: resources.join(";"),
      pattern: "needle",
    }),
    {
      role: "toolResult",
      toolCallId: "search",
      content: "actual search output",
    },
    toolCall("read", "read", { path: "omp://other.md" }),
    { role: "toolResult", toolCallId: "read", content: "actual read output" },
  ];
}

async function compactListExpansion() {
  const view = createTranscriptView();
  await view.render({ messages: searchMessages() });
  const row = view.row("search");
  const summary = row.querySelector<HTMLElement>(":scope > summary")!;
  expect(summary.textContent).toContain("搜索");
  expect(summary.textContent).toContain(paths[0]);
  expect(summary.textContent).toContain("…");
  expect(summary.textContent).not.toContain(paths[1]);
  expect(row.querySelector(".tool-target-list")).toBeNull();
  await view.click(summary);
  expect(row.open).toBe(true);
  expect(summary.textContent).not.toContain(paths[0]);
  const targets = row.querySelectorAll<HTMLButtonElement>(
    ".tool-target-list > li > button",
  );
  expect(Array.from(targets, (target) => target.textContent)).toEqual([
    ...paths,
    "needle",
  ]);
  expect(row.querySelector(".inline-tool-details")).toBeNull();
  expect(view.row("read").open).toBe(false);
  expect(view.row("read").querySelector("summary")?.textContent).toContain(
    "omp://other.md",
  );
  await view.click(targets[1]);
  expect(targets[1].getAttribute("aria-expanded")).toBe("true");
  const panel = document.getElementById(
    targets[1].getAttribute("aria-controls")!,
  );
  expect(panel?.parentElement).toBe(targets[1].parentElement);
  // 非命令详情不再重复目标，目标只在工具行出现。
  expect(panel?.querySelector(".inline-tool-source")).toBeNull();
  expect(
    panel?.querySelector('.inline-tool-details[data-kind="target"]'),
  ).not.toBeNull();
  expect(panel?.textContent).toContain("actual search output");
}
it(
  "多对象操作只预览首个对象，展开为缩进列表，再点击对象阅读详情",
  compactListExpansion,
);

async function independentObjectDetails() {
  const view = createTranscriptView();
  await view.render({ messages: searchMessages() });
  const row = view.row("search");
  const summary = row.querySelector<HTMLElement>(":scope > summary")!;
  await view.click(summary);
  const targets = row.querySelectorAll<HTMLButtonElement>(
    ".tool-target-list > li > button",
  );
  await view.click(targets[0]);
  await view.click(targets[2]);
  expect(targets[0].getAttribute("aria-expanded")).toBe("false");
  expect(targets[2].getAttribute("aria-expanded")).toBe("true");
  expect(row.querySelectorAll(".inline-tool-details")).toHaveLength(1);
  await view.click(targets[2]);
  expect(row.open).toBe(true);
  expect(row.querySelector(".inline-tool-details")).toBeNull();
  await view.click(targets[3]);
  await view.click(summary);
  expect(row.open).toBe(false);
  expect(summary.textContent).toContain(paths[0]);
  await view.click(summary);
  expect(row.querySelector(".inline-tool-source")).toBeNull();
  expect(
    row.querySelector('.inline-tool-details[data-kind="target"]'),
  ).not.toBeNull();
  await view.click(view.target("read"));
  expect(view.row("read").textContent).toContain("actual read output");
  expect(row.open).toBe(true);
}
it(
  "对象详情可切换和单独收起，列表收起后恢复阅读状态，其他操作保持独立",
  independentObjectDetails,
);

async function liveListAndSessionChanges() {
  const view = createTranscriptView();
  await view.render({ messages: searchMessages() });
  const row = view.row("search");
  await view.click(row.querySelector<HTMLElement>(":scope > summary")!);
  await view.click(
    row.querySelector<HTMLButtonElement>(".tool-target-list > li > button")!,
  );
  await view.render({ messages: searchMessages([...paths, "omp://four.md"]) });
  expect(view.row("search")).toBe(row);
  expect(row.open).toBe(true);
  expect(row.querySelectorAll(".tool-target-list > li")).toHaveLength(5);
  expect(row.querySelector(".inline-tool-source")).toBeNull();
  expect(
    row.querySelector('.inline-tool-details[data-kind="target"]'),
  ).not.toBeNull();
  await view.render({
    messages: searchMessages(),
    sessionId: "another-session",
  });
  expect(view.row("search").open).toBe(false);
  expect(view.row("search").querySelector(".tool-target-list")).toBeNull();
}
it(
  "列表内容跟随最新证据且保留展开状态，切换会话清除状态",
  liveListAndSessionChanges,
);

async function sameFileNamesStayDistinct() {
  const errorLog = vi.spyOn(console, "error");
  onTestFinished(() => errorLog.mockRestore());
  const view = createTranscriptView();
  const resources = ["C:/one/config.yml", "C:/two/config.yml"];
  await view.render({ messages: searchMessages(resources) });
  const row = view.row("search");
  await view.click(row.querySelector<HTMLElement>(":scope > summary")!);
  const targets = row.querySelectorAll<HTMLButtonElement>(
    ".tool-target-list > li > button",
  );
  expect(targets[0].title).toBe(resources[0]);
  expect(targets[1].title).toBe(resources[1]);
  expect(targets[0].getAttribute("aria-controls")).not.toBe(
    targets[1].getAttribute("aria-controls"),
  );
  await view.click(targets[1]);
  expect(
    row
      .querySelector(".inline-file-header .inline-tool-label")
      ?.getAttribute("title"),
  ).toBe(resources[1]);
  expect(errorLog).not.toHaveBeenCalled();
}
it(
  "不同目录的同名文件分别显示并打开对应对象，没有重复节点标识",
  sameFileNamesStayDistinct,
);
