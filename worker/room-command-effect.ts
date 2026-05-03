import { Effect } from "effect";

import type { RoomCommandHost } from "./room-command-host";
import type { StoredState } from "./room-types";

export interface SaveAndBroadcastStateDeps {
  saveState: (host: RoomCommandHost) => Effect.Effect<void>;
  broadcastState: (host: RoomCommandHost, state: StoredState) => Effect.Effect<void>;
}

export const saveAndBroadcastStateDeps: SaveAndBroadcastStateDeps = {
  saveState: (host) => Effect.promise(() => host.saveState()),
  broadcastState: (host, state) => Effect.sync(() => host.broadcastState(state)),
};

export function saveAndBroadcastStateEffect(
  host: RoomCommandHost,
  state: StoredState,
  deps: SaveAndBroadcastStateDeps = saveAndBroadcastStateDeps,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* deps.saveState(host);
    yield* deps.broadcastState(host, state);
  });
}
