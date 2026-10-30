import { useCallback, useEffect, useRef, useState } from "react";
import "./toasts.css";

export interface ToastNotice {
  level: "success" | "info" | "warning" | "error";
  title: string;
  detail?: string;
  action?: { label: string; run: () => void | Promise<void> };
}

export interface ToastItem extends ToastNotice {
  id: number;
}

export interface ToastController {
  items: ToastItem[];
  push: (notice: ToastNotice) => void;
  dismiss: (id: number) => void;
}

interface ToastsProps {
  items: ToastItem[];
  dismiss: (id: number) => void;
}

/** 通知状态由 App 持有，切换会话不重置；只保留最新三条。 */
export function useToasts(): ToastController {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const push = useCallback((notice: ToastNotice) => {
    const item: ToastItem = { ...notice, id: ++nextId.current };
    setItems((previous) => [...previous.slice(-2), item]);
  }, []);
  const dismiss = useCallback((id: number) => {
    setItems((previous) => previous.filter((item) => item.id !== id));
  }, []);
  return { items, push, dismiss };
}

/** 每条通知独立计时，悬停和执行操作时保留尚未用完的显示时间。 */
function Toast({ item, dismiss }: { item: ToastItem; dismiss: (id: number) => void }) {
  const [hovered, setHovered] = useState(false);
  const [running, setRunning] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const remaining = useRef(4000);
  const mounted = useRef(false);
  const actionRunning = useRef(false);
  const level = actionError === undefined ? item.level : "error";

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if ((level !== "info" && level !== "success") || hovered || running) return;
    const started = Date.now();
    const timer = window.setTimeout(() => dismiss(item.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [dismiss, hovered, item.id, level, running]);

  const runAction = async () => {
    if (!item.action || actionRunning.current) return;
    actionRunning.current = true;
    setRunning(true);
    setActionError(undefined);
    try {
      await item.action.run();
    } catch (error) {
      // 操作失败留在当前通知中，避免未处理的 Promise 拒绝或重复全局错误。
      if (mounted.current) setActionError(`操作失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      actionRunning.current = false;
      if (mounted.current) setRunning(false);
    }
  };

  return (
    <div className={`toast toast-${level}`} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <span className="toast-icon" aria-hidden="true">{level === "success" ? "✓" : level === "info" ? "i" : level === "warning" ? "⚠" : "×"}</span>
      <div className="toast-content">
        <strong className="toast-title">{item.title}</strong>
        {item.detail && <p className="toast-detail">{item.detail}</p>}
        {actionError !== undefined && <p className="toast-action-error">{actionError}</p>}
        {item.action && <button type="button" className="toast-action" disabled={running} onClick={() => { void runAction(); }}>{item.action.label}</button>}
      </div>
      <button type="button" className="toast-close" aria-label="关闭通知" onClick={() => dismiss(item.id)}>×</button>
    </div>
  );
}

/** 在输入框上方按时间顺序排列，新通知位于底部。 */
export function Toasts({ items, dismiss }: ToastsProps) {
  return (
    <div className="toasts" aria-live="polite" aria-relevant="additions text">
      {items.map((item) => <Toast key={item.id} item={item} dismiss={dismiss} />)}
    </div>
  );
}
