import { createContext, useContext } from "react";
import { RichContent } from "./RichContent";

export const ThinkingVisibility = createContext(true);

/** 思考正文直接展示，所有入口共享对话的可见性开关。 */
export function ThinkingContent({ text }: { text: string }) {
  const visible = useContext(ThinkingVisibility);
  if (!visible || !text.trim()) return null;
  return (
    <div className="thinking-content thinking-block">
      <RichContent text={text} />
    </div>
  );
}
