import { useEffect, useState } from "react";

const STORAGE_KEY = "omp-desktop.conversation-gutter";
export const DEFAULT_CONVERSATION_GUTTER = 28;

/** 保存界面留白到本机，不改动原生会话与连接配置。 */
export function useConversationSpacing() {
  const [gutter, setGutter] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const value =
        stored === null ? DEFAULT_CONVERSATION_GUTTER : Number(stored);
      return Number.isFinite(value)
        ? Math.max(12, Math.min(160, value))
        : DEFAULT_CONVERSATION_GUTTER;
    } catch {
      return DEFAULT_CONVERSATION_GUTTER;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(gutter));
    } catch {
      /* 存储不可用时保留本次窗口设置。 */
    }
  }, [gutter]);
  return { gutter, setGutter };
}
