import { useCallback, useEffect, useState, type RefObject } from "react";

/** 测量展开正文是否需要吸顶，并跟踪异步内容和视口变化；参数：[in] panelRef 正文引用，[in] open 展开状态。返回值：吸顶状态与测量函数。 */
export function useStickyMeasure(
  panelRef: RefObject<HTMLElement | null>,
  open: boolean,
) {
  const [long, setLong] = useState(false);
  const measure = useCallback(() => {
    const panel = panelRef.current;
    setLong(
      open &&
        !!panel &&
        (!!panel.querySelector(
          '[data-expanded="true"], [data-output-expanded="true"]',
        ) ||
          panel.offsetHeight > window.innerHeight / 2),
    );
  }, [panelRef, open]);
  useEffect(() => {
    measure();
    if (!open) return;
    const panel = panelRef.current;
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);
    if (panel) observer?.observe(panel);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure, open, panelRef]);
  return { sticky: open && long, measure };
}
