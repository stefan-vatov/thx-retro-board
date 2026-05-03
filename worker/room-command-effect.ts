import { Effect } from "effect";

import type { RoomCommandHost } from "./room-command-host";
import type { StoredState } from "./room-types";

export function saveAndBroadcastStateEffect(
  host: RoomCommandHost,
  state: StoredState,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* Effect.promise(() => host.saveState());
    host.broadcastState(state);
  });
}
