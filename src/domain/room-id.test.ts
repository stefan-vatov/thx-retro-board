import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { generateRoomId, generateRoomIdEffect, ROOM_ID_LENGTH } from "./room-id";

describe("generateRoomId", () => {
  it("generates a string of the expected length", () => {
    const id = generateRoomId();
    expect(id.length).toBe(ROOM_ID_LENGTH);
  });

  it("generates unique ids on successive calls", () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateRoomId()));
    expect(ids.size).toBe(20);
  });

  it("contains only URL-safe characters", () => {
    const id = generateRoomId();
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates ids through Effect", async () => {
    const id = await Effect.runPromise(generateRoomIdEffect());

    expect(id).toHaveLength(ROOM_ID_LENGTH);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
