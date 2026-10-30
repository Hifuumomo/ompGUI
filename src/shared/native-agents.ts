export type AgentSource = "project" | "user" | "bundled";
export type AgentProperty = "model" | "prewalk" | "advisor";

export interface NativeAgent {
  readonly name: string;
  readonly description: string;
  readonly systemPrompt: string;
  readonly source: AgentSource;
  readonly filePath?: string;
  readonly disabled: boolean;
  readonly overrideModel?: string;
  readonly prewalkOverride?: string;
  readonly advisorOverride?: string;
  readonly effectiveModel: string;
  readonly resolvedModel?: string;
  readonly effectivePrewalk?: string;
  readonly effectiveAdvisor?: string;
}

export interface AgentSpec {
  readonly identifier: string;
  readonly whenToUse: string;
  readonly systemPrompt: string;
}

export interface AgentsSnapshot {
  readonly agents: readonly NativeAgent[];
  readonly models: readonly {
    readonly selector: string;
    readonly name: string;
    readonly provider: string;
  }[];
  readonly matches: readonly string[];
  readonly query: string;
  readonly spec?: AgentSpec;
  readonly notice?: string;
}

export type AgentsAction = (
  | { readonly op: "list" }
  | { readonly op: "search"; readonly query: string }
  | { readonly op: "toggle"; readonly name: string; readonly disabled: boolean }
  | {
      readonly op: "override";
      readonly name: string;
      readonly property: AgentProperty;
      readonly value?: string;
    }
  | { readonly op: "generate"; readonly description: string }
  | {
      readonly op: "save";
      readonly scope: "project" | "user";
      readonly spec: AgentSpec;
    }
) & { readonly query?: string };

export interface AgentsHubProps {
  readonly snapshot: AgentsSnapshot;
  readonly onAction: (action: AgentsAction) => Promise<AgentsSnapshot>;
  readonly onClose: () => void;
}
