import { useEffect, useState } from "react";

/** 按需每秒刷新当前时间；参数：[in] running 是否运行。返回值：当前毫秒时间。 */
export function useNow(running: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  return now;
}
