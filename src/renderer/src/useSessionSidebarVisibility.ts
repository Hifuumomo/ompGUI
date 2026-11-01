import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "omp-desktop.session-sidebar-hidden";
const NARROW_QUERY = "(max-width: 800px)";

/** 桌面偏好独立保存，窄屏抽屉只在当前断点内临时打开。 */
export function useSessionSidebarVisibility() {
  const [media] = useState(() =>
    typeof window.matchMedia === "function"
      ? window.matchMedia(NARROW_QUERY)
      : undefined,
  );
  const [viewport, setViewport] = useState(() => ({
    isNarrow: media?.matches ?? window.innerWidth <= 800,
    mobileSidebarOpen: false,
  }));
  const [desktopSidebarHidden, setDesktopSidebarHidden] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const desktopHidden = useRef(desktopSidebarHidden);

  useEffect(() => {
    const change = () => {
      const isNarrow = media?.matches ?? window.innerWidth <= 800;
      // 同一次更新切换断点并关闭抽屉，避免旧抽屉状态短暂泄露。
      setViewport((previous) =>
        previous.isNarrow === isNarrow
          ? previous
          : { isNarrow, mobileSidebarOpen: false },
      );
    };
    if (media) media.addEventListener("change", change);
    else window.addEventListener("resize", change);
    change();
    return () => {
      if (media) media.removeEventListener("change", change);
      else window.removeEventListener("resize", change);
    };
  }, [media]);

  const toggleSidebar = useCallback(() => {
    if (viewport.isNarrow) {
      setViewport((previous) => ({
        ...previous,
        mobileSidebarOpen: !previous.mobileSidebarOpen,
      }));
      return;
    }
    const hidden = !desktopHidden.current;
    desktopHidden.current = hidden;
    setDesktopSidebarHidden(hidden);
    // 只由桌面主动操作写入，挂载、断点切换和抽屉操作均不保存。
    try {
      localStorage.setItem(STORAGE_KEY, String(hidden));
    } catch {
      /* 存储不可用时仍可切换当前窗口。 */
    }
  }, [viewport.isNarrow]);

  const closeMobileSidebar = useCallback(() => {
    setViewport((previous) =>
      previous.mobileSidebarOpen
        ? { ...previous, mobileSidebarOpen: false }
        : previous,
    );
  }, []);

  return {
    isNarrow: viewport.isNarrow,
    mobileSidebarOpen: viewport.mobileSidebarOpen,
    sidebarVisible: viewport.isNarrow
      ? viewport.mobileSidebarOpen
      : !desktopSidebarHidden,
    toggleSidebar,
    closeMobileSidebar,
  };
}
