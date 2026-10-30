import { describe, expect, it } from "vitest";
import type { SessionEntry, TreeNode } from "../../shared/protocol";
import {
  nativeTreeRows,
  treeIndex,
  treeNodeVisible,
  resolveTreeSelection,
} from "./native-tree-data";
import { nativeTreeKey, type TreeKey } from "./native-tree-keys";

/** 构造带父子关系的会话节点。[in] options：条目和子节点。返回值：树节点。 */
function node(
  options: Partial<SessionEntry> & {
    id: string;
    children?: TreeNode[];
    label?: string;
  },
): TreeNode {
  const { children = [], label, ...entry } = options;
  return {
    entry: {
      type: "message",
      parentId: null,
      timestamp: "2026-10-15",
      ...entry,
    },
    children,
    label,
  };
}

const side = node({
  id: "side",
  parentId: "root",
  message: { role: "user", content: "older branch" },
});
const answer = node({
  id: "answer",
  parentId: "active",
  label: "result",
  message: { role: "assistant", content: "read the alpha file" },
});
const active = node({
  id: "active",
  parentId: "root",
  message: { role: "user", content: "current request" },
  children: [answer],
});
const root = node({
  id: "root",
  message: { role: "user", content: "first request" },
  children: [side, active],
});
const rows = nativeTreeRows({
  tree: [root],
  leafId: "answer",
  filter: "default",
  query: "",
});

/** 解码键盘输入。[in] key：按键字段。返回值：树动作。 */
function keyAction(key: Partial<TreeKey> & { key: string }) {
  return nativeTreeKey({
    key: {
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
      ...key,
    },
    rows,
    selected: "answer",
    filter: "default",
    pageSize: 2,
    query: "",
  });
}

it("当前分支排前，线性链不增加缩进且不改变输入树", () => {
  expect(rows.map((row) => row.node.entry.id)).toEqual([
    "root",
    "active",
    "answer",
    "side",
  ]);
  expect(rows.map((row) => row.depth)).toEqual([0, 1, 1, 1]);
  expect(rows[1].prefix).toBe("├─ ");
  expect(rows[2].prefix).toBe("│  ");
  expect(root.children.map((child) => child.entry.id)).toEqual([
    "side",
    "active",
  ]);
});
it("多词模糊搜索保留匹配节点，而不添加不匹配祖先", () => {
  const filtered = nativeTreeRows({
    tree: [root],
    leafId: "answer",
    filter: "default",
    query: "rd alpha",
  });
  expect(filtered.map((row) => row.node.entry.id)).toEqual(["answer"]);
});
it("标签筛选和用户筛选按原生字段工作", () => {
  expect(
    nativeTreeRows({
      tree: [root],
      leafId: "answer",
      filter: "labeled-only",
      query: "",
    }).map((row) => row.node.entry.id),
  ).toEqual(["answer"]);
  expect(
    nativeTreeRows({
      tree: [root],
      leafId: "answer",
      filter: "user-only",
      query: "",
    }),
  ).toHaveLength(3);
  const skill = node({
    id: "skill",
    type: "custom_message",
    customType: "skill-prompt",
    attribution: "user",
  });
  expect(
    treeNodeVisible({ node: skill, leafId: null, filter: "user-only" }),
  ).toBe(true);
});
it("仅工具调用助手隐藏，但当前叶和错误助手保留", () => {
  const tool = node({
    id: "tool",
    message: {
      role: "assistant",
      content: [{ type: "toolCall", name: "read" }],
    },
  });
  expect(treeNodeVisible({ node: tool, leafId: null, filter: "all" })).toBe(
    false,
  );
  expect(
    treeNodeVisible({ node: tool, leafId: "tool", filter: "default" }),
  ).toBe(true);
  const error = node({
    id: "error",
    message: { role: "assistant", stopReason: "error", content: [] },
  });
  expect(
    treeNodeVisible({ node: error, leafId: null, filter: "default" }),
  ).toBe(true);
});
it("原生工具结果标题取自对应调用参数", () => {
  const result = node({
    id: "result",
    parentId: "call",
    message: { role: "toolResult", toolCallId: "t", toolName: "read" },
  });
  const call = node({
    id: "call",
    message: {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "t",
          name: "read",
          arguments: { path: "src/index.ts" },
        },
      ],
    },
    children: [result],
  });
  expect(
    nativeTreeRows({
      tree: [call],
      leafId: "result",
      filter: "default",
      query: "",
    })[0].text,
  ).toBe("[read: src/index.ts]");
});

it.each([
  ["priority", "Fast"],
  ["ultrafast", "Ultrafast"],
  [undefined, "标准"],
  [null, "标准"],
  ["", "标准"],
  ["flex", "flex"],
  [42, "标准"],
  [{ anthropic: "priority" }, "anthropic: Fast"],
  [{ openai: "ultrafast", anthropic: "priority" }, "openai: Ultrafast · anthropic: Fast"],
  [{ google: "flex" }, "google: flex"],
  [{}, "标准"],
  [[], "标准"],
] as const)("原生服务档位 %j 在全部条目中显示为 %s", (serviceTier, label) => {
  const tier = node({ id: "tier", type: "service_tier_change", serviceTier });
  const options = { tree: [tier], leafId: null, query: "" };
  const all = nativeTreeRows({ ...options, filter: "all" });
  expect(all).toHaveLength(1);
  expect(all[0].text).toBe(`[service tier change]: ${label}`);
  expect(nativeTreeRows({ ...options, filter: "default" })).toHaveLength(0);
  expect(
    nativeTreeRows({ ...options, filter: "all", query: label }).map(
      (row) => row.node.entry.id,
    ),
  ).toEqual(["tier"]);
});
it("被筛选掉的选中条目恢复到最近可见祖先", () => {
  const visible = nativeTreeRows({
    tree: [root],
    leafId: "answer",
    filter: "user-only",
    query: "",
  });
  expect(
    resolveTreeSelection({
      rows: visible,
      nodes: treeIndex([root], "answer").nodes,
      selected: "answer",
    }),
  ).toBe("active");
});
describe("native tree keyboard", () => {
  it("左右翻页而不是折叠，上下逐条移动", () => {
    expect(keyAction({ key: "ArrowLeft" })).toEqual({
      type: "select",
      id: "root",
    });
    expect(keyAction({ key: "ArrowUp" })).toEqual({
      type: "select",
      id: "active",
    });
    expect(keyAction({ key: "ArrowRight" })).toEqual({
      type: "select",
      id: "side",
    });
  });
  it("Enter、Shift Enter、筛选、标签和退出保持独立语义", () => {
    expect(keyAction({ key: "Enter", shiftKey: true })).toEqual({
      type: "confirm",
      summarize: true,
    });
    expect(keyAction({ key: "o", ctrlKey: true, shiftKey: true })).toEqual({
      type: "filter",
      filter: "all",
    });
    expect(keyAction({ key: "u", altKey: true })).toEqual({
      type: "filter",
      filter: "user-only",
    });
    expect(keyAction({ key: "L", shiftKey: true })).toEqual({ type: "label" });
    expect(keyAction({ key: "Escape" })).toEqual({ type: "escape" });
  });
});
