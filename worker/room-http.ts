import { Schema } from "effect";
import type { Phase, RankingMethod, RoomState } from "../src/domain";
import { PhaseSchema, RankingMethodSchema } from "../src/domain";
import { readValidatedJsonBody } from "./http-effect";
import type { StoredState } from "./room-types";
import { MAX_WEBSOCKET_MESSAGE_BYTES } from "./room-types";

const OptionalConnectionTokenSchema = Schema.Struct({
  participantId: Schema.String,
  connectionToken: Schema.optional(Schema.String),
});

const JoinRequestSchema = Schema.Struct({
  participantId: Schema.String,
  displayName: Schema.String,
  connectionToken: Schema.optional(Schema.String),
  facilitatorClaimToken: Schema.optional(Schema.String),
});

const VoteBudgetRequestSchema = Schema.Struct({
  participantId: Schema.String,
  connectionToken: Schema.optional(Schema.String),
  budget: Schema.Number,
});

const RankingMethodRequestSchema = Schema.Struct({
  participantId: Schema.String,
  connectionToken: Schema.optional(Schema.String),
  rankingMethod: RankingMethodSchema,
});

const PhaseRequestSchema = Schema.Struct({
  participantId: Schema.String,
  connectionToken: Schema.optional(Schema.String),
  phase: PhaseSchema,
});

const AddItemRequestSchema = Schema.Struct({
  participantId: Schema.String,
  connectionToken: Schema.optional(Schema.String),
  text: Schema.String,
  columnId: Schema.optional(Schema.String),
});

const EditItemRequestSchema = Schema.Struct({
  participantId: Schema.String,
  connectionToken: Schema.optional(Schema.String),
  text: Schema.String,
});

const TimerRequestSchema = Schema.Struct({
  participantId: Schema.String,
  connectionToken: Schema.optional(Schema.String),
  durationSeconds: Schema.Number,
});

const ReviewTargetRequestSchema = Schema.Struct({
  participantId: Schema.String,
  connectionToken: Schema.optional(Schema.String),
  reviewTargetKey: Schema.NullOr(Schema.String),
});

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
  const url = new URL(request.url);

  if (url.pathname === "/join" && request.method === "POST") {
    const body = await readValidatedJsonBody(request, JoinRequestSchema, { maxBytes: MAX_WEBSOCKET_MESSAGE_BYTES });
    if (body instanceof Response) return body;
    return Response.json(await room.join(body.participantId, body.displayName, body.connectionToken, body.facilitatorClaimToken));
  }

  if (url.pathname === "/state" && request.method === "POST") {
    const body = await readValidatedJsonBody(request, OptionalConnectionTokenSchema, { maxBytes: MAX_WEBSOCKET_MESSAGE_BYTES });
    if (body instanceof Response) return body;
    const result = await room.getRoomStateForParticipant(body.participantId, body.connectionToken);
    return Response.json(result, { status: result.success ? 200 : 403 });
  }

  if (url.pathname === "/vote-budget" && request.method === "POST") {
    const body = await readValidatedJsonBody(request, VoteBudgetRequestSchema, { maxBytes: MAX_WEBSOCKET_MESSAGE_BYTES });
    if (body instanceof Response) return body;
    const auth = await authorizeBody(room, body.participantId, body.connectionToken);
    return auth instanceof Response ? auth : Response.json(await room.setVoteBudget(auth.participantId, body.budget));
  }

  if (url.pathname === "/ranking-method" && request.method === "POST") {
    const body = await readValidatedJsonBody(request, RankingMethodRequestSchema, { maxBytes: MAX_WEBSOCKET_MESSAGE_BYTES });
    if (body instanceof Response) return body;
    const auth = await authorizeBody(room, body.participantId, body.connectionToken);
    return auth instanceof Response ? auth : Response.json(await room.setRankingMethod(auth.participantId, body.rankingMethod));
  }

  if (url.pathname === "/phase" && request.method === "POST") {
    const body = await readValidatedJsonBody(request, PhaseRequestSchema, { maxBytes: MAX_WEBSOCKET_MESSAGE_BYTES });
    if (body instanceof Response) return body;
    const auth = await authorizeBody(room, body.participantId, body.connectionToken);
    return auth instanceof Response ? auth : Response.json(await room.setPhase(auth.participantId, body.phase));
  }

  if (url.pathname === "/items" && request.method === "POST") {
    const body = await readValidatedJsonBody(request, AddItemRequestSchema, { maxBytes: MAX_WEBSOCKET_MESSAGE_BYTES });
    if (body instanceof Response) return body;
    const auth = await authorizeBody(room, body.participantId, body.connectionToken);
    return auth instanceof Response ? auth : Response.json(await room.addItem(auth.participantId, body.text, body.columnId));
  }

  const itemMatch = url.pathname.match(/^\/items\/([^/]+)$/);
  if (itemMatch && request.method === "PATCH") {
    const body = await readValidatedJsonBody(request, EditItemRequestSchema, { maxBytes: MAX_WEBSOCKET_MESSAGE_BYTES });
    if (body instanceof Response) return body;
    const auth = await authorizeBody(room, body.participantId, body.connectionToken);
    return auth instanceof Response
      ? auth
      : Response.json(await room.editItem(auth.participantId, decodeURIComponent(itemMatch[1]!), body.text));
  }

  if (itemMatch && request.method === "DELETE") {
    const body = await readValidatedJsonBody(request, OptionalConnectionTokenSchema, { maxBytes: MAX_WEBSOCKET_MESSAGE_BYTES });
    if (body instanceof Response) return body;
    const auth = await authorizeBody(room, body.participantId, body.connectionToken);
    return auth instanceof Response
      ? auth
      : Response.json(await room.deleteItem(auth.participantId, decodeURIComponent(itemMatch[1]!)));
  }

  if (url.pathname === "/timer" && request.method === "POST") {
    const body = await readValidatedJsonBody(request, TimerRequestSchema, { maxBytes: MAX_WEBSOCKET_MESSAGE_BYTES });
    if (body instanceof Response) return body;
    const auth = await authorizeBody(room, body.participantId, body.connectionToken);
    return auth instanceof Response ? auth : Response.json(await room.setTimer(auth.participantId, body.durationSeconds));
  }

  if (url.pathname === "/review-target" && request.method === "POST") {
    const body = await readValidatedJsonBody(request, ReviewTargetRequestSchema, { maxBytes: MAX_WEBSOCKET_MESSAGE_BYTES });
    if (body instanceof Response) return body;
    const auth = await authorizeBody(room, body.participantId, body.connectionToken);
    return auth instanceof Response ? auth : Response.json(await room.setReviewTarget(auth.participantId, body.reviewTargetKey));
  }

  if (url.pathname === "/purge" && request.method === "POST") {
    const body = await readValidatedJsonBody(request, OptionalConnectionTokenSchema, { maxBytes: MAX_WEBSOCKET_MESSAGE_BYTES });
    if (body instanceof Response) return body;
    const auth = await authorizeBody(room, body.participantId, body.connectionToken);
    return auth instanceof Response ? auth : Response.json(await room.purgeByFacilitator(auth.participantId));
  }

  if (url.pathname === "/ws-ticket" && request.method === "POST") {
    const body = await readValidatedJsonBody(request, OptionalConnectionTokenSchema, { maxBytes: MAX_WEBSOCKET_MESSAGE_BYTES });
    if (body instanceof Response) return body;
    const result = await room.createWebSocketTicket(body.participantId, body.connectionToken);
    return Response.json(result, { status: result.success ? 200 : 403 });
  }

  return null;
}
