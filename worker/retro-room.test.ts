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

  it("initializes room state", async () => {
    const roomId = "test-init-room";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    await stub.initRoom(roomId);
    const state = await stub.getRoomState();
    expect(state.roomId).toBe(roomId);
    expect(state.phase).toBe("write");
    expect(state.participants).toEqual([]);
    expect(state.voteBudget).toBe(5);
    expect(state.version).toBe(1);
  });

  it("detects if room exists", async () => {
    const roomId = "test-has-room";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    expect(await stub.hasRoom()).toBe(false);
    await stub.initRoom(roomId);
    expect(await stub.hasRoom()).toBe(true);
  });

  it("allows participant to join with valid name", async () => {
    const roomId = "test-join-room";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    await stub.initRoom(roomId);

    const result = await stub.join("p1", "Alice");
    expect(result.success).toBe(true);
    expect(result.state?.participants).toHaveLength(1);
    expect(result.state?.participants[0]?.displayName).toBe("Alice");
    expect(result.state?.participants[0]?.isFacilitator).toBe(true);
  });

  it("rejects blank display name", async () => {
    const roomId = "test-blank-name";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    await stub.initRoom(roomId);

    const result = await stub.join("p1", "   ");
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("second participant is not facilitator", async () => {
    const roomId = "test-second-join";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    await stub.initRoom(roomId);

    await stub.join("p1", "Alice");
    const result = await stub.join("p2", "Bob");
    expect(result.success).toBe(true);
    expect(result.state?.participants).toHaveLength(2);
    const bob = result.state?.participants.find((p) => p.id === "p2");
    expect(bob?.isFacilitator).toBe(false);
  });

  it("facilitator can set vote budget", async () => {
    const roomId = "test-vote-budget";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    await stub.initRoom(roomId);
    await stub.join("p1", "Alice");

    const result = await stub.setVoteBudget("p1", 10);
    expect(result.success).toBe(true);
    const state = await stub.getRoomState();
    expect(state.voteBudget).toBe(10);
  });

  it("non-facilitator cannot set vote budget", async () => {
    const roomId = "test-vote-budget-deny";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    await stub.initRoom(roomId);
    await stub.join("p1", "Alice");
    await stub.join("p2", "Bob");

    const result = await stub.setVoteBudget("p2", 10);
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("isolates rooms by name", async () => {
    const stub1 = env.RETRO_ROOM.get(env.RETRO_ROOM.idFromName("room-a"));
    const stub2 = env.RETRO_ROOM.get(env.RETRO_ROOM.idFromName("room-b"));
    const g1 = await stub1.sayHello();
    const g2 = await stub2.sayHello();
    expect(g1).toBe(g2);
  });

  it("join returns a connection token", async () => {
    const roomId = "test-conn-token";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    await stub.initRoom(roomId);

    const result = await stub.join("p1", "Alice");
    expect(result.success).toBe(true);
    expect(typeof result.connectionToken).toBe("string");
    expect(result.connectionToken!.length).toBeGreaterThan(0);
  });

  it("re-joining returns a new connection token", async () => {
    const roomId = "test-conn-token-rejoin";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    await stub.initRoom(roomId);

    const result1 = await stub.join("p1", "Alice");
    const result2 = await stub.join("p1", "Alice");
    expect(result2.success).toBe(true);
    expect(result2.connectionToken).toBeDefined();
    expect(result2.connectionToken).not.toBe(result1.connectionToken);
  });

  it("version increments on each state mutation", async () => {
    const roomId = "test-version-incr";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    await stub.initRoom(roomId);

    const state0 = await stub.getRoomState();
    const v0 = state0.version;

    await stub.join("p1", "Alice");
    const state1 = await stub.getRoomState();
    expect(state1.version).toBeGreaterThan(v0);

    await stub.setVoteBudget("p1", 8);
    const state2 = await stub.getRoomState();
    expect(state2.version).toBeGreaterThan(state1.version);
  });

  it("rejects WebSocket without pid and token", async () => {
    const roomId = "test-ws-auth-missing";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    await stub.initRoom(roomId);
    await stub.join("p1", "Alice");

    const response = await stub.fetch(new Request("http://do/ws", {
      headers: { Upgrade: "websocket" },
    }));
    expect(response.status).toBe(400);
  });

  it("rejects WebSocket with wrong token", async () => {
    const roomId = "test-ws-auth-wrong";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    await stub.initRoom(roomId);
    await stub.join("p1", "Alice");

    const response = await stub.fetch(new Request("http://do/ws?pid=p1&token=wrong-token", {
      headers: { Upgrade: "websocket" },
    }));
    expect(response.status).toBe(403);
  });

  it("rejects WebSocket for unknown participant", async () => {
    const roomId = "test-ws-auth-unknown";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    await stub.initRoom(roomId);
    await stub.join("p1", "Alice");

    const response = await stub.fetch(new Request("http://do/ws?pid=p2&token=some-token", {
      headers: { Upgrade: "websocket" },
    }));
    expect(response.status).toBe(403);
  });

  it("accepts WebSocket with correct token", async () => {
    const roomId = "test-ws-auth-correct";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    await stub.initRoom(roomId);
    const joinResult = await stub.join("p1", "Alice");
    const token = joinResult.connectionToken!;

    const response = await stub.fetch(new Request(`http://do/ws?pid=p1&token=${encodeURIComponent(token)}`, {
      headers: { Upgrade: "websocket" },
    }));
    expect(response.status).toBe(101);
    expect(response.webSocket).toBeDefined();
  });

  describe("add-item", () => {
    async function setupRoom(roomId: string) {
      const id = env.RETRO_ROOM.idFromName(roomId);
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom(roomId);
      await stub.join("p1", "Alice");
      return stub;
    }

    it("adds an item during write phase via RPC", async () => {
      const stub = await setupRoom("test-add-item-rpc");
      const result = await stub.addItem("p1", "Improve standups");
      expect(result.success).toBe(true);
      expect(result.item).toBeDefined();
      expect(result.item!.text).toBe("Improve standups");
      expect(result.item!.authorId).toBe("p1");

      const state = await stub.getRoomState();
      expect(state.items).toHaveLength(1);
      expect(state.items[0]!.text).toBe("Improve standups");
    });

    it("rejects empty item text", async () => {
      const stub = await setupRoom("test-add-item-empty");
      const result = await stub.addItem("p1", "");
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();

      const state = await stub.getRoomState();
      expect(state.items).toHaveLength(0);
    });

    it("rejects whitespace-only item text", async () => {
      const stub = await setupRoom("test-add-item-ws");
      const result = await stub.addItem("p1", "   ");
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();

      const state = await stub.getRoomState();
      expect(state.items).toHaveLength(0);
    });

    it("trims and truncates item text", async () => {
      const stub = await setupRoom("test-add-item-sanitize");
      const longText = "A".repeat(600);
      const result = await stub.addItem("p1", `  ${longText}  `);
      expect(result.success).toBe(true);
      expect(result.item!.text).toBe("A".repeat(500));
    });

    it("adds multiple distinct items", async () => {
      const stub = await setupRoom("test-add-multi");
      const r1 = await stub.addItem("p1", "Item A");
      const r2 = await stub.addItem("p1", "Item B");
      const r3 = await stub.addItem("p1", "Item C");

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(r3.success).toBe(true);

      const state = await stub.getRoomState();
      expect(state.items).toHaveLength(3);
      expect(state.items.map((i) => i.text)).toEqual(["Item A", "Item B", "Item C"]);
      expect(state.items.map((i) => i.id)).toEqual(
        expect.arrayContaining([r1.item!.id, r2.item!.id, r3.item!.id]),
      );
    });

    it("items persist in storage after being added", async () => {
      const roomId = "test-add-item-persist";
      const id = env.RETRO_ROOM.idFromName(roomId);
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom(roomId);
      await stub.join("p1", "Alice");
      await stub.addItem("p1", "Persisted item");

      const state = await stub.getRoomState();
      expect(state.items).toHaveLength(1);
      expect(state.items[0]!.text).toBe("Persisted item");
    });

    it("preserves items across multiple participants", async () => {
      const stub = await setupRoom("test-add-multi-auth");
      await stub.join("p2", "Bob");

      await stub.addItem("p1", "From Alice");
      await stub.addItem("p2", "From Bob");

      const state = await stub.getRoomState();
      expect(state.items).toHaveLength(2);
      expect(state.items[0]!.authorId).toBe("p1");
      expect(state.items[1]!.authorId).toBe("p2");
    });

    it("rejects add-item outside write phase", async () => {
      const stub = await setupRoom("test-add-out-phase");
      await stub.addItem("p1", "Valid item");
      await stub.setPhaseForTest("organise");

      const result = await stub.addItem("p1", "Should fail");
      expect(result.success).toBe(false);
      expect(result.error).toContain("write phase");

      const state = await stub.getRoomState();
      expect(state.items).toHaveLength(1);
      expect(state.items[0]!.text).toBe("Valid item");
    });

    it("rejects add-item during vote phase", async () => {
      const stub = await setupRoom("test-add-vote-phase");
      await stub.setPhaseForTest("vote");

      const result = await stub.addItem("p1", "Should fail");
      expect(result.success).toBe(false);

      const state = await stub.getRoomState();
      expect(state.items).toHaveLength(0);
    });

    it("rejects add-item during review phase", async () => {
      const stub = await setupRoom("test-add-review-phase");
      await stub.setPhaseForTest("review");

      const result = await stub.addItem("p1", "Should fail");
      expect(result.success).toBe(false);

      const state = await stub.getRoomState();
      expect(state.items).toHaveLength(0);
    });
  });
});
