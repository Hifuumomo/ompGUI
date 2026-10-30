import { createContext } from "react";

/** 会话内的富文本共享文件打开入口；独立渲染的内容默认不能打开文件。 */
export const MessageFileLinks = createContext<
  ((href: string) => Promise<void>) | undefined
>(undefined);

/** 会话富文本中文件链接的右键菜单入口；坐标为视口位置，失败时拒绝。 */
export const MessageFileMenu = createContext<
  ((href: string, x: number, y: number) => Promise<void>) | undefined
>(undefined);
