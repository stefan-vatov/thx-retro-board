import type { RetroRoom } from "./retro-room";

export interface Env {
  RETRO_ROOM: DurableObjectNamespace<RetroRoom>;
}

export { RetroRoom } from "./retro-room";

export default {
  async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return Response.json({ message: "Retro Board API" });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
