import { Effect, Schema } from "effect";
import { ROOM_ID_LENGTH } from "../src/domain";
import {
  isLocalRequest,
  rateLimitRoomAccessEffect,
} from "./anti-abuse";
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
import { forwardValidatedRoomMutationEffect } from "./room-mutation-forwarder";
import type { RetroRoom } from "./retro-room";
import type { Env } from "./index";

interface ParsedRoomPath {
  roomId: string;
  suffix: string;
}

interface RoomMutationRoute {
  suffix: string;
  method: string;
  schema: Schema.Schema.AnyNoContext;
  durableObjectPath: (suffix: string) => string;
}

const staticMutationRoutes: RoomMutationRoute[] = [
  route("join", "POST", JoinRoomRequestSchema, "/join"),
  route("state", "POST", OptionalConnectionTokenSchema, "/state"),
  route("vote-budget", "POST", VoteBudgetRequestSchema, "/vote-budget"),
  route("ranking-method", "POST", RankingMethodRequestSchema, "/ranking-method"),
  route("phase", "POST", PhaseRequestSchema, "/phase"),
  route("items", "POST", AddItemRequestSchema, "/items"),
  route("timer", "POST", TimerRequestSchema, "/timer"),
  route("review-target", "POST", ReviewTargetRequestSchema, "/review-target"),
  route("purge", "POST", OptionalConnectionTokenSchema, "/purge"),
  route("ws-ticket", "POST", OptionalConnectionTokenSchema, "/ws-ticket"),
];

export function handleRoomApiRequestEffect(
  request: Request,
  env: Env,
  url: URL,
): Effect.Effect<Response | null> {
  return Effect.gen(function* () {
    const parsed = parseRoomPath(url.pathname);
    if (!parsed) return null;

    const { roomId, suffix } = parsed;
    if (!isValidRoomId(roomId)) {
      return Response.json({ error: "Room not found" }, { status: 404 });
    }

    if (!isLocalRequest(url) && !env.ROOM_ACCESS_RATE_LIMITER) {
      return Response.json({ error: "Room access is temporarily unavailable." }, { status: 503 });
    }

    const lookupLimit = yield* rateLimitRoomAccessEffect(env, request);
    if (lookupLimit) return lookupLimit;

    const stub = getRoomStub(env, roomId);
    const hasRoom = yield* Effect.promise(() => stub.hasRoom());
    if (!hasRoom) return roomNotFoundResponse(suffix);

    if (suffix === "" && request.method === "GET") {
      return Response.json({ roomId });
    }

    const mutationRoute = getMutationRoute(suffix, request.method);
    if (mutationRoute) {
      return yield* validateAndForwardEffect(request, stub, mutationRoute.schema, mutationRoute.durableObjectPath(suffix));
    }

    if (suffix === "ws" && request.headers.get("Upgrade") === "websocket") {
      const newUrl = new URL(request.url);
      newUrl.pathname = "/ws";
      return yield* Effect.promise(() => stub.fetch(new Request(newUrl, request)));
    }

    return null;
  });
}

function route(
  suffix: string,
  method: string,
  schema: Schema.Schema.AnyNoContext,
  durableObjectPath: string,
): RoomMutationRoute {
  return { suffix, method, schema, durableObjectPath: () => durableObjectPath };
}

function parseRoomPath(pathname: string): ParsedRoomPath | null {
  const match = pathname.match(/^\/api\/rooms\/([^/]+)(?:\/(.+))?$/);
  if (!match) return null;
  return { roomId: match[1]!, suffix: match[2] ?? "" };
}

function isValidRoomId(roomId: string): boolean {
  return roomId.length === ROOM_ID_LENGTH && /^[A-Za-z0-9_-]+$/.test(roomId);
}

function getMutationRoute(suffix: string, method: string): RoomMutationRoute | null {
  const itemMatch = suffix.match(/^items\/([^/]+)$/);
  if (itemMatch && method === "PATCH") {
    return {
      suffix,
      method,
      schema: EditItemRequestSchema,
      durableObjectPath: () => `/items/${itemMatch[1]}`,
    };
  }
  if (itemMatch && method === "DELETE") {
    return {
      suffix,
      method,
      schema: OptionalConnectionTokenSchema,
      durableObjectPath: () => `/items/${itemMatch[1]}`,
    };
  }

  return staticMutationRoutes.find((route) => route.suffix === suffix && route.method === method) ?? null;
}

function validateAndForwardEffect(
  request: Request,
  stub: DurableObjectStub<RetroRoom>,
  schema: Schema.Schema.AnyNoContext,
  durableObjectPath: string,
): Effect.Effect<Response> {
  return forwardValidatedRoomMutationEffect(
    request,
    schema,
    (body) => Effect.promise(() => forwardToDO(stub, durableObjectPath, request, body)),
  );
}

function getRoomStub(env: Env, roomId: string): DurableObjectStub<RetroRoom> {
  const id = env.RETRO_ROOM.idFromName(roomId);
  return env.RETRO_ROOM.get(id);
}

function forwardToDO(
  stub: DurableObjectStub<RetroRoom>,
  pathname: string,
  request: Request,
  body: unknown,
): Promise<Response> {
  return stub.fetch(new Request(`http://do${pathname}`, {
    method: request.method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

function roomNotFoundResponse(suffix: string): Response {
  return suffix === ""
    ? Response.json({ error: "Room not found" }, { status: 404 })
    : Response.json({ success: false, error: "Room not found" }, { status: 404 });
}
