import { Effect } from "effect";

type RateLimiterBinding = {
  limit(input: { key: string }): Promise<{ success: boolean }>;
};

export interface AntiAbuseEnv {
  ROOM_CREATE_RATE_LIMITER?: RateLimiterBinding;
  ROOM_ACCESS_RATE_LIMITER?: RateLimiterBinding;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}

export function isLocalRequest(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
}

export function isLocalRequestEffect(url: URL): Effect.Effect<boolean> {
  return Effect.sync(() => isLocalRequest(url));
}

export function hasProductionAntiAbuseConfig(env: AntiAbuseEnv): boolean {
  return Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY && env.ROOM_CREATE_RATE_LIMITER && env.ROOM_ACCESS_RATE_LIMITER);
}

export function hasProductionAntiAbuseConfigEffect(env: AntiAbuseEnv): Effect.Effect<boolean> {
  return Effect.sync(() => hasProductionAntiAbuseConfig(env));
}

export function getRateLimitKey(request: Request, url: URL, prefix: string): string | null {
  if (isLocalRequest(url)) return null;
  const clientIp = request.headers.get("CF-Connecting-IP");
  return `${prefix}:${clientIp && clientIp.trim().length > 0 ? clientIp : "unknown"}`;
}

export function getRateLimitKeyEffect(request: Request, url: URL, prefix: string): Effect.Effect<string | null> {
  return Effect.sync(() => getRateLimitKey(request, url, prefix));
}

export function rateLimitRoomAccessEffect(
  env: AntiAbuseEnv,
  request: Request,
): Effect.Effect<Response | null> {
  const url = new URL(request.url);
  const key = getRateLimitKey(request, url, "room-access");
  if (!env.ROOM_ACCESS_RATE_LIMITER || !key) return Effect.succeed(null);

  return Effect.promise(async () => {
    const { success } = await env.ROOM_ACCESS_RATE_LIMITER!.limit({ key });
    return success
      ? null
      : Response.json({ error: "Too many room attempts from this network. Please wait a minute and try again." }, { status: 429 });
  });
}

export function rateLimitRoomAccess(env: AntiAbuseEnv, request: Request): Promise<Response | null> {
  return Effect.runPromise(rateLimitRoomAccessEffect(env, request));
}

export function rateLimitRoomCreateEffect(
  env: AntiAbuseEnv,
  request: Request,
): Effect.Effect<Response | null> {
  const url = new URL(request.url);
  const key = getRateLimitKey(request, url, "room-create");
  if (!env.ROOM_CREATE_RATE_LIMITER || !key) return Effect.succeed(null);

  return Effect.promise(async () => {
    const { success } = await env.ROOM_CREATE_RATE_LIMITER!.limit({ key });
    return success
      ? null
      : Response.json(
          { error: "Too many rooms created from this network. Please wait a minute and try again." },
          { status: 429 },
        );
  });
}
