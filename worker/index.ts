import { Effect, Schema } from "effect";
import type { RetroRoom } from "./retro-room";
import {
  generateRoomId,
  ROOM_ID_LENGTH,
} from "../src/domain";
import {
  getRateLimitKey,
  hasProductionAntiAbuseConfig,
  isLocalRequest,
  rateLimitRoomAccess,
} from "./anti-abuse";
import {
  readJsonBody,
  readValidatedJsonBody,
} from "./http-effect";
import {
  AddItemRequestSchema,
  CreateRoomRequestSchema,
  EditItemRequestSchema,
  JoinRoomRequestSchema,
  OptionalConnectionTokenSchema,
  PhaseRequestSchema,
  RankingMethodRequestSchema,
  ReviewTargetRequestSchema,
  TimerRequestSchema,
  VoteBudgetRequestSchema,
} from "./room-request-schemas";
import { withSecurityHeaders } from "./security-headers";
import { verifyTurnstileToken } from "./turnstile";

export interface Env {
  ASSETS?: Fetcher;
  RETRO_ROOM: DurableObjectNamespace<RetroRoom>;
  ROOM_CREATE_RATE_LIMITER?: RateLimit;
  ROOM_ACCESS_RATE_LIMITER?: RateLimit;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}

export { RetroRoom } from "./retro-room";

const MAX_JSON_BODY_BYTES = 32 * 1024;
function getRoomStub(env: Env, roomId: string) {
  const id = env.RETRO_ROOM.idFromName(roomId);
  return env.RETRO_ROOM.get(id);
}

function parseRoomPath(pathname: string): { prefix: string; roomId: string; suffix: string } | null {
  const match = pathname.match(/^\/api\/rooms\/([^/]+)(?:\/(.+))?$/);
  if (!match) return null;
  return { prefix: "/api/rooms", roomId: match[1]!, suffix: match[2] ?? "" };
}

function isValidRoomId(roomId: string): boolean {
  return roomId.length === ROOM_ID_LENGTH && /^[A-Za-z0-9_-]+$/.test(roomId);
}

function forwardToDO(stub: DurableObjectStub<RetroRoom>, pathname: string, request: Request, body: unknown): Promise<Response> {
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

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname, method } = { pathname: url.pathname, method: request.method };

    if (pathname === "/api/config" && method === "GET") {
      const turnstileSiteKey = hasProductionAntiAbuseConfig(env)
        ? env.TURNSTILE_SITE_KEY
        : null;
      return Response.json({ turnstileSiteKey });
    }

    if (pathname === "/api/rooms") {
      if (method === "POST") {
        if (!isLocalRequest(url) && !hasProductionAntiAbuseConfig(env)) {
          return Response.json({ error: "Room creation is temporarily unavailable." }, { status: 503 });
        }
        const createLimitKey = getRateLimitKey(request, url, "room-create");
        if (env.ROOM_CREATE_RATE_LIMITER && createLimitKey) {
          const { success } = await env.ROOM_CREATE_RATE_LIMITER.limit({ key: createLimitKey });
          if (!success) {
            return Response.json({ error: "Too many rooms created from this network. Please wait a minute and try again." }, { status: 429 });
          }
        }

        const rawBody = await readJsonBody<unknown>(request, { maxBytes: MAX_JSON_BODY_BYTES });
        const body = rawBody === null
          ? {}
          : await Effect.runPromiseExit(Schema.decodeUnknown(CreateRoomRequestSchema)(rawBody)).then((decoded) =>
              decoded._tag === "Success" ? decoded.value : {});
        const clientIp = request.headers.get("CF-Connecting-IP");
        const turnstile = await verifyTurnstileToken({ secret: env.TURNSTILE_SECRET_KEY }, body?.turnstileToken, clientIp ?? "unknown");
        if (!turnstile.success) {
          return Response.json({ error: turnstile.error }, { status: 403 });
        }

        const roomId = generateRoomId();
        const facilitatorClaimToken = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
        const stub = getRoomStub(env, roomId);
        await stub.initRoom(roomId, facilitatorClaimToken);
        return Response.json({ roomId, facilitatorClaimToken });
      }
      if (method === "GET") {
        return Response.json({ message: "Retro Board API" });
      }
    }

    const parsed = parseRoomPath(pathname);
    if (parsed) {
      const { roomId, suffix } = parsed;
      if (!isValidRoomId(roomId)) {
        return Response.json({ error: "Room not found" }, { status: 404 });
      }
      if (!isLocalRequest(url) && !env.ROOM_ACCESS_RATE_LIMITER) {
        return Response.json({ error: "Room access is temporarily unavailable." }, { status: 503 });
      }
      const lookupLimit = await rateLimitRoomAccess(env, request);
      if (lookupLimit) return lookupLimit;
      const stub = getRoomStub(env, roomId);
      const hasRoom = await stub.hasRoom();
      if (!hasRoom) {
        return roomNotFoundResponse(suffix);
      }

      if (suffix === "join" && method === "POST") {
        const body = await readValidatedJsonBody(request, JoinRoomRequestSchema, { maxBytes: MAX_JSON_BODY_BYTES });
        if (body instanceof Response) return body;
        return forwardToDO(stub, "/join", request, body);
      }

      if (suffix === "" && method === "GET") {
        return Response.json({ roomId });
      }

      if (suffix === "state" && method === "POST") {
        const body = await readValidatedJsonBody(request, OptionalConnectionTokenSchema, { maxBytes: MAX_JSON_BODY_BYTES });
        if (body instanceof Response) return body;
        return forwardToDO(stub, "/state", request, body);
      }

      if (suffix === "vote-budget" && method === "POST") {
        const body = await readValidatedJsonBody(request, VoteBudgetRequestSchema, { maxBytes: MAX_JSON_BODY_BYTES });
        if (body instanceof Response) return body;
        return forwardToDO(stub, "/vote-budget", request, body);
      }

      if (suffix === "ranking-method" && method === "POST") {
        const body = await readValidatedJsonBody(request, RankingMethodRequestSchema, { maxBytes: MAX_JSON_BODY_BYTES });
        if (body instanceof Response) return body;
        return forwardToDO(stub, "/ranking-method", request, body);
      }

      if (suffix === "phase" && method === "POST") {
        const body = await readValidatedJsonBody(request, PhaseRequestSchema, { maxBytes: MAX_JSON_BODY_BYTES });
        if (body instanceof Response) return body;
        return forwardToDO(stub, "/phase", request, body);
      }

      if (suffix === "items" && method === "POST") {
        const body = await readValidatedJsonBody(request, AddItemRequestSchema, { maxBytes: MAX_JSON_BODY_BYTES });
        if (body instanceof Response) return body;
        return forwardToDO(stub, "/items", request, body);
      }

      const itemMatch = suffix.match(/^items\/([^/]+)$/);
      if (itemMatch && method === "PATCH") {
        const body = await readValidatedJsonBody(request, EditItemRequestSchema, { maxBytes: MAX_JSON_BODY_BYTES });
        if (body instanceof Response) return body;
        return forwardToDO(stub, `/items/${itemMatch[1]}`, request, body);
      }

      if (itemMatch && method === "DELETE") {
        const body = await readValidatedJsonBody(request, OptionalConnectionTokenSchema, { maxBytes: MAX_JSON_BODY_BYTES });
        if (body instanceof Response) return body;
        return forwardToDO(stub, `/items/${itemMatch[1]}`, request, body);
      }

      if (suffix === "timer" && method === "POST") {
        const body = await readValidatedJsonBody(request, TimerRequestSchema, { maxBytes: MAX_JSON_BODY_BYTES });
        if (body instanceof Response) return body;
        return forwardToDO(stub, "/timer", request, body);
      }

      if (suffix === "review-target" && method === "POST") {
        const body = await readValidatedJsonBody(request, ReviewTargetRequestSchema, { maxBytes: MAX_JSON_BODY_BYTES });
        if (body instanceof Response) return body;
        return forwardToDO(stub, "/review-target", request, body);
      }

      if (suffix === "purge" && method === "POST") {
        const body = await readValidatedJsonBody(request, OptionalConnectionTokenSchema, { maxBytes: MAX_JSON_BODY_BYTES });
        if (body instanceof Response) return body;
        return forwardToDO(stub, "/purge", request, body);
      }

      if (suffix === "ws-ticket" && method === "POST") {
        const body = await readValidatedJsonBody(request, OptionalConnectionTokenSchema, { maxBytes: MAX_JSON_BODY_BYTES });
        if (body instanceof Response) return body;
        return forwardToDO(stub, "/ws-ticket", request, body);
      }

      if (suffix === "ws" && request.headers.get("Upgrade") === "websocket") {
        const newUrl = new URL(request.url);
        newUrl.pathname = "/ws";
        return stub.fetch(new Request(newUrl, request));
      }
    }

    if (pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
    }

    const assetResponse = await env.ASSETS?.fetch(request);
    return assetResponse ? withSecurityHeaders(assetResponse) : new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
