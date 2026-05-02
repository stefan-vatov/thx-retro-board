import { Effect } from "effect";
import type { ApiError, PublicConfig } from "../api";

export function loadHomePublicConfigEffect(
  source: Effect.Effect<PublicConfig, ApiError | Error>,
): Effect.Effect<PublicConfig> {
  return source.pipe(
    Effect.catchAll(() => Effect.succeed({ turnstileSiteKey: null })),
  );
}
