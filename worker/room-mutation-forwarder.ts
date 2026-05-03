import { Effect, Schema } from "effect";

import { readValidatedJsonBodyEffect } from "./http-effect";

const MAX_JSON_BODY_BYTES = 32 * 1024;

export function forwardValidatedRoomMutationEffect<T>(
  request: Request,
  schema: Schema.Schema<T>,
  forward: (body: T) => Promise<Response>,
): Effect.Effect<Response> {
  return Effect.gen(function* () {
    const body = yield* readValidatedJsonBodyEffect(request, schema, { maxBytes: MAX_JSON_BODY_BYTES });
    if (body instanceof Response) return body;

    return yield* Effect.promise(() => forward(body));
  });
}
