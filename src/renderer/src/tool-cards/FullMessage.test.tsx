// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  click,
  container,
  render,
  setup,
  timeline,
} from "../transcript-test-harness";
import { Transcript } from "../Transcript";
import { FullMessage } from "./FullMessage";
import { launchCompletion, handoff, ircIncoming } from "./fixtures";

beforeEach(setup);
afterEach(cleanup);

it("真实守护进程通知显示名称、exit 与时长，缺字段仍可查看原文", async () => {
  await render(<FullMessage message={launchCompletion} />);
  expect(container.textContent).toContain("守护进程已退出");
  expect(container.textContent).toContain("PrePerfPortableSmoke");
  expect(container.textContent).toContain("exit 0");
  expect(container.textContent).toContain("运行 52秒");
  const details = container.querySelector("details")!;
  expect(details.open).toBe(false);
  await click(details.querySelector("summary")!);
  expect(details.open).toBe(true);
  await render(
    <FullMessage
      message={{
        role: "custom",
        customType: "launch-completion",
        content: "缺失字段原文",
        details: { daemons: [null, {}] },
      }}
    />,
  );
  expect(container.textContent).toContain("缺失字段原文");
  expect(container.textContent).not.toContain("undefined");
});

it("单个原生后台任务在标题显示身份，输出摘要显示状态和耗时且可展开", async () => {
  await render(
    <FullMessage
      message={{
        role: "custom",
        customType: "async-result",
        content: "**真实输出**",
        details: {
          jobs: [
            {
              jobId: "bg_1",
              label: "检查",
              status: "completed",
              durationMs: 12000,
              type: "bash",
            },
          ],
          meta: { source: "native" },
        },
      }}
    />,
  );
  const notice = container.querySelector(".notice-strip")!;
  expect(notice.querySelector("header strong")?.textContent).toBe(
    "后台任务完成",
  );
  expect(notice.querySelector("header code")?.textContent).toBe("bg_1 · 检查");
  const details = notice.querySelector("details")!;
  expect(details.querySelector("summary")?.textContent).toBe(
    "任务完成 · 12秒 · 查看输出",
  );
  expect(notice.textContent).not.toContain("exit");
  expect(details.open).toBe(false);
  await click(details.querySelector("summary")!);
  expect(details.open).toBe(true);
  expect(details.querySelector(".rich-content strong")?.textContent).toBe(
    "真实输出",
  );
});

it("多个后台任务保留各自身份、终态和耗时，共享原生输出展开", async () => {
  await render(
    <FullMessage
      message={{
        role: "custom",
        customType: "async-result",
        content: "全部任务原文",
        details: {
          jobs: [
            {
              jobId: "bg_ok",
              label: "构建",
              status: "completed",
              durationMs: 12000,
            },
            {
              jobId: "bg_bad",
              label: "测试",
              status: "failed",
              durationMs: 3000,
            },
            { jobId: "bg_unknown", status: "cancelled" },
          ],
        },
      }}
    />,
  );
  const notice = container.querySelector(".notice-strip")!;
  const rows = notice.querySelectorAll(".notice-job");
  expect(rows).toHaveLength(3);
  expect(rows[0].querySelector("code")?.textContent).toBe("bg_ok · 构建");
  expect(rows[0].querySelector("small")?.textContent).toBe("任务完成 · 12秒");
  expect(rows[1].querySelector("code")?.textContent).toBe("bg_bad · 测试");
  expect(rows[1].querySelector("small")?.textContent).toBe("任务失败 · 3秒");
  expect(rows[2].textContent).toBe("bg_unknowncancelled");
  const details = notice.querySelector("details")!;
  expect(details.open).toBe(false);
  await click(details.querySelector("summary")!);
  expect(details.open).toBe(true);
  expect(details.textContent).toContain("全部任务原文");
});

it("后台任务缺字段或缺任务列表仍保留可展开原文，不猜测顶层任务信息", async () => {
  for (const details of [
    { jobs: [{ jobId: "bg_partial" }] },
    { jobs: [null, {}] },
    { jobs: [] },
    { jobId: "非原生顶层ID", label: "非原生顶层标签", status: "completed" },
  ]) {
    await render(
      <FullMessage
        message={{
          role: "custom",
          customType: "async-result",
          content: "缺字段输出",
          details,
        }}
      />,
    );
    const notice = container.querySelector(".notice-strip")!;
    expect(notice.querySelector("summary")?.textContent).toBe("查看输出");
    expect(notice.textContent).not.toContain("undefined");
    expect(notice.textContent).not.toContain("exit");
    expect(notice.textContent).not.toContain("任务完成 ·");
    expect(notice.textContent).not.toContain("非原生顶层");
    if ("jobs" in details && details.jobs?.length === 1) {
      expect(notice.querySelector("header code")?.textContent).toBe(
        "bg_partial",
      );
    }
    const output = notice.querySelector("details")!;
    expect(output.open).toBe(false);
    await click(output.querySelector("summary")!);
    expect(output.open).toBe(true);
    expect(output.textContent).toContain("缺字段输出");
    await click(output.querySelector("summary")!);
    expect(output.open).toBe(false);
  }
});

it("无详情模型分隔线仅呈现文本，不生成可展开或可聚焦交互", async () => {
  await render(
    <FullMessage
      message={{
        role: "custom",
        customType: "ompgui-event-divider",
        content: "模型切换为 gpt-6.1-sol",
      }}
    />,
  );
  const divider = container.querySelector('[role="separator"]')!;
  expect(divider.querySelector("span")?.textContent).toBe(
    "模型切换为 gpt-6.1-sol",
  );
  expect(
    divider.querySelector("summary, details, button, [tabindex]"),
  ).toBeNull();
  expect(divider.hasAttribute("tabindex")).toBe(false);
});

it("顶层迟到通知和代理来信也经过完整消息分发", async () => {
  await render(
    <Transcript
      mode="full"
      sessionId="events"
      tools={[]}
      messages={timeline([
        { role: "user", content: "开始" },
        { role: "assistant", content: "结束", stopReason: "stop" },
        {
          role: "custom",
          customType: "async-result",
          content: "真实输出",
          details: {
            jobs: [
              {
                jobId: "bg_1",
                label: "检查",
                status: "completed",
                durationMs: 12000,
              },
            ],
          },
        },
        ircIncoming,
      ])}
    />,
  );
  expect(container.querySelector(".late-result-divider")).not.toBeNull();
  expect(
    container.querySelector(".conversation-late-trigger .notice-strip"),
  ).not.toBeNull();
  expect(
    container.querySelector('.agent-message-strip[data-direction="in"]'),
  ).not.toBeNull();
  expect(container.textContent).toContain("bg_1 · 检查");
});

it("完整模式压缩和交接摘要可展开且不显示内部标签", async () => {
  await render(
    <Transcript
      mode="full"
      sessionId="events"
      tools={[]}
      messages={timeline([
        { role: "user", content: "开始" },
        { role: "assistant", content: "结束", stopReason: "stop" },
        {
          role: "compactionSummary",
          summary: "**压缩摘要**",
          tokensBefore: 232000,
        },
        handoff,
      ])}
    />,
  );
  const dividers =
    container.querySelectorAll<HTMLDetailsElement>(".event-divider");
  expect(dividers).toHaveLength(2);
  expect(dividers[0].querySelector("summary")?.textContent).toBe(
    "上下文已压缩 232K",
  );
  expect(dividers[0].open).toBe(false);
  await click(dividers[0].querySelector("summary")!);
  expect(dividers[0].open).toBe(true);
  expect(dividers[0].querySelector(".rich-content strong")?.textContent).toBe(
    "压缩摘要",
  );
  expect(dividers[1].textContent).not.toContain("handoff-context");
});

it("两种模式均在用户气泡后单独呈现关联引用，并保留原生可聚焦文件链接", async () => {
  const openFile = vi.fn(async () => undefined);
  for (const mode of ["full", "compact"] as const) {
    openFile.mockClear();
    await render(
      <Transcript
        mode={mode}
        sessionId="chips"
        tools={[]}
        onOpenFile={openFile}
        messages={timeline([
          { role: "user", content: "检查引用" },
          {
            role: "fileMention",
            files: [
              { path: "src/a.ts", content: "" },
              { path: "large.bin", content: "", skippedReason: "binary" },
            ],
          },
          {
            role: "custom",
            customType: "model_mention",
            display: false,
            details: { name: "GPT-6-Luna" },
          },
          { role: "user", content: "第二条消息" },
          { role: "fileMention", files: [{ path: "src/b.ts", content: "" }] },
        ])}
      />,
    );
    const users = container.querySelectorAll<HTMLElement>(".conversation-user");
    const rows = container.querySelectorAll<HTMLElement>(".file-chips");
    expect(users).toHaveLength(2);
    expect(rows).toHaveLength(2);
    expect(users[0].textContent).toBe("检查引用");
    expect(users[1].textContent).toBe("第二条消息");
    for (const [index, user] of users.entries()) {
      expect(user.querySelector(".file-chips")).toBeNull();
      expect(user.nextElementSibling).toBe(rows[index]);
      expect(rows[index].parentElement).toBe(user.parentElement);
    }
    expect(rows[0].textContent).toContain("@ GPT-6-Luna");
    expect(
      rows[0].querySelector(".file-chip-skipped")?.getAttribute("title"),
    ).toBe("binary");
    expect(rows[0].querySelectorAll("a")).toHaveLength(1);
    expect(rows[1].querySelectorAll("a")).toHaveLength(1);
    expect(rows[1].querySelector(".file-chip-skipped")).toBeNull();
    const link = rows[0].querySelector<HTMLAnchorElement>("a")!;
    const secondLink = rows[1].querySelector<HTMLAnchorElement>("a")!;
    expect(link.getAttribute("href")).not.toBe(secondLink.getAttribute("href"));
    expect(link.tabIndex).toBe(0);
    link.focus();
    expect(document.activeElement).toBe(link);
    await click(link);
    expect(openFile).toHaveBeenCalledTimes(1);
    expect(openFile).toHaveBeenCalledWith(link.getAttribute("href"));
  }
});
