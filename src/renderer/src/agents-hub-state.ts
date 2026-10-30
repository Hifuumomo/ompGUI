import type {
  AgentProperty,
  AgentSource,
  NativeAgent,
} from "../../shared/native-agents";

export const AGENT_SCOPES = [
  "all",
  "project",
  "user",
  "bundled",
  "new",
] as const;
export const SOURCE_LABELS = {
  all: "全部代理",
  project: "项目",
  user: "用户",
  bundled: "内置",
  new: "+ 新建代理",
};
export const PROPERTY_LABELS = {
  model: "模型",
  prewalk: "Prewalk",
  advisor: "Advisor",
};
export type AgentScope = (typeof AGENT_SCOPES)[number];
export type AgentStage =
  "list" | "agent" | "property" | "pattern" | "models" | "create";
export interface AgentsState {
  readonly scope: AgentScope;
  readonly query: string;
  readonly index: number;
  readonly focus: "scope" | "list";
  readonly stage: AgentStage;
  readonly property: AgentProperty;
  readonly pattern: string;
  readonly modelQuery: string;
  readonly description: string;
  readonly createScope: Exclude<AgentSource, "bundled">;
}
export const INITIAL_AGENTS_STATE: AgentsState = {
  scope: "all",
  query: "",
  index: 0,
  focus: "list",
  stage: "list",
  property: "model",
  pattern: "",
  modelQuery: "",
  description: "",
  createScope: "project",
};

export function overrideValue(agent: NativeAgent, property: AgentProperty) {
  if (property === "model") return agent.overrideModel;
  return property === "prewalk" ? agent.prewalkOverride : agent.advisorOverride;
}

export function propertyValue(agent: NativeAgent, property: AgentProperty) {
  const override = overrideValue(agent, property);
  if (override) return override;
  if (property === "model")
    return agent.resolvedModel || agent.effectiveModel || "继承默认模型";
  return (
    (property === "prewalk"
      ? agent.effectivePrewalk
      : agent.effectiveAdvisor) || "关闭"
  );
}
