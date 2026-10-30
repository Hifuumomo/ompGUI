import type {
  NativeCatalogModel,
  NativeModelSnapshot,
} from "../../shared/native-model";

export const MODEL_KIND_TABS = [
  "all",
  "chat",
  "tiny",
  "image",
  "tts",
  "stt",
  "search",
  "judge",
  "embedding",
  "rerank",
  "video",
] as const;
export const ROLE_TABS = ["all", "chat", "kind"] as const;
export const RECENT_MODEL_LIMIT = 15;
export const MODEL_PAGE_STEP = 10;

export interface ModelAssignment {
  readonly role: string;
  readonly chainIndex?: number | null;
}
export interface HubChoice {
  readonly label: string;
  readonly active?: boolean;
  readonly choose: () => void;
}
export type HubStrip =
  | {
      readonly kind: "choices";
      readonly title: string;
      readonly choices: readonly HubChoice[];
      readonly index: number;
      readonly returnToRoles?: boolean;
    }
  | {
      readonly kind: "name";
      readonly title: string;
      readonly value: string;
      readonly submit: (value: string) => void;
    };

export interface HubState {
  readonly scope: string;
  readonly focus: "scope" | "list";
  readonly query: string;
  readonly kind: string;
  readonly roleTab: string;
  readonly index: number;
  readonly assigning?: ModelAssignment;
  readonly strip?: HubStrip;
  readonly task: boolean;
}
export type HubPatch = (change: Partial<HubState>) => void;
export const INITIAL_HUB_STATE: HubState = {
  scope: "all",
  focus: "list",
  query: "",
  kind: "all",
  roleTab: "all",
  index: 0,
  task: false,
};

export interface HubRoleRow {
  readonly id: string;
  readonly role?: string;
  readonly selector?: string;
  readonly chainIndex?: number;
  readonly kind: "role" | "fallback" | "chain" | "newRole" | "newFallback";
}

export function roleRows(data: NativeModelSnapshot, tab: string): HubRoleRow[] {
  const rows = data.roles
    .filter((role) => tab === "all" || role.section === tab)
    .flatMap((role) => [
      { id: role.role, role: role.role, kind: "role" as const },
      ...(data.fallbackChains[role.role] ?? []).map((selector, chainIndex) => ({
        id: `${role.role}:${chainIndex}`,
        role: role.role,
        selector,
        chainIndex,
        kind: "fallback" as const,
      })),
    ]);
  const known = new Set(data.roles.map((role) => role.role));
  const chains = Object.entries(data.fallbackChains)
    .filter(([role]) => !known.has(role))
    .flatMap(([role, values]) => [
      { id: role, role, kind: "chain" as const },
      ...values.map((selector, chainIndex) => ({
        id: `${role}:${chainIndex}`,
        role,
        selector,
        chainIndex,
        kind: "fallback" as const,
      })),
    ]);
  return [
    ...rows,
    ...chains,
    { id: "newFallback", kind: "newFallback" },
    { id: "newRole", kind: "newRole" },
  ];
}

export function hubScopes(data: NativeModelSnapshot) {
  const recent = data.recent
    .filter((selector) =>
      data.models.some((model) => model.selector === selector),
    )
    .slice(0, RECENT_MODEL_LIMIT);
  return [
    {
      id: "recent",
      label: "Recently used",
      count: recent.length,
      locked: false,
    },
    {
      id: "roles",
      label: "Roles",
      count: data.roles.filter((role) => !!role.value).length,
      locked: false,
    },
    {
      id: "all",
      label: "All models",
      count: data.models.length,
      locked: false,
    },
    ...data.providers.map((provider) => ({
      ...provider,
      id: `provider:${provider.id}`,
      label: provider.id,
    })),
  ];
}

export function visibleModels(
  data: NativeModelSnapshot,
  state: HubState,
): NativeCatalogModel[] {
  // 等待对应查询的原生排名，不能让 Enter 应用上一轮搜索的候选。
  if (state.query && state.query !== data.query) return [];
  const bySelector = new Map(
    data.models.map((model) => [model.selector, model]),
  );
  const selectors = state.query
    ? data.matches
    : data.models.map((model) => model.selector);
  const models = selectors
    .map((selector) => bySelector.get(selector))
    .filter((model): model is NativeCatalogModel => !!model);
  const recent = data.recent.slice(0, RECENT_MODEL_LIMIT);
  return models.filter((model) => {
    if (state.scope === "recent" && !recent.includes(model.selector))
      return false;
    if (
      state.scope.startsWith("provider:") &&
      model.provider !== state.scope.slice("provider:".length)
    )
      return false;
    if (state.kind !== "all" && model.kind !== state.kind) return false;
    if (!state.assigning || state.assigning.chainIndex !== undefined)
      return true;
    const knownRole = data.roles.some(
      (role) => role.role === state.assigning!.role,
    );
    return knownRole
      ? model.allowedRoles.includes(state.assigning.role)
      : model.kind === "chat";
  });
}

export function movedIndex(
  index: number,
  delta: number,
  length: number,
): number {
  return length ? (((index + delta) % length) + length) % length : 0;
}

export function movedOrder(
  order: readonly string[],
  role: string,
  delta: number,
): string[] {
  const index = order.indexOf(role);
  const next = index + delta;
  if (index < 0 || next < 0 || next >= order.length) return [...order];
  return order.map((item, position) =>
    position === index ? order[next] : position === next ? role : item,
  );
}

export function modelNumber(value?: number): string {
  if (value === undefined) return "—";
  return Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  })
    .format(value)
    .toLowerCase();
}
