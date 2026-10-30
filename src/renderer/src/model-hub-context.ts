import type {
  NativeModelAction,
  NativeModelSnapshot,
} from "../../shared/native-model";
import type { HubPatch, HubState } from "./model-hub-state";

export interface HubActionContext {
  readonly data: NativeModelSnapshot;
  readonly state: HubState;
  readonly patch: HubPatch;
  readonly run: (
    action: NativeModelAction,
    done?: (data: NativeModelSnapshot) => void,
  ) => void;
  readonly close: () => void;
  readonly temporary: boolean;
}
