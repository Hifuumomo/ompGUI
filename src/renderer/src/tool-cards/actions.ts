import { createContext } from "react";

/** 转录框可调用的既有界面操作，不扩展导航协议。 */
export const TranscriptActions = createContext<{ onOpenSubagent?: () => void }>(
  {},
);
