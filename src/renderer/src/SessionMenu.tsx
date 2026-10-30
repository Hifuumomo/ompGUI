import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { SessionSummary, SessionEngineStatus } from "../../shared/protocol";
import "./session-menu.css";

export interface SessionMenuTarget {
  sessions: readonly SessionSummary[];
  x: number;
  y: number;
}

/** 按路径报告删除结果；未带错误表示文件及附属产物已删除。 */
export interface SessionDeletionResult {
  path: string;
  error?: string;
}

interface SessionMenuProps {
  target: SessionMenuTarget;
  /** 目标是否为当前打开的会话；删除后界面回到欢迎页。 */
  current: boolean;
  onClose: () => void;
  onRename: (session: SessionSummary, name: string) => Promise<void>;
  onDelete: (sessions: readonly SessionSummary[]) => Promise<SessionDeletionResult[]>;
  onCopy: (sessions: readonly SessionSummary[], kind: "paths" | "content") => Promise<void>;
  onSeance: (sessions: readonly SessionSummary[]) => Promise<void>;
  engines: readonly SessionEngineStatus[];
  onEngine: (sessions: readonly SessionSummary[], start: boolean) => Promise<void>;
}

/** 原生租约冲突改写为可操作的说明，其余错误原样展示。 */
function describeError(error: unknown, action: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("SESSION_OCCUPIED"))
    return `该会话正在被其他 omp 实例使用，无法${action}。请先结束占用该会话的 omp 后重试。`;
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}

/** Tab 在对话框内循环，Esc 取消；按键不冒泡到会话快捷键。 */
function trapDialogKeys(
  event: KeyboardEvent<HTMLDivElement>,
  cancel: () => void,
) {
  event.stopPropagation();
  if (event.key === "Escape") {
    event.preventDefault();
    cancel();
    return;
  }
  if (event.key !== "Tab") return;
  event.preventDefault();
  const controls = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      "input:not(:disabled), button:not(:disabled)",
    ),
  ];
  const active = document.activeElement;
  const index = controls.findIndex((control) => control === active);
  controls[
    (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
  ]?.focus();
}

/** 侧边栏会话右键菜单：重命名、删除；均由主进程取得原生租约后执行。 */
export function SessionMenu({
  target,
  current,
  onClose,
  onRename,
  onDelete,
  onCopy,
  onSeance,
  engines,
  onEngine,
}: SessionMenuProps) {
  const [mode, setMode] = useState<"menu" | "rename" | "delete">("menu");
  const session = target.sessions[0];
  const batch = target.sessions.length > 1;
  const [name, setName] = useState(session?.title ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [submenu, setSubmenu] = useState(false);
  const [deleted, setDeleted] = useState<Set<string>>(() => new Set());
  const [deleteFailures, setDeleteFailures] = useState<SessionDeletionResult[]>([]);
  const deleting = useRef(false);
  const [position, setPosition] = useState({ x: target.x, y: target.y });
  const menu = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const title = batch ? `${target.sessions.length} 个会话` : session?.title || "未命名会话";
  const startable = target.sessions.filter((item) => !engines.some((engine) => engine.sessionPath === item.path));
  const stoppable = target.sessions.filter((item) => engines.some((engine) => engine.sessionPath === item.path && engine.state !== "starting" && engine.state !== "stopping"));
  const submenuButton = useRef<HTMLButtonElement>(null);
  const submenuMenu = useRef<HTMLDivElement>(null);
  const focusSubmenu = useRef(false);
  const [submenuPosition, setSubmenuPosition] = useState({ x: 0, y: 0 });

  function openSubmenu(focus = false) {
    if (focus) {
      if (submenuMenu.current)
        submenuMenu.current.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
      else focusSubmenu.current = true;
    }
    setSubmenu(true);
  }

  function positionSubmenu() {
    if (!menu.current || !submenuButton.current || !submenuMenu.current) return;
    const parent = menu.current.getBoundingClientRect();
    const trigger = submenuButton.current.getBoundingClientRect();
    const child = submenuMenu.current.getBoundingClientRect();
    const right = parent.right - 1;
    const x = right + child.width <= window.innerWidth - 8
      ? right
      : parent.left - child.width + 1;
    setSubmenuPosition({
      x: Math.max(8, Math.min(x, window.innerWidth - child.width - 8)),
      y: Math.max(8, Math.min(trigger.top, window.innerHeight - child.height - 8)),
    });
  }

  useLayoutEffect(() => {
    if (mode !== "menu" || !menu.current) return;
    const rect = menu.current.getBoundingClientRect();
    setPosition({
      x: Math.max(8, Math.min(target.x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(target.y, window.innerHeight - rect.height - 8)),
    });
  }, [mode, target.x, target.y, error]);

  useLayoutEffect(() => {
    if (mode !== "menu" || !submenu) return;
    positionSubmenu();
    if (focusSubmenu.current) {
      focusSubmenu.current = false;
      submenuMenu.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    }
  }, [mode, submenu, position.x, position.y, error, pending]);

  useEffect(() => {
    if (mode === "menu") menu.current?.querySelector("button")?.focus();
    else if (mode === "rename") dialog.current?.querySelector("input")?.select();
    else dialog.current?.querySelector("button")?.focus();
  }, [mode]);

  // 菜单阶段点击外部、窗口失焦或尺寸变化即关闭；对话框阶段由遮罩独占交互。
  useEffect(() => {
    if (mode !== "menu") return;
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node && menu.current?.contains(event.target)))
        onClose();
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [mode, onClose]);

  async function run(action: string, operation: () => Promise<void>) {
    setPending(true);
    setError("");
    try {
      await operation();
      onClose();
    } catch (failure) {
      setError(describeError(failure, action));
      setPending(false);
    }
  }

  /** 重试仅包含失败项，已成功删除的路径不会再次提交。 */
  async function deleteSessions() {
    if (deleting.current) return;
    const remaining = target.sessions.filter((item) => !deleted.has(item.path));
    deleting.current = true;
    setPending(true);
    setError("");
    let results: SessionDeletionResult[];
    try {
      results = await onDelete(remaining);
    } catch (failure) {
      results = remaining.map((item) => ({ path: item.path, error: describeError(failure, "删除") }));
    }
    const successes = new Set(deleted);
    const failures: SessionDeletionResult[] = [];
    for (const item of remaining) {
      const result = results.find((entry) => entry.path === item.path);
      if (result && result.error === undefined) successes.add(item.path);
      else failures.push({ path: item.path, error: result?.error ?? "未收到删除结果，请重试。" });
    }
    setDeleted(successes);
    setDeleteFailures(failures);
    deleting.current = false;
    setPending(false);
    if (!failures.length) onClose();
  }

  if (mode === "menu")
    return (
      <div
        ref={menu}
        className="session-menu"
        role="menu"
        aria-label={`会话操作：${title}`}
        style={{
          left: position.x,
          top: position.y,
        }}
        onScroll={positionSubmenu}
        onKeyDown={(event) => {
          event.stopPropagation();
          const inSubmenu = (event.target as Element).closest(".session-menu-submenu");
          if (event.key === "ArrowLeft" || (event.key === "Escape" && inSubmenu)) {
            event.preventDefault();
            setSubmenu(false);
            submenuButton.current?.focus();
            return;
          }
          if (event.key === "ArrowRight" && event.target === submenuButton.current) {
            event.preventDefault();
            openSubmenu(true);
            return;
          }
          if (event.key === "Escape" || event.key === "Tab") {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          const scope = (event.target as Element).closest('[role="menu"]') ?? event.currentTarget;
          const items = [...scope.querySelectorAll<HTMLButtonElement>(":scope > button:not(:disabled)")];
          const index = items.findIndex(
            (item) => item === document.activeElement,
          );
          items[
            (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
              items.length
          ]?.focus();
        }}
      >
        {batch && <p className="session-menu-count">已选择 {target.sessions.length} 个会话</p>}
        <button type="button" role="menuitem" disabled={pending || !startable.length}
          onClick={() => void run("开启 omp", () => onEngine(startable, true))}>
          {batch ? `开启 omp（${startable.length}）` : "开启 omp"}
        </button>
        <button type="button" role="menuitem" disabled={pending || !stoppable.length}
          onClick={() => void run("关闭 omp", () => onEngine(stoppable, false))}>
          {batch ? `关闭 omp（${stoppable.length}）` : "关闭 omp"}
        </button>
        {!batch && <button type="button" role="menuitem" onClick={() => setMode("rename")}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M10.5 2.5l3 3L6 13H3v-3z" />
          </svg>
          重命名
        </button>}
        <button
          type="button"
          role="menuitem"
          className="danger"
          onClick={() => setMode("delete")}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" />
          </svg>
          删除
        </button>
        {batch ? <>
          <button type="button" role="menuitem" disabled={pending}
            onClick={() => void run("复制", () => onCopy(target.sessions, "paths"))}>复制所选会话 JSONL 路径</button>
          <button type="button" role="menuitem" disabled={pending}
            onClick={() => void run("咨询", () => onSeance(target.sessions))}>并行 /seance 咨询</button>
        </> : <button ref={submenuButton} type="button" role="menuitem" aria-haspopup="menu"
          aria-expanded={submenu} disabled={pending}
          onMouseEnter={() => { if (!pending) openSubmenu(); }}
          onClick={() => openSubmenu(true)}>
          会话内容与咨询 <span aria-hidden="true">›</span>
        </button>}
        {submenu && <div ref={submenuMenu} className="session-menu session-menu-submenu"
          role="menu" aria-label="会话内容与咨询"
          style={{ left: submenuPosition.x, top: submenuPosition.y }}>
          <button type="button" role="menuitem" disabled={pending}
            onClick={() => void run("复制", () => onCopy(target.sessions, "paths"))}>复制会话 JSONL 路径</button>
          <button type="button" role="menuitem" disabled={pending}
            onClick={() => void run("复制", () => onCopy(target.sessions, "content"))}>复制会话主要内容</button>
          <button type="button" role="menuitem" disabled={pending}
            onClick={() => void run("咨询", () => onSeance(target.sessions))}>对此会话调用 /seance</button>
        </div>}
        {error && <p role="alert">{error}</p>}
      </div>
    );

  const cancel = () => {
    if (!pending) onClose();
  };
  return (
    <div className="confirm-backdrop">
      <div
        ref={dialog}
        className="confirm-dialog"
        role={mode === "delete" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-label={mode === "delete" ? "确认删除会话" : "重命名会话"}
        onKeyDown={(event) => trapDialogKeys(event, cancel)}
      >
        {mode === "rename" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const next = name.trim();
              if (!next) {
                setError("会话名称不能为空");
                return;
              }
              if (session) void run("重命名", () => onRename(session, next));
            }}
          >
            <h3>重命名会话</h3>
            <input
              className="session-rename-input"
              aria-label="会话名称"
              value={name}
              maxLength={140}
              disabled={pending}
              onChange={(event) => setName(event.target.value)}
            />
            {error && <p role="alert">{error}</p>}
            <div className="action-row">
              <button type="button" disabled={pending} onClick={cancel}>
                取消
              </button>
              <button type="submit" className="primary" disabled={pending}>
                {pending ? "正在保存…" : "保存"}
              </button>
            </div>
          </form>
        ) : (
          <>
            <h3>删除会话？</h3>
            <p>
              将永久删除{batch ? `所选 ${target.sessions.length} 个会话` : `会话「${title}」`}的记录文件及其附属产物，此操作无法撤销。项目文件不会被删除。
            </p>
            <ul className="session-delete-list">{target.sessions.map((item) => (
              <li key={item.path}>{item.title || "未命名会话"}{deleted.has(item.path) && " — 已删除"}</li>
            ))}</ul>
            {current && <p>所选目标包含当前打开的会话，删除后界面将回到欢迎页。</p>}
            {deleted.size > 0 && <p role="status">已成功删除 {deleted.size} 个会话。</p>}
            {deleteFailures.map((failure) => <p role="alert" key={failure.path}>
              {target.sessions.find((item) => item.path === failure.path)?.title || failure.path}：
              {describeError(failure.error, "删除")}
            </p>)}
            {error && <p role="alert">{error}</p>}
            <div className="action-row">
              <button type="button" disabled={pending} onClick={cancel}>
                取消
              </button>
              <button
                type="button"
                className="danger"
                disabled={pending}
                onClick={() => void deleteSessions()}
              >
                {pending ? "正在删除…" : deleteFailures.length ? "重试失败项" : "确认删除"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
