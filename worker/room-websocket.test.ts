import { describe, expect, it } from "vitest";

import { handleRoomWebSocketRequest } from "./room-websocket";

describe("room websocket request handling", () => {
  it("ignores non-websocket requests", async () => {
    const response = await handleRoomWebSocketRequest({} as never, new Request("https://example.test/room"));

    expect(response).toBeNull();
  });
});
