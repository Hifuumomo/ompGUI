// @vitest-environment jsdom
import { expect, it } from "vitest";
import {
  call,
  click,
  container,
  conversation,
  toolRow,
} from "./transcript-test-harness";

/** 连续读取按批折叠，文字和思考保持原位，混合工具保持原始顺序。 */
it("连续混合调用统一折叠，过渡回复和思考分隔不同批次", async () => {
  await conversation([
    call("r1", "read", { path: "1.txt" }),
    call("r2", "read", { path: "2.txt" }),
    { role: "toolResult", toolCallId: "r1", content: "第一个文件内容" },
    { role: "assistant", content: "第一批已读" },
    call("r3", "read", { path: "3.txt" }),
    call("r4", "read", { path: "4.txt" }),
    {
      role: "assistant",
      content: [{ type: "thinking", thinking: "继续检查" }],
    },
    call("r5", "read", { path: "5.txt" }),
    call("w1", "write", { path: "out.txt", content: "输出" }),
    { role: "assistant", content: "最终总结" },
  ]);
  const process =
    container.querySelector<HTMLDetailsElement>(".process-group")!;
  await click(process.querySelector("summary")!);
  const groups =
    container.querySelectorAll<HTMLDetailsElement>(".tool-type-group");
  expect(groups).toHaveLength(3);
  for (const group of groups) {
    expect(group.open).toBe(false);
    expect(group.querySelector("summary > span")!.textContent).toContain(
      "读取",
    );
    expect(
      group.querySelector(".tool-type-items")!.getAttribute("tabindex"),
    ).toBe("0");
    expect(group.querySelector("summary")!.textContent).not.toContain("次调用");
  }
  expect(groups[0].textContent).not.toContain("第一批已读");
  expect(groups[1].textContent).not.toContain("继续检查");
  expect(toolRow("r5").closest(".tool-type-group")).toBe(groups[2]);
  expect(toolRow("r5").querySelector(".tool-type-more")).toBeNull();
  expect(toolRow("w1").closest(".tool-type-group")).toBe(groups[2]);
  await click(groups[0].querySelector("summary")!);
  expect(groups[0].open).toBe(true);
  expect(groups[0].textContent).toContain("1.txt");
  expect(groups[0].textContent).toContain("2.txt");
  expect(toolRow("r1").querySelector("summary")!.textContent).toContain("读取");
  expect(toolRow("r2").querySelector("summary")!.textContent).toContain("读取");
  expect(toolRow("r5").querySelector("summary")!.textContent).toContain("读取");
  await click(toolRow("r1").querySelector("summary")!);
  expect(toolRow("r1").textContent).toContain("第一个文件内容");
  expect(toolRow("r2").open).toBe(false);
  await click(groups[0].querySelector("summary")!);
  expect(groups[0].open).toBe(false);
  expect(process.textContent).not.toContain("最终总结");
});

/** 增量调用加入同组时保留用户展开状态，摘要呈现运行及错误状态。 */
it("追加同类调用保留展开状态并更新状态，不展示调用数量", async () => {
  const messages = [
    call("a", "read", { path: "a.txt" }),
    call("b", "read", { path: "b.txt" }),
  ];
  await conversation(messages);
  await click(
    container.querySelector<HTMLElement>(".process-group > summary")!,
  );
  const group =
    container.querySelector<HTMLDetailsElement>(".tool-type-group")!;
  await click(group.querySelector("summary")!);
  await conversation(
    [
      ...messages,
      call("c", "read", { path: "c.txt" }),
      {
        role: "toolResult",
        toolCallId: "a",
        isError: true,
        content: "读取失败",
      },
    ],
    [{ id: "c", name: "read", args: { path: "c.txt" }, running: true }],
  );
  expect(container.querySelector(".tool-type-group")).toBe(group);
  expect(group.open).toBe(true);
  expect(group.querySelector("summary > span")!.textContent).toContain("读取");
  expect(group.querySelector("summary")!.textContent).not.toContain("次调用");
  expect(group.querySelector("summary")!.getAttribute("aria-busy")).toBe(
    "true",
  );
  expect(group.querySelector("summary")!.textContent).not.toContain("有错误");
  expect(group.classList.contains("process-error")).toBe(false);
  expect(toolRow("a").classList.contains("process-error")).toBe(true);
  expect(toolRow("b").classList.contains("process-error")).toBe(false);
});

it.each([
  ["read", "读取了多个对象"],
  ["write", "写入了多个对象"],
  ["edit", "编辑了多个对象"],
  ["bash", "运行了多个命令"],
  ["grep", "搜索了多个对象"],
  ["glob", "查找了多个文件"],
  ["web_search", "搜索了多个网页"],
  ["custom_tool", "多次调用工具 custom_tool"],
])("%s 同类分组使用明确标题且展开保留原始条目", async (name, label) => {
  await conversation([call("first", name), call("second", name)]);
  const group =
    container.querySelector<HTMLDetailsElement>(".tool-type-group")!;
  expect(group.querySelector(".tool-group-label")!.textContent).toBe(label);
  expect(
    group.querySelector(":scope > summary > .tool-operation-icon"),
  ).not.toBeNull();
  expect(group.open).toBe(false);
  await click(group.querySelector("summary")!);
  expect(group.open).toBe(true);
  expect(
    [...group.querySelectorAll(".tool-row")].map((row) =>
      row.getAttribute("data-tool-id"),
    ),
  ).toEqual(["first", "second"]);
  expect(group.querySelector('[aria-label="操作记录"]')).not.toBeNull();
});

it("混合操作保留类别摘要，单次调用不标记多个对象", async () => {
  await conversation([call("r", "read"), call("w", "write")]);
  expect(container.querySelector(".tool-group-label")!.textContent).toBe(
    "读取 · 写入",
  );
  expect(
    container.querySelector(
      ".tool-type-group > summary > .tool-operation-icon",
    ),
  ).toBeNull();
  expect(
    container.querySelectorAll(".tool-row > summary > .tool-operation-icon"),
  ).toHaveLength(2);
  await conversation([call("r", "read")]);
  expect(container.querySelector(".tool-type-group")).toBeNull();
  expect(container.textContent).not.toContain("多个");
});
