import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { PromptContext } from "../../shared/prompt-context";
import type { CommentSourceAnchor } from "../../shared/comment-anchor";
import { activeDraftComments, addDraftComment, deleteDraftComment, newCommentDraft, updateDraftComment, type CommentDraft } from "./comment-draft";

/** 同步 ref 是异步提交的事务边界，React 状态仅负责展示。 */
export function useCommentDraft() {
  const [state, setState] = useState(newCommentDraft);
  const current = useRef(state);
  const commit = useCallback((next: CommentDraft) => { current.current = next; setState(next); }, []);
  const setDraft: Dispatch<SetStateAction<string>> = useCallback((value) => {
    const previous = current.current;
    const text = typeof value === "function" ? value(previous.text) : value;
    if (text !== previous.text) commit({ ...previous, text, revision: previous.revision + 1 });
  }, [commit]);
  const resetDraft = useCallback((text = "") => commit(newCommentDraft(text)), [commit]);
  const addComment = useCallback((context: PromptContext, comment: string, sourceAnchor?: CommentSourceAnchor) => {
    const next = addDraftComment(current.current, current.current.nextNumber, context, comment, sourceAnchor);
    commit(next);
  }, [commit]);
  const editComment = useCallback((id: string, comment: string) => commit(updateDraftComment(current.current, id, comment)), [commit]);
  const removeComment = useCallback((id: string) => commit(deleteDraftComment(current.current, id)), [commit]);
  const consume = useCallback((submission: { draftId: string; revision: number }) => {
    const latest = current.current;
    if (latest.id !== submission.draftId || latest.revision !== submission.revision) return false;
    resetDraft();
    return true;
  }, [resetDraft]);
  const activeComments = useMemo(() => activeDraftComments(state), [state]);
  return { draft: state.text, state, current, activeComments, setDraft, resetDraft, restore: commit, addComment, editComment, removeComment, consume };
}
