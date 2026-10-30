import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FileAction, FileOpener } from "../../shared/file-actions";
import type { ProjectEntry } from "../../shared/project-browser";
import "./session-menu.css";
import "./file-context-menu.css";

export interface FileMenuTarget {
  readonly href: string;
  readonly entry: ProjectEntry;
  readonly x: number;
  readonly y: number;
}

/** 去掉 Electron IPC 包装前缀，保留主进程给出的原因。 */
function failureText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    "",
  );
}

/**
 * 会话内文件链接的右键菜单，条目仿照 ChatGPT 桌面端（不含单独的「在 VS Code 中打开」）。
 * @param props [in] target：链接与主进程核实过的位置；cwd：解析相对链接的会话目录；onClose：关闭菜单。
 * @returns 固定定位菜单；打开类操作经主进程重新核实路径后执行。
 */
export function FileContextMenu({
  target,
  cwd,
  onClose,
  onComment,
  onAddDiff,
}: {
  readonly target: FileMenuTarget;
  readonly cwd: string;
  readonly onClose: () => void;
  readonly onComment?: () => Promise<void>;
  readonly onAddDiff?: () => Promise<void>;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const submenuElement = useRef<HTMLDivElement>(null);
  const submenuTrigger = useRef<HTMLButtonElement>(null);
  const focusSubmenu = useRef(false);
  const [openers, setOpeners] = useState<readonly FileOpener[]>();
  const [submenu, setSubmenu] = useState(false);
  const [error, setError] = useState("");
  const [position, setPosition] = useState({ left: target.x, top: target.y });
  const [submenuPosition, setSubmenuPosition] = useState({ left: 0, top: 0 });
  const file = target.entry.kind === "file";

  useEffect(() => {
    let active = true;
    window.desktop.listFileOpeners().then(
      (list) => active && setOpeners(list),
      (failure: unknown) => {
        if (!active) return;
        setOpeners([]);
        setError(failureText(failure));
      },
    );
    return () => {
      active = false;
    };
  }, []);

  // 按实际尺寸约束到窗口内；异步错误也可能改变菜单高度。
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(target.x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(target.y, window.innerHeight - height - 8)),
    });
  }, [target.x, target.y, error]);

  useLayoutEffect(() => {
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [target.x, target.y]);

  function positionSubmenu() {
    const parent = menu.current;
    const child = submenuElement.current;
    const trigger = submenuTrigger.current;
    if (!parent || !child || !trigger) return;
    const parentRect = parent.getBoundingClientRect();
    const childRect = child.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const right = parentRect.right - 1;
    const left =
      right + childRect.width <= window.innerWidth - 8
        ? right
        : parentRect.left - childRect.width + 1;
    setSubmenuPosition({
      left: Math.max(8, Math.min(left, window.innerWidth - childRect.width - 8)),
      top: Math.max(
        8,
        Math.min(triggerRect.top, window.innerHeight - childRect.height - 8),
      ),
    });
  }

  useLayoutEffect(() => {
    if (submenu) positionSubmenu();
  }, [submenu, openers, error, position.left, position.top]);

  useLayoutEffect(() => {
    if (!submenu || !focusSubmenu.current) return;
    if (
      document.activeElement !== submenuTrigger.current &&
      !submenuElement.current?.contains(document.activeElement)
    ) {
      focusSubmenu.current = false;
      return;
    }
    const first = submenuElement.current?.querySelector<HTMLButtonElement>("button");
    if (!first) return;
    focusSubmenu.current = false;
    first.focus({ preventScroll: true });
  }, [submenu, openers]);

  function openSubmenu() {
    if (!submenu) {
      focusSubmenu.current = true;
      submenuTrigger.current?.focus({ preventScroll: true });
    }
    setSubmenu(true);
  }

  function closeSubmenu() {
    focusSubmenu.current = false;
    setSubmenu(false);
    submenuTrigger.current?.focus({ preventScroll: true });
  }

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!(
        event.target instanceof Node && menu.current?.contains(event.target)
      ))
        onClose();
    };
    const wheel = (event: WheelEvent) => {
      if (!(event.target instanceof Node && menu.current?.contains(event.target)))
        onClose();
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    window.addEventListener("wheel", wheel, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("wheel", wheel);
    };
  }, [onClose]);

  async function perform(operation: () => Promise<void>) {
    setError("");
    try {
      await operation();
      onClose();
    } catch (failure) {
      setError(failureText(failure));
    }
  }
  const run = (action: FileAction) =>
    perform(() => window.desktop.runFileAction(target.href, cwd, action));

  return (
    <div
      ref={menu}
      className="session-menu file-context-menu"
      role="menu"
      aria-label={`文件操作：${target.entry.name}`}
      style={position}
      onContextMenu={(event) => event.preventDefault()}
      onScroll={(event) => {
        if (submenu && event.target === event.currentTarget) positionSubmenu();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          if (submenu && event.key === "Escape") closeSubmenu();
          else onClose();
          return;
        }
        if (event.key === "ArrowRight" && !submenu) {
          const focused = document.activeElement;
          if (focused instanceof HTMLElement && focused.dataset.submenu) {
            event.preventDefault();
            openSubmenu();
          }
          return;
        }
        if (event.key === "ArrowLeft" && submenu) {
          event.preventDefault();
          closeSubmenu();
          return;
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const scope =
          document.activeElement?.closest(".file-context-submenu") ??
          menu.current;
        const items = [
          ...(scope?.querySelectorAll<HTMLButtonElement>(
            scope === menu.current ? ":scope > button" : "button",
          ) ?? []),
        ];
        const index = items.findIndex(
          (item) => item === document.activeElement,
        );
        items[
          (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length
        ]?.focus();
      }}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => void run({ type: "open" })}
      >
        {target.entry.kind === "directory" ? "打开文件夹" : "打开文件"}
      </button>
      <button
        type="button"
        role="menuitem"
        ref={submenuTrigger}
        data-submenu="true"
        aria-haspopup="menu"
        aria-expanded={submenu}
        className="file-context-parent"
        onClick={openSubmenu}
        onMouseEnter={openSubmenu}
      >
        打开方式
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m6 3.5 4.5 4.5L6 12.5" />
        </svg>
      </button>
      {submenu && (
        <div
          className="session-menu file-context-submenu"
          role="menu"
          aria-label="打开方式"
          ref={submenuElement}
          style={submenuPosition}
        >
          {openers === undefined ? (
            <p role="status">正在查找程序…</p>
          ) : (
            openers.map((opener) => (
              <button
                key={opener.id}
                type="button"
                role="menuitem"
                onClick={() =>
                  void run({ type: "open-with", opener: opener.id })
                }
              >
                {opener.label}
              </button>
            ))
          )}
        </div>
      )}
      <hr />
      {file && (
        <button
          type="button"
          role="menuitem"
          onMouseEnter={() => setSubmenu(false)}
          onClick={() => void run({ type: "save-as" })}
        >
          另存为…
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        onMouseEnter={() => setSubmenu(false)}
        onClick={() => void run({ type: "copy-path" })}
      >
        复制路径
      </button>
      {file && (
        <button
          type="button"
          role="menuitem"
          onMouseEnter={() => setSubmenu(false)}
          onClick={() => void run({ type: "copy-content" })}
        >
          复制文件内容
        </button>
      )}
      {onComment && file && (
        <button type="button" role="menuitem" onClick={() => void perform(onComment)}>
          评论文件
        </button>
      )}
      {onAddDiff && file && (
        <button type="button" role="menuitem" onClick={() => void perform(onAddDiff)}>
          添加 Git diff 到提示词
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        onMouseEnter={() => setSubmenu(false)}
        onClick={() => void run({ type: "reveal" })}
      >
        在资源管理器中打开
      </button>
      {error && (
        <p className="file-context-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
