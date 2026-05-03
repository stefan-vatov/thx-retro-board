import { Effect } from "effect";
import type { ApiError, PublicConfig } from "../api";

export type HomeCreateState = {
  creating: boolean;
  turnstileSiteKey: string | null;
  turnstileToken: string | null;
};

export type HomeCreateResult =
  | { status: "ignored" }
  | { status: "blocked"; error: string }
  | { status: "created"; roomId: string };

export interface HomeCreateDeps {
  createRoom(
    turnstileToken: string | undefined,
  ): Effect.Effect<
    { roomId: string; facilitatorClaimToken?: string },
    ApiError | Error
  >;
  storeFacilitatorClaimToken(
    roomId: string,
    facilitatorClaimToken: string,
  ): Effect.Effect<void>;
  navigate(path: string): Effect.Effect<void>;
}

export interface SessionClaimStorage {
  setItem(key: string, value: string): void;
}

export function loadHomePublicConfigEffect(
  source: Effect.Effect<PublicConfig, ApiError | Error>,
): Effect.Effect<PublicConfig> {
  return source.pipe(
    Effect.catchAll(() => Effect.succeed({ turnstileSiteKey: null })),
  );
}

export function createHomeRoomEffect(
  state: HomeCreateState,
  deps: HomeCreateDeps,
): Effect.Effect<HomeCreateResult, ApiError | Error> {
  return Effect.gen(function* () {
    if (state.creating) return { status: "ignored" as const };

    if (state.turnstileSiteKey && !state.turnstileToken) {
      return {
        status: "blocked" as const,
        error: "Please complete the verification before creating a room.",
      };
    }

    const { roomId, facilitatorClaimToken } = yield* deps.createRoom(
      state.turnstileToken ?? undefined,
    );

    if (facilitatorClaimToken) {
      yield* deps.storeFacilitatorClaimToken(roomId, facilitatorClaimToken);
    }

    yield* deps.navigate(`/room/${roomId}`);
    return { status: "created" as const, roomId };
  });
}

export function storeHomeFacilitatorClaimTokenEffect(
  roomId: string,
  facilitatorClaimToken: string,
  storage: SessionClaimStorage,
): Effect.Effect<void> {
  return Effect.sync(() => {
    storage.setItem(`retro-facilitator-claim-${roomId}`, facilitatorClaimToken);
  });
}
