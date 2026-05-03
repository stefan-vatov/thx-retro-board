import type { RetroRoom } from "./retro-room";
import {
  hasProductionAntiAbuseConfig,
} from "./anti-abuse";
import { handleCreateRoomRequestEffect } from "./index-effect";
import { handleRoomApiRequestEffect } from "./index-room-route";
import { withSecurityHeadersEffect } from "./security-headers";
import { Effect } from "effect";

export interface Env {
  ASSETS?: Fetcher;
  RETRO_ROOM: DurableObjectNamespace<RetroRoom>;
  ROOM_CREATE_RATE_LIMITER?: RateLimit;
  ROOM_ACCESS_RATE_LIMITER?: RateLimit;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}

export { RetroRoom } from "./retro-room";

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
        return Effect.runPromise(handleCreateRoomRequestEffect(request, env, url));
      }
      if (method === "GET") {
        return Response.json({ message: "Retro Board API" });
      }
    }

    const roomApiResponse = await Effect.runPromise(handleRoomApiRequestEffect(request, env, url));
    if (roomApiResponse) return roomApiResponse;

    if (pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
    }

    const assetResponse = await env.ASSETS?.fetch(request);
    return assetResponse ? Effect.runPromise(withSecurityHeadersEffect(assetResponse)) : new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
