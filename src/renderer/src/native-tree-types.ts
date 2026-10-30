import type { ReactNode } from "react";
import type { TreeNode } from "../../shared/protocol";
import type { NativeTreeRow, TreeFilter } from "./native-tree-data";

export interface NativeTreeContent {
  readonly rows: NativeTreeRow[];
  readonly selectedId: string | null;
  readonly pending: boolean;
  readonly onSelect: (id: string) => void;
  readonly onActivate: (id: string, summarize?: boolean) => void;
  readonly onLabel: (id: string) => void;
  readonly onDelete?: (id: string) => void;
}

export interface TreeNavigation {
  readonly entryId: string;
  readonly summarize: boolean;
}
export interface TreeLabelChange {
  readonly entryId: string;
  readonly label: string | undefined;
}
export interface TreeDeletion {
  readonly entryId: string;
  readonly entryIds: readonly string[];
}
export interface NativeTreeScreenProps {
  readonly suspended?: boolean;
  readonly tree: readonly TreeNode[];
  readonly leafId: string | null;
  readonly sessionName?: string;
  readonly initialFilter?: TreeFilter;
  readonly toolbar?: ReactNode;
  readonly renderContent?: (view: NativeTreeContent) => ReactNode;
  readonly onNavigate: (request: TreeNavigation) => Promise<void> | void;
  readonly onCancelNavigation?: () => Promise<void> | void;
  readonly onLabel: (request: TreeLabelChange) => Promise<void> | void;
  readonly onDelete?: (request: TreeDeletion) => Promise<void> | void;
  readonly onClose: () => void;
}
