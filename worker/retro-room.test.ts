// @ts-expect-error -- cloudflare:workers vitest module
import { env } from "cloudflare:workers";
import { describe, it, expect } from "vitest";
import type { RoomState } from "../src/domain";

describe("RetroRoom Durable Object v2 schema", () => {
  async function init(roomId: string) {
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    await stub.initRoom(roomId);
    return stub;
  }

  async function freshMovePreconditions(stub: { getRoomState: () => Promise<RoomState> }, itemId: string) {
    const state = await stub.getRoomState();
    const item = state.items.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error(`Missing item ${itemId}`);
    return {
      expectedVersion: state.version,
      sourceGroupId: item.groupId,
      sourceIndex: item.order,
    };
  }

  it("initializes new rooms as v2 with no fixed default columns", async () => {
    const stub = await init("test-v2-empty-room");

    const state = await stub.getRoomState();
    expect(state.schemaVersion).toBe(2);
    expect(state.roomId).toBe("test-v2-empty-room");
    expect(state.phase).toBe("write");
    expect(state.columns).toEqual([]);
    expect(state.groups).toEqual([]);
    expect(state.items).toEqual([]);
    expect(state.votes).toEqual([]);
    expect(state.columns.map((column) => column.name)).not.toEqual(expect.arrayContaining(["Start", "Stop", "Continue"]));
  });

  it("resets incompatible legacy board content on load", async () => {
    const roomId = "test-v2-legacy-reset";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    await stub.seedStoredStateForTest({
      roomId,
      participants: [{ id: "fac1", displayName: "Facilitator", isFacilitator: true }],
      facilitatorId: "fac1",
      phase: "vote",
      items: [{ id: "legacy-item", text: "Old item", authorId: "fac1", columnId: "start", groupId: "start", order: 0 }],
      groups: [{ id: "start", name: "Start", order: 0 }],
      votes: [{ participantId: "fac1", itemId: "legacy-item", count: 3 }],
      version: 41,
    } as never);

    const state = await stub.getRoomState();
    expect(state.schemaVersion).toBe(2);
    expect(state.phase).toBe("write");
    expect(state.participants).toEqual([{ id: "fac1", displayName: "Facilitator", isFacilitator: true }]);
    expect(state.columns).toEqual([]);
    expect(state.groups).toEqual([]);
    expect(state.items).toEqual([]);
    expect(state.votes).toEqual([]);
  });

  it("stores distinct columns, column-scoped groups, original item column IDs, and group votes", async () => {
    const stub = await init("test-v2-shape");
    await stub.join("fac1", "Facilitator");

    const column = await stub.createColumn("fac1", "Went well");
    expect(column.success).toBe(true);
    const columnId = column.column!.id;

    const item = await stub.addItem("fac1", "Shipping was smooth", columnId);
    expect(item.success).toBe(true);
    expect(item.item!.columnId).toBe(columnId);
    expect(item.item!.groupId).toBeNull();

    await stub.setPhase("fac1", "organise");
    const group = await stub.createGroup("fac1", "Release wins", columnId);
    expect(group.success).toBe(true);
    expect(group.group).toMatchObject({ name: "Release wins", columnId, order: 0 });

    const move = await stub.moveItemToGroup(
      "fac1",
      item.item!.id,
      group.group!.id,
      0,
      await freshMovePreconditions(stub, item.item!.id),
    );
    expect(move.success).toBe(true);

    await stub.setPhase("fac1", "vote");
    const vote = await stub.castVote("fac1", group.group!.id, 2);
    expect(vote.success).toBe(true);

    const state = await stub.getRoomState();
    expect(state.columns).toEqual([{ id: columnId, name: "Went well", order: 0 }]);
    expect(state.groups).toEqual([{ id: group.group!.id, name: "Release wins", columnId, order: 0 }]);
    expect(state.items).toEqual([
      expect.objectContaining({ id: item.item!.id, text: "Shipping was smooth", columnId, groupId: group.group!.id, order: 0 }),
    ]);
    expect(state.votes).toEqual([{ participantId: "fac1", groupId: group.group!.id, itemId: group.group!.id, count: 2 }]);
  });

  it("rejects cross-column item moves without changing state", async () => {
    const stub = await init("test-v2-cross-column-reject");
    await stub.join("fac1", "Facilitator");
    const first = await stub.createColumn("fac1", "First");
    const second = await stub.createColumn("fac1", "Second");
    const item = await stub.addItem("fac1", "Scoped item", first.column!.id);
    await stub.setPhase("fac1", "organise");
    const otherGroup = await stub.createGroup("fac1", "Other column group", second.column!.id);
    const before = await stub.getRoomState();

    const move = await stub.moveItemToGroup(
      "fac1",
      item.item!.id,
      otherGroup.group!.id,
      0,
      await freshMovePreconditions(stub, item.item!.id),
    );

    expect(move.success).toBe(false);
    expect(move.error).toContain("another column");
    expect(await stub.getRoomState()).toEqual(before);
  });
});
