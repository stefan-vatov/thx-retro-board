import { Effect } from "effect";
import { generateRoomId as defaultGenerateRoomId } from "../src/domain";
import {
  hasProductionAntiAbuseConfig,
  isLocalRequest,
  rateLimitRoomCreateEffect,
} from "./anti-abuse";
import { readCreateRoomBodyEffect } from "./create-room-body";
import { verifyTurnstileTokenEffect } from "./turnstile";
import type { Env } from "./index";

export interface CreateRoomRequestDeps {
  generateRoomId: () => string;
  generateFacilitatorClaimToken: () => string;
}

export const createRoomRequestDeps: CreateRoomRequestDeps = {
  generateRoomId: defaultGenerateRoomId,
  generateFacilitatorClaimToken: () =>
    crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", ""),
};

export function handleCreateRoomRequestEffect(
  request: Request,
  env: Env,
  url: URL,
  deps: CreateRoomRequestDeps = createRoomRequestDeps,
): Effect.Effect<Response> {
  return Effect.gen(function* () {
    if (!isLocalRequest(url) && !hasProductionAntiAbuseConfig(env)) {
      return Response.json({ error: "Room creation is temporarily unavailable." }, { status: 503 });
    }

    const createLimit = yield* rateLimitRoomCreateEffect(env, request);
    if (createLimit) return createLimit;

    const body = yield* readCreateRoomBodyEffect(request);
    const clientIp = request.headers.get("CF-Connecting-IP");
    const turnstile = yield* verifyTurnstileTokenEffect(
      { secret: env.TURNSTILE_SECRET_KEY },
      body.turnstileToken,
      clientIp ?? "unknown",
    );

    if (!turnstile.success) {
      return Response.json({ error: turnstile.error }, { status: 403 });
    }

    const roomId = deps.generateRoomId();
    const facilitatorClaimToken = deps.generateFacilitatorClaimToken();
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    yield* Effect.promise(() => stub.initRoom(roomId, facilitatorClaimToken));

    return Response.json({ roomId, facilitatorClaimToken });
  });
}
