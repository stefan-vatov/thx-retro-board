import { Effect } from "effect";
import { ApiError } from "../api";
import type { RoomState } from "../domain";

export type PageState =
  | "loading"
  | "join"
  | "room"
  | "not-found"
  | "load-error";

export type RoomLoadError = {
  title: string;
  description: string;
  detail: string;
};

export type StoredIdentity = {
  participantId: string;
  displayName: string;
  connectionToken?: string;
};

export type RoomMutationResult = {
  success: boolean;
  error?: string;
};

export type RoomMutationWithRefreshResult = RoomMutationResult & {
  state: RoomState | null;
};

export function mergeRoomState(
  local: RoomState | null,
  ws: RoomState | null,
): RoomState | null {
  if (!local && !ws) return null;
  if (!local) return ws;
  if (!ws) return local;
  if (ws.version >= local.version) return ws;
  return local;
}

export function mergeRoomStateEffect(
  local: RoomState | null,
  ws: RoomState | null,
): Effect.Effect<RoomState | null> {
  return Effect.sync(() => mergeRoomState(local, ws));
}

export function formatElapsedTime(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatElapsedTimeEffect(
  milliseconds: number,
): Effect.Effect<string> {
  return Effect.sync(() => formatElapsedTime(milliseconds));
}

export function getStoredIdentityEffect(
  roomId: string,
): Effect.Effect<StoredIdentity> {
  return Effect.sync(() => {
    const pidKey = `retro-participant-${roomId}`;
    const nameKey = `retro-name-${roomId}`;
    const tokenKey = `retro-token-${roomId}`;
    const participantId = localStorage.getItem(pidKey) ?? crypto.randomUUID();
    const displayName = localStorage.getItem(nameKey) ?? "";
    const connectionToken = localStorage.getItem(tokenKey) ?? undefined;
    if (!localStorage.getItem(pidKey)) {
      localStorage.setItem(pidKey, participantId);
    }
    return { participantId, displayName, connectionToken };
  });
}

export function getStoredIdentity(roomId: string): StoredIdentity {
  return Effect.runSync(getStoredIdentityEffect(roomId));
}

export function getFacilitatorClaimTokenEffect(
  roomId: string,
): Effect.Effect<string | undefined> {
  return Effect.sync(
    () =>
      sessionStorage.getItem(`retro-facilitator-claim-${roomId}`) ?? undefined,
  );
}

export function getFacilitatorClaimToken(roomId: string): string | undefined {
  return Effect.runSync(getFacilitatorClaimTokenEffect(roomId));
}

export function clearStoredIdentityEffect(roomId: string): Effect.Effect<void> {
  return Effect.sync(() => {
    localStorage.removeItem(`retro-participant-${roomId}`);
    localStorage.removeItem(`retro-name-${roomId}`);
    localStorage.removeItem(`retro-token-${roomId}`);
    sessionStorage.removeItem(`retro-facilitator-claim-${roomId}`);
  });
}

export function clearStoredIdentity(roomId: string): void {
  Effect.runSync(clearStoredIdentityEffect(roomId));
}

export type PersistJoinedIdentityInput = {
  roomId: string;
  displayName: string;
  connectionToken?: string;
  clearFacilitatorClaim: boolean;
};

export function persistJoinedIdentityEffect({
  roomId,
  displayName,
  connectionToken,
  clearFacilitatorClaim,
}: PersistJoinedIdentityInput): Effect.Effect<void> {
  return Effect.sync(() => {
    localStorage.setItem(`retro-name-${roomId}`, displayName);
    if (connectionToken) {
      localStorage.setItem(`retro-token-${roomId}`, connectionToken);
    }
    if (clearFacilitatorClaim) {
      sessionStorage.removeItem(`retro-facilitator-claim-${roomId}`);
    }
  });
}

export function resetStoredParticipantEffect(
  roomId: string,
  participantId: string,
): Effect.Effect<void> {
  return Effect.sync(() => {
    localStorage.setItem(`retro-participant-${roomId}`, participantId);
    localStorage.removeItem(`retro-token-${roomId}`);
  });
}

export function classifyRoomLoadError(error: unknown): RoomLoadError {
  if (error instanceof ApiError && error.status && error.status >= 500) {
    return {
      title: "Room temporarily unavailable",
      description:
        "The room service returned an error while checking this invite.",
      detail:
        "Retry in a moment. If the problem continues, return home and create a fresh room.",
    };
  }

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return {
      title: "You appear to be offline",
      description:
        "We could not check this room because your browser is offline.",
      detail: "Reconnect to the internet, then retry loading the room.",
    };
  }

  return {
    title: "Could not load room",
    description:
      "We could not check this invite because the network request failed.",
    detail:
      "Check your connection and retry. Your participant credentials are not included in the room link.",
  };
}

export function classifyRoomLoadErrorEffect(
  error: unknown,
): Effect.Effect<RoomLoadError> {
  return Effect.sync(() => classifyRoomLoadError(error));
}

export function runRoomMutationWithRefreshEffect(
  mutation: Effect.Effect<RoomMutationResult, unknown>,
  refresh: Effect.Effect<RoomState, unknown>,
): Effect.Effect<RoomMutationWithRefreshResult, unknown> {
  return Effect.gen(function* () {
    const result = yield* mutation;
    if (!result.success) return { ...result, state: null };

    const refreshed = yield* refresh.pipe(
      Effect.map((state): RoomState | null => state),
      Effect.catchAll(() => Effect.succeed(null)),
    );
    return { ...result, state: refreshed };
  });
}
