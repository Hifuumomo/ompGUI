import { useEffect, useLayoutEffect, useState } from "react";

const STORAGE_KEY = "omp-desktop.interface-font-size";
export const DEFAULT_INTERFACE_FONT_SIZE = 14;
export const MIN_INTERFACE_FONT_SIZE = 12;
export const MAX_INTERFACE_FONT_SIZE = 20;

/** 保存界面字号到本机并等比缩放整个窗口，不改动会话与连接配置。 */
export function useInterfaceFontSize() {
  const [fontSize, setFontSize] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const value = stored === null ? DEFAULT_INTERFACE_FONT_SIZE : Number(stored);
      return Number.isFinite(value)
        ? Math.max(MIN_INTERFACE_FONT_SIZE, Math.min(MAX_INTERFACE_FONT_SIZE, Math.round(value)))
        : DEFAULT_INTERFACE_FONT_SIZE;
    } catch {
      return DEFAULT_INTERFACE_FONT_SIZE;
    }
  });
  useLayoutEffect(() => {
    window.desktop.setZoomFactor(fontSize / DEFAULT_INTERFACE_FONT_SIZE);
  }, [fontSize]);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(fontSize));
    } catch {
      /* 存储不可用时保留本次窗口设置。 */
    }
  }, [fontSize]);
  return { fontSize, setFontSize };
}
