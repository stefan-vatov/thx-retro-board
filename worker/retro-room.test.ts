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

  describe("setPhase", () => {
    async function setupRoomWithFacilitator(roomId: string) {
      const id = env.RETRO_ROOM.idFromName(roomId);
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom(roomId);
      await stub.join("fac1", "Facilitator");
      return stub;
    }

    it("facilitator can advance from write to organise", async () => {
      const stub = await setupRoomWithFacilitator("test-phase-write-organise");
      const result = await stub.setPhase("fac1", "organise");
      expect(result.success).toBe(true);

      const state = await stub.getRoomState();
      expect(state.phase).toBe("organise");
    });

    it("facilitator can advance from organise to vote", async () => {
      const stub = await setupRoomWithFacilitator("test-phase-organise-vote");
      await stub.setPhase("fac1", "organise");
      const result = await stub.setPhase("fac1", "vote");
      expect(result.success).toBe(true);

      const state = await stub.getRoomState();
      expect(state.phase).toBe("vote");
    });

    it("facilitator can advance from vote to review", async () => {
      const stub = await setupRoomWithFacilitator("test-phase-vote-review");
      await stub.setPhase("fac1", "organise");
      await stub.setPhase("fac1", "vote");
      const result = await stub.setPhase("fac1", "review");
      expect(result.success).toBe(true);

      const state = await stub.getRoomState();
      expect(state.phase).toBe("review");
    });

    it("non-facilitator cannot change phase", async () => {
      const stub = await setupRoomWithFacilitator("test-phase-nonfac");
      await stub.join("p2", "Bob");
      const result = await stub.setPhase("p2", "organise");
      expect(result.success).toBe(false);
      expect(result.error).toContain("facilitator");

      const state = await stub.getRoomState();
      expect(state.phase).toBe("write");
    });

    it("cannot skip phases", async () => {
      const stub = await setupRoomWithFacilitator("test-phase-skip");
      const result = await stub.setPhase("fac1", "vote");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot transition");

      const state = await stub.getRoomState();
      expect(state.phase).toBe("write");
    });

    it("cannot go backwards in phase", async () => {
      const stub = await setupRoomWithFacilitator("test-phase-back");
      await stub.setPhase("fac1", "organise");
      const result = await stub.setPhase("fac1", "write");
      expect(result.success).toBe(false);

      const state = await stub.getRoomState();
      expect(state.phase).toBe("organise");
    });

    it("unknown participant cannot change phase", async () => {
      const stub = await setupRoomWithFacilitator("test-phase-unknown");
      const result = await stub.setPhase("unknown-pid", "organise");
      expect(result.success).toBe(false);

      const state = await stub.getRoomState();
      expect(state.phase).toBe("write");
    });

    it("after phase change, stale add-item is rejected", async () => {
      const stub = await setupRoomWithFacilitator("test-phase-stale-add");
      await stub.addItem("fac1", "Valid write item");
      await stub.setPhase("fac1", "organise");
      const result = await stub.addItem("fac1", "Stale item");
      expect(result.success).toBe(false);
      expect(result.error).toContain("write phase");

      const state = await stub.getRoomState();
      expect(state.items).toHaveLength(1);
      expect(state.items[0]!.text).toBe("Valid write item");
    });
  });

  describe("reconnect broadcast", () => {
    it("re-joining existing participant does not duplicate membership", async () => {
      const roomId = "test-reconnect-no-dupe";
      const id = env.RETRO_ROOM.idFromName(roomId);
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom(roomId);

      await stub.join("p1", "Alice");
      await stub.join("p2", "Bob");

      // Re-join Alice
      const result = await stub.join("p1", "Alice");
      expect(result.success).toBe(true);

      const state = await stub.getRoomState();
      const aliceCount = state.participants.filter((p) => p.id === "p1").length;
      expect(aliceCount).toBe(1);
      expect(state.participants).toHaveLength(2);
    });

    it("re-join returns a new token and room state", async () => {
      const roomId = "test-reconnect-token";
      const id = env.RETRO_ROOM.idFromName(roomId);
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom(roomId);

      const first = await stub.join("p1", "Alice");
      const second = await stub.join("p1", "Alice");
      expect(second.success).toBe(true);
      expect(second.connectionToken).not.toBe(first.connectionToken);
      expect(second.state).toBeDefined();
    });
  });

  describe("reconnect identity persistence", () => {
    it("reconnect reuses same participant identity without creating duplicate", async () => {
      const roomId = "test-reconnect-identity";
      const id = env.RETRO_ROOM.idFromName(roomId);
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom(roomId);

      // Alice joins, adds an item
      await stub.join("p1", "Alice");
      await stub.addItem("p1", "Item from Alice");

      // Bob joins
      await stub.join("p2", "Bob");

      // Alice disconnects and reconnects (simulated by re-joining with same participantId)
      const rejoinResult = await stub.join("p1", "Alice");
      expect(rejoinResult.success).toBe(true);
      expect(rejoinResult.connectionToken).toBeDefined();

      // No duplicate membership
      const state = await stub.getRoomState();
      expect(state.participants).toHaveLength(2);
      const aliceCount = state.participants.filter((p) => p.id === "p1").length;
      expect(aliceCount).toBe(1);

      // Alice's items are still there
      expect(state.items).toHaveLength(1);
      expect(state.items[0]!.authorId).toBe("p1");
    });

    it("reconnect with new token can open WebSocket", async () => {
      const roomId = "test-reconnect-ws";
      const id = env.RETRO_ROOM.idFromName(roomId);
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom(roomId);

      const firstJoin = await stub.join("p1", "Alice");
      await stub.join("p2", "Bob");

      // Alice reconnects and gets a new token
      const rejoinResult = await stub.join("p1", "Alice");
      expect(rejoinResult.success).toBe(true);
      const newToken = rejoinResult.connectionToken!;

      // Old token should be invalid (replaced)
      const oldWsRes = await stub.fetch(new Request(`http://do/ws?pid=p1&token=${encodeURIComponent(firstJoin.connectionToken!)}`, {
        headers: { Upgrade: "websocket" },
      }));
      expect(oldWsRes.status).toBe(403);

      // New token should work
      const newWsRes = await stub.fetch(new Request(`http://do/ws?pid=p1&token=${encodeURIComponent(newToken)}`, {
        headers: { Upgrade: "websocket" },
      }));
      expect(newWsRes.status).toBe(101);
    });

    it("reconnecting participant presence is broadcast to other clients", async () => {
      const roomId = "test-reconnect-broadcast";
      const id = env.RETRO_ROOM.idFromName(roomId);
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom(roomId);

      await stub.join("p1", "Alice");
      const bobJoin = await stub.join("p2", "Bob");

      // Connect Bob's WebSocket
      const bobWsRes = await stub.fetch(new Request(`http://do/ws?pid=p2&token=${encodeURIComponent(bobJoin.connectionToken!)}`, {
        headers: { Upgrade: "websocket" },
      }));
      expect(bobWsRes.status).toBe(101);
      const bobWs = bobWsRes.webSocket!;
      bobWs.accept();

      const messages: string[] = [];
      bobWs.addEventListener("message", (e) => {
        messages.push(e.data as string);
      });

      // Alice reconnects (which broadcasts participant-joined to others)
      await stub.join("p1", "Alice");

      // Wait for messages to propagate
      await new Promise((r) => setTimeout(r, 50));

      // Bob should receive a participant-joined broadcast for Alice's reconnect
      const joinedMsg = messages.find((m) => {
        try {
          const parsed = JSON.parse(m);
          return parsed.type === "participant-joined" && parsed.participant?.id === "p1";
        } catch { return false; }
      });
      expect(joinedMsg).toBeDefined();
    });
  });

  describe("organise phase", () => {
    async function setupOrganiseRoom(roomId: string) {
      const id = env.RETRO_ROOM.idFromName(roomId);
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom(roomId);
      await stub.join("fac1", "Facilitator");
      await stub.join("p2", "Bob");
      await stub.addItem("fac1", "Item A");
      await stub.addItem("fac1", "Item B");
      await stub.addItem("fac1", "Item C");
      await stub.setPhase("fac1", "organise");
      return stub;
    }

    it("createGroup creates a group during organise phase", async () => {
      const stub = await setupOrganiseRoom("test-create-group");
      const result = await stub.createGroup("fac1", "Process");
      expect(result.success).toBe(true);
      expect(result.group).toBeDefined();
      expect(result.group!.name).toBe("Process");

      const state = await stub.getRoomState();
      expect(state.groups).toHaveLength(1);
      expect(state.groups[0]!.name).toBe("Process");
    });

    it("createGroup rejects empty name", async () => {
      const stub = await setupOrganiseRoom("test-create-group-empty");
      const result = await stub.createGroup("fac1", "   ");
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();

      const state = await stub.getRoomState();
      expect(state.groups).toHaveLength(0);
    });

    it("createGroup is rejected outside organise phase", async () => {
      const id = env.RETRO_ROOM.idFromName("test-create-group-phase");
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom("test-create-group-phase");
      await stub.join("fac1", "Facilitator");

      const result = await stub.createGroup("fac1", "Process");
      expect(result.success).toBe(false);
      expect(result.error).toContain("organise phase");
    });

    it("any participant can create a group during organise", async () => {
      const stub = await setupOrganiseRoom("test-create-group-any");
      const result = await stub.createGroup("p2", "Team");
      expect(result.success).toBe(true);
      expect(result.group!.name).toBe("Team");
    });

    it("reorderItems reorders items during organise phase", async () => {
      const stub = await setupOrganiseRoom("test-reorder-items");
      const state0 = await stub.getRoomState();
      const ids = state0.items.map((i) => i.id);

      const result = await stub.reorderItems("fac1", [ids[2]!, ids[0]!, ids[1]!]);
      expect(result.success).toBe(true);

      const state = await stub.getRoomState();
      expect(state.items.map((i) => i.text)).toEqual(["Item C", "Item A", "Item B"]);
    });

    it("reorderItems is rejected outside organise phase", async () => {
      const id = env.RETRO_ROOM.idFromName("test-reorder-items-phase");
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom("test-reorder-items-phase");
      await stub.join("fac1", "Facilitator");
      await stub.addItem("fac1", "Item A");
      await stub.addItem("fac1", "Item B");

      const result = await stub.reorderItems("fac1", ["id-b", "id-a"]);
      expect(result.success).toBe(false);
      expect(result.error).toContain("organise phase");
    });

    it("reorderGroups reorders groups during organise phase", async () => {
      const stub = await setupOrganiseRoom("test-reorder-groups");
      await stub.createGroup("fac1", "Group A");
      await stub.createGroup("fac1", "Group B");

      const state0 = await stub.getRoomState();
      const gIds = state0.groups.map((g) => g.id);

      const result = await stub.reorderGroups("fac1", [gIds[1]!, gIds[0]!]);
      expect(result.success).toBe(true);

      const state = await stub.getRoomState();
      expect(state.groups.map((g) => g.name)).toEqual(["Group B", "Group A"]);
    });

    it("reorderGroups is rejected outside organise phase", async () => {
      const id = env.RETRO_ROOM.idFromName("test-reorder-groups-phase");
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom("test-reorder-groups-phase");
      await stub.join("fac1", "Facilitator");

      const result = await stub.reorderGroups("fac1", ["g1", "g2"]);
      expect(result.success).toBe(false);
      expect(result.error).toContain("organise phase");
    });

    it("moveItemToGroup moves an item into a group", async () => {
      const stub = await setupOrganiseRoom("test-move-item-group");
      const groupResult = await stub.createGroup("fac1", "Process");
      const groupId = groupResult.group!.id;

      const state0 = await stub.getRoomState();
      const itemId = state0.items[0]!.id;

      const result = await stub.moveItemToGroup("fac1", itemId, groupId, 0);
      expect(result.success).toBe(true);

      const state = await stub.getRoomState();
      const moved = state.items.find((i) => i.id === itemId);
      expect(moved?.groupId).toBe(groupId);
    });

    it("moveItemToGroup moves item to ungrouped (null)", async () => {
      const stub = await setupOrganiseRoom("test-move-item-ungrouped");
      const groupResult = await stub.createGroup("fac1", "Process");
      const groupId = groupResult.group!.id;

      const state0 = await stub.getRoomState();
      const itemId = state0.items[0]!.id;

      await stub.moveItemToGroup("fac1", itemId, groupId, 0);
      const result = await stub.moveItemToGroup("fac1", itemId, null, 0);
      expect(result.success).toBe(true);

      const state = await stub.getRoomState();
      const moved = state.items.find((i) => i.id === itemId);
      expect(moved?.groupId).toBeNull();
    });

    it("moveItemToGroup is rejected outside organise phase", async () => {
      const id = env.RETRO_ROOM.idFromName("test-move-item-phase");
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom("test-move-item-phase");
      await stub.join("fac1", "Facilitator");
      await stub.addItem("fac1", "Item A");

      const result = await stub.moveItemToGroup("fac1", "fake-id", "g1", 0);
      expect(result.success).toBe(false);
      expect(result.error).toContain("organise phase");
    });

    it("moveItemToGroup rejects unknown item", async () => {
      const stub = await setupOrganiseRoom("test-move-item-unknown");
      await stub.createGroup("fac1", "Process");

      const result = await stub.moveItemToGroup("fac1", "nonexistent", null, 0);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Item not found");
    });

    it("moveItemToGroup rejects unknown group", async () => {
      const stub = await setupOrganiseRoom("test-move-item-unknown-group");
      const state0 = await stub.getRoomState();
      const itemId = state0.items[0]!.id;

      const result = await stub.moveItemToGroup("fac1", itemId, "nonexistent-group", 0);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Group not found");
    });

    it("duplicate text items remain distinct through organisation", async () => {
      const id = env.RETRO_ROOM.idFromName("test-dup-organise");
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom("test-dup-organise");
      await stub.join("fac1", "Facilitator");
      await stub.addItem("fac1", "Same text");
      await stub.addItem("fac1", "Same text");
      await stub.setPhase("fac1", "organise");

      const state0 = await stub.getRoomState();
      expect(state0.items).toHaveLength(2);

      const groupResult = await stub.createGroup("fac1", "Group");
      const groupId = groupResult.group!.id;

      // Move first duplicate only
      const firstDup = state0.items[0]!;
      const result = await stub.moveItemToGroup("fac1", firstDup.id, groupId, 0);
      expect(result.success).toBe(true);

      const state = await stub.getRoomState();
      const inGroup = state.items.filter((i) => i.groupId === groupId);
      const ungrouped = state.items.filter((i) => i.groupId === null);
      expect(inGroup).toHaveLength(1);
      expect(ungrouped).toHaveLength(1);
      expect(inGroup[0]!.id).toBe(firstDup.id);
    });

    it("any participant can reorder items during organise", async () => {
      const stub = await setupOrganiseRoom("test-any-reorder");
      const state0 = await stub.getRoomState();
      const ids = state0.items.map((i) => i.id);

      const result = await stub.reorderItems("p2", [ids[2]!, ids[1]!, ids[0]!]);
      expect(result.success).toBe(true);

      const state = await stub.getRoomState();
      expect(state.items.map((i) => i.text)).toEqual(["Item C", "Item B", "Item A"]);
    });

    it("empty organise phase is graceful with no items", async () => {
      const id = env.RETRO_ROOM.idFromName("test-empty-organise");
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom("test-empty-organise");
      await stub.join("fac1", "Facilitator");
      await stub.setPhase("fac1", "organise");

      const state = await stub.getRoomState();
      expect(state.phase).toBe("organise");
      expect(state.items).toEqual([]);
      expect(state.groups).toEqual([]);
    });

    it("organisation is blocked during vote phase", async () => {
      const id = env.RETRO_ROOM.idFromName("test-org-blocked-vote");
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom("test-org-blocked-vote");
      await stub.join("fac1", "Facilitator");
      await stub.addItem("fac1", "Item A");
      await stub.setPhase("fac1", "organise");
      await stub.setPhase("fac1", "vote");

      const r1 = await stub.createGroup("fac1", "Group");
      const r2 = await stub.reorderItems("fac1", ["id-a"]);
      const r3 = await stub.reorderGroups("fac1", []);
      const r4 = await stub.moveItemToGroup("fac1", "id-a", null, 0);

      expect(r1.success).toBe(false);
      expect(r2.success).toBe(false);
      expect(r3.success).toBe(false);
      expect(r4.success).toBe(false);
    });

    it("organisation is blocked during review phase", async () => {
      const id = env.RETRO_ROOM.idFromName("test-org-blocked-review");
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom("test-org-blocked-review");
      await stub.join("fac1", "Facilitator");
      await stub.addItem("fac1", "Item A");
      await stub.setPhase("fac1", "organise");
      await stub.setPhase("fac1", "vote");
      await stub.setPhase("fac1", "review");

      const r1 = await stub.createGroup("fac1", "Group");
      expect(r1.success).toBe(false);
    });

    it("groups and item order persist after state save", async () => {
      const stub = await setupOrganiseRoom("test-org-persist");
      await stub.createGroup("fac1", "Group A");

      const state0 = await stub.getRoomState();
      const groupId = state0.groups[0]!.id;

      // Move item A into the group
      await stub.moveItemToGroup("fac1", state0.items[0]!.id, groupId, 0);

      // Read back from storage
      const state = await stub.getRoomState();
      expect(state.groups).toHaveLength(1);
      expect(state.groups[0]!.name).toBe("Group A");
      const grouped = state.items.filter((i) => i.groupId === groupId);
      expect(grouped).toHaveLength(1);
    });
  });
});
