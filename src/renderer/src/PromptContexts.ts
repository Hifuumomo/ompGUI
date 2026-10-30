import { createContext } from "react";
import type { PromptContext } from "../../shared/prompt-context";
import type { CommentSourceAnchor } from "../../shared/comment-anchor";

export interface PromptContextActions {
  comment(context: PromptContext, anchor: { x: number; y: number }, trigger?: HTMLElement, sourceAnchor?: CommentSourceAnchor): void;
  append(context: PromptContext): void;
}
export const PromptContexts = createContext<PromptContextActions | undefined>(undefined);
