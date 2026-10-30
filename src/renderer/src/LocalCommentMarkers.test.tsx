import { act, useRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { LocalCommentMarkers, LocalSourceMarkers, type LocalCommentEntry } from "./LocalCommentMarkers";
import { container, render } from "./transcript-test-harness";

const context = { kind: "file" as const, path: "/a.ts", text: "one\n", representation: "source" as const, startLine: 1, endLine: 1 };
const entries: LocalCommentEntry[] = [{ id: "first", number: 7, context, sourceAnchor: { kind: "local", view: "source", path: "/a.ts", identity: "one\n", startLine: 1 } }];
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function Source({ identity, items = entries, edit }: { identity: string; items?: LocalCommentEntry[]; edit: (id: string, anchor: { x: number; y: number }, trigger?: HTMLElement) => void }) {
  const root = useRef<HTMLDivElement>(null);
  return <LocalCommentMarkers.Provider value={{ entries: items, edit }}>
    <div ref={root}><span className="file-code-row"><span className="file-code-gutter" data-line="1" /><span className="file-code-text">one</span></span></div>
    <LocalSourceMarkers root={root} path="/a.ts" view="source" identity={identity} />
  </LocalCommentMarkers.Provider>;
}

it("编号点击编辑原记录，重复来源并列且不进入正文，内容变化或删除后消失", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 10, right: 310, top: 20, bottom: 50, width: 300, height: 30, x: 10, y: 20, toJSON() {} });
  const edit = vi.fn();
  const second: LocalCommentEntry = { ...entries[0], id: "second", number: 8 };
  await render(<Source identity={"one\n"} items={[...entries, second]} edit={edit} />);
  const badges = [...document.querySelectorAll<HTMLButtonElement>(".local-comment-marker")];
  expect(badges.map((badge) => badge.textContent)).toEqual(["7", "8"]);
  expect(badges[0].style.left).not.toBe(badges[1].style.left);
  expect(container.querySelector(".file-code-row")?.textContent).toBe("one");
  await act(() => badges[0].click());
  expect(edit).toHaveBeenCalledWith("first", expect.objectContaining({ x: expect.any(Number), y: 20 }), container.querySelector(".file-code-row"));
  await render(<Source identity={"changed\n"} edit={edit} />);
  expect(document.querySelector(".local-comment-marker")).toBeNull();
  await render(<Source identity={"one\n"} edit={edit} />);
  expect(document.querySelector(".local-comment-marker")?.textContent).toBe("7");
  await render(<Source identity={"one\n"} items={[]} edit={edit} />);
  expect(document.querySelector(".local-comment-marker")).toBeNull();
});
