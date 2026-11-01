import type { ComponentProps } from "react";
import { vi, expect, it } from "vitest";
import type { ProjectDiff, ProjectDiffRow, ProjectEntry } from "../../shared/project-browser";
import { ChangeFileSection, type DiffResource } from "./ChangeFileSection";
import { click, container, render } from "./transcript-test-harness";

/** 0-9 未修改，10 新增，11-20 未修改：折叠 0-6 与 14-20，灰条 start 为 0 和 14。 */
function makeDiff(label = "ctx"): ProjectDiff {
  const rows: ProjectDiffRow[] = [];
  for (let index = 0; index < 10; index += 1)
    rows.push({ kind: "context", text: `${label} ${index}`, ending: "\n", oldLine: index + 1, newLine: index + 1 });
  rows.push({ kind: "addition", text: "added", ending: "\n", newLine: 11 });
  for (let index = 0; index < 10; index += 1)
    rows.push({ kind: "context", text: `${label} ${index + 11}`, ending: "\n", oldLine: index + 11, newLine: index + 12 });
  return { before: "", after: "", rows };
}
const ready = (value: ProjectDiff): DiffResource => ({ status: "ready", value });
const entry: ProjectEntry = { name: "a.ts", path: "/p/a.ts", kind: "file", change: "modified" };

function section(overrides: Partial<ComponentProps<typeof ChangeFileSection>> = {}) {
  return (
    <ChangeFileSection entry={entry} base="abc" collapsed={false} resource={ready(makeDiff())}
      layout="unified" wrap foldUnchanged revealTarget={false} onToggle={vi.fn()}
      onOpenInFiles={vi.fn()} onMenu={vi.fn()} register={vi.fn()} {...overrides} />
  );
}
const topBar = (start: number) =>
  container.querySelector<HTMLButtonElement>(`button[data-fold-start="${start}"][data-fold-edge="top"]`);
const rowCount = () => container.querySelectorAll("[data-diff-index]").length;

it("折叠再展开文件区块后，手动展开的段保持不变", async () => {
  await render(section());
  await click(topBar(0)!);
  expect(topBar(0)?.getAttribute("aria-expanded")).toBe("true");
  await render(section({ collapsed: true }));
  expect(container.querySelector(".project-diff-view")).toBeNull();
  await render(section({ collapsed: false }));
  expect(topBar(0)?.getAttribute("aria-expanded")).toBe("true");
  expect(topBar(14)?.getAttribute("aria-expanded")).toBe("false");
});

it("内容相同的刷新保留展开状态，内容变化时清空", async () => {
  await render(section());
  await click(topBar(0)!);
  // 刷新期间先进入 loading，再以内容相同的新对象完成。
  await render(section({ resource: { status: "loading" } }));
  await render(section({ resource: ready(makeDiff()) }));
  expect(topBar(0)?.getAttribute("aria-expanded")).toBe("true");
  await render(section({ resource: { status: "loading" } }));
  await render(section({ resource: ready(makeDiff("changed")) }));
  expect(topBar(0)?.getAttribute("aria-expanded")).toBe("false");
});

it("关闭折叠后显示全部行，再次开启时手动展开的段全部收起", async () => {
  await render(section());
  // 21 行中隐藏 0-6 与 14-20，剩 7 行；展开第一段后 14 行。
  expect(rowCount()).toBe(7);
  await click(topBar(0)!);
  expect(rowCount()).toBe(14);
  await render(section({ foldUnchanged: false }));
  expect(container.querySelector(".project-diff-fold")).toBeNull();
  expect(rowCount()).toBe(21);
  await render(section({ foldUnchanged: true }));
  expect(topBar(0)?.getAttribute("aria-expanded")).toBe("false");
  expect(rowCount()).toBe(7);
});
