import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { RoomState } from "../domain";
import { createRoomState } from "../domain";
import { getSortedColumns, getSortedColumnsEffect } from "./room-columns";

function makeRoomState(columns: RoomState["columns"]): RoomState {
  return {
    ...createRoomState("room-columns"),
    columns,
  };
}

describe("room column helpers", () => {
  it("sorts room columns by order", () => {
    const state = makeRoomState([
      { id: "later", name: "Later", order: 2 },
      { id: "first", name: "First", order: 0 },
      { id: "middle", name: "Middle", order: 1 },
    ]);

    expect(getSortedColumns(state).map((column) => column.id)).toEqual(["first", "middle", "later"]);
  });

  it("sorts room columns through Effect", async () => {
    const state = makeRoomState([
      { id: "later", name: "Later", order: 2 },
      { id: "first", name: "First", order: 0 },
      { id: "middle", name: "Middle", order: 1 },
    ]);

    await expect(Effect.runPromise(getSortedColumnsEffect(state))).resolves.toEqual(getSortedColumns(state));
  });
});
