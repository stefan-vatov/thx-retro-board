import { env } from "cloudflare:workers";
import { expect } from "vitest";
import type { RoomState } from "../src/domain";

const testEnv = env as unknown as {
  RETRO_ROOM: DurableObjectNamespace;
};

type RetroRoomTestStub = {
  initRoom: (roomId: string) => Promise<void>;
  getRoomState: () => Promise<RoomState>;
  setPhaseForTest: (phase: RoomState["phase"]) => Promise<void>;
  createColumn: (...args: never[]) => Promise<unknown>;
  editColumn: (...args: never[]) => Promise<unknown>;
  reorderColumns: (...args: never[]) => Promise<unknown>;
  deleteColumn: (...args: never[]) => Promise<unknown>;
};

export async function initRaw(roomId: string) {
  const id = testEnv.RETRO_ROOM.idFromName(roomId);
  const stub = testEnv.RETRO_ROOM.get(id) as unknown as RetroRoomTestStub;
  await stub.initRoom(roomId);
  return stub;
}

export async function init(roomId: string) {
  const stub = await initRaw(roomId);
  await stub.setPhaseForTest("write");
  return withWritePhaseColumnSetup(stub);
}

function withWritePhaseColumnSetup<T extends {
  getRoomState: () => Promise<RoomState>;
  setPhaseForTest: (phase: RoomState["phase"]) => Promise<void>;
  createColumn: (...args: never[]) => Promise<unknown>;
  editColumn: (...args: never[]) => Promise<unknown>;
  reorderColumns: (...args: never[]) => Promise<unknown>;
  deleteColumn: (...args: never[]) => Promise<unknown>;
}>(stub: T): T {
  async function runColumnSetup(method: keyof Pick<T, "createColumn" | "editColumn" | "reorderColumns" | "deleteColumn">, args: never[]) {
    const phase = (await stub.getRoomState()).phase;
    if (phase !== "write" || args[0] !== "fac1") {
      return stub[method](...args);
    }
    await stub.setPhaseForTest("setup");
    const result = await stub[method](...args);
    await stub.setPhaseForTest("write");
    return result;
  }

  return new Proxy(stub, {
    get(target, prop, receiver) {
      if (prop === "createColumn" || prop === "editColumn" || prop === "reorderColumns" || prop === "deleteColumn") {
        return (...args: never[]) => runColumnSetup(prop, args);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

export async function freshMovePreconditions(stub: { getRoomState: () => Promise<RoomState> }, itemId: string) {
  const state = await stub.getRoomState();
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error(`Missing item ${itemId}`);
  return {
    expectedVersion: state.version,
    sourceGroupId: item.groupId,
    sourceIndex: item.order,
  };
}

export async function freshItemReorderPreconditions(stub: { getRoomState: () => Promise<RoomState> }, itemId: string) {
  const state = await stub.getRoomState();
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error(`Missing item ${itemId}`);
  return {
    expectedVersion: state.version,
    sourceColumnId: item.columnId,
    sourceGroupId: item.groupId,
  };
}

export async function freshGroupReorderVersion(stub: { getRoomState: () => Promise<RoomState> }) {
  return (await stub.getRoomState()).version;
}

export async function deleteAllColumns(stub: {
  getRoomState: () => Promise<RoomState>;
  deleteColumn: (participantId: string, columnId: string) => Promise<{ success: boolean; error?: string }>;
}, participantId = "fac1") {
  const state = await stub.getRoomState();
  for (const column of state.columns) {
    const result = await stub.deleteColumn(participantId, column.id);
    expect(result.success).toBe(true);
  }
}
