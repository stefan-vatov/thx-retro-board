import { Effect, Schema } from "effect";

import { readJsonBodyEffect } from "./http-effect";
import { CreateRoomRequestSchema } from "./room-request-schemas";

const MAX_JSON_BODY_BYTES = 32 * 1024;

type CreateRoomBody = typeof CreateRoomRequestSchema.Type;

export function readCreateRoomBodyEffect(request: Request): Effect.Effect<CreateRoomBody> {
  return Effect.gen(function* () {
    const rawBody = yield* readJsonBodyEffect<unknown>(request, { maxBytes: MAX_JSON_BODY_BYTES });
    if (rawBody === null) return {};

    return yield* Schema.decodeUnknown(CreateRoomRequestSchema)(rawBody).pipe(
      Effect.catchAll(() => Effect.succeed({})),
    );
  });
}
