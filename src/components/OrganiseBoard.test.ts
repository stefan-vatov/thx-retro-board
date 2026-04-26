import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { RoomState, Column, Group, RetroItem } from "../domain";
import { OrganiseBoard } from "./OrganiseBoard";

function makeRoomState(columns: Column[], phase: RoomState["phase"] = "organise", groups: Group[] = [], items: RetroItem[] = []): RoomState {
  return {
    schemaVersion: 2,
    roomId: "room-organise-columns",
    phase,
    participants: [{ id: "fac1", displayName: "Alice", isFacilitator: true }],
    items,
    columns,
    groups,
    votes: [],
    timer: { startedAt: null, durationSeconds: null, expired: false },
    voteBudget: 5,
    version: 1,
  };
}

function makeColumns(count: number): Column[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `column-${index}`,
    name: `Column ${index + 1}`,
    order: index,
  }));
}

describe("OrganiseBoard group feedback", () => {
  it("renders server-side organise errors from lastError", () => {
    const serverError = "Cannot move item to a group in another column";
    const markup = renderToStaticMarkup(
      createElement(OrganiseBoard, {
        roomState: makeRoomState(makeColumns(1)),
        isFacilitator: false,
        send: () => undefined,
        serverError,
      }),
    );

    expect(markup).toContain(serverError);
  });

  it("exposes group creation controls to non-facilitators during organise", () => {
    const markup = renderToStaticMarkup(
      createElement(OrganiseBoard, {
        roomState: makeRoomState(makeColumns(1)),
        isFacilitator: false,
        send: () => undefined,
      }),
    );

    expect(markup).toContain("Create group");
    expect(markup).toContain("New group name for Column 1");
  });
});

describe("OrganiseBoard column-scoped group layout", () => {
  it("renders one organise lane per configured column with scoped ungrouped items and group cards", () => {
    const columns = makeColumns(2);
    const groups: Group[] = [
      { id: "group-1", name: "First group", columnId: "column-0", order: 0 },
    ];
    const items: RetroItem[] = [
      { id: "item-1", text: "First ungrouped", authorId: "fac1", columnId: "column-0", groupId: null, order: 0 },
      { id: "item-2", text: "Second ungrouped", authorId: "fac1", columnId: "column-1", groupId: null, order: 0 },
      { id: "item-3", text: "Grouped item", authorId: "fac1", columnId: "column-0", groupId: "group-1", order: 0 },
    ];

    const markup = renderToStaticMarkup(
      createElement(OrganiseBoard, {
        roomState: makeRoomState(columns, "organise", groups, items),
        isFacilitator: true,
        send: () => true,
      }),
    );

    expect(markup).toContain("Organise phase columns");
    expect(markup).toContain("Column 1");
    expect(markup).toContain("Column 2");
    expect(markup).toContain("First group");
    expect(markup).toContain("First ungrouped");
    expect(markup).toContain("Second ungrouped");
    expect(markup).toContain("Grouped item");
    expect(markup).toContain("data-column-id=\"column-0\"");
    expect(markup).toContain("data-column-id=\"column-1\"");
    expect(markup).toContain("data-drop-column-id=\"column-0\"");
    expect(markup).toContain("data-drop-column-id=\"column-1\"");
  });

  it("renders group create, rename, and delete controls inside each column", () => {
    const columns = makeColumns(1);
    const groups: Group[] = [{ id: "group-1", name: "Editable group", columnId: "column-0", order: 0 }];
    const markup = renderToStaticMarkup(
      createElement(OrganiseBoard, {
        roomState: makeRoomState(columns, "organise", groups),
        isFacilitator: false,
        send: () => true,
      }),
    );

    expect(markup).toContain("New group name for Column 1");
    expect(markup).toContain("Create group");
    expect(markup).toContain("Rename Editable group");
    expect(markup).toContain("Delete Editable group");
  });

  it("keeps item drag handles explicitly labelled for pointer-only drag lifecycle tests", () => {
    const columns = makeColumns(1);
    const items: RetroItem[] = [
      { id: "item-1", text: "Clickable item", authorId: "fac1", columnId: "column-0", groupId: null, order: 0 },
    ];
    const markup = renderToStaticMarkup(
      createElement(OrganiseBoard, {
        roomState: makeRoomState(columns, "organise", [], items),
        isFacilitator: true,
        send: () => true,
      }),
    );

    expect(markup).toContain("<button type=\"button\" class=\"drag-handle\" aria-label=\"Drag Clickable item\"");
  });
});
