import { Effect, Schema } from "effect";
import type { RetroRoom } from "./retro-room";
import {
  generateRoomId,
  PhaseSchema,
  RankingMethodSchema,
  ROOM_ID_LENGTH,
} from "../src/domain";

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
const turnstileFailure = "Verification failed. Please retry and create the room again.";
const OptionalConnectionTokenSchema = Schema.Struct({
  participantId: Schema.String,
  connectionToken: Schema.optional(Schema.String),
});
const CreateRoomRequestSchema = Schema.Struct({
  turnstileToken: Schema.optional(Schema.String),
});
const JoinRoomRequestSchema = Schema.Struct({
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

function getClientIp(request: Request): string | null {
  return request.headers.get("CF-Connecting-IP");
}

function isLocalRequest(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
}

function hasProductionAntiAbuseConfig(env: Env): boolean {
  return Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY && env.ROOM_CREATE_RATE_LIMITER && env.ROOM_ACCESS_RATE_LIMITER);
}

function getRateLimitKey(request: Request, url: URL, prefix: string): string | null {
  if (isLocalRequest(url)) return null;
  const clientIp = getClientIp(request);
  return `${prefix}:${clientIp && clientIp.trim().length > 0 ? clientIp : "unknown"}`;
}

async function rateLimitRoomAccess(env: Env, request: Request, url: URL): Promise<Response | null> {
  const key = getRateLimitKey(request, url, "room-access");
  if (!env.ROOM_ACCESS_RATE_LIMITER || !key) return null;

  const { success } = await env.ROOM_ACCESS_RATE_LIMITER.limit({ key });
  return success
    ? null
    : Response.json({ error: "Too many room attempts from this network. Please wait a minute and try again." }, { status: 429 });
}

function withSecurityHeaders(response: Response): Response {
  const secured = new Response(response.body, response);
  secured.headers.set("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self' https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self' https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; "));
  secured.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  secured.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  secured.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  secured.headers.set("X-Content-Type-Options", "nosniff");
  return secured;
}

function readJsonBodyEffect<T>(request: Request): Effect.Effect<T | null> {
  return Effect.promise(async () => {
    const contentType = request.headers.get("Content-Type") ?? "";
    if (!contentType.includes("application/json")) return null;
    const contentLength = request.headers.get("Content-Length");
    if (contentLength !== null && (!Number.isFinite(Number(contentLength)) || Number(contentLength) > MAX_JSON_BODY_BYTES)) return null;

    const reader = request.body?.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let body = "";
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_JSON_BODY_BYTES) {
          await reader.cancel();
          return null;
        }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    } else {
      body = await request.text();
      if (new TextEncoder().encode(body).byteLength > MAX_JSON_BODY_BYTES) return null;
    }

    try {
      return JSON.parse(body) as T;
    } catch {
      return null;
    }
  });
}

function readJsonBody<T>(request: Request): Promise<T | null> {
  return Effect.runPromise(readJsonBodyEffect<T>(request));
}

async function readValidatedJsonBody<T>(request: Request, schema: Schema.Schema<T>): Promise<T | Response> {
  const body = await readJsonBody<unknown>(request);
  if (body === null) return Response.json({ success: false, error: "Valid JSON body is required" }, { status: 400 });
  const decoded = await Effect.runPromiseExit(Schema.decodeUnknown(schema)(body));
  return decoded._tag === "Success"
    ? decoded.value
    : Response.json({ success: false, error: "Valid JSON body is required" }, { status: 400 });
}

function verifyTurnstileTokenEffect(
  env: Env,
  token: unknown,
  remoteIp: string,
): Effect.Effect<{ success: true } | { success: false; error: string }> {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) return Effect.succeed({ success: true });
  if (typeof token !== "string" || token.trim().length === 0) {
    return Effect.succeed({ success: false, error: "Verification is required before creating a room." });
  }

  const formData = new FormData();
  formData.append("secret", secret);
  formData.append("response", token);
  if (remoteIp !== "unknown") {
    formData.append("remoteip", remoteIp);
  }

  return Effect.gen(function* () {
    const response = yield* Effect.promise(() =>
      fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        body: formData,
      }).catch(() => undefined),
    );
    if (!response) return { success: false, error: turnstileFailure };

    const result = yield* Effect.promise(() => (response.json() as Promise<{ success?: boolean } | null>).catch(() => null));
    return result?.success === true
      ? { success: true }
      : { success: false, error: turnstileFailure };
  });
}

function verifyTurnstileToken(env: Env, token: unknown, remoteIp: string): Promise<{ success: true } | { success: false; error: string }> {
  return Effect.runPromise(verifyTurnstileTokenEffect(env, token, remoteIp));
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

        const rawBody = await readJsonBody<unknown>(request);
        const body = rawBody === null
          ? {}
          : await Effect.runPromiseExit(Schema.decodeUnknown(CreateRoomRequestSchema)(rawBody)).then((decoded) =>
              decoded._tag === "Success" ? decoded.value : {});
        const clientIp = getClientIp(request);
        const turnstile = await verifyTurnstileToken(env, body?.turnstileToken, clientIp ?? "unknown");
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
      const lookupLimit = await rateLimitRoomAccess(env, request, url);
      if (lookupLimit) return lookupLimit;
      const stub = getRoomStub(env, roomId);
      const hasRoom = await stub.hasRoom();
      if (!hasRoom) {
        return roomNotFoundResponse(suffix);
      }

      if (suffix === "join" && method === "POST") {
        const body = await readValidatedJsonBody(request, JoinRoomRequestSchema);
        if (body instanceof Response) return body;
        return forwardToDO(stub, "/join", request, body);
      }

      if (suffix === "" && method === "GET") {
        return Response.json({ roomId });
      }

      if (suffix === "state" && method === "POST") {
        const body = await readValidatedJsonBody(request, OptionalConnectionTokenSchema);
        if (body instanceof Response) return body;
        return forwardToDO(stub, "/state", request, body);
      }

      if (suffix === "vote-budget" && method === "POST") {
        const body = await readValidatedJsonBody(request, VoteBudgetRequestSchema);
        if (body instanceof Response) return body;
        return forwardToDO(stub, "/vote-budget", request, body);
      }

      if (suffix === "ranking-method" && method === "POST") {
        const body = await readValidatedJsonBody(request, RankingMethodRequestSchema);
        if (body instanceof Response) return body;
        return forwardToDO(stub, "/ranking-method", request, body);
      }

      if (suffix === "phase" && method === "POST") {
        const body = await readValidatedJsonBody(request, PhaseRequestSchema);
        if (body instanceof Response) return body;
        return forwardToDO(stub, "/phase", request, body);
      }

      if (suffix === "items" && method === "POST") {
        const body = await readValidatedJsonBody(request, AddItemRequestSchema);
        if (body instanceof Response) return body;
        return forwardToDO(stub, "/items", request, body);
      }

      const itemMatch = suffix.match(/^items\/([^/]+)$/);
      if (itemMatch && method === "PATCH") {
        const body = await readValidatedJsonBody(request, EditItemRequestSchema);
        if (body instanceof Response) return body;
        return forwardToDO(stub, `/items/${itemMatch[1]}`, request, body);
      }

      if (itemMatch && method === "DELETE") {
        const body = await readValidatedJsonBody(request, OptionalConnectionTokenSchema);
        if (body instanceof Response) return body;
        return forwardToDO(stub, `/items/${itemMatch[1]}`, request, body);
      }

      if (suffix === "timer" && method === "POST") {
        const body = await readValidatedJsonBody(request, TimerRequestSchema);
        if (body instanceof Response) return body;
        return forwardToDO(stub, "/timer", request, body);
      }

      if (suffix === "review-target" && method === "POST") {
        const body = await readValidatedJsonBody(request, ReviewTargetRequestSchema);
        if (body instanceof Response) return body;
        return forwardToDO(stub, "/review-target", request, body);
      }

      if (suffix === "purge" && method === "POST") {
        const body = await readValidatedJsonBody(request, OptionalConnectionTokenSchema);
        if (body instanceof Response) return body;
        return forwardToDO(stub, "/purge", request, body);
      }

      if (suffix === "ws-ticket" && method === "POST") {
        const body = await readValidatedJsonBody(request, OptionalConnectionTokenSchema);
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
