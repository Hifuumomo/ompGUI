// @vitest-environment jsdom
import { expect, it } from "vitest";
import type { AgentMessage } from "../../shared/protocol";
import {
  container,
  conversation,
  click,
  render,
  timeline,
} from "./transcript-test-harness";
import { Transcript } from "./Transcript";
import {
  LateResultDivider,
  noticeLabel,
  TranscriptNotice,
} from "./TranscriptNotice";

const log =
  "> npm run build\n\nvite building...\n  output.js  40.49 kB\n[…121ln elided…]\n<script>unsafe()</script>";
const background: AgentMessage = {
  role: "custom",
  customType: "async-result",
  display: true,
  content: log,
  details: { jobs: [{ label: "npm run build" }] },
};

/** 同轮压缩不切断执行过程，多次压缩保持原位，下一条用户消息仍分隔轮次。 */
it("上下文压缩位于同一执行过程内部，最终回复仍独立展示", async () => {
  await conversation([
    { role: "user", content: "用户提示1" },
    { role: "assistant", content: "压缩前执行" },
    { role: "compactionSummary", summary: "第一次压缩" },
    { role: "assistant", content: "压缩后执行" },
    { role: "compactionSummary", summary: "第二次压缩" },
    { role: "assistant", content: "最终回答1" },
    { role: "user", content: "用户提示2" },
    { role: "compactionSummary", summary: "第三次压缩" },
    { role: "assistant", content: "最终回答2" },
  ]);
  const groups =
    container.querySelectorAll<HTMLDetailsElement>(".process-group");
  expect(groups).toHaveLength(2);
  expect(
    [...groups[0].querySelectorAll(".process-evidence > article")].map(
      (node) => node.textContent,
    ),
  ).toEqual([
    "压缩前执行",
    "上下文压缩第一次压缩",
    "压缩后执行",
    "上下文压缩第二次压缩",
  ]);
  expect(groups[0].textContent).not.toContain("最终回答1");
  expect(groups[1].textContent).not.toContain("最终回答2");
  expect(groups[1].querySelectorAll(".compaction-notice")).toHaveLength(1);
  const compact =
    groups[0].querySelector<HTMLDetailsElement>(".compaction-notice")!;
  expect(compact.open).toBe(false);
  await click(groups[0].querySelector("summary")!);
  await click(compact.querySelector("summary")!);
  expect(compact.open).toBe(true);
});

/** 运行中的代理来信独立折叠，刷新保留展开选择，结束后最终回复仍在过程外。 */
it("display:true 的代理来信在执行过程中可折叠并保留完整正文", async () => {
  const incoming: AgentMessage = {
    role: "custom",
    customType: "irc:incoming",
    display: true,
    content: "代理进度\n\nSent while waiting/working.\n\nReply via `write`.",
    details: { from: "Task5HiddenValidator", message: "代理进度" },
  };
  async function update(busy: boolean, message = incoming) {
    await render(
      <Transcript
        messages={timeline([
          message,
          { role: "assistant", content: "最终回复" },
        ])}
        tools={[]}
        sessionId="agent-session"
        busy={busy}
      />,
    );
  }
  await update(true);
  const process =
    container.querySelector<HTMLDetailsElement>(".process-group")!;
  const notice =
    process.querySelector<HTMLDetailsElement>(".transcript-notice")!;
  expect(process.open).toBe(true);
  expect(notice.open).toBe(false);
  expect(notice.querySelector("summary")!.textContent).toBe(
    "代理消息 · Task5HiddenValidator",
  );
  expect(process.textContent).not.toContain("最终回复");
  await click(notice.querySelector("summary")!);
  expect(notice.open).toBe(true);
  expect(notice.textContent).toContain("Sent while waiting/working.");
  expect(notice.querySelector("code")!.textContent).toBe("write");
  await update(true, { ...incoming, content: incoming.content + "\n\n新进度" });
  expect(process.querySelector(".transcript-notice")).toBe(notice);
  expect(notice.open).toBe(true);
  expect(notice.textContent).toContain("新进度");
  await click(notice.querySelector("summary")!);
  expect(notice.open).toBe(false);
  await update(false);
  expect(process.open).toBe(false);
});

/** 后台日志保持字面内容，折叠入口位于执行过程内，最终回复独立显示。 */
it("后台输出默认折叠并保留换行，刷新后保持用户展开状态", async () => {
  await conversation([background, { role: "assistant", content: "构建完成" }]);
  const process =
    container.querySelector<HTMLDetailsElement>(".process-group")!;
  const notice =
    process.querySelector<HTMLDetailsElement>(".background-output")!;
  expect(notice.open).toBe(false);
  expect(notice.querySelector("summary")!.textContent).toBe(
    "后台任务输出 · npm run build",
  );
  expect(notice.querySelector("pre")!.textContent).toBe(log);
  expect(notice.querySelector("blockquote")).toBeNull();
  expect(notice.querySelector("script")).toBeNull();
  expect(process.textContent).not.toContain("构建完成");
  await click(process.querySelector("summary")!);
  await click(notice.querySelector("summary")!);
  expect(notice.open).toBe(true);
  await conversation([
    { ...background, content: log + "\n新输出" },
    { role: "assistant", content: "构建完成" },
  ]);
  expect(container.querySelector(".background-output")).toBe(notice);
  expect(notice.open).toBe(true);
  expect(notice.querySelector("pre")!.textContent).toBe(log + "\n新输出");
});

/** 内部通知从时间线隐藏，不产生空入口，也不打断相邻执行过程。 */
it("隐藏所有 display:false 内部通知并保持同轮执行过程连续", async () => {
  const notices: AgentMessage[] = [
    "eval-prelude-notice",
    "mid-run-todo-nudge",
    "orchestrate-notice",
    "future-notice",
    "async-result",
    "irc:incoming",
  ].map((customType) => ({
    role: "custom",
    customType,
    display: false,
    content: `隐藏正文 ${customType}`,
  }));
  await conversation([
    { role: "user", content: "用户提示" },
    { role: "assistant", content: "前段执行" },
    ...notices,
    { role: "assistant", content: "后段执行" },
    { role: "assistant", content: "最终回答" },
  ]);
  expect(container.textContent).not.toContain("内部通知");
  expect(container.textContent).not.toContain("隐藏正文");
  expect(container.querySelectorAll(".process-group")).toHaveLength(1);
  const process = container.querySelector(".process-group")!;
  expect(process.textContent).toContain("前段执行");
  expect(process.textContent).toContain("后段执行");
  expect(process.textContent).not.toContain("最终回答");
  expect(container.querySelectorAll('[aria-label="自定义消息"]')).toHaveLength(
    0,
  );
  await conversation(notices);
  expect(
    container.querySelector(".conversation-review")!.children,
  ).toHaveLength(0);
});
it("后台输出缺少标签使用通用标题，普通自定义正文仍正常显示", async () => {
  await conversation([
    {
      ...background,
      details: undefined,
      content: [{ type: "text", text: log }],
    },
    { role: "custom", content: "普通自定义正文" },
  ]);
  expect(
    container.querySelector(".background-output summary")!.textContent,
  ).toBe("后台任务输出");
  expect(container.querySelector(".background-output pre")!.textContent).toBe(
    log,
  );
  expect(container.textContent).toContain("普通自定义正文");
  expect(container.querySelectorAll(".transcript-notice")).toHaveLength(1);
});

/** 标签只复用原生任务标签或代理名称，缺少字段时不从日志猜测。 */
it("通知标题辅助与卡片共用单行标签，不猜测任务状态", async () => {
  const message: AgentMessage = {
    ...background,
    details: {
      jobs: [
        { label: "  npm\nrun build  " },
        { label: "" },
        { label: 42 },
        { label: "npm test" },
      ],
      status: "unverified-status",
      exitCode: 42,
    },
  };
  expect(noticeLabel(message)).toBe("npm run build / npm test");
  await render(
    <TranscriptNotice message={message}>
      <pre>{log}</pre>
    </TranscriptNotice>,
  );
  const summary = container.querySelector("summary")!;
  expect(summary.textContent).toBe(
    "后台任务输出 · npm run build / npm test",
  );
  expect(summary.title).toBe(noticeLabel(message));
  expect(summary.textContent).not.toContain("unverified-status");
  expect(summary.textContent).not.toContain("42");
  expect(noticeLabel({ ...background, details: undefined })).toBeUndefined();
  expect(
    noticeLabel({ ...background, details: { jobs: [{ label: " \n " }] } }),
  ).toBeUndefined();
  expect(
    noticeLabel({
      role: "custom",
      customType: "irc:incoming",
      content: "# 不从正文猜测代理名称",
      details: { from: " Worker\nOne " },
    }),
  ).toBe("Worker One");
  expect(
    noticeLabel({
      role: "custom",
      customType: "irc:incoming",
      content: "# 不从正文猜测代理名称",
    }),
  ).toBeUndefined();
});

it("后台摘要统计原生任务终态，不展示未知状态或正文中的失败数", async () => {
  await render(
    <TranscriptNotice message={{
      ...background,
      details: { jobs: [
        { label: "npm test", status: "failed" },
        { label: "npm build", status: "completed" },
        { label: "future", status: "future-status" },
        { label: "unknown" },
      ] },
    }}>
      <pre>exit 1 · 9 failed</pre>
    </TranscriptNotice>,
  );
  expect(container.querySelector(".notice-status")?.textContent).toBe("1 个任务失败 · 1 个任务完成");
  expect(container.querySelector("summary")?.textContent).not.toContain("9 failed");
  expect(container.querySelector("summary")?.textContent).not.toContain("exit 1");
  expect(container.querySelector("summary")?.textContent).not.toContain("future-status");
});

/** 原生时间戳齐全时同时展示到达时刻与回复后的等待间隔。 */
it("迟到分隔线展示到达时刻及等待时长", async () => {
  const answeredAt = new Date("2026-10-30T12:00:00Z").getTime();
  const arrivedAt = answeredAt + 125000;
  await render(
    <LateResultDivider arrivedAt={arrivedAt} answeredAt={answeredAt} />,
  );
  const divider = container.querySelector('[role="separator"]')!;
  expect(divider.getAttribute("aria-label")).toBe("后台结果迟到");
  expect(divider.classList.contains("late-result-divider")).toBe(true);
  expect(divider.textContent).toBe(
    `后台结果迟到 · ${new Date(arrivedAt).toLocaleTimeString()} · 回复后 2分5秒`,
  );
  expect(divider.textContent).not.toContain("运行了");
});

/** 缺失时间戳时只呈现已知时间，不推断等待间隔。 */
it.each([
  { arrivedAt: undefined, answeredAt: undefined },
  { arrivedAt: undefined, answeredAt: 0 },
  { arrivedAt: 0, answeredAt: undefined },
])("迟到分隔线缺失时间时降级为已知信息：%j", async (timestamps) => {
  await render(<LateResultDivider {...timestamps} />);
  const divider = container.querySelector('[role="separator"]')!;
  expect(divider.textContent).toBe(
    timestamps.arrivedAt === undefined
      ? "后台结果迟到"
      : `后台结果迟到 · ${new Date(timestamps.arrivedAt).toLocaleTimeString()}`,
  );
  expect(divider.textContent).not.toContain("回复后");
});

/** 乱序时间戳沿用统一用时转换的零值下限，不显示负等待时间。 */
it("迟到分隔线保留零时间戳并限制负间隔", async () => {
  await render(<LateResultDivider arrivedAt={0} answeredAt={1000} />);
  expect(container.querySelector('[role="separator"]')!.textContent).toBe(
    `后台结果迟到 · ${new Date(0).toLocaleTimeString()} · 回复后 0秒`,
  );
});
