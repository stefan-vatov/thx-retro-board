import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  getRateLimitKey,
  hasProductionAntiAbuseConfig,
  rateLimitRoomCreateEffect,
  rateLimitRoomAccessEffect,
} from "./anti-abuse";

describe("anti-abuse worker helpers", () => {
  it("detects complete production anti-abuse configuration", () => {
    expect(hasProductionAntiAbuseConfig({
      TURNSTILE_SITE_KEY: "site",
      TURNSTILE_SECRET_KEY: "secret",
      ROOM_CREATE_RATE_LIMITER: { limit: async () => ({ success: true }) },
      ROOM_ACCESS_RATE_LIMITER: { limit: async () => ({ success: true }) },
    })).toBe(true);
    expect(hasProductionAntiAbuseConfig({ TURNSTILE_SITE_KEY: "site" })).toBe(false);
  });

  it("bypasses rate-limit keys locally and derives stable production keys from client IP", () => {
    const local = new Request("http://127.0.0.1/api/rooms", { headers: { "CF-Connecting-IP": "203.0.113.1" } });
    const production = new Request("https://retro.thethracian.com/api/rooms", { headers: { "CF-Connecting-IP": "203.0.113.2" } });
    const missingIp = new Request("https://retro.thethracian.com/api/rooms");

    expect(getRateLimitKey(local, new URL(local.url), "room-create")).toBeNull();
    expect(getRateLimitKey(production, new URL(production.url), "room-create")).toBe("room-create:203.0.113.2");
    expect(getRateLimitKey(missingIp, new URL(missingIp.url), "room-create")).toBe("room-create:unknown");
  });

  it("returns a controlled 429 response when room access is rate limited", async () => {
    const response = await Effect.runPromise(rateLimitRoomAccessEffect({
      ROOM_ACCESS_RATE_LIMITER: { limit: async () => ({ success: false }) },
    }, new Request("https://retro.thethracian.com/api/rooms/abcdefghijklmnopqrstu", {
      headers: { "CF-Connecting-IP": "203.0.113.3" },
    })));

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(429);
    await expect((response as Response).json()).resolves.toEqual({
      error: "Too many room attempts from this network. Please wait a minute and try again.",
    });
  });

  it("returns a controlled 429 response when room creation is rate limited", async () => {
    const response = await Effect.runPromise(rateLimitRoomCreateEffect({
      ROOM_CREATE_RATE_LIMITER: { limit: async () => ({ success: false }) },
    }, new Request("https://retro.thethracian.com/api/rooms", {
      method: "POST",
      headers: { "CF-Connecting-IP": "203.0.113.9" },
    })));

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(429);
    await expect((response as Response).json()).resolves.toEqual({
      error: "Too many rooms created from this network. Please wait a minute and try again.",
    });
  });

  it("returns null when local or allowed by the limiter", async () => {
    await expect(Effect.runPromise(rateLimitRoomAccessEffect({
      ROOM_ACCESS_RATE_LIMITER: { limit: async () => ({ success: false }) },
    }, new Request("http://localhost/api/rooms/abcdefghijklmnopqrstu")))).resolves.toBeNull();

    await expect(Effect.runPromise(rateLimitRoomAccessEffect({
      ROOM_ACCESS_RATE_LIMITER: { limit: async () => ({ success: true }) },
    }, new Request("https://retro.thethracian.com/api/rooms/abcdefghijklmnopqrstu", {
      headers: { "CF-Connecting-IP": "203.0.113.4" },
    })))).resolves.toBeNull();
  });
});
