import { Cause, Effect, Exit, Option } from "effect";
import type { RoomState, Phase, RetroItem, RankingMethod } from "./domain";

export interface PublicConfig {
  turnstileSiteKey: string | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const jsonHeaders = { "Content-Type": "application/json" };

function fetchEffect(input: RequestInfo | URL, init?: RequestInit): Effect.Effect<Response, ApiError> {
  return Effect.tryPromise({
    try: () => fetch(input, init),
    catch: (error) => new ApiError(error instanceof Error ? error.message : "Network request failed"),
  });
}

function responseJsonEffect<T>(response: Response, fallbackMessage: string): Effect.Effect<T, ApiError> {
  return Effect.tryPromise({
    try: () => response.json() as Promise<T>,
    catch: () => new ApiError(fallbackMessage, response.status),
  });
}

function requestJsonEffect<T>(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  options?: {
    readonly failureMessage?: string;
    readonly statusMessage?: (status: number) => string;
  },
): Effect.Effect<T, ApiError> {
  const failureMessage = options?.failureMessage ?? "Request failed";
  return Effect.gen(function* () {
    const response = yield* fetchEffect(input, init);
    if (!response.ok) {
      const body = yield* responseJsonEffect<{ error?: string } | null>(response, failureMessage).pipe(
        Effect.catchAll(() => Effect.succeed(null)),
      );
      const message = options?.statusMessage?.(response.status) ?? body?.error ?? failureMessage;
      return yield* Effect.fail(new ApiError(message, response.status));
    }
    return yield* responseJsonEffect<T>(response, failureMessage);
  });
}

function postJsonEffect<T>(path: string, body: unknown): Effect.Effect<T, ApiError> {
  return requestJsonEffect<T>(path, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
}

export async function runApiEffect<A>(effect: Effect.Effect<A, ApiError>): Promise<A> {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  throw Option.getOrElse(Cause.failureOption(exit.cause), () => new ApiError("Request failed"));
}

export const getPublicConfigEffect = (): Effect.Effect<PublicConfig, ApiError> =>
  Effect.gen(function* () {
    const response = yield* fetchEffect("/api/config");
    if (!response.ok) return { turnstileSiteKey: null };
    return yield* responseJsonEffect<PublicConfig>(response, "Failed to load public config");
  });

export const createRoomEffect = (
  turnstileToken?: string,
): Effect.Effect<{ roomId: string; facilitatorClaimToken?: string }, ApiError> =>
  postJsonEffect<{ roomId: string; facilitatorClaimToken?: string }>("/api/rooms", { turnstileToken }).pipe(
    Effect.mapError((error) => new ApiError(error.message || "Failed to create room", error.status)),
  );

export const getRoomStateEffect = (
  roomId: string,
  participantId: string,
  connectionToken: string | undefined,
): Effect.Effect<RoomState, ApiError> => Effect.gen(function* () {
  const result = yield* postJsonEffect<{ success?: boolean; error?: string; state?: RoomState }>(
    `/api/rooms/${encodeURIComponent(roomId)}/state`,
    { participantId, connectionToken },
  ).pipe(
    Effect.mapError((error) => error.status === undefined
      ? error
      : new ApiError(error.status === 404 ? "Room not found" : "Failed to load room", error.status)),
  );
  if (!result.success || !result.state) {
    return yield* Effect.fail(new ApiError(result.error ?? "Failed to load room"));
  }
  return result.state;
});

export const joinRoomEffect = (
  roomId: string,
  participantId: string,
  displayName: string,
  connectionToken?: string,
  facilitatorClaimToken?: string,
): Effect.Effect<{ success: boolean; error?: string; state?: RoomState; connectionToken?: string }, ApiError> =>
  postJsonEffect(`/api/rooms/${encodeURIComponent(roomId)}/join`, { participantId, displayName, connectionToken, facilitatorClaimToken });

export const createWebSocketTicketEffect = (
  roomId: string,
  participantId: string,
  connectionToken: string | undefined,
): Effect.Effect<{ success: boolean; error?: string; ticket?: string }, ApiError> =>
  postJsonEffect(`/api/rooms/${encodeURIComponent(roomId)}/ws-ticket`, { participantId, connectionToken });

export const setVoteBudgetEffect = (
  roomId: string,
  participantId: string,
  connectionToken: string | undefined,
  budget: number,
): Effect.Effect<{ success: boolean; error?: string }, ApiError> =>
  postJsonEffect(`/api/rooms/${encodeURIComponent(roomId)}/vote-budget`, { participantId, connectionToken, budget });

export const setRankingMethodEffect = (
  roomId: string,
  participantId: string,
  connectionToken: string | undefined,
  rankingMethod: RankingMethod,
): Effect.Effect<{ success: boolean; error?: string }, ApiError> =>
  postJsonEffect(`/api/rooms/${encodeURIComponent(roomId)}/ranking-method`, { participantId, connectionToken, rankingMethod });

export const setPhaseEffect = (
  roomId: string,
  participantId: string,
  connectionToken: string | undefined,
  phase: Phase,
): Effect.Effect<{ success: boolean; error?: string }, ApiError> =>
  postJsonEffect(`/api/rooms/${encodeURIComponent(roomId)}/phase`, { participantId, connectionToken, phase });

export const addItemEffect = (
  roomId: string,
  participantId: string,
  connectionToken: string | undefined,
  text: string,
  columnId: string,
): Effect.Effect<{ success: boolean; error?: string; item?: RetroItem }, ApiError> =>
  postJsonEffect(`/api/rooms/${encodeURIComponent(roomId)}/items`, { participantId, connectionToken, text, columnId });

export const editItemEffect = (
  roomId: string,
  participantId: string,
  connectionToken: string | undefined,
  itemId: string,
  text: string,
): Effect.Effect<{ success: boolean; error?: string; item?: RetroItem }, ApiError> =>
  requestJsonEffect(`/api/rooms/${encodeURIComponent(roomId)}/items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    headers: jsonHeaders,
    body: JSON.stringify({ participantId, connectionToken, text }),
  });

export const deleteItemEffect = (
  roomId: string,
  participantId: string,
  connectionToken: string | undefined,
  itemId: string,
): Effect.Effect<{ success: boolean; error?: string }, ApiError> =>
  requestJsonEffect(`/api/rooms/${encodeURIComponent(roomId)}/items/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
    headers: jsonHeaders,
    body: JSON.stringify({ participantId, connectionToken }),
  });

export const setTimerEffect = (
  roomId: string,
  participantId: string,
  connectionToken: string | undefined,
  durationSeconds: number,
): Effect.Effect<{ success: boolean; error?: string }, ApiError> =>
  postJsonEffect(`/api/rooms/${encodeURIComponent(roomId)}/timer`, { participantId, connectionToken, durationSeconds });

export const purgeRoomEffect = (
  roomId: string,
  participantId: string,
  connectionToken: string | undefined,
): Effect.Effect<{ success: boolean; error?: string }, ApiError> =>
  postJsonEffect(`/api/rooms/${encodeURIComponent(roomId)}/purge`, { participantId, connectionToken });
