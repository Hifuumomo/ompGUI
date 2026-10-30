import type { BtwRecord } from "../../shared/protocol";
import { sameProjectPath } from "../../shared/message-file-link";

export interface BtwIdentity {
  sessionId?: string;
  sessionFile?: string;
  cwd: string;
  agentDir?: string;
  profile?: string;
}
export interface BtwSelection {
  start: number;
  end: number;
  direction: "forward" | "backward" | "none";
}
export interface BtwDraft {
  text: string;
  revision: number;
  selection: BtwSelection;
}
export interface BtwScopeState {
  key: string;
  identity: BtwIdentity;
  selectedId?: string;
  drafts: Map<string, BtwDraft>;
  scrolls: Map<string, { top: number; follow: boolean }>;
  history: "unavailable" | "loading" | "ready" | "error";
  historyError?: string;
  operationError?: string;
  storageError?: string;
  errors: Map<string, string>;
}
export const BTW_NEW_TOPIC = "";

/** 缺省路径不能与实际路径共享草稿；Windows 路径沿用项目比较规则。 */
export function sameBtwIdentity(a: BtwIdentity, b: BtwIdentity): boolean {
  const pathEqual = (left?: string, right?: string) =>
    left === undefined || right === undefined ? left === right : sameProjectPath(left, right);
  return a.sessionId === b.sessionId && a.profile === b.profile &&
    sameProjectPath(a.cwd, b.cwd) && pathEqual(a.agentDir, b.agentDir) &&
    pathEqual(a.sessionFile, b.sessionFile);
}

export function createBtwScope(identity: BtwIdentity, key: string): BtwScopeState {
  return { key, identity: { ...identity }, drafts: new Map(), scrolls: new Map(),
    history: "unavailable", errors: new Map() };
}

/** 只消费原提交版本，等待期间的新文字与选区必须保留。 */
export function consumeBtwDraft(draft: BtwDraft, submittedRevision: number): BtwDraft {
  return draft.revision !== submittedRevision ? draft : {
    text: "", revision: draft.revision + 1,
    selection: { start: 0, end: 0, direction: "none" },
  };
}

/** 与原生旁问一致：复制最后一个非空答案，不拼接整个主题。 */
export function getBtwCopyText(record: BtwRecord): string | undefined {
  for (let i = (record.followUps?.length ?? 0) - 1; i >= 0; i--) {
    const answer = record.followUps![i].answer;
    if (answer.trim()) return answer;
  }
  return record.answer.trim() ? record.answer : undefined;
}
