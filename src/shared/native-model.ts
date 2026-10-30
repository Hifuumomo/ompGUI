import type { ModelInfo, ModelRole } from "./protocol";

export type ModelScope = "global" | "project";

export interface NativeCatalogModel extends ModelInfo {
  readonly selector: string;
  readonly kind: string;
  readonly description?: string;
  readonly maxTokens?: number;
  readonly input?: readonly string[];
  readonly cost?: { input: number; output: number; cacheRead?: number };
  readonly intelligence?: number;
  readonly tps?: number;
  readonly allowedRoles: readonly string[];
  readonly thinkingLevels: readonly string[];
  readonly compaction?: {
    tokens?: number;
    percent?: number;
    draft?: string;
    source: string;
  };
}

export interface NativeModelRole extends ModelRole {
  readonly name: string;
  readonly tag?: string;
  readonly color?: string;
  readonly section: "chat" | "kind";
  readonly source: ModelScope | "default";
  readonly resolvedSelector?: string;
  readonly thinkingLevel?: string;
  readonly autoSelected: boolean;
}

export interface NativeModelProvider {
  readonly id: string;
  readonly locked: boolean;
  readonly oauth: boolean;
  readonly count: number;
  readonly status?: string;
  readonly error?: string;
}

export interface NativeModelSnapshot {
  readonly models: readonly NativeCatalogModel[];
  readonly roles: readonly NativeModelRole[];
  readonly providers: readonly NativeModelProvider[];
  readonly recent: readonly string[];
  readonly cycleOrder: readonly string[];
  readonly fallbackChains: Readonly<Record<string, readonly string[]>>;
  readonly presets: {
    readonly names: readonly string[];
    readonly active?: string;
  };
  readonly storage: ModelScope;
  readonly currentSelector?: string;
  readonly currentThinking?: string;
  readonly currentContextTokens?: number;
  readonly query: string;
  readonly matches: readonly string[];
  readonly notice?: string;
}

export type NativeModelAction =
  | { readonly op: "list" }
  | { readonly op: "search"; readonly query: string }
  | {
      readonly op: "assign";
      readonly role: string;
      readonly selector: string;
      readonly thinkingLevel?: string;
      readonly scope: ModelScope;
    }
  | { readonly op: "clear"; readonly role: string; readonly scope: ModelScope }
  | { readonly op: "cycle"; readonly order: readonly string[] }
  | {
      readonly op: "fallback";
      readonly role: string;
      readonly chain: readonly string[];
    }
  | { readonly op: "savePreset" | "switchPreset"; readonly name: string }
  | {
      readonly op: "compaction";
      readonly selector: string;
      readonly value: string;
    }
  | { readonly op: "refresh"; readonly provider?: string }
  | { readonly op: "login"; readonly provider: string }
  | {
      readonly op: "temporary";
      readonly selector: string;
      readonly target: "session" | "task";
    }
  | {
      readonly op: "applyRole";
      readonly role: string;
      readonly target: "session" | "task";
    };

export interface NativeModelHubProps {
  readonly snapshot: NativeModelSnapshot;
  readonly onAction: (
    action: NativeModelAction,
  ) => Promise<NativeModelSnapshot>;
  readonly onClose: () => void;
  readonly temporary?: boolean;
}
