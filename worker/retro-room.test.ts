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

  it("rejects item adds without a valid existing column without changing state", async () => {
    const stub = await init("test-v2-add-item-column-required");
    await stub.join("fac1", "Facilitator");
    const column = await stub.createColumn("fac1", "Valid lane");
    const beforeMissing = await stub.getRoomState();

    const missing = await stub.addItem("fac1", "No column");
    expect(missing.success).toBe(false);
    expect(missing.error).toBe("Column is required");
    expect(await stub.getRoomState()).toEqual(beforeMissing);

    const nullColumn = await stub.addItem("fac1", "Null column", null);
    expect(nullColumn.success).toBe(false);
    expect(nullColumn.error).toBe("Column is required");
    expect(await stub.getRoomState()).toEqual(beforeMissing);

    const malformed = await stub.addItem("fac1", "Malformed column", 123 as never);
    expect(malformed.success).toBe(false);
    expect(malformed.error).toBe("Column is required");
    expect(await stub.getRoomState()).toEqual(beforeMissing);

    const unknown = await stub.addItem("fac1", "Unknown column", "missing-column");
    expect(unknown.success).toBe(false);
    expect(unknown.error).toBe("Column not found");
    expect(await stub.getRoomState()).toEqual(beforeMissing);

    const valid = await stub.addItem("fac1", "Valid item", column.column!.id);
    expect(valid.success).toBe(true);
    expect(valid.item).toMatchObject({ text: "Valid item", columnId: column.column!.id, groupId: null });
  });

  it("normalizes persisted v2 state by dropping invalid columnless and orphaned items and related votes", async () => {
    const roomId = "test-v2-normalize-invalid-item-columns";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    await stub.seedStoredStateForTest({
      roomId,
      participants: [{ id: "fac1", displayName: "Facilitator", isFacilitator: true }],
      facilitatorId: "fac1",
      columns: [
        { id: "col-1", name: "Keep", order: 0 },
        { id: "col-2", name: "Other", order: 1 },
      ],
      groups: [
        { id: "group-1", name: "Kept group", columnId: "col-1", order: 0 },
        { id: "orphan-group", name: "Orphan group", columnId: "missing-column", order: 1 },
      ],
      items: [
        { id: "valid-item", text: "Valid", authorId: "fac1", columnId: "col-1", groupId: "group-1", order: 0 },
        { id: "null-column", text: "Null", authorId: "fac1", columnId: null, groupId: null, order: 1 },
        { id: "missing-column", text: "Missing", authorId: "fac1", groupId: null, order: 2 },
        { id: "malformed-column", text: "Malformed", authorId: "fac1", columnId: 42, groupId: null, order: 3 },
        { id: "unknown-column", text: "Unknown", authorId: "fac1", columnId: "missing-column", groupId: null, order: 4 },
        { id: "cross-group", text: "Cross group", authorId: "fac1", columnId: "col-2", groupId: "group-1", order: 5 },
      ],
      votes: [
        { participantId: "fac1", groupId: "group-1", itemId: "group-1", count: 2 },
        { participantId: "fac1", groupId: "orphan-group", itemId: "orphan-group", count: 3 },
      ],
      version: 12,
    } as never);

    const state = await stub.getRoomState();
    expect(state.columns.map((column) => column.id)).toEqual(["col-1", "col-2"]);
    expect(state.groups).toEqual([{ id: "group-1", name: "Kept group", columnId: "col-1", order: 0 }]);
    expect(state.items).toEqual([
      expect.objectContaining({ id: "valid-item", columnId: "col-1", groupId: "group-1", order: 0 }),
      expect.objectContaining({ id: "cross-group", columnId: "col-2", groupId: null, order: 1 }),
    ]);
    expect(state.votes).toEqual([{ participantId: "fac1", groupId: "group-1", count: 2 }]);
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
