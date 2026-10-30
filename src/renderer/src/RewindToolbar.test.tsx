import { act } from "react";
import { expect, it, vi } from "vitest";
import type { SessionEntry } from "../../shared/protocol";
import { render, container } from "./transcript-test-harness";
import { RewindToolbar } from "./RewindToolbar";
import { useRewind } from "./useRewind";

const entries: SessionEntry[] = [
  {
    type: "message",
    id: "u",
    parentId: null,
    timestamp: "2026-10-15",
    message: { role: "user", content: "用户问题" },
  },
  {
    type: "message",
    id: "a",
    parentId: "u",
    timestamp: "2026-10-15",
    message: { role: "assistant", content: "助手回复" },
  },
];

function Consumer({
  onNavigate,
  onCancel,
}: {
  onNavigate: (entry: SessionEntry) => void;
  onCancel: () => void;
}) {
  const rewind = useRewind({
    enabled: true,
    entries,
    leafId: "a",
    onNavigate,
    onCancel,
  });
  return (
    <>
      <output>{rewind.selectedTarget?.turnId}</output>
      <RewindToolbar rewind={rewind} />
    </>
  );
}

async function key(value: string) {
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: value, bubbles: true }),
    ),
  );
}

it("筛选 Esc 先恢复全文并保留选中，再次 Esc 才取消", async () => {
  const cancel = vi.fn();
  const navigate = vi.fn();
  await render(<Consumer onNavigate={navigate} onCancel={cancel} />);
  await key("ArrowUp");
  await key("f");
  expect(container.querySelector("input")).not.toBeNull();
  expect(container.querySelector("output")?.textContent).toBe("u");
  await key("Escape");
  expect(container.querySelector("input")).toBeNull();
  expect(container.querySelector("output")?.textContent).toBe("u");
  expect(cancel).not.toHaveBeenCalled();
  await key("Escape");
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(navigate).not.toHaveBeenCalled();
});

it("Enter 将选中节点交给原生导航回调，移动预览不产生导航", async () => {
  const navigate = vi.fn();
  await render(<Consumer onNavigate={navigate} onCancel={vi.fn()} />);
  await key("ArrowUp");
  expect(navigate).not.toHaveBeenCalled();
  await key("Enter");
  expect(navigate).toHaveBeenCalledExactlyOnceWith(entries[0]);
});
