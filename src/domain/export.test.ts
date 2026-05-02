import { describe, expect, it } from "vitest";
import type { RoomState } from "./types";
import {
  buildAnonymousRetroExport,
  formatActionsCsv,
  formatActionsJson,
  formatActionsMarkdown,
  formatRetroExportMarkdown,
  groupVoteTarget,
  itemVoteTarget,
} from ".";

function makeExportState(): RoomState {
  return {
    schemaVersion: 2,
    roomId: "room-export",
    startedAt: 1000,
    purgeScheduledAt: null,
    phase: "finalize",
    participants: [
      { id: "fac1", displayName: "Alice", isFacilitator: true },
      { id: "p2", displayName: "Bob", isFacilitator: false },
    ],
    columns: [
      { id: "col-1", name: "Went well", order: 0 },
      { id: "col-2", name: "Improve", order: 1 },
    ],
    groups: [{ id: "group-1", name: "Release", columnId: "col-1", order: 0 }],
    items: [
      { id: "item-1", text: "Demo worked", authorId: "fac1", columnId: "col-1", groupId: "group-1", order: 0 },
      { id: "item-2", text: "Need clearer owner", authorId: "p2", columnId: "col-2", groupId: null, order: 0 },
    ],
    votes: [
      { participantId: "fac1", target: groupVoteTarget("group-1"), count: 2 },
      { participantId: "p2", target: groupVoteTarget("group-1"), count: 1 },
      { participantId: "p2", target: itemVoteTarget("item-2"), count: 1 },
    ],
    actions: [{ id: "action-1", text: "Alice to create launch checklist", authorId: "fac1", order: 0 }],
    timer: { startedAt: null, durationSeconds: null, expired: false },
    voteBudget: 5,
    version: 12,
  };
}

describe("anonymous retro exports", () => {
  it("exports the full retro without participant identities", () => {
    const exportData = buildAnonymousRetroExport(makeExportState(), "2026-05-01T12:00:00.000Z");

    expect(exportData).toMatchObject({
      schemaVersion: 1,
      exportedAt: "2026-05-01T12:00:00.000Z",
      roomId: "room-export",
      actions: [{ id: "action-1", text: "Alice to create launch checklist", order: 0 }],
    });
    expect(exportData.items[0]).not.toHaveProperty("authorId");
    expect(exportData.actions[0]).not.toHaveProperty("authorId");
    expect(exportData.votes).toEqual([
      { target: { type: "group", id: "group-1" }, totalVotes: 3 },
      { target: { type: "item", id: "item-2" }, totalVotes: 1 },
    ]);
  });

  it("formats full markdown and action-only markdown/json/csv", () => {
    const exportData = buildAnonymousRetroExport(makeExportState(), "2026-05-01T12:00:00.000Z");

    expect(formatRetroExportMarkdown(exportData)).toContain("#### Release (3 votes)");
    expect(formatRetroExportMarkdown(exportData)).toContain("- [ ] Alice to create launch checklist");
    expect(formatActionsMarkdown(exportData.actions)).toBe("- [ ] Alice to create launch checklist\n");
    expect(formatActionsJson(exportData.actions)).toContain("\"text\": \"Alice to create launch checklist\"");
    expect(formatActionsCsv(exportData.actions)).toBe("order,text\n1,Alice to create launch checklist\n");
  });
});
