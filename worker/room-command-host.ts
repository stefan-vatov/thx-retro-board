import type { ServerToClientMessage } from "../src/domain";
import type { StoredState } from "./room-types";

export interface RoomCommandHost {
  loadState(): Promise<StoredState>;
  saveState(): Promise<void>;
  broadcast(message: ServerToClientMessage, excludeId?: string): void;
  broadcastState(state: StoredState, excludeId?: string): void;
}
