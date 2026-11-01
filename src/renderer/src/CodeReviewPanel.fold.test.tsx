import { act } from "react";
import { expect, it, vi } from "vitest";
import type { ProjectBrowser, ProjectDiffRow, ProjectEntry, ProjectReview } from "../../shared/project-browser";
import { CodeReviewPanel } from "./CodeReviewPanel";
import { click, container, render } from "./transcript-test-harness";

const file: ProjectEntry = { name: "a.ts", path: "/project/a.ts", kind: "file", change: "modified" };
const rows: ProjectDiffRow[] = [
  ...Array.from({ length: 10 }, (_, index) => ({ kind: "context" as const, text: `ctx ${index}`, ending: "\n", oldLine: index + 1, newLine: index + 1 })),
  { kind: "addition", text: "added", ending: "\n", newLine: 11 },
];

async function settle() {
  for (let index = 0; index < 6; index += 1) await act(async () => {});
}
async function openChanges() {
  const browser: ProjectBrowser & ProjectReview = {
    listProjectChanges: vi.fn<ProjectReview["listProjectChanges"]>(async () => ({ kind: "git", root: "/project", base: "base", files: [file] })),
    listProjectDirectory: vi.fn<ProjectBrowser["listProjectDirectory"]>(async () => []),
    readProjectFile: vi.fn(async () => ""),
    readProjectDiff: vi.fn(async () => ({ before: "", after: "", rows })),
    readProjectImage: vi.fn(),
  };
  await render(<CodeReviewPanel cwd="/project" browser={browser} suspended={false} onClose={vi.fn()} onCommentReveal={vi.fn()} />);
  const tab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((item) => item.textContent?.startsWith("变更"))!;
  await act(() => tab.click());
  await settle();
}
const toggle = () => container.querySelector<HTMLButtonElement>('button[aria-label="折叠未修改的行"]')!;
/** 默认并排，只数修改后一侧，避免两侧重复计数。 */
const visibleRows = () => container.querySelectorAll('[data-diff-side="new"] [data-diff-index]').length;
const bar = () => container.querySelector<HTMLButtonElement>('button[data-fold-edge="top"]');
async function tooltip() {
  await act(() => { toggle().focus(); });
  const text = toggle().querySelector('[role="tooltip"]')?.textContent;
  await act(() => { toggle().blur(); });
  return text;
}

it("工具栏开关默认开启，关闭后显示全部行，再次开启后手动展开的段收起", async () => {
  await openChanges();
  expect(toggle().getAttribute("aria-pressed")).toBe("true");
  expect(await tooltip()).toBe("显示全部未修改的行");
  expect(bar()?.textContent).toBe("7 行未修改");
  await click(bar()!);
  expect(bar()?.getAttribute("aria-expanded")).toBe("true");
  expect(visibleRows()).toBe(11);

  await click(toggle());
  expect(toggle().getAttribute("aria-pressed")).toBe("false");
  expect(await tooltip()).toBe("折叠未修改的行");
  expect(container.querySelector(".project-diff-fold")).toBeNull();
  expect(visibleRows()).toBe(11);

  await click(toggle());
  expect(toggle().getAttribute("aria-pressed")).toBe("true");
  expect(bar()?.getAttribute("aria-expanded")).toBe("false");
  expect(visibleRows()).toBe(4);
});
