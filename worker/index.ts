import type { RetroRoom } from "./retro-room";

export interface Env {
  RETRO_ROOM: DurableObjectNamespace<RetroRoom>;
}

export { RetroRoom } from "./retro-room";

function generateRoomId(): string {
  const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  const LENGTH = 21;
  const bytes = new Uint8Array(LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CHARSET[b % CHARSET.length]).join("");
}

function getRoomStub(env: Env, roomId: string) {
  const id = env.RETRO_ROOM.idFromName(roomId);
  return env.RETRO_ROOM.get(id);
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // POST /api/rooms - Create a new room
    if (url.pathname === "/api/rooms" && request.method === "POST") {
      const roomId = generateRoomId();
      const stub = getRoomStub(env, roomId);
      await stub.initRoom(roomId);
      return Response.json({ roomId });
    }

    // GET /api/rooms - API health/info
    if (url.pathname === "/api/rooms" && request.method === "GET") {
      return Response.json({ message: "Retro Board API" });
    }

    // POST /api/rooms/:roomId/join - Join a room
    const joinMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/join$/);
    if (joinMatch && request.method === "POST") {
      const roomId = joinMatch[1]!;
      const body = await request.json() as { participantId: string; displayName: string };
      const stub = getRoomStub(env, roomId);
      const response = await stub.fetch(new Request(`http://do/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }));
      return response;
    }

    // GET /api/rooms/:roomId - Get room state
    const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (roomMatch && request.method === "GET") {
      const roomId = roomMatch[1]!;
      const stub = getRoomStub(env, roomId);
      const hasRoom = await stub.hasRoom();
      if (!hasRoom) {
        return Response.json({ error: "Room not found" }, { status: 404 });
      }
      const state = await stub.getRoomState();
      return Response.json(state);
    }

    // POST /api/rooms/:roomId/vote-budget - Set vote budget
    const voteBudgetMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/vote-budget$/);
    if (voteBudgetMatch && request.method === "POST") {
      const roomId = voteBudgetMatch[1]!;
      const body = await request.json() as { participantId: string; budget: number };
      const stub = getRoomStub(env, roomId);
      const response = await stub.fetch(new Request(`http://do/vote-budget`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }));
      return response;
    }

    // WebSocket upgrade: /api/rooms/:roomId/ws
    const wsMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/ws$/);
    if (wsMatch && request.headers.get("Upgrade") === "websocket") {
      const roomId = wsMatch[1]!;
      const stub = getRoomStub(env, roomId);
      const newUrl = new URL(request.url);
      newUrl.pathname = "/ws";
      return stub.fetch(new Request(newUrl, request));
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
