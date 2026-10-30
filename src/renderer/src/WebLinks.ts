import { createContext } from "react";

/** 所有富文本网页链接共用同一侧栏入口。 */
export const WebLinks = createContext<
  ((url: string) => Promise<"opened" | "deferred">) | undefined
>(undefined);
