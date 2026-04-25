import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { RoomState, Column } from "../domain";
import { MAX_COLUMNS } from "../domain";
import { OrganiseBoard } from "./OrganiseBoard";

function makeRoomState(columns: Column[], phase: RoomState["phase"] = "organise"): RoomState {
  return {
    roomId: "room-organise-columns",
    phase,
    participants: [{ id: "fac1", displayName: "Alice", isFacilitator: true }],
    items: [],
    columns,
    groups: columns,
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

describe("OrganiseBoard column creation feedback", () => {
  it("disables facilitator column creation and shows a local max-column message at the limit", () => {
    const markup = renderToStaticMarkup(
      createElement(OrganiseBoard, {
        roomState: makeRoomState(makeColumns(MAX_COLUMNS)),
        isFacilitator: true,
        send: () => undefined,
      }),
    );

    expect(markup).toContain(`Rooms can have at most ${MAX_COLUMNS} columns.`);
    expect(markup).toContain("disabled");
    expect(markup).toContain("Create Column");
  });

  it("renders server-side create-column errors from lastError without hiding local feedback", () => {
    const serverError = `Server column rejection: Rooms can have at most ${MAX_COLUMNS} columns`;
    const markup = renderToStaticMarkup(
      createElement(OrganiseBoard, {
        roomState: makeRoomState(makeColumns(MAX_COLUMNS)),
        isFacilitator: true,
        send: () => undefined,
        serverError,
      }),
    );

    expect(markup).toContain(`Rooms can have at most ${MAX_COLUMNS} columns.`);
    expect(markup).toContain(serverError);
  });

  it("does not expose facilitator-only column creation controls to non-facilitators", () => {
    const markup = renderToStaticMarkup(
      createElement(OrganiseBoard, {
        roomState: makeRoomState(makeColumns(3)),
        isFacilitator: false,
        send: () => undefined,
      }),
    );

    expect(markup).not.toContain("Create Column");
    expect(markup).not.toContain("New column name");
  });
});
