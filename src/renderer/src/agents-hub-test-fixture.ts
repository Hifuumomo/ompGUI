import type { AgentsSnapshot } from "../../shared/native-agents";

export const agentsSnapshot: AgentsSnapshot = {
  agents: [
    {
      name: "project-reviewer",
      description: "Review project changes",
      source: "project",
      systemPrompt: "Review changes with evidence.",
      disabled: false,
      effectiveModel: "test/one",
      effectivePrewalk: "on",
    },
    {
      name: "scout",
      description: "Explore code",
      source: "bundled",
      systemPrompt: "Find relevant code.",
      disabled: true,
      effectiveModel: "test/two",
    },
  ],
  models: [
    { name: "Model One", selector: "test/one", provider: "test" },
    { name: "Model Two", selector: "test/two", provider: "test" },
  ],
  query: "",
  matches: ["project-reviewer", "scout"],
};
