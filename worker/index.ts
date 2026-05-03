import type { RetroRoom } from "./retro-room";
import { hasProductionAntiAbuseConfig } from "./anti-abuse";
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

export interface WorkerFetchDeps {
  createRoom(request: Request, env: Env, url: URL): Effect.Effect<Response>;
  roomApi(request: Request, env: Env, url: URL): Effect.Effect<Response | null>;
  fetchAsset(env: Env, request: Request): Effect.Effect<Response | null>;
  withSecurityHeaders(response: Response): Effect.Effect<Response>;
}

export const workerFetchDeps: WorkerFetchDeps = {
  createRoom: handleCreateRoomRequestEffect,
  roomApi: handleRoomApiRequestEffect,
  fetchAsset: (env, request) =>
    Effect.promise(async () => env.ASSETS?.fetch(request) ?? null),
  withSecurityHeaders: withSecurityHeadersEffect,
};

export function handleWorkerFetchEffect(
  request: Request,
  env: Env,
  deps: WorkerFetchDeps = workerFetchDeps,
): Effect.Effect<Response> {
  return Effect.gen(function* () {
    const url = new URL(request.url);
    const { pathname, method } = {
      pathname: url.pathname,
      method: request.method,
    };

    if (pathname === "/api/config" && method === "GET") {
      const turnstileSiteKey = hasProductionAntiAbuseConfig(env)
        ? env.TURNSTILE_SITE_KEY
        : null;
      return Response.json({ turnstileSiteKey });
    }

    if (pathname === "/api/rooms") {
      if (method === "POST") {
        return yield* deps.createRoom(request, env, url);
      }
      if (method === "GET") {
        return Response.json({ message: "Retro Board API" });
      }
    }

    const roomApiResponse = yield* deps.roomApi(request, env, url);
    if (roomApiResponse) return roomApiResponse;

    if (pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
    }

    const assetResponse = yield* deps.fetchAsset(env, request);
    return assetResponse
      ? yield* deps.withSecurityHeaders(assetResponse)
      : new Response("Not found", { status: 404 });
  });
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    return Effect.runPromise(handleWorkerFetchEffect(request, env));
  },
} satisfies ExportedHandler<Env>;
