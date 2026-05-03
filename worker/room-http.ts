import { Effect } from "effect";
import type { Phase, RankingMethod, RoomState } from "../src/domain";
import { readValidatedJsonBodyEffect } from "./http-effect";
import {
  AddItemRequestSchema,
  EditItemRequestSchema,
  JoinRoomRequestSchema,
  OptionalConnectionTokenSchema,
  PhaseRequestSchema,
  RankingMethodRequestSchema,
  ReviewTargetRequestSchema,
  TimerRequestSchema,
  VoteBudgetRequestSchema,
} from "./room-request-schemas";
import type { StoredState } from "./room-types";
import { MAX_WEBSOCKET_MESSAGE_BYTES } from "./room-types";
import { runAuthorizedRoomMutationEffect } from "./room-http-authorization";

type RoomResult<T extends object = object> = Promise<{ success: boolean; error?: string } & T>;

export interface RoomHttpController {
  join(
    participantId: string,
    displayName: string,
    connectionToken?: string,
    facilitatorClaimToken?: unknown,
  ): RoomResult<{ state?: RoomState; connectionToken?: string }>;
  getRoomStateForParticipant(
    participantId: string,
    connectionToken: unknown,
  ): RoomResult<{ state?: RoomState }>;
  authorizeHttpParticipant(
    participantId: string,
    connectionToken: unknown,
  ): Promise<{ success: true; participantId: string; state: StoredState } | { success: false; error: string }>;
  setVoteBudget(participantId: string, budget: number): RoomResult;
  setRankingMethod(participantId: string, rankingMethod: RankingMethod): RoomResult;
  setPhase(participantId: string, phase: Phase): RoomResult;
  addItem(participantId: string, text: string, columnId?: unknown): RoomResult;
  editItem(participantId: string, itemId: string, text: string): RoomResult;
  deleteItem(participantId: string, itemId: string): RoomResult;
  setTimer(participantId: string, durationSeconds: number): RoomResult;
  setReviewTarget(participantId: string, reviewTargetKey: string | null): RoomResult;
  purgeByFacilitator(participantId: string): RoomResult;
  createWebSocketTicket(participantId: string, connectionToken: unknown): RoomResult<{ ticket?: string }>;
}

export interface RoomHttpDeps {
  getRoomStateForParticipant: (
    room: RoomHttpController,
    participantId: string,
    connectionToken: unknown,
  ) => Effect.Effect<Awaited<ReturnType<RoomHttpController["getRoomStateForParticipant"]>>>;
  createWebSocketTicket: (
    room: RoomHttpController,
    participantId: string,
    connectionToken: unknown,
  ) => Effect.Effect<Awaited<ReturnType<RoomHttpController["createWebSocketTicket"]>>>;
}

export const roomHttpDeps: RoomHttpDeps = {
  getRoomStateForParticipant: (room, participantId, connectionToken) =>
    Effect.promise(() => room.getRoomStateForParticipant(participantId, connectionToken)),
  createWebSocketTicket: (room, participantId, connectionToken) =>
    Effect.promise(() => room.createWebSocketTicket(participantId, connectionToken)),
};

export async function handleRoomHttpRequest(room: RoomHttpController, request: Request): Promise<Response | null> {
  return Effect.runPromise(handleRoomHttpRequestEffect(room, request));
}

function readBodyEffect<T>(
  request: Request,
  schema: Parameters<typeof readValidatedJsonBodyEffect<T>>[1],
): Effect.Effect<T | Response> {
  return readValidatedJsonBodyEffect(request, schema, { maxBytes: MAX_WEBSOCKET_MESSAGE_BYTES });
}

export function handleRoomHttpRequestEffect(
  room: RoomHttpController,
  request: Request,
  deps: RoomHttpDeps = roomHttpDeps,
): Effect.Effect<Response | null> {
  return Effect.gen(function* () {
  const url = new URL(request.url);

  if (url.pathname === "/join" && request.method === "POST") {
    const body = yield* readBodyEffect(request, JoinRoomRequestSchema);
    if (body instanceof Response) return body;
    return Response.json(yield* Effect.promise(() =>
      room.join(body.participantId, body.displayName, body.connectionToken, body.facilitatorClaimToken)
    ));
  }

  if (url.pathname === "/state" && request.method === "POST") {
    const body = yield* readBodyEffect(request, OptionalConnectionTokenSchema);
    if (body instanceof Response) return body;
    const result = yield* deps.getRoomStateForParticipant(room, body.participantId, body.connectionToken);
    return Response.json(result, { status: result.success ? 200 : 403 });
  }

  if (url.pathname === "/vote-budget" && request.method === "POST") {
    const body = yield* readBodyEffect(request, VoteBudgetRequestSchema);
    if (body instanceof Response) return body;
    return yield* runAuthorizedRoomMutationEffect(
      room,
      body.participantId,
      body.connectionToken,
      (participantId) => room.setVoteBudget(participantId, body.budget),
    );
  }

  if (url.pathname === "/ranking-method" && request.method === "POST") {
    const body = yield* readBodyEffect(request, RankingMethodRequestSchema);
    if (body instanceof Response) return body;
    return yield* runAuthorizedRoomMutationEffect(
      room,
      body.participantId,
      body.connectionToken,
      (participantId) => room.setRankingMethod(participantId, body.rankingMethod),
    );
  }

  if (url.pathname === "/phase" && request.method === "POST") {
    const body = yield* readBodyEffect(request, PhaseRequestSchema);
    if (body instanceof Response) return body;
    return yield* runAuthorizedRoomMutationEffect(
      room,
      body.participantId,
      body.connectionToken,
      (participantId) => room.setPhase(participantId, body.phase),
    );
  }

  if (url.pathname === "/items" && request.method === "POST") {
    const body = yield* readBodyEffect(request, AddItemRequestSchema);
    if (body instanceof Response) return body;
    return yield* runAuthorizedRoomMutationEffect(
      room,
      body.participantId,
      body.connectionToken,
      (participantId) => room.addItem(participantId, body.text, body.columnId),
    );
  }

  const itemMatch = url.pathname.match(/^\/items\/([^/]+)$/);
  if (itemMatch && request.method === "PATCH") {
    const body = yield* readBodyEffect(request, EditItemRequestSchema);
    if (body instanceof Response) return body;
    return yield* runAuthorizedRoomMutationEffect(
      room,
      body.participantId,
      body.connectionToken,
      (participantId) => room.editItem(participantId, decodeURIComponent(itemMatch[1]!), body.text),
    );
  }

  if (itemMatch && request.method === "DELETE") {
    const body = yield* readBodyEffect(request, OptionalConnectionTokenSchema);
    if (body instanceof Response) return body;
    return yield* runAuthorizedRoomMutationEffect(
      room,
      body.participantId,
      body.connectionToken,
      (participantId) => room.deleteItem(participantId, decodeURIComponent(itemMatch[1]!)),
    );
  }

  if (url.pathname === "/timer" && request.method === "POST") {
    const body = yield* readBodyEffect(request, TimerRequestSchema);
    if (body instanceof Response) return body;
    return yield* runAuthorizedRoomMutationEffect(
      room,
      body.participantId,
      body.connectionToken,
      (participantId) => room.setTimer(participantId, body.durationSeconds),
    );
  }

  if (url.pathname === "/review-target" && request.method === "POST") {
    const body = yield* readBodyEffect(request, ReviewTargetRequestSchema);
    if (body instanceof Response) return body;
    return yield* runAuthorizedRoomMutationEffect(
      room,
      body.participantId,
      body.connectionToken,
      (participantId) => room.setReviewTarget(participantId, body.reviewTargetKey),
    );
  }

  if (url.pathname === "/purge" && request.method === "POST") {
    const body = yield* readBodyEffect(request, OptionalConnectionTokenSchema);
    if (body instanceof Response) return body;
    return yield* runAuthorizedRoomMutationEffect(
      room,
      body.participantId,
      body.connectionToken,
      (participantId) => room.purgeByFacilitator(participantId),
    );
  }

  if (url.pathname === "/ws-ticket" && request.method === "POST") {
    const body = yield* readBodyEffect(request, OptionalConnectionTokenSchema);
    if (body instanceof Response) return body;
    const result = yield* deps.createWebSocketTicket(room, body.participantId, body.connectionToken);
    return Response.json(result, { status: result.success ? 200 : 403 });
  }

  return null;
  });
}
