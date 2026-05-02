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

function getClientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP")
    ?? request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim()
    ?? "unknown";
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
        if (env.ROOM_CREATE_RATE_LIMITER) {
          const { success } = await env.ROOM_CREATE_RATE_LIMITER.limit({ key: `room-create:${clientIp}` });
          if (!success) {
            return Response.json({ error: "Too many rooms created from this network. Please wait a minute and try again." }, { status: 429 });
          }
        }

        const body = await readJsonBody<{ turnstileToken?: string }>(request);
        const turnstile = await verifyTurnstileToken(env, body?.turnstileToken, clientIp);
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
        const body = await request.json() as { participantId: string; displayName: string };
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
        const body = await request.json() as { participantId: string; budget: number };
        return forwardToDO(stub, "/vote-budget", request, body);
      }

      if (suffix === "ranking-method" && method === "POST") {
        const body = await request.json() as { participantId: string; rankingMethod: string };
        return forwardToDO(stub, "/ranking-method", request, body);
      }

      if (suffix === "phase" && method === "POST") {
        const body = await request.json() as { participantId: string; phase: string };
        return forwardToDO(stub, "/phase", request, body);
      }

      if (suffix === "items" && method === "POST") {
        const body = await request.json() as { participantId: string; text: string; columnId?: string };
        return forwardToDO(stub, "/items", request, body);
      }

      const itemMatch = suffix.match(/^items\/([^/]+)$/);
      if (itemMatch && method === "PATCH") {
        const body = await request.json() as { participantId: string; text: string };
        return forwardToDO(stub, `/items/${itemMatch[1]}`, request, body);
      }

      if (itemMatch && method === "DELETE") {
        const body = await request.json() as { participantId: string };
        return forwardToDO(stub, `/items/${itemMatch[1]}`, request, body);
      }

      if (suffix === "timer" && method === "POST") {
        const body = await request.json() as { participantId: string; durationSeconds: number };
        return forwardToDO(stub, "/timer", request, body);
      }

      if (suffix === "review-target" && method === "POST") {
        const body = await request.json() as { participantId: string; reviewTargetKey: string | null };
        return forwardToDO(stub, "/review-target", request, body);
      }

      if (suffix === "purge" && method === "POST") {
        const hasRoom = await stub.hasRoom();
        if (!hasRoom) {
          return Response.json({ success: false, error: "Room not found" }, { status: 404 });
        }
        const body = await request.json() as { participantId: string };
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

    return env.ASSETS?.fetch(request) ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
