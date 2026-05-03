import { Effect, Schema } from "effect";
import { generateRoomId as defaultGenerateRoomId } from "../src/domain";
import {
  hasProductionAntiAbuseConfig,
  isLocalRequest,
  rateLimitRoomCreateEffect,
} from "./anti-abuse";
import { readJsonBodyEffect } from "./http-effect";
import { CreateRoomRequestSchema } from "./room-request-schemas";
import { verifyTurnstileTokenEffect } from "./turnstile";
import type { Env } from "./index";

const MAX_JSON_BODY_BYTES = 32 * 1024;

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

    const rawBody = yield* readJsonBodyEffect<unknown>(request, { maxBytes: MAX_JSON_BODY_BYTES });
    const body = rawBody === null
      ? {}
      : yield* Schema.decodeUnknown(CreateRoomRequestSchema)(rawBody).pipe(
          Effect.catchAll(() => Effect.succeed({})),
        );
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
