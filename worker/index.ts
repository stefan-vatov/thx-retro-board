import type { RetroRoom } from "./retro-room";
import { generateRoomId } from "../src/domain";

export interface Env {
  ASSETS: Fetcher;
  RETRO_ROOM: DurableObjectNamespace<RetroRoom>;
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

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname, method } = { pathname: url.pathname, method: request.method };

    if (pathname === "/api/rooms") {
      if (method === "POST") {
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

      if (suffix === "ws" && request.headers.get("Upgrade") === "websocket") {
        const newUrl = new URL(request.url);
        newUrl.pathname = "/ws";
        return stub.fetch(new Request(newUrl, request));
      }
    }

    if (pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
