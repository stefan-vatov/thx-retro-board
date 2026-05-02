import type { RetroRoom } from "./retro-room";
import { generateRoomId } from "../src/domain";

export interface Env {
  ASSETS?: Fetcher;
  RETRO_ROOM: DurableObjectNamespace<RetroRoom>;
  ROOM_CREATE_RATE_LIMITER?: RateLimit;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}

export { RetroRoom } from "./retro-room";

function getRoomStub(env: Env, roomId: string) {
  const id = env.RETRO_ROOM.idFromName(roomId);
  return env.RETRO_ROOM.get(id);
}

function parseRoomPath(pathname: string): { prefix: string; roomId: string; suffix: string } | null {
  const match = pathname.match(/^\/api\/rooms\/([^/]+)(?:\/(.+))?$/);
  if (!match) return null;
  return { prefix: "/api/rooms", roomId: match[1]!, suffix: match[2] ?? "" };
}

function forwardToDO(stub: DurableObjectStub<RetroRoom>, pathname: string, request: Request, body: unknown): Promise<Response> {
  return stub.fetch(new Request(`http://do${pathname}`, {
    method: request.method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

function getClientIp(request: Request): string | null {
  return request.headers.get("CF-Connecting-IP");
}

function shouldRateLimitClientIp(clientIp: string | null): clientIp is string {
  if (!clientIp) return false;
  if (clientIp === "127.0.0.1" || clientIp === "::1") return false;
  if (/^10\./.test(clientIp)) return false;
  if (/^192\.168\./.test(clientIp)) return false;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(clientIp)) return false;
  return true;
}

function withSecurityHeaders(response: Response): Response {
  const secured = new Response(response.body, response);
  secured.headers.set("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self' https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self' https://challenges.cloudflare.com wss:",
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

async function readJsonBody<T>(request: Request): Promise<T | null> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) return null;
  try {
    return await request.json() as T;
  } catch {
    return null;
  }
}

async function readRequiredJsonBody<T>(request: Request): Promise<T | Response> {
  const body = await readJsonBody<T>(request);
  return body ?? Response.json({ success: false, error: "Valid JSON body is required" }, { status: 400 });
}

async function verifyTurnstileToken(env: Env, token: unknown, remoteIp: string): Promise<{ success: true } | { success: false; error: string }> {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) return { success: true };
  if (typeof token !== "string" || token.trim().length === 0) {
    return { success: false, error: "Verification is required before creating a room." };
  }

  const formData = new FormData();
  formData.append("secret", secret);
  formData.append("response", token);
  if (remoteIp !== "unknown") {
    formData.append("remoteip", remoteIp);
  }

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: formData,
  });
  const result = await response.json().catch(() => null) as { success?: boolean } | null;
  return result?.success === true
    ? { success: true }
    : { success: false, error: "Verification failed. Please retry and create the room again." };
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname, method } = { pathname: url.pathname, method: request.method };

    if (pathname === "/api/config" && method === "GET") {
      const turnstileSiteKey = env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY
        ? env.TURNSTILE_SITE_KEY
        : null;
      return Response.json({ turnstileSiteKey });
    }

    if (pathname === "/api/rooms") {
      if (method === "POST") {
        const clientIp = getClientIp(request);
        if (env.ROOM_CREATE_RATE_LIMITER && shouldRateLimitClientIp(clientIp)) {
          const { success } = await env.ROOM_CREATE_RATE_LIMITER.limit({ key: `room-create:${clientIp}` });
          if (!success) {
            return Response.json({ error: "Too many rooms created from this network. Please wait a minute and try again." }, { status: 429 });
          }
        }

        const body = await readJsonBody<{ turnstileToken?: string }>(request);
        const turnstile = await verifyTurnstileToken(env, body?.turnstileToken, clientIp ?? "unknown");
        if (!turnstile.success) {
          return Response.json({ error: turnstile.error }, { status: 403 });
        }

        const roomId = generateRoomId();
        const stub = getRoomStub(env, roomId);
        await stub.initRoom(roomId);
        return Response.json({ roomId });
      }
      if (method === "GET") {
        return Response.json({ message: "Retro Board API" });
      }
    }

    const parsed = parseRoomPath(pathname);
    if (parsed) {
      const { roomId, suffix } = parsed;
      const stub = getRoomStub(env, roomId);

      if (suffix === "join" && method === "POST") {
        const hasRoom = await stub.hasRoom();
        if (!hasRoom) {
          return Response.json({ success: false, error: "Room not found" }, { status: 404 });
        }
        const body = await readRequiredJsonBody<{ participantId: string; displayName: string; connectionToken?: string }>(request);
        if (body instanceof Response) return body;
        return forwardToDO(stub, "/join", request, body);
      }

      if (suffix === "" && method === "GET") {
        const hasRoom = await stub.hasRoom();
        if (!hasRoom) {
          return Response.json({ error: "Room not found" }, { status: 404 });
        }
        const state = await stub.getRoomState();
        return Response.json(state);
      }

      if (suffix === "vote-budget" && method === "POST") {
        const body = await readRequiredJsonBody<{ participantId: string; connectionToken?: string; budget: number }>(request);
        if (body instanceof Response) return body;
        return forwardToDO(stub, "/vote-budget", request, body);
      }

      if (suffix === "ranking-method" && method === "POST") {
        const body = await readRequiredJsonBody<{ participantId: string; connectionToken?: string; rankingMethod: string }>(request);
        if (body instanceof Response) return body;
        return forwardToDO(stub, "/ranking-method", request, body);
      }

      if (suffix === "phase" && method === "POST") {
        const body = await readRequiredJsonBody<{ participantId: string; connectionToken?: string; phase: string }>(request);
        if (body instanceof Response) return body;
        return forwardToDO(stub, "/phase", request, body);
      }

      if (suffix === "items" && method === "POST") {
        const body = await readRequiredJsonBody<{ participantId: string; connectionToken?: string; text: string; columnId?: string }>(request);
        if (body instanceof Response) return body;
        return forwardToDO(stub, "/items", request, body);
      }

      const itemMatch = suffix.match(/^items\/([^/]+)$/);
      if (itemMatch && method === "PATCH") {
        const body = await readRequiredJsonBody<{ participantId: string; connectionToken?: string; text: string }>(request);
        if (body instanceof Response) return body;
        return forwardToDO(stub, `/items/${itemMatch[1]}`, request, body);
      }

      if (itemMatch && method === "DELETE") {
        const body = await readRequiredJsonBody<{ participantId: string; connectionToken?: string }>(request);
        if (body instanceof Response) return body;
        return forwardToDO(stub, `/items/${itemMatch[1]}`, request, body);
      }

      if (suffix === "timer" && method === "POST") {
        const body = await readRequiredJsonBody<{ participantId: string; connectionToken?: string; durationSeconds: number }>(request);
        if (body instanceof Response) return body;
        return forwardToDO(stub, "/timer", request, body);
      }

      if (suffix === "review-target" && method === "POST") {
        const body = await readRequiredJsonBody<{ participantId: string; connectionToken?: string; reviewTargetKey: string | null }>(request);
        if (body instanceof Response) return body;
        return forwardToDO(stub, "/review-target", request, body);
      }

      if (suffix === "purge" && method === "POST") {
        const hasRoom = await stub.hasRoom();
        if (!hasRoom) {
          return Response.json({ success: false, error: "Room not found" }, { status: 404 });
        }
        const body = await readRequiredJsonBody<{ participantId: string; connectionToken?: string }>(request);
        if (body instanceof Response) return body;
        return forwardToDO(stub, "/purge", request, body);
      }

      if (suffix === "ws" && request.headers.get("Upgrade") === "websocket") {
        const hasRoom = await stub.hasRoom();
        if (!hasRoom) {
          return new Response(JSON.stringify({ error: "Room not found" }), { status: 404 });
        }
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
