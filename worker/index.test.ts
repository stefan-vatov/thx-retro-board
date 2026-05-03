import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { Env } from "./index";
import { handleWorkerFetchEffect } from "./index";

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: undefined,
    RETRO_ROOM: {
      idFromName: (name: string) => ({ name }) as DurableObjectId,
      get: () => ({}) as DurableObjectStub,
    } as unknown as Env["RETRO_ROOM"],
    ...overrides,
  };
}

describe("handleWorkerFetchEffect", () => {
  it("routes static asset fallbacks through injected Effect dependencies", async () => {
    const calls: string[] = [];
    const response = await Effect.runPromise(
      handleWorkerFetchEffect(
        new Request("https://example.test/room/abc"),
        createEnv(),
        {
          createRoom: () =>
            Effect.sync(() => {
              throw new Error("create room should not be called");
            }),
          roomApi: () => Effect.succeed(null),
          fetchAsset: (_env, request) =>
            Effect.sync(() => {
              calls.push(`asset:${new URL(request.url).pathname}`);
              return new Response("asset");
            }),
          withSecurityHeaders: (assetResponse) =>
            Effect.sync(() => {
              calls.push("headers");
              return new Response(assetResponse.body, {
                status: assetResponse.status,
                headers: { "x-secured": "yes" },
              });
            }),
        },
      ),
    );

    expect(calls).toEqual(["asset:/room/abc", "headers"]);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-secured")).toBe("yes");
    await expect(response.text()).resolves.toBe("asset");
  });
});
