import { Effect } from "effect";
import type { Phase, RankingMethod, RoomState } from "../src/domain";
import { readValidatedJsonBody } from "./http-effect";
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

async function authorizeBody(
  room: RoomHttpController,
  participantId: string,
  connectionToken: unknown,
): Promise<{ success: true; participantId: string } | Response> {
  const auth = await room.authorizeHttpParticipant(participantId, connectionToken);
  return auth.success ? { success: true, participantId: auth.participantId } : Response.json(auth, { status: 403 });
}

export async function handleRoomHttpRequest(room: RoomHttpController, request: Request): Promise<Response | null> {
  return Effect.runPromise(handleRoomHttpRequestEffect(room, request));
}

function readBodyEffect<T>(
  request: Request,
  schema: Parameters<typeof readValidatedJsonBody<T>>[1],
): Effect.Effect<T | Response> {
  return Effect.promise(() => readValidatedJsonBody(request, schema, { maxBytes: MAX_WEBSOCKET_MESSAGE_BYTES }));
}

function authorizeBodyEffect(
  room: RoomHttpController,
  participantId: string,
  connectionToken: unknown,
): Effect.Effect<{ success: true; participantId: string } | Response> {
  return Effect.promise(() => authorizeBody(room, participantId, connectionToken));
}

export function handleRoomHttpRequestEffect(
  room: RoomHttpController,
  request: Request,
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
    const result = yield* Effect.promise(() => room.getRoomStateForParticipant(body.participantId, body.connectionToken));
    return Response.json(result, { status: result.success ? 200 : 403 });
  }

  if (url.pathname === "/vote-budget" && request.method === "POST") {
    const body = yield* readBodyEffect(request, VoteBudgetRequestSchema);
    if (body instanceof Response) return body;
    const auth = yield* authorizeBodyEffect(room, body.participantId, body.connectionToken);
    return auth instanceof Response
      ? auth
      : Response.json(yield* Effect.promise(() => room.setVoteBudget(auth.participantId, body.budget)));
  }

  if (url.pathname === "/ranking-method" && request.method === "POST") {
    const body = yield* readBodyEffect(request, RankingMethodRequestSchema);
    if (body instanceof Response) return body;
    const auth = yield* authorizeBodyEffect(room, body.participantId, body.connectionToken);
    return auth instanceof Response
      ? auth
      : Response.json(yield* Effect.promise(() => room.setRankingMethod(auth.participantId, body.rankingMethod)));
  }

  if (url.pathname === "/phase" && request.method === "POST") {
    const body = yield* readBodyEffect(request, PhaseRequestSchema);
    if (body instanceof Response) return body;
    const auth = yield* authorizeBodyEffect(room, body.participantId, body.connectionToken);
    return auth instanceof Response
      ? auth
      : Response.json(yield* Effect.promise(() => room.setPhase(auth.participantId, body.phase)));
  }

  if (url.pathname === "/items" && request.method === "POST") {
    const body = yield* readBodyEffect(request, AddItemRequestSchema);
    if (body instanceof Response) return body;
    const auth = yield* authorizeBodyEffect(room, body.participantId, body.connectionToken);
    return auth instanceof Response
      ? auth
      : Response.json(yield* Effect.promise(() => room.addItem(auth.participantId, body.text, body.columnId)));
  }

  const itemMatch = url.pathname.match(/^\/items\/([^/]+)$/);
  if (itemMatch && request.method === "PATCH") {
    const body = yield* readBodyEffect(request, EditItemRequestSchema);
    if (body instanceof Response) return body;
    const auth = yield* authorizeBodyEffect(room, body.participantId, body.connectionToken);
    return auth instanceof Response
      ? auth
      : Response.json(yield* Effect.promise(() => room.editItem(auth.participantId, decodeURIComponent(itemMatch[1]!), body.text)));
  }

  if (itemMatch && request.method === "DELETE") {
    const body = yield* readBodyEffect(request, OptionalConnectionTokenSchema);
    if (body instanceof Response) return body;
    const auth = yield* authorizeBodyEffect(room, body.participantId, body.connectionToken);
    return auth instanceof Response
      ? auth
      : Response.json(yield* Effect.promise(() => room.deleteItem(auth.participantId, decodeURIComponent(itemMatch[1]!))));
  }

  if (url.pathname === "/timer" && request.method === "POST") {
    const body = yield* readBodyEffect(request, TimerRequestSchema);
    if (body instanceof Response) return body;
    const auth = yield* authorizeBodyEffect(room, body.participantId, body.connectionToken);
    return auth instanceof Response
      ? auth
      : Response.json(yield* Effect.promise(() => room.setTimer(auth.participantId, body.durationSeconds)));
  }

  if (url.pathname === "/review-target" && request.method === "POST") {
    const body = yield* readBodyEffect(request, ReviewTargetRequestSchema);
    if (body instanceof Response) return body;
    const auth = yield* authorizeBodyEffect(room, body.participantId, body.connectionToken);
    return auth instanceof Response
      ? auth
      : Response.json(yield* Effect.promise(() => room.setReviewTarget(auth.participantId, body.reviewTargetKey)));
  }

  if (url.pathname === "/purge" && request.method === "POST") {
    const body = yield* readBodyEffect(request, OptionalConnectionTokenSchema);
    if (body instanceof Response) return body;
    const auth = yield* authorizeBodyEffect(room, body.participantId, body.connectionToken);
    return auth instanceof Response
      ? auth
      : Response.json(yield* Effect.promise(() => room.purgeByFacilitator(auth.participantId)));
  }

  if (url.pathname === "/ws-ticket" && request.method === "POST") {
    const body = yield* readBodyEffect(request, OptionalConnectionTokenSchema);
    if (body instanceof Response) return body;
    const result = yield* Effect.promise(() => room.createWebSocketTicket(body.participantId, body.connectionToken));
    return Response.json(result, { status: result.success ? 200 : 403 });
  }

  return null;
  });
}
