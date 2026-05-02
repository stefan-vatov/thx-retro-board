import { Cause, Effect, Exit, Option, Schema } from "effect";
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

export const PhaseSchema = Schema.Literal("setup", "write", "organise", "vote", "review", "finalize");
export const RankingMethodSchema = Schema.Literal("score", "pairwise");
const VoteTargetSchema = Schema.Union(
  Schema.Struct({ type: Schema.Literal("group"), id: Schema.String }),
  Schema.Struct({ type: Schema.Literal("item"), id: Schema.String }),
);
export const ParticipantSchema = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  isFacilitator: Schema.Boolean,
});
export const ColumnSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  order: Schema.Number,
});
export const GroupSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  columnId: Schema.String,
  order: Schema.Number,
});
export const RetroItemSchema = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  authorId: Schema.String,
  columnId: Schema.String,
  groupId: Schema.NullOr(Schema.String),
  order: Schema.Number,
});
const VoteAllocationSchema = Schema.Struct({
  participantId: Schema.String,
  target: Schema.optional(VoteTargetSchema),
  groupId: Schema.optional(Schema.String),
  itemId: Schema.optional(Schema.String),
  count: Schema.Number,
});
export const PairwiseChoiceSchema = Schema.Struct({
  participantId: Schema.String,
  winner: VoteTargetSchema,
  loser: VoteTargetSchema,
  count: Schema.optional(Schema.Number),
});
const PairwiseProgressSchema = Schema.Struct({
  participantId: Schema.String,
  answered: Schema.Number,
  total: Schema.Number,
});
export const ActionItemSchema = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  authorId: Schema.String,
  order: Schema.Number,
});
const ReactionSchema = Schema.Struct({
  participantId: Schema.String,
  target: VoteTargetSchema,
  emoji: Schema.String,
});
export const TimerStateSchema = Schema.Struct({
  startedAt: Schema.NullOr(Schema.Number),
  durationSeconds: Schema.NullOr(Schema.Number),
  expired: Schema.Boolean,
});
export const RoomStateSchema = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  roomId: Schema.String,
  startedAt: Schema.Number,
  purgeScheduledAt: Schema.NullOr(Schema.Number),
  phase: PhaseSchema,
  participants: Schema.Array(ParticipantSchema),
  items: Schema.Array(RetroItemSchema),
  columns: Schema.Array(ColumnSchema),
  groups: Schema.Array(GroupSchema),
  votes: Schema.Array(VoteAllocationSchema),
  rankingMethod: RankingMethodSchema,
  pairwiseChoices: Schema.Array(PairwiseChoiceSchema),
  pairwiseProgress: Schema.Array(PairwiseProgressSchema),
  reviewTargetKey: Schema.NullOr(Schema.String),
  actions: Schema.Array(ActionItemSchema),
  reactions: Schema.Array(ReactionSchema),
  timer: TimerStateSchema,
  voteBudget: Schema.Number,
  version: Schema.Number,
});
const PublicConfigSchema: Schema.Schema<PublicConfig> = Schema.Struct({
  turnstileSiteKey: Schema.NullOr(Schema.String),
});
const CreateRoomResponseSchema = Schema.Struct({
  roomId: Schema.String,
  facilitatorClaimToken: Schema.optional(Schema.String),
});
const RoomStateResponseSchema = Schema.Struct({
  success: Schema.optional(Schema.Boolean),
  error: Schema.optional(Schema.String),
  state: Schema.optional(Schema.Unknown),
});
const MutationResponseSchema = Schema.Struct({
  success: Schema.Boolean,
  error: Schema.optional(Schema.String),
});
const JoinRoomResponseSchema = Schema.Struct({
  success: Schema.Boolean,
  error: Schema.optional(Schema.String),
  state: Schema.optional(RoomStateSchema),
  connectionToken: Schema.optional(Schema.String),
});
const WebSocketTicketResponseSchema = Schema.Struct({
  success: Schema.Boolean,
  error: Schema.optional(Schema.String),
  ticket: Schema.optional(Schema.String),
});
const AddItemResponseSchema = Schema.Struct({
  success: Schema.Boolean,
  error: Schema.optional(Schema.String),
  item: Schema.optional(RetroItemSchema),
});

function fetchEffect(input: RequestInfo | URL, init?: RequestInit): Effect.Effect<Response, ApiError> {
  return Effect.tryPromise({
    try: () => fetch(input, init),
    catch: (error) => new ApiError(error instanceof Error ? error.message : "Network request failed"),
  });
}

function responseJsonEffect(response: Response, fallbackMessage: string): Effect.Effect<unknown, ApiError> {
  return Effect.tryPromise({
    try: () => response.json() as Promise<unknown>,
    catch: () => new ApiError(fallbackMessage, response.status),
  });
}

function decodeJsonEffect<T>(
  schema: Schema.Schema<T>,
  value: unknown,
  response: Response,
  fallbackMessage: string,
): Effect.Effect<T, ApiError> {
  return Schema.decodeUnknown(schema)(value).pipe(
    Effect.mapError(() => new ApiError(fallbackMessage, response.status)),
  );
}

function requestJsonEffect<T>(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  schema: Schema.Schema<T>,
  options?: {
    readonly failureMessage?: string;
    readonly statusMessage?: (status: number) => string;
    readonly parseFailureMessage?: string;
  },
): Effect.Effect<T, ApiError> {
  const failureMessage = options?.failureMessage ?? "Request failed";
  const parseFailureMessage = options?.parseFailureMessage ?? failureMessage;
  return Effect.gen(function* () {
    const response = yield* fetchEffect(input, init);
    if (!response.ok) {
      const body = yield* responseJsonEffect(response, failureMessage).pipe(
        Effect.catchAll(() => Effect.succeed(null)),
      );
      const error = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : undefined;
      const message = options?.statusMessage?.(response.status) ?? error ?? failureMessage;
      return yield* Effect.fail(new ApiError(message, response.status));
    }
    const json = yield* responseJsonEffect(response, failureMessage);
    return yield* decodeJsonEffect(schema, json, response, parseFailureMessage);
  });
}

function postJsonEffect<T>(path: string, body: unknown, schema: Schema.Schema<T>): Effect.Effect<T, ApiError> {
  return requestJsonEffect<T>(path, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  }, schema, { parseFailureMessage: "Failed to parse room response" });
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
    const json = yield* responseJsonEffect(response, "Failed to load public config");
    return yield* decodeJsonEffect(PublicConfigSchema, json, response, "Failed to parse room response");
  });

export const createRoomEffect = (
  turnstileToken?: string,
): Effect.Effect<{ roomId: string; facilitatorClaimToken?: string }, ApiError> =>
  postJsonEffect("/api/rooms", { turnstileToken }, CreateRoomResponseSchema).pipe(
    Effect.mapError((error) => new ApiError(error.message || "Failed to create room", error.status)),
  );

export const getRoomStateEffect = (
  roomId: string,
  participantId: string,
  connectionToken: string | undefined,
): Effect.Effect<RoomState, ApiError> => Effect.gen(function* () {
  const result = yield* postJsonEffect(
    `/api/rooms/${encodeURIComponent(roomId)}/state`,
    { participantId, connectionToken },
    RoomStateResponseSchema,
  ).pipe(
    Effect.mapError((error) => error.status === undefined
      ? error
      : new ApiError(error.status === 404 ? "Room not found" : "Failed to load room", error.status)),
  );
  if (result.success && !result.state) {
    return yield* Effect.fail(new ApiError("Failed to parse room response"));
  }
  if (!result.success || !result.state) {
    return yield* Effect.fail(new ApiError(result.error ?? "Failed to load room"));
  }
  return yield* decodeJsonEffect(RoomStateSchema, result.state, new Response(null), "Failed to parse room response").pipe(
    Effect.map((state) => state as RoomState),
  );
});

export const joinRoomEffect = (
  roomId: string,
  participantId: string,
  displayName: string,
  connectionToken?: string,
  facilitatorClaimToken?: string,
): Effect.Effect<{ success: boolean; error?: string; state?: RoomState; connectionToken?: string }, ApiError> =>
  postJsonEffect(`/api/rooms/${encodeURIComponent(roomId)}/join`, { participantId, displayName, connectionToken, facilitatorClaimToken }, JoinRoomResponseSchema).pipe(
    Effect.map((result) => ({
      ...result,
      state: result.state as RoomState | undefined,
    })),
  );

export const createWebSocketTicketEffect = (
  roomId: string,
  participantId: string,
  connectionToken: string | undefined,
): Effect.Effect<{ success: boolean; error?: string; ticket?: string }, ApiError> =>
  postJsonEffect(`/api/rooms/${encodeURIComponent(roomId)}/ws-ticket`, { participantId, connectionToken }, WebSocketTicketResponseSchema);

export const setVoteBudgetEffect = (
  roomId: string,
  participantId: string,
  connectionToken: string | undefined,
  budget: number,
): Effect.Effect<{ success: boolean; error?: string }, ApiError> =>
  postJsonEffect(`/api/rooms/${encodeURIComponent(roomId)}/vote-budget`, { participantId, connectionToken, budget }, MutationResponseSchema);

export const setRankingMethodEffect = (
  roomId: string,
  participantId: string,
  connectionToken: string | undefined,
  rankingMethod: RankingMethod,
): Effect.Effect<{ success: boolean; error?: string }, ApiError> =>
  postJsonEffect(`/api/rooms/${encodeURIComponent(roomId)}/ranking-method`, { participantId, connectionToken, rankingMethod }, MutationResponseSchema);

export const setPhaseEffect = (
  roomId: string,
  participantId: string,
  connectionToken: string | undefined,
  phase: Phase,
): Effect.Effect<{ success: boolean; error?: string }, ApiError> =>
  postJsonEffect(`/api/rooms/${encodeURIComponent(roomId)}/phase`, { participantId, connectionToken, phase }, MutationResponseSchema);

export const addItemEffect = (
  roomId: string,
  participantId: string,
  connectionToken: string | undefined,
  text: string,
  columnId: string,
): Effect.Effect<{ success: boolean; error?: string; item?: RetroItem }, ApiError> =>
  postJsonEffect(`/api/rooms/${encodeURIComponent(roomId)}/items`, { participantId, connectionToken, text, columnId }, AddItemResponseSchema);

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
  }, AddItemResponseSchema, { parseFailureMessage: "Failed to parse room response" });

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
  }, MutationResponseSchema, { parseFailureMessage: "Failed to parse room response" });

export const setTimerEffect = (
  roomId: string,
  participantId: string,
  connectionToken: string | undefined,
  durationSeconds: number,
): Effect.Effect<{ success: boolean; error?: string }, ApiError> =>
  postJsonEffect(`/api/rooms/${encodeURIComponent(roomId)}/timer`, { participantId, connectionToken, durationSeconds }, MutationResponseSchema);

export const purgeRoomEffect = (
  roomId: string,
  participantId: string,
  connectionToken: string | undefined,
): Effect.Effect<{ success: boolean; error?: string }, ApiError> =>
  postJsonEffect(`/api/rooms/${encodeURIComponent(roomId)}/purge`, { participantId, connectionToken }, MutationResponseSchema);
