// @ts-expect-error -- cloudflare:workers vitest module
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { groupVoteTarget, itemVoteTarget } from "../src/domain";
import { init, freshMovePreconditions, freshItemReorderPreconditions, freshGroupReorderVersion, deleteAllColumns } from "./retro-room-test-helpers";

describe("RetroRoom board layout invariants", () => {
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
      expect.objectContaining({ id: "cross-group", columnId: "col-2", groupId: null, order: 0 }),
    ]);
    expect(state.votes).toEqual([{ participantId: "fac1", target: groupVoteTarget("group-1"), count: 2 }]);
  });
  
  it("normalizes persisted mixed votes to canonical safe targets", async () => {
    const roomId = "test-v2-normalize-mixed-votes";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    await stub.seedStoredStateForTest({
      roomId,
      participants: [
        { id: "fac1", displayName: "Facilitator", isFacilitator: true },
        { id: "p2", displayName: "Participant", isFacilitator: false },
      ],
      facilitatorId: "fac1",
      phase: "vote",
      columns: [{ id: "col-1", name: "Keep", order: 0 }],
      groups: [{ id: "group-1", name: "Kept group", columnId: "col-1", order: 0 }],
      items: [
        { id: "grouped-item", text: "Grouped", authorId: "fac1", columnId: "col-1", groupId: "group-1", order: 0 },
        { id: "free-item", text: "Free", authorId: "fac1", columnId: "col-1", groupId: null, order: 0 },
      ],
      votes: [
        { participantId: "fac1", groupId: "group-1", itemId: "group-1", count: 1 },
        { participantId: "fac1", target: groupVoteTarget("group-1"), count: 2 },
        { participantId: "p2", itemId: "free-item", count: 3 },
        { participantId: "p2", target: itemVoteTarget("free-item"), count: 1 },
        { participantId: "p2", itemId: "grouped-item", count: 1 },
        { participantId: "missing", target: groupVoteTarget("group-1"), count: 1 },
        { participantId: "p2", target: itemVoteTarget("missing-item"), count: 1 },
        { participantId: "p2", groupId: "group-1", itemId: "free-item", count: 1 },
        { participantId: "p2", target: itemVoteTarget("free-item"), count: 0 },
      ],
    });
  
    const state = await stub.getRoomState();
  
    expect(state.votes).toEqual([
      { participantId: "fac1", target: groupVoteTarget("group-1"), count: 3 },
      { participantId: "p2", target: itemVoteTarget("free-item"), count: 4 },
    ]);
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
  
  it("accepts same-column group reorder and rejects duplicate, omitted, unknown, and cross-column group payloads atomically", async () => {
    const stub = await init("test-v2-group-reorder-invariants");
    await stub.join("fac1", "Facilitator");
    const first = await stub.createColumn("fac1", "First");
    const second = await stub.createColumn("fac1", "Second");
    await stub.setPhase("fac1", "organise");
    const firstA = await stub.createGroup("fac1", "First A", first.column!.id);
    const firstB = await stub.createGroup("fac1", "First B", first.column!.id);
    const secondA = await stub.createGroup("fac1", "Second A", second.column!.id);
  
    const accepted = await stub.reorderGroups("fac1", [firstB.group!.id, firstA.group!.id], await freshGroupReorderVersion(stub));
    expect(accepted.success).toBe(true);
    const afterAccepted = await stub.getRoomState();
    expect(afterAccepted.groups
      .filter((group) => group.columnId === first.column!.id)
      .sort((a, b) => a.order - b.order)
      .map((group) => [group.id, group.order])).toEqual([
      [firstB.group!.id, 0],
      [firstA.group!.id, 1],
    ]);
  
    for (const groupIds of [
      [firstB.group!.id, firstB.group!.id],
      [firstB.group!.id],
      [firstB.group!.id, "missing-group"],
      [firstB.group!.id, secondA.group!.id],
    ]) {
      const before = await stub.getRoomState();
      const rejected = await stub.reorderGroups("fac1", groupIds, await freshGroupReorderVersion(stub));
      expect(rejected.success).toBe(false);
      expect(await stub.getRoomState()).toEqual(before);
    }
  });
  
  it("rejects stale item moves without changing state or version", async () => {
    const stub = await init("test-v2-stale-item-move-reject");
    await stub.join("fac1", "Facilitator");
    const column = await stub.createColumn("fac1", "Lane");
    const item = await stub.addItem("fac1", "Scoped item", column.column!.id);
    await stub.setPhase("fac1", "organise");
    const group = await stub.createGroup("fac1", "Group", column.column!.id);
    const stalePreconditions = await freshMovePreconditions(stub, item.item!.id);
    const otherGroup = await stub.createGroup("fac1", "Other group", column.column!.id);
    expect(otherGroup.success).toBe(true);
  
    const before = await stub.getRoomState();
    const stale = await stub.moveItemToGroup("fac1", item.item!.id, group.group!.id, 0, stalePreconditions);
  
    expect(stale.success).toBe(false);
    expect(stale.error).toContain("Stale");
    expect(await stub.getRoomState()).toEqual(before);
  });
  
  it("rejects duplicate, omitted, unknown, and cross-column item reorder payloads atomically", async () => {
    const stub = await init("test-v2-item-reorder-invariants");
    await stub.join("fac1", "Facilitator");
    const first = await stub.createColumn("fac1", "First");
    const second = await stub.createColumn("fac1", "Second");
    const firstA = await stub.addItem("fac1", "First A", first.column!.id);
    const firstB = await stub.addItem("fac1", "First B", first.column!.id);
    const secondA = await stub.addItem("fac1", "Second A", second.column!.id);
    await stub.setPhase("fac1", "organise");
  
    for (const itemIds of [
      [firstA.item!.id, firstA.item!.id],
      [firstA.item!.id],
      [firstA.item!.id, "missing-item"],
      [firstA.item!.id, secondA.item!.id],
    ]) {
      const before = await stub.getRoomState();
      const rejected = await stub.reorderItems("fac1", itemIds, await freshItemReorderPreconditions(stub, firstA.item!.id));
      expect(rejected.success).toBe(false);
      expect(await stub.getRoomState()).toEqual(before);
    }
  
    const accepted = await stub.reorderItems("fac1", [firstB.item!.id, firstA.item!.id], await freshItemReorderPreconditions(stub, firstA.item!.id));
    expect(accepted.success).toBe(true);
    const afterAccepted = await stub.getRoomState();
    expect(afterAccepted.items
      .filter((item) => item.columnId === first.column!.id && item.groupId === null)
      .sort((a, b) => a.order - b.order)
      .map((item) => item.id)).toEqual([firstB.item!.id, firstA.item!.id]);
  });
  
  it("rejects stale complete item reorders without changing state or version", async () => {
    const stub = await init("test-v2-stale-item-reorder-reject");
    await stub.join("fac1", "Facilitator");
    const column = await stub.createColumn("fac1", "Lane");
    const first = await stub.addItem("fac1", "First", column.column!.id);
    const second = await stub.addItem("fac1", "Second", column.column!.id);
    await stub.setPhase("fac1", "organise");
  
    const stalePreconditions = await freshItemReorderPreconditions(stub, first.item!.id);
    const group = await stub.createGroup("fac1", "Later group", column.column!.id);
    expect(group.success).toBe(true);
  
    const before = await stub.getRoomState();
    const stale = await stub.reorderItems("fac1", [second.item!.id, first.item!.id], stalePreconditions);
  
    expect(stale.success).toBe(false);
    expect(stale.error).toContain("Stale");
    expect(await stub.getRoomState()).toEqual(before);
  });
  
  it("rejects stale complete group reorders without changing state or version", async () => {
    const stub = await init("test-v2-stale-group-reorder-reject");
    await stub.join("fac1", "Facilitator");
    const column = await stub.createColumn("fac1", "Lane");
    await stub.setPhase("fac1", "organise");
    const first = await stub.createGroup("fac1", "First", column.column!.id);
    const second = await stub.createGroup("fac1", "Second", column.column!.id);
  
    const staleVersion = await freshGroupReorderVersion(stub);
    const third = await stub.createGroup("fac1", "Third", column.column!.id);
    expect(third.success).toBe(true);
  
    const before = await stub.getRoomState();
    const stale = await stub.reorderGroups("fac1", [second.group!.id, first.group!.id, third.group!.id], staleVersion);
  
    expect(stale.success).toBe(false);
    expect(stale.error).toContain("Stale");
    expect(await stub.getRoomState()).toEqual(before);
  });
  
  it("creates, renames, and deletes nested groups while preserving parent column invariants", async () => {
    const stub = await init("test-v2-nested-group-crud-invariants");
    await stub.join("fac1", "Facilitator");
    const column = await stub.createColumn("fac1", "Lane");
    const item = await stub.addItem("fac1", "Grouped item", column.column!.id);
    await stub.setPhase("fac1", "organise");
    const group = await stub.createGroup("fac1", "Original", column.column!.id);
    await stub.moveItemToGroup("fac1", item.item!.id, group.group!.id, 0, await freshMovePreconditions(stub, item.item!.id));
    await stub.setPhase("fac1", "vote");
    await stub.castVote("fac1", group.group!.id, 1);
    await stub.setPhaseForTest("organise");
  
    const renamed = await stub.editGroup("fac1", group.group!.id, "Renamed");
    expect(renamed).toMatchObject({ success: true, group: { id: group.group!.id, name: "Renamed", columnId: column.column!.id } });
    const beforeDelete = await stub.getRoomState();
  
    const deleted = await stub.deleteGroup("fac1", group.group!.id);
    expect(deleted.success).toBe(true);
    const afterDelete = await stub.getRoomState();
    expect(afterDelete.columns).toEqual(beforeDelete.columns);
    expect(afterDelete.groups).toEqual([]);
    expect(afterDelete.items).toEqual([
      expect.objectContaining({ id: item.item!.id, columnId: column.column!.id, groupId: null, order: 0 }),
    ]);
    expect(afterDelete.votes).toEqual([]);
    expect(afterDelete.version).toBe(beforeDelete.version + 1);
  });
  
  it("rejects missing or unknown group parent columns without changing state", async () => {
    const stub = await init("test-v2-group-parent-required");
    await stub.join("fac1", "Facilitator");
    await stub.createColumn("fac1", "Lane");
    await stub.setPhase("fac1", "organise");
    const before = await stub.getRoomState();
  
    await expect(stub.createGroup("fac1", "No parent")).resolves.toMatchObject({ success: false, error: "Column not found" });
    await expect(stub.createGroup("fac1", "Unknown parent", "missing-column")).resolves.toMatchObject({ success: false, error: "Column not found" });
    expect(await stub.getRoomState()).toEqual(before);
  });
  
  it("rejects duplicate sanitized group creates within the same column without changing state or version", async () => {
    const stub = await init("test-v2-duplicate-group-create-reject");
    await stub.join("fac1", "Facilitator");
    const firstColumn = await stub.createColumn("fac1", "First");
    const secondColumn = await stub.createColumn("fac1", "Second");
    await stub.setPhase("fac1", "organise");
  
    const firstGroup = await stub.createGroup("fac1", "Shared theme", firstColumn.column!.id);
    expect(firstGroup.success).toBe(true);
    const sameNameOtherColumn = await stub.createGroup("fac1", " Shared theme ", secondColumn.column!.id);
    expect(sameNameOtherColumn.success).toBe(true);
  
    const beforeDuplicate = await stub.getRoomState();
    const duplicate = await stub.createGroup("fac1", " Shared theme ", firstColumn.column!.id);
  
    expect(duplicate).toMatchObject({ success: false, error: "Group name already exists in this column" });
    expect(await stub.getRoomState()).toEqual(beforeDuplicate);
  });
  
  it("rejects duplicate sanitized group renames within the same column without changing groups, items, votes, or version", async () => {
    const stub = await init("test-v2-duplicate-group-rename-reject");
    await stub.join("fac1", "Facilitator");
    const firstColumn = await stub.createColumn("fac1", "First");
    const secondColumn = await stub.createColumn("fac1", "Second");
    const item = await stub.addItem("fac1", "Scoped item", firstColumn.column!.id);
    await stub.setPhase("fac1", "organise");
    const existing = await stub.createGroup("fac1", "Existing", firstColumn.column!.id);
    const target = await stub.createGroup("fac1", "Target", firstColumn.column!.id);
    const otherColumn = await stub.createGroup("fac1", "Existing", secondColumn.column!.id);
    expect(existing.success).toBe(true);
    expect(target.success).toBe(true);
    expect(otherColumn.success).toBe(true);
    await stub.moveItemToGroup("fac1", item.item!.id, target.group!.id, 0, await freshMovePreconditions(stub, item.item!.id));
    await stub.setPhase("fac1", "vote");
    await stub.castVote("fac1", target.group!.id, 1);
    await stub.setPhaseForTest("organise");
  
    const sameCurrentName = await stub.editGroup("fac1", existing.group!.id, " Existing ");
    expect(sameCurrentName).toMatchObject({ success: true, group: { id: existing.group!.id, name: "Existing" } });
  
    const beforeDuplicate = await stub.getRoomState();
    const duplicate = await stub.editGroup("fac1", target.group!.id, " Existing ");
  
    expect(duplicate).toMatchObject({ success: false, error: "Group name already exists in this column" });
    expect(await stub.getRoomState()).toEqual(beforeDuplicate);
  });
  
  it("allows the facilitator to create, rename, reorder, and delete columns during setup", async () => {
    const stub = await init("test-v2-column-crud-facilitator-phases");
    await stub.join("fac1", "Facilitator");
    await deleteAllColumns(stub);
  
    const first = await stub.createColumn("fac1", "First");
    const second = await stub.createColumn("fac1", "Second");
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
  
    const rename = await stub.editColumn("fac1", first.column!.id, "Renamed");
    expect(rename.success).toBe(true);
    expect(rename.column).toMatchObject({ id: first.column!.id, name: "Renamed" });
  
    const reorder = await stub.reorderColumns("fac1", [second.column!.id, first.column!.id]);
    expect(reorder.success).toBe(true);
    expect((await stub.getRoomState()).columns.map((column) => [column.id, column.order])).toEqual([
      [second.column!.id, 0],
      [first.column!.id, 1],
    ]);
  
    const third = await stub.createColumn("fac1", "Third");
    expect(third.success).toBe(true);
  
    const deleteSecond = await stub.deleteColumn("fac1", second.column!.id);
    expect(deleteSecond.success).toBe(true);
    expect((await stub.getRoomState()).columns.map((column) => column.id)).toEqual([first.column!.id, third.column!.id]);
  });
  
  it("deletes a column with contained groups, items, and votes while preserving unrelated columns", async () => {
    const stub = await init("test-v2-column-delete-cascade");
    await stub.join("fac1", "Facilitator");
    await deleteAllColumns(stub);
    const keep = await stub.createColumn("fac1", "Keep");
    const remove = await stub.createColumn("fac1", "Remove");
    const keepItem = await stub.addItem("fac1", "Keep item", keep.column!.id);
    const removeItem = await stub.addItem("fac1", "Remove item", remove.column!.id);
    const keepFreeItem = await stub.addItem("fac1", "Keep free item", keep.column!.id);
    const removeFreeItem = await stub.addItem("fac1", "Remove free item", remove.column!.id);
  
    await stub.setPhase("fac1", "organise");
    const keepGroup = await stub.createGroup("fac1", "Keep group", keep.column!.id);
    const removeGroup = await stub.createGroup("fac1", "Remove group", remove.column!.id);
    await stub.moveItemToGroup("fac1", keepItem.item!.id, keepGroup.group!.id, 0, await freshMovePreconditions(stub, keepItem.item!.id));
    await stub.moveItemToGroup("fac1", removeItem.item!.id, removeGroup.group!.id, 0, await freshMovePreconditions(stub, removeItem.item!.id));
  
    await stub.setPhase("fac1", "vote");
    await stub.castVote("fac1", keepGroup.group!.id, 1);
    await stub.castVote("fac1", removeGroup.group!.id, 2);
    await stub.castVote("fac1", itemVoteTarget(keepFreeItem.item!.id), 1);
    await stub.castVote("fac1", itemVoteTarget(removeFreeItem.item!.id), 1);
    await stub.setPhaseForTest("setup");
  
    const before = await stub.getRoomState();
    expect(before.votes.map((vote) => vote.target?.id).sort()).toEqual([
      keepFreeItem.item!.id,
      keepGroup.group!.id,
      removeFreeItem.item!.id,
      removeGroup.group!.id,
    ].sort());
  
    const deleted = await stub.deleteColumn("fac1", remove.column!.id);
    expect(deleted.success).toBe(true);
  
    const after = await stub.getRoomState();
    expect(after.columns).toEqual([{ id: keep.column!.id, name: "Keep", order: 0 }]);
    expect(after.groups).toEqual([{ id: keepGroup.group!.id, name: "Keep group", columnId: keep.column!.id, order: 0 }]);
    expect(after.items.sort((a, b) => a.text.localeCompare(b.text))).toEqual([
      expect.objectContaining({ id: keepFreeItem.item!.id, text: "Keep free item", columnId: keep.column!.id, groupId: null, order: 0 }),
      expect.objectContaining({ id: keepItem.item!.id, text: "Keep item", columnId: keep.column!.id, groupId: keepGroup.group!.id, order: 0 }),
    ]);
    expect(after.votes).toEqual([
      { participantId: "fac1", target: groupVoteTarget(keepGroup.group!.id), count: 1 },
      { participantId: "fac1", target: itemVoteTarget(keepFreeItem.item!.id), count: 1 },
    ]);
    expect(after.version).toBe(before.version + 1);
  });
  
  it("deletes the final column without recreating defaults or allowing invalid item adds", async () => {
    const stub = await init("test-v2-column-delete-last");
    await stub.join("fac1", "Facilitator");
    await deleteAllColumns(stub);
    const last = await stub.createColumn("fac1", "Last");
    await stub.addItem("fac1", "Only item", last.column!.id);
  
    const deleted = await stub.deleteColumn("fac1", last.column!.id);
    expect(deleted.success).toBe(true);
  
    const state = await stub.getRoomState();
    expect(state.columns).toEqual([]);
    expect(state.groups).toEqual([]);
    expect(state.items).toEqual([]);
    expect(state.votes).toEqual([]);
  
    const add = await stub.addItem("fac1", "No lane", last.column!.id);
    expect(add.success).toBe(false);
    expect(add.error).toBe("Column not found");
    expect(await stub.getRoomState()).toEqual(state);
  });
  
  it("rejects participant and late-phase column CRUD without changing state or version", async () => {
    const stub = await init("test-v2-column-crud-rejects");
    await stub.join("fac1", "Facilitator");
    await stub.join("p2", "Participant");
    const first = await stub.createColumn("fac1", "First");
    const second = await stub.createColumn("fac1", "Second");
  
    const beforeParticipant = await stub.getRoomState();
    await expect(stub.createColumn("p2", "Participant create")).resolves.toMatchObject({ success: false });
    await expect(stub.editColumn("p2", first.column!.id, "Participant rename")).resolves.toMatchObject({ success: false });
    await expect(stub.reorderColumns("p2", [second.column!.id, first.column!.id])).resolves.toMatchObject({ success: false });
    await expect(stub.deleteColumn("p2", first.column!.id)).resolves.toMatchObject({ success: false });
    expect(await stub.getRoomState()).toEqual(beforeParticipant);
  
    await stub.setPhase("fac1", "organise");
    await stub.setPhase("fac1", "vote");
    const beforeVotePhase = await stub.getRoomState();
    await expect(stub.createColumn("fac1", "Late create")).resolves.toMatchObject({ success: false });
    await expect(stub.editColumn("fac1", first.column!.id, "Late rename")).resolves.toMatchObject({ success: false });
    await expect(stub.reorderColumns("fac1", [second.column!.id, first.column!.id])).resolves.toMatchObject({ success: false });
    await expect(stub.deleteColumn("fac1", first.column!.id)).resolves.toMatchObject({ success: false });
    expect(await stub.getRoomState()).toEqual(beforeVotePhase);
  
    await stub.setPhase("fac1", "review");
    const beforeReviewPhase = await stub.getRoomState();
    await expect(stub.createColumn("fac1", "Review create")).resolves.toMatchObject({ success: false });
    await expect(stub.editColumn("fac1", first.column!.id, "Review rename")).resolves.toMatchObject({ success: false });
    await expect(stub.reorderColumns("fac1", [second.column!.id, first.column!.id])).resolves.toMatchObject({ success: false });
    await expect(stub.deleteColumn("fac1", first.column!.id)).resolves.toMatchObject({ success: false });
    expect(await stub.getRoomState()).toEqual(beforeReviewPhase);
  });
   });
