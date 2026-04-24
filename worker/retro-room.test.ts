// @ts-expect-error -- cloudflare:workers vitest module
import { env } from "cloudflare:workers";
import { describe, it, expect } from "vitest";

describe("RetroRoom Durable Object", () => {
  it("responds to sayHello RPC", async () => {
    const id = env.RETRO_ROOM.idFromName("test-room-hello");
    const stub = env.RETRO_ROOM.get(id);
    const greeting = await stub.sayHello();
    expect(greeting).toBe("Hello from RetroRoom!");
  });

  it("isolates rooms by name", async () => {
    const stub1 = env.RETRO_ROOM.get(env.RETRO_ROOM.idFromName("room-a"));
    const stub2 = env.RETRO_ROOM.get(env.RETRO_ROOM.idFromName("room-b"));
    const g1 = await stub1.sayHello();
    const g2 = await stub2.sayHello();
    expect(g1).toBe(g2);
  });
});
