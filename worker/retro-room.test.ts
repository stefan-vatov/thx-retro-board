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

  describe("configurable columns protocol", () => {
    async function setupColumnRoom(roomId: string) {
      const id = env.RETRO_ROOM.idFromName(roomId);
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom(roomId);
      await stub.join("fac1", "Facilitator");
      await stub.join("p2", "Bob");
      return stub;
    }

    it("new rooms start with stable default Start Stop Continue columns", async () => {
      const id = env.RETRO_ROOM.idFromName("test-columns-defaults");
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom("test-columns-defaults");

      const state = await stub.getRoomState();
      expect(state.columns).toEqual([
        { id: "start", name: "Start", order: 0 },
        { id: "stop", name: "Stop", order: 1 },
        { id: "continue", name: "Continue", order: 2 },
      ]);
      expect(state.groups).toEqual(state.columns);
    });

    it("facilitator can create edit and reorder columns with version increments", async () => {
      const stub = await setupColumnRoom("test-columns-mutate");
      const before = await stub.getRoomState();
      const create = await stub.createColumn("fac1", "  Learn  ");
      expect(create.success).toBe(true);
      expect(create.column?.name).toBe("Learn");
      expect(create.column?.id).toEqual(expect.any(String));

      const afterCreate = await stub.getRoomState();
      expect(afterCreate.version).toBeGreaterThan(before.version);
      expect(afterCreate.columns.at(-1)).toEqual(create.column);

      const edit = await stub.editColumn("fac1", create.column!.id, "Improve");
      expect(edit.success).toBe(true);
      const afterEdit = await stub.getRoomState();
      expect(afterEdit.version).toBeGreaterThan(afterCreate.version);
      expect(afterEdit.columns.find((column) => column.id === create.column!.id)?.name).toBe("Improve");

      const order = afterEdit.columns.map((column) => column.id).reverse();
      const reorder = await stub.reorderColumns("fac1", order);
      expect(reorder.success).toBe(true);
      const afterReorder = await stub.getRoomState();
      expect(afterReorder.version).toBeGreaterThan(afterEdit.version);
      expect(afterReorder.columns.map((column) => column.id)).toEqual(order);
      expect(afterReorder.columns.map((column) => column.order)).toEqual([0, 1, 2, 3]);
    });

    it("rejects non-facilitator and out-of-phase column mutations atomically", async () => {
      const stub = await setupColumnRoom("test-columns-permissions");
      const before = await stub.getRoomState();
      expect((await stub.createColumn("p2", "Blocked")).success).toBe(false);
      expect((await stub.editColumn("p2", "start", "Blocked")).success).toBe(false);
      expect((await stub.reorderColumns("p2", before.columns.map((column) => column.id).reverse())).success).toBe(false);
      expect(await stub.getRoomState()).toEqual(before);

      await stub.setPhase("fac1", "organise");
      await stub.setPhase("fac1", "vote");
      const voteState = await stub.getRoomState();
      expect((await stub.createColumn("fac1", "Blocked")).success).toBe(false);
      expect((await stub.editColumn("fac1", "start", "Blocked")).success).toBe(false);
      expect((await stub.reorderColumns("fac1", voteState.columns.map((column) => column.id).reverse())).success).toBe(false);
      expect(await stub.getRoomState()).toEqual(voteState);
    });

    it("rejects invalid column IDs and reorder payloads without version changes", async () => {
      const stub = await setupColumnRoom("test-columns-invalid");
      const before = await stub.getRoomState();
      expect((await stub.editColumn("fac1", "missing", "Name")).success).toBe(false);
      expect((await stub.reorderColumns("fac1", ["start", "start", "continue"])).success).toBe(false);
      expect((await stub.reorderColumns("fac1", ["start", "stop"])).success).toBe(false);
      expect((await stub.reorderColumns("fac1", ["start", "stop", "other"])).success).toBe(false);
      expect(await stub.getRoomState()).toEqual(before);
    });

    it("enforces the maximum configured column count without mutating state", async () => {
      const stub = await setupColumnRoom("test-columns-max-count");
      for (const name of ["One", "Two", "Three", "Four", "Five"]) {
        const result = await stub.createColumn("fac1", name);
        expect(result.success).toBe(true);
      }

      const before = await stub.getRoomState();
      expect(before.columns).toHaveLength(8);
      const result = await stub.createColumn("fac1", "Overflow");

      expect(result.success).toBe(false);
      expect(result.error).toContain("at most 8 columns");
      expect(await stub.getRoomState()).toEqual(before);
    });

    it("validates item column associations on create and move", async () => {
      const stub = await setupColumnRoom("test-columns-item-associations");
      const addInvalid = await stub.addItem("fac1", "Invalid", "missing-column");
      expect(addInvalid.success).toBe(false);
      const addValid = await stub.addItem("fac1", "In Start", "start");
      expect(addValid.success).toBe(true);
      expect(addValid.item?.columnId).toBe("start");

      await stub.setPhase("fac1", "organise");
      const beforeInvalidMove = await stub.getRoomState();
      const moveInvalid = await stub.moveItemToGroup("fac1", addValid.item!.id, "missing-column", 0);
      expect(moveInvalid.success).toBe(false);
      expect(await stub.getRoomState()).toEqual(beforeInvalidMove);
    });

    it("keeps column IDs stable across edits so item associations survive", async () => {
      const stub = await setupColumnRoom("test-columns-stable-edit");
      const itemResult = await stub.addItem("fac1", "Start doing this", "start");
      expect(itemResult.success).toBe(true);
      const edit = await stub.editColumn("fac1", "start", "Begin");
      expect(edit.success).toBe(true);
      const state = await stub.getRoomState();
      expect(state.columns.find((column) => column.id === "start")?.name).toBe("Begin");
      expect(state.items.find((item) => item.id === itemResult.item!.id)?.columnId).toBe("start");
    });

    it("normalizes legacy snapshots without columns or item column IDs", async () => {
      const id = env.RETRO_ROOM.idFromName("test-columns-legacy-normalize");
      const stub = env.RETRO_ROOM.get(id);
      await stub.seedStoredStateForTest({
        roomId: "test-columns-legacy-normalize",
        participants: [{ id: "fac1", displayName: "Facilitator", isFacilitator: true }],
        facilitatorId: "fac1",
        items: [{ id: "legacy-item", text: "Old item", authorId: "fac1", groupId: "legacy-group", order: 0 } as never],
        groups: [],
      });

      const state = await stub.getRoomState();
      expect(state.columns.map((column) => column.name)).toEqual(["Start", "Stop", "Continue"]);
      expect(state.items[0]?.columnId).toBeNull();
      expect(state.items[0]?.groupId).toBeNull();
    });
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
      expect(state.groups.map((group) => group.name)).toEqual(["Start", "Stop", "Continue", "Process"]);
      expect(state.columns).toEqual(state.groups);
    });

    it("createGroup rejects empty name", async () => {
      const stub = await setupOrganiseRoom("test-create-group-empty");
      const result = await stub.createGroup("fac1", "   ");
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();

      const state = await stub.getRoomState();
      expect(state.groups.map((group) => group.name)).toEqual(["Start", "Stop", "Continue"]);
    });

    it("createGroup is allowed during write phase for facilitators", async () => {
      const id = env.RETRO_ROOM.idFromName("test-create-group-phase");
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom("test-create-group-phase");
      await stub.join("fac1", "Facilitator");

      const result = await stub.createGroup("fac1", "Process");
      expect(result.success).toBe(true);
      expect(result.group?.name).toBe("Process");
    });

    it("non-facilitator cannot create a group during organise", async () => {
      const stub = await setupOrganiseRoom("test-create-group-any");
      const result = await stub.createGroup("p2", "Team");
      expect(result.success).toBe(false);
      expect(result.error).toContain("facilitator");
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

      const result = await stub.reorderGroups("fac1", [gIds[4]!, gIds[3]!, gIds[0]!, gIds[1]!, gIds[2]!]);
      expect(result.success).toBe(true);

      const state = await stub.getRoomState();
      expect(state.groups.map((g) => g.name)).toEqual(["Group B", "Group A", "Start", "Stop", "Continue"]);
    });

    it("reorderGroups is rejected outside organise phase", async () => {
      const id = env.RETRO_ROOM.idFromName("test-reorder-groups-phase");
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom("test-reorder-groups-phase");
      await stub.join("fac1", "Facilitator");

      const result = await stub.reorderGroups("fac1", ["g1", "g2"]);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Column reorder");
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
      expect(result.error).toContain("Column not found");
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
      expect(state.groups.map((group) => group.name)).toEqual(["Start", "Stop", "Continue"]);
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
      const groupResult = await stub.createGroup("fac1", "Group A");

      const state0 = await stub.getRoomState();
      const groupId = groupResult.group!.id;

      // Move item A into the group
      await stub.moveItemToGroup("fac1", state0.items[0]!.id, groupId, 0);

      // Read back from storage
      const state = await stub.getRoomState();
      expect(state.groups.map((group) => group.name)).toContain("Group A");
      const grouped = state.items.filter((i) => i.groupId === groupId);
      expect(grouped).toHaveLength(1);
    });

    it("reordering items within one group preserves items in other groups and ungrouped", async () => {
      const id = env.RETRO_ROOM.idFromName("test-partial-reorder-preserve");
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom("test-partial-reorder-preserve");
      await stub.join("fac1", "Facilitator");
      await stub.addItem("fac1", "G1-A");
      await stub.addItem("fac1", "G1-B");
      await stub.addItem("fac1", "G2-A");
      await stub.addItem("fac1", "G2-B");
      await stub.addItem("fac1", "Ungrouped-1");
      await stub.setPhase("fac1", "organise");

      // Create two groups
      const g1Result = await stub.createGroup("fac1", "Group 1");
      const g2Result = await stub.createGroup("fac1", "Group 2");
      const g1Id = g1Result.group!.id;
      const g2Id = g2Result.group!.id;

      const orgState = await stub.getRoomState();

      // Move items into groups
      const g1a = orgState.items.find((i) => i.text === "G1-A")!;
      const g1b = orgState.items.find((i) => i.text === "G1-B")!;
      const g2a = orgState.items.find((i) => i.text === "G2-A")!;
      const g2b = orgState.items.find((i) => i.text === "G2-B")!;

      await stub.moveItemToGroup("fac1", g1a.id, g1Id, 0);
      await stub.moveItemToGroup("fac1", g1b.id, g1Id, 1);
      await stub.moveItemToGroup("fac1", g2a.id, g2Id, 0);
      await stub.moveItemToGroup("fac1", g2b.id, g2Id, 1);
      // Ungrouped-1 stays ungrouped

      // Now reorder only g1 items (partial reorder - send only g1 IDs)
      const result = await stub.reorderItems("fac1", [g1b.id, g1a.id]);
      expect(result.success).toBe(true);

      const state = await stub.getRoomState();

      // All 5 items must be preserved
      expect(state.items).toHaveLength(5);

      // G1 items are reordered
      const g1Items = state.items.filter((i) => i.groupId === g1Id).sort((a, b) => a.order - b.order);
      expect(g1Items.map((i) => i.text)).toEqual(["G1-B", "G1-A"]);

      // G2 items remain untouched
      const g2Items = state.items.filter((i) => i.groupId === g2Id).sort((a, b) => a.order - b.order);
      expect(g2Items.map((i) => i.text)).toEqual(["G2-A", "G2-B"]);

      // Ungrouped item remains
      const ungrouped = state.items.filter((i) => i.groupId === null);
      expect(ungrouped).toHaveLength(1);
      expect(ungrouped[0]!.text).toBe("Ungrouped-1");
    });
  });

  describe("vote phase", () => {
    async function setupVoteRoom(roomId: string, budget: number = 5) {
      const id = env.RETRO_ROOM.idFromName(roomId);
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom(roomId);
      await stub.join("fac1", "Facilitator");
      await stub.join("p2", "Bob");
      await stub.addItem("fac1", "Item A");
      await stub.addItem("fac1", "Item B");
      await stub.setVoteBudget("fac1", budget);
      await stub.setPhase("fac1", "organise");
      await stub.setPhase("fac1", "vote");
      return stub;
    }

    it("participant can cast a vote during vote phase", async () => {
      const stub = await setupVoteRoom("test-cast-vote");
      const state0 = await stub.getRoomState();
      const itemId = state0.items[0]!.id;

      const result = await stub.castVote("fac1", itemId, 1);
      expect(result.success).toBe(true);

      const state = await stub.getRoomState();
      expect(state.votes).toHaveLength(1);
      expect(state.votes[0]!.participantId).toBe("fac1");
      expect(state.votes[0]!.itemId).toBe(itemId);
      expect(state.votes[0]!.count).toBe(1);
    });

    it("participant can stack votes on the same item", async () => {
      const stub = await setupVoteRoom("test-stack-votes", 5);
      const state0 = await stub.getRoomState();
      const itemId = state0.items[0]!.id;

      await stub.castVote("fac1", itemId, 1);
      const result = await stub.castVote("fac1", itemId, 2);
      expect(result.success).toBe(true);

      const state = await stub.getRoomState();
      const allocation = state.votes.find((v) => v.participantId === "fac1" && v.itemId === itemId);
      expect(allocation?.count).toBe(3);
    });

    it("over-budget vote is rejected", async () => {
      const stub = await setupVoteRoom("test-over-budget", 3);
      const state0 = await stub.getRoomState();
      const itemId = state0.items[0]!.id;

      const r1 = await stub.castVote("fac1", itemId, 3);
      expect(r1.success).toBe(true);

      const r2 = await stub.castVote("fac1", itemId, 1);
      expect(r2.success).toBe(false);
      expect(r2.error).toContain("Over budget");

      const state = await stub.getRoomState();
      const allocation = state.votes.find((v) => v.participantId === "fac1" && v.itemId === itemId);
      expect(allocation?.count).toBe(3);
    });

    it("rapid extra votes are rejected after budget exhaustion", async () => {
      const stub = await setupVoteRoom("test-rapid-extra", 2);
      const state0 = await stub.getRoomState();
      const itemA = state0.items[0]!.id;
      const itemB = state0.items[1]!.id;

      const r1 = await stub.castVote("fac1", itemA, 2);
      expect(r1.success).toBe(true);

      const r2 = await stub.castVote("fac1", itemB, 1);
      expect(r2.success).toBe(false);

      const state = await stub.getRoomState();
      expect(state.votes).toHaveLength(1);
    });

    it("participant can remove own vote", async () => {
      const stub = await setupVoteRoom("test-remove-vote");
      const state0 = await stub.getRoomState();
      const itemId = state0.items[0]!.id;

      await stub.castVote("fac1", itemId, 2);
      const result = await stub.removeVote("fac1", itemId);
      expect(result.success).toBe(true);

      const state = await stub.getRoomState();
      const allocation = state.votes.find((v) => v.participantId === "fac1" && v.itemId === itemId);
      expect(allocation?.count).toBe(1);
    });

    it("participant can remove all votes from an item", async () => {
      const stub = await setupVoteRoom("test-remove-all-votes");
      const state0 = await stub.getRoomState();
      const itemId = state0.items[0]!.id;

      await stub.castVote("fac1", itemId, 1);
      const result = await stub.removeVote("fac1", itemId);
      expect(result.success).toBe(true);

      const state = await stub.getRoomState();
      const allocation = state.votes.find((v) => v.participantId === "fac1" && v.itemId === itemId);
      expect(allocation).toBeUndefined();
    });

    it("cannot remove vote that does not exist", async () => {
      const stub = await setupVoteRoom("test-remove-nonexist");
      const state0 = await stub.getRoomState();
      const itemId = state0.items[0]!.id;

      const result = await stub.removeVote("fac1", itemId);
      expect(result.success).toBe(false);
      expect(result.error).toContain("No votes to remove");
    });

    it("votes are rejected outside vote phase", async () => {
      const id = env.RETRO_ROOM.idFromName("test-vote-out-phase");
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom("test-vote-out-phase");
      await stub.join("fac1", "Facilitator");
      await stub.addItem("fac1", "Item A");

      const state = await stub.getRoomState();
      const itemId = state.items[0]!.id;

      const r1 = await stub.castVote("fac1", itemId, 1);
      expect(r1.success).toBe(false);
      expect(r1.error).toContain("vote phase");

      const r2 = await stub.removeVote("fac1", itemId);
      expect(r2.success).toBe(false);
      expect(r2.error).toContain("vote phase");
    });

    it("votes are rejected during review phase", async () => {
      const stub = await setupVoteRoom("test-vote-review");
      await stub.setPhase("fac1", "review");

      const state = await stub.getRoomState();
      const itemId = state.items[0]!.id;

      const r1 = await stub.castVote("fac1", itemId, 1);
      expect(r1.success).toBe(false);
    });

    it("each participant has independent budget", async () => {
      const stub = await setupVoteRoom("test-independent-budget", 3);
      const state0 = await stub.getRoomState();
      const itemA = state0.items[0]!.id;

      // fac1 uses all 3 votes
      await stub.castVote("fac1", itemA, 3);

      // p2 should still have 3 votes
      const r = await stub.castVote("p2", itemA, 3);
      expect(r.success).toBe(true);

      const state = await stub.getRoomState();
      expect(state.votes).toHaveLength(2);
    });

    it("vote totals aggregate across participants", async () => {
      const stub = await setupVoteRoom("test-aggregate-totals", 5);
      const state0 = await stub.getRoomState();
      const itemA = state0.items[0]!.id;

      await stub.castVote("fac1", itemA, 2);
      await stub.castVote("p2", itemA, 3);

      const state = await stub.getRoomState();
      const totalVotes = state.votes
        .filter((v) => v.itemId === itemA)
        .reduce((sum, v) => sum + v.count, 0);
      expect(totalVotes).toBe(5);
    });

    it("organised state is preserved during vote (groups and order remain)", async () => {
      const id = env.RETRO_ROOM.idFromName("test-vote-preserves-org");
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom("test-vote-preserves-org");
      await stub.join("fac1", "Facilitator");
      await stub.addItem("fac1", "Item A");
      await stub.addItem("fac1", "Item B");
      await stub.setPhase("fac1", "organise");
      await stub.createGroup("fac1", "Process");
      const orgState = await stub.getRoomState();
      const groupId = orgState.groups[0]!.id;
      await stub.moveItemToGroup("fac1", orgState.items[0]!.id, groupId, 0);
      await stub.setPhase("fac1", "vote");

      const voteState = await stub.getRoomState();
      expect(voteState.groups.map((group) => group.name)).toContain("Process");
      const inGroup = voteState.items.filter((i) => i.groupId === groupId);
      expect(inGroup).toHaveLength(1);

      // Organisation should be blocked during vote
      const r = await stub.createGroup("fac1", "Blocked");
      expect(r.success).toBe(false);
    });

    it("late joiner during vote receives canonical state with votes and budget", async () => {
      const stub = await setupVoteRoom("test-late-join-vote", 3);
      const state0 = await stub.getRoomState();
      const itemA = state0.items[0]!.id;

      await stub.castVote("fac1", itemA, 2);

      // p3 joins late
      await stub.join("p3", "Carol");
      const state = await stub.getRoomState();

      // Votes from fac1 should still be there
      expect(state.votes).toHaveLength(1);
      expect(state.votes[0]!.count).toBe(2);
      // p3 should have 0 used votes
      const p3votes = state.votes.filter((v) => v.participantId === "p3");
      expect(p3votes).toHaveLength(0);
      // Budget should be 3
      expect(state.voteBudget).toBe(3);
    });

    it("vote allocations survive state reload", async () => {
      const stub = await setupVoteRoom("test-vote-persist", 5);
      const state0 = await stub.getRoomState();
      const itemA = state0.items[0]!.id;

      await stub.castVote("fac1", itemA, 2);
      await stub.castVote("p2", itemA, 1);

      const state = await stub.getRoomState();
      expect(state.votes).toHaveLength(2);
      expect(state.votes.find((v) => v.participantId === "fac1")?.count).toBe(2);
      expect(state.votes.find((v) => v.participantId === "p2")?.count).toBe(1);
    });

    it("organisation operations blocked during vote phase", async () => {
      const stub = await setupVoteRoom("test-org-blocked-during-vote");
      const state0 = await stub.getRoomState();

      const r1 = await stub.createGroup("fac1", "New Group");
      const r2 = await stub.reorderItems("fac1", state0.items.map((i) => i.id).reverse());
      const r3 = await stub.reorderGroups("fac1", []);
      const r4 = await stub.moveItemToGroup("fac1", state0.items[0]!.id, null, 0);

      expect(r1.success).toBe(false);
      expect(r2.success).toBe(false);
      expect(r3.success).toBe(false);
      expect(r4.success).toBe(false);
    });

    it("cannot vote on nonexistent item", async () => {
      const stub = await setupVoteRoom("test-vote-nonexist-item");
      const result = await stub.castVote("fac1", "nonexistent-item", 1);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Item not found");
    });

    it("cast vote rejects zero or negative count", async () => {
      const stub = await setupVoteRoom("test-vote-zero-count");
      const state0 = await stub.getRoomState();
      const itemId = state0.items[0]!.id;

      const r1 = await stub.castVote("fac1", itemId, 0);
      expect(r1.success).toBe(false);

      const r2 = await stub.castVote("fac1", itemId, -1);
      expect(r2.success).toBe(false);
    });

    it("facilitator-configured budget is used per participant", async () => {
      const stub = await setupVoteRoom("test-facilitator-budget", 2);
      const state0 = await stub.getRoomState();
      const itemA = state0.items[0]!.id;

      // Each participant gets 2 votes
      const r1 = await stub.castVote("fac1", itemA, 2);
      expect(r1.success).toBe(true);

      const r2 = await stub.castVote("p2", itemA, 2);
      expect(r2.success).toBe(true);

      // Both are now over budget
      const r3 = await stub.castVote("fac1", itemA, 1);
      expect(r3.success).toBe(false);

      const r4 = await stub.castVote("p2", itemA, 1);
      expect(r4.success).toBe(false);
    });
  });

  describe("review phase", () => {
    async function setupReviewRoom(roomId: string, budget: number = 5) {
      const id = env.RETRO_ROOM.idFromName(roomId);
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom(roomId);
      await stub.join("fac1", "Facilitator");
      await stub.join("p2", "Bob");
      await stub.addItem("fac1", "Item A");
      await stub.addItem("fac1", "Item B");
      await stub.addItem("fac1", "Item C");
      await stub.setVoteBudget("fac1", budget);
      await stub.setPhase("fac1", "organise");
      // Create a group and move items into it
      await stub.createGroup("fac1", "Process");
      const orgState = await stub.getRoomState();
      const groupId = orgState.groups[0]!.id;
      const itemAId = orgState.items.find((i) => i.text === "Item A")!.id;
      const itemBId = orgState.items.find((i) => i.text === "Item B")!.id;
      await stub.moveItemToGroup("fac1", itemAId, groupId, 0);
      await stub.moveItemToGroup("fac1", itemBId, groupId, 1);
      // Item C stays ungrouped
      await stub.setPhase("fac1", "vote");
      return { stub, groupId, itemAId, itemBId, itemCId: orgState.items.find((i) => i.text === "Item C")!.id };
    }

    it("facilitator can transition from vote to review", async () => {
      const { stub } = await setupReviewRoom("test-review-transition");
      const result = await stub.setPhase("fac1", "review");
      expect(result.success).toBe(true);

      const state = await stub.getRoomState();
      expect(state.phase).toBe("review");
    });

    it("non-facilitator cannot transition to review", async () => {
      const { stub } = await setupReviewRoom("test-review-nonfac");
      const result = await stub.setPhase("p2", "review");
      expect(result.success).toBe(false);

      const state = await stub.getRoomState();
      expect(state.phase).toBe("vote");
    });

    it("review preserves grouped item order and group structure", async () => {
      const { stub, groupId, itemAId, itemBId, itemCId } = await setupReviewRoom("test-review-preserves-order");
      await stub.setPhase("fac1", "review");

      const state = await stub.getRoomState();

      // Group should exist
      expect(state.groups.map((group) => group.id)).toContain(groupId);

      // Items in group should maintain order
      const groupedItems = state.items
        .filter((i) => i.groupId === groupId)
        .sort((a, b) => a.order - b.order);
      expect(groupedItems.map((i) => i.id)).toEqual([itemAId, itemBId]);

      // Ungrouped items remain
      const ungrouped = state.items.filter((i) => i.groupId === null);
      expect(ungrouped).toHaveLength(1);
      expect(ungrouped[0]!.id).toBe(itemCId);
    });

    it("review shows vote totals including zero-vote items", async () => {
      const { stub, itemAId, itemCId } = await setupReviewRoom("test-review-vote-totals");
      // Vote only on Item A; Item C gets zero votes
      await stub.castVote("fac1", itemAId, 3);
      await stub.setPhase("fac1", "review");

      const state = await stub.getRoomState();

      // Item A should have 3 votes
      const totalA = state.votes
        .filter((v) => v.itemId === itemAId)
        .reduce((sum, v) => sum + v.count, 0);
      expect(totalA).toBe(3);

      // Item C should have 0 votes (no allocation exists)
      const totalC = state.votes
        .filter((v) => v.itemId === itemCId)
        .reduce((sum, v) => sum + v.count, 0);
      expect(totalC).toBe(0);

      // All 3 items should still be present
      expect(state.items).toHaveLength(3);
    });

    it("review blocks add-item mutations", async () => {
      const { stub } = await setupReviewRoom("test-review-block-add");
      await stub.setPhase("fac1", "review");

      const result = await stub.addItem("fac1", "Should fail");
      expect(result.success).toBe(false);
      expect(result.error).toContain("write phase");

      const state = await stub.getRoomState();
      expect(state.items).toHaveLength(3);
    });

    it("review blocks organise mutations", async () => {
      const { stub, itemAId } = await setupReviewRoom("test-review-block-organise");
      await stub.setPhase("fac1", "review");

      const r1 = await stub.createGroup("fac1", "Blocked");
      const r2 = await stub.reorderItems("fac1", [itemAId]);
      const r3 = await stub.reorderGroups("fac1", []);
      const r4 = await stub.moveItemToGroup("fac1", itemAId, null, 0);

      expect(r1.success).toBe(false);
      expect(r2.success).toBe(false);
      expect(r3.success).toBe(false);
      expect(r4.success).toBe(false);
    });

    it("review blocks vote mutations", async () => {
      const { stub, itemAId } = await setupReviewRoom("test-review-block-vote");
      await stub.setPhase("fac1", "review");

      const r1 = await stub.castVote("fac1", itemAId, 1);
      const r2 = await stub.removeVote("fac1", itemAId);

      expect(r1.success).toBe(false);
      expect(r2.success).toBe(false);
    });

    it("late joiner during review receives full state snapshot", async () => {
      const { stub, itemAId } = await setupReviewRoom("test-review-late-join");
      await stub.castVote("fac1", itemAId, 2);
      await stub.setPhase("fac1", "review");

      // New participant joins during review
      const joinResult = await stub.join("p3", "Carol");
      expect(joinResult.success).toBe(true);
      expect(joinResult.state).toBeDefined();

      const state = joinResult.state!;
      expect(state.phase).toBe("review");
      expect(state.items).toHaveLength(3);
      expect(state.groups.map((group) => group.name)).toEqual(["Start", "Stop", "Continue", "Process"]);

      // Votes from before review should be present
      const totalA = state.votes
        .filter((v) => v.itemId === itemAId)
        .reduce((sum, v) => sum + v.count, 0);
      expect(totalA).toBe(2);
    });

    it("refresh/reconnect during review preserves state", async () => {
      const { stub, itemAId } = await setupReviewRoom("test-review-refresh");
      await stub.castVote("fac1", itemAId, 1);
      await stub.setPhase("fac1", "review");

      // Simulate reconnect by re-joining existing participant
      const rejoinResult = await stub.join("fac1", "Facilitator");
      expect(rejoinResult.success).toBe(true);
      expect(rejoinResult.state).toBeDefined();

      const state = rejoinResult.state!;
      expect(state.phase).toBe("review");
      expect(state.items).toHaveLength(3);
      expect(state.votes).toHaveLength(1);
      expect(state.votes[0]!.count).toBe(1);
    });

    it("empty review is graceful with no items", async () => {
      const roomId = "test-review-empty";
      const id = env.RETRO_ROOM.idFromName(roomId);
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom(roomId);
      await stub.join("fac1", "Facilitator");
      await stub.setPhase("fac1", "organise");
      await stub.setPhase("fac1", "vote");
      await stub.setPhase("fac1", "review");

      const state = await stub.getRoomState();
      expect(state.phase).toBe("review");
      expect(state.items).toEqual([]);
      expect(state.groups.map((group) => group.name)).toEqual(["Start", "Stop", "Continue"]);
      expect(state.votes).toEqual([]);
    });

    it("review preserves duplicate text items with distinct vote totals", async () => {
      const roomId = "test-review-dup-items";
      const id = env.RETRO_ROOM.idFromName(roomId);
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom(roomId);
      await stub.join("fac1", "Facilitator");
      await stub.addItem("fac1", "Same text");
      await stub.addItem("fac1", "Same text");
      await stub.setVoteBudget("fac1", 5);
      await stub.setPhase("fac1", "organise");
      await stub.setPhase("fac1", "vote");

      const voteState = await stub.getRoomState();
      const firstItem = voteState.items[0]!;
      const secondItem = voteState.items[1]!;

      // Vote on only the first duplicate
      await stub.castVote("fac1", firstItem.id, 3);
      await stub.setPhase("fac1", "review");

      const reviewState = await stub.getRoomState();
      expect(reviewState.items).toHaveLength(2);

      // First duplicate should have 3 votes
      const totalFirst = reviewState.votes
        .filter((v) => v.itemId === firstItem.id)
        .reduce((sum, v) => sum + v.count, 0);
      expect(totalFirst).toBe(3);

      // Second duplicate should have 0 votes
      const totalSecond = reviewState.votes
        .filter((v) => v.itemId === secondItem.id)
        .reduce((sum, v) => sum + v.count, 0);
      expect(totalSecond).toBe(0);
    });
  });

  describe("timer", () => {
    async function setupTimerRoom(roomId: string) {
      const id = env.RETRO_ROOM.idFromName(roomId);
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom(roomId);
      await stub.join("fac1", "Facilitator");
      await stub.join("p2", "Bob");
      return stub;
    }

    it("initial room has no timer set", async () => {
      const stub = await setupTimerRoom("test-timer-init");
      const state = await stub.getRoomState();
      expect(state.timer.startedAt).toBeNull();
      expect(state.timer.durationSeconds).toBeNull();
      expect(state.timer.expired).toBe(false);
    });

    it("facilitator can set a timer", async () => {
      const stub = await setupTimerRoom("test-timer-set");
      const result = await stub.setTimer("fac1", 300);
      expect(result.success).toBe(true);

      const state = await stub.getRoomState();
      expect(state.timer.startedAt).not.toBeNull();
      expect(state.timer.durationSeconds).toBe(300);
      expect(state.timer.expired).toBe(false);
    });

    it("non-facilitator cannot set a timer", async () => {
      const stub = await setupTimerRoom("test-timer-nonfac");
      const result = await stub.setTimer("p2", 300);
      expect(result.success).toBe(false);
      expect(result.error).toContain("facilitator");

      const state = await stub.getRoomState();
      expect(state.timer.startedAt).toBeNull();
    });

    it("timer rejects invalid durations", async () => {
      const stub = await setupTimerRoom("test-timer-invalid");

      const r1 = await stub.setTimer("fac1", 0);
      expect(r1.success).toBe(false);

      const r2 = await stub.setTimer("fac1", -1);
      expect(r2.success).toBe(false);

      const r3 = await stub.setTimer("fac1", 1.5);
      expect(r3.success).toBe(false);

      const state = await stub.getRoomState();
      expect(state.timer.startedAt).toBeNull();
    });

    it("timer resets on phase change", async () => {
      const stub = await setupTimerRoom("test-timer-phase-reset");
      await stub.addItem("fac1", "Item A");
      await stub.setTimer("fac1", 300);

      const stateBefore = await stub.getRoomState();
      expect(stateBefore.timer.startedAt).not.toBeNull();

      await stub.setPhase("fac1", "organise");

      const stateAfter = await stub.getRoomState();
      expect(stateAfter.timer.startedAt).toBeNull();
      expect(stateAfter.timer.durationSeconds).toBeNull();
      expect(stateAfter.timer.expired).toBe(false);
    });

    it("timer persists through state reload", async () => {
      const stub = await setupTimerRoom("test-timer-persist");
      await stub.setTimer("fac1", 600);

      const state = await stub.getRoomState();
      expect(state.timer.startedAt).not.toBeNull();
      expect(state.timer.durationSeconds).toBe(600);
    });

    it("timer survives reconnect", async () => {
      const stub = await setupTimerRoom("test-timer-reconnect");
      await stub.setTimer("fac1", 300);

      // Reconnect facilitator
      const rejoin = await stub.join("fac1", "Facilitator");
      expect(rejoin.success).toBe(true);
      expect(rejoin.state).toBeDefined();
      expect(rejoin.state!.timer.startedAt).not.toBeNull();
      expect(rejoin.state!.timer.durationSeconds).toBe(300);
    });
  });

  describe("cross-flow", () => {
    it("full flow: write → organise → vote → review preserves all state", async () => {
      const roomId = "test-full-flow";
      const id = env.RETRO_ROOM.idFromName(roomId);
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom(roomId);
      await stub.join("fac1", "Alice (Facilitator)");
      await stub.join("p2", "Bob");
      await stub.setVoteBudget("fac1", 5);

      // Write phase
      await stub.addItem("fac1", "Improve standups");
      await stub.addItem("p2", "Better docs");
      await stub.addItem("fac1", "More pair programming");

      let state = await stub.getRoomState();
      expect(state.phase).toBe("write");
      expect(state.items).toHaveLength(3);

      // Set timer during write
      await stub.setTimer("fac1", 300);
      state = await stub.getRoomState();
      expect(state.timer.startedAt).not.toBeNull();

      // Advance to organise
      await stub.setPhase("fac1", "organise");
      state = await stub.getRoomState();
      expect(state.phase).toBe("organise");
      expect(state.timer.startedAt).toBeNull(); // Timer resets on phase change

      // Create group and move items
      await stub.createGroup("fac1", "Process");
      state = await stub.getRoomState();
      const groupId = state.groups[0]!.id;
      const item1Id = state.items.find((i) => i.text === "Improve standups")!.id;
      const item2Id = state.items.find((i) => i.text === "Better docs")!.id;
      await stub.moveItemToGroup("fac1", item1Id, groupId, 0);
      await stub.moveItemToGroup("fac1", item2Id, groupId, 1);

      // Advance to vote
      await stub.setPhase("fac1", "vote");
      state = await stub.getRoomState();
      expect(state.phase).toBe("vote");

      // Both participants vote
      await stub.castVote("fac1", item1Id, 3);
      await stub.castVote("p2", item1Id, 2);
      await stub.castVote("p2", item2Id, 1);

      // Set timer during vote
      await stub.setTimer("fac1", 120);

      // Advance to review
      await stub.setPhase("fac1", "review");
      state = await stub.getRoomState();
      expect(state.phase).toBe("review");
      expect(state.timer.startedAt).toBeNull(); // Timer resets on phase change

      // Verify all state
      expect(state.items).toHaveLength(3);
      expect(state.groups.map((group) => group.name)).toContain("Process");
      expect(state.participants).toHaveLength(2);
      expect(state.voteBudget).toBe(5);

      // Check vote totals
      const item1Total = state.votes
        .filter((v) => v.itemId === item1Id)
        .reduce((sum, v) => sum + v.count, 0);
      expect(item1Total).toBe(5);

      const item2Total = state.votes
        .filter((v) => v.itemId === item2Id)
        .reduce((sum, v) => sum + v.count, 0);
      expect(item2Total).toBe(1);

      // Group structure preserved
      const groupedItems = state.items.filter((i) => i.groupId === groupId);
      expect(groupedItems).toHaveLength(2);
    });

    it("room isolation: actions in room A do not affect room B", async () => {
      const stubA = env.RETRO_ROOM.get(env.RETRO_ROOM.idFromName("isolation-a"));
      const stubB = env.RETRO_ROOM.get(env.RETRO_ROOM.idFromName("isolation-b"));
      await stubA.initRoom("isolation-a");
      await stubB.initRoom("isolation-b");

      // Join same participant ID in both rooms
      await stubA.join("p1", "Alice");
      await stubB.join("p1", "Alice");

      // Add items in room A
      await stubA.addItem("p1", "Room A item");
      await stubB.addItem("p1", "Room B item");

      const stateA = await stubA.getRoomState();
      const stateB = await stubB.getRoomState();

      expect(stateA.items).toHaveLength(1);
      expect(stateA.items[0]!.text).toBe("Room A item");
      expect(stateB.items).toHaveLength(1);
      expect(stateB.items[0]!.text).toBe("Room B item");

      // Advance phase in room A only
      await stubA.setPhase("p1", "organise");
      const stateA2 = await stubA.getRoomState();
      const stateB2 = await stubB.getRoomState();
      expect(stateA2.phase).toBe("organise");
      expect(stateB2.phase).toBe("write");
    });

    it("reconnect does not duplicate membership or votes", async () => {
      const roomId = "test-reconnect-no-dupe-votes";
      const id = env.RETRO_ROOM.idFromName(roomId);
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom(roomId);
      await stub.join("fac1", "Alice");
      await stub.join("p2", "Bob");
      await stub.addItem("fac1", "Item A");
      await stub.setVoteBudget("fac1", 5);
      await stub.setPhase("fac1", "organise");
      await stub.setPhase("fac1", "vote");

      const state0 = await stub.getRoomState();
      const itemId = state0.items[0]!.id;

      // Alice votes
      await stub.castVote("fac1", itemId, 3);

      // Alice reconnects
      const rejoin = await stub.join("fac1", "Alice");
      expect(rejoin.success).toBe(true);

      const state = await stub.getRoomState();
      // No duplicate participants
      expect(state.participants).toHaveLength(2);
      const aliceCount = state.participants.filter((p) => p.id === "fac1").length;
      expect(aliceCount).toBe(1);

      // Votes unchanged
      const aliceVotes = state.votes.filter((v) => v.participantId === "fac1");
      expect(aliceVotes).toHaveLength(1);
      expect(aliceVotes[0]!.count).toBe(3);
    });

    it("reconnect during review preserves full state", async () => {
      const roomId = "test-reconnect-review";
      const id = env.RETRO_ROOM.idFromName(roomId);
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom(roomId);
      await stub.join("fac1", "Alice");
      await stub.join("p2", "Bob");
      await stub.addItem("fac1", "Item A");
      await stub.setVoteBudget("fac1", 3);
      await stub.setPhase("fac1", "organise");
      await stub.setPhase("fac1", "vote");

      const voteState = await stub.getRoomState();
      const itemId = voteState.items[0]!.id;
      await stub.castVote("fac1", itemId, 2);
      await stub.castVote("p2", itemId, 1);
      await stub.setPhase("fac1", "review");

      // Alice reconnects
      const rejoin = await stub.join("fac1", "Alice");
      expect(rejoin.success).toBe(true);
      expect(rejoin.state!.phase).toBe("review");
      expect(rejoin.state!.items).toHaveLength(1);
      expect(rejoin.state!.votes).toHaveLength(2);

      // Bob also reconnects
      const rejoin2 = await stub.join("p2", "Bob");
      expect(rejoin2.success).toBe(true);
      expect(rejoin2.state!.phase).toBe("review");
      expect(rejoin2.state!.participants).toHaveLength(2);
    });

    it("timer expiry does not auto-advance phase", async () => {
      const roomId = "test-timer-no-auto";
      const id = env.RETRO_ROOM.idFromName(roomId);
      const stub = env.RETRO_ROOM.get(id);
      await stub.initRoom(roomId);
      await stub.join("fac1", "Alice");
      await stub.addItem("fac1", "Item A");

      // Set a 1-second timer
      await stub.setTimer("fac1", 1);

      const stateBefore = await stub.getRoomState();
      expect(stateBefore.phase).toBe("write");

      // Wait for timer to expire
      await new Promise((r) => setTimeout(r, 1100));

      const stateAfter = await stub.getRoomState();
      // Phase should still be write
      expect(stateAfter.phase).toBe("write");
      // Timer should be expired
      expect(stateAfter.timer.expired).toBe(true);
    });
  });
});
