import { Effect } from "effect";

export const turnstileFailure = "Verification failed. Please retry and create the room again.";
export const missingTurnstileTokenError = "Verification is required before creating a room.";

export interface TurnstileConfig {
  secret?: string;
  fetcher?: typeof fetch;
}

export type TurnstileResult =
  | { success: true }
  | { success: false; error: string };

export function verifyTurnstileTokenEffect(
  config: TurnstileConfig,
  token: unknown,
  remoteIp: string,
): Effect.Effect<TurnstileResult> {
  if (!config.secret) return Effect.succeed({ success: true });
  if (typeof token !== "string" || token.trim().length === 0) {
    return Effect.succeed({ success: false, error: missingTurnstileTokenError });
  }

  const formData = new FormData();
  formData.append("secret", config.secret);
  formData.append("response", token);
  if (remoteIp !== "unknown") {
    formData.append("remoteip", remoteIp);
  }

  return Effect.gen(function* () {
    const siteverifyFetch = config.fetcher ?? fetch;
    const response = yield* Effect.promise(() =>
      siteverifyFetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        body: formData,
      }).catch(() => undefined),
    );
    if (!response) return { success: false, error: turnstileFailure };

    const result = yield* Effect.promise(() => (response.json() as Promise<{ success?: boolean } | null>).catch(() => null));
    return result?.success === true
      ? { success: true }
      : { success: false, error: turnstileFailure };
  });
}

export function verifyTurnstileToken(
  config: TurnstileConfig,
  token: unknown,
  remoteIp: string,
): Promise<TurnstileResult> {
  return Effect.runPromise(verifyTurnstileTokenEffect(config, token, remoteIp));
}
