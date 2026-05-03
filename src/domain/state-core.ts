import { Effect } from "effect";
import type {
  ActionItem,
  Column,
  Group,
  Participant,
  Phase,
  RetroItem,
  RoomState,
  TimerState,
} from "./types";
import { sanitizeActionText } from "./state-sanitize";

export const DEFAULT_COLUMNS: readonly Column[] = [
  { id: "mad", name: "Mad", order: 0 },
  { id: "glad", name: "Glad", order: 1 },
  { id: "sad", name: "Sad", order: 2 },
] as const;

export const MAX_COLUMNS = 8;

export class ColumnValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ColumnValidationError";
  }
}

export function getDefaultColumns(): Column[] {
  return DEFAULT_COLUMNS.map((column) => ({ ...column }));
}

export function createRoomState(roomId: string, voteBudget: number = 5): RoomState {
  return {
    roomId,
    schemaVersion: 2,
    startedAt: Date.now(),
    purgeScheduledAt: null,
    phase: "setup",
    participants: [],
    items: [],
    columns: getDefaultColumns(),
    groups: [],
    votes: [],
    rankingMethod: "score",
    pairwiseChoices: [],
    pairwiseProgress: [],
    reviewTargetKey: null,
    actions: [],
    reactions: [],
    timer: { startedAt: null, durationSeconds: null, expired: false },
    voteBudget,
    version: 0,
  };
}

export function createRoomStateEffect(roomId: string, voteBudget: number = 5): Effect.Effect<RoomState> {
  return Effect.sync(() => createRoomState(roomId, voteBudget));
}

export function createParticipant(id: string, displayName: string, isFacilitator: boolean): Participant {
  return { id, displayName, isFacilitator };
}

export function createItem(
  id: string,
  text: string,
  authorId: string,
  order: number,
  columnId: string,
  groupId: string | null = null,
): RetroItem {
  return { id, text, authorId, columnId, groupId, order };
}

export function createGroup(id: string, name: string, columnId: string | number, order?: number): Group {
  if (typeof columnId === "number") {
    return { id, name, columnId: "", order: columnId };
  }
  return { id, name, columnId, order: order ?? 0 };
}

export function createColumn(id: string, name: string, order: number): Column {
  return { id, name, order };
}

export function createActionItem(id: string, text: string, authorId: string, order: number): ActionItem {
  return { id, text: sanitizeActionText(text), authorId, order };
}

export const PHASE_ORDER: readonly Phase[] = ["setup", "write", "organise", "vote", "review", "finalize"] as const;

export function canTransition(from: Phase, to: Phase): boolean {
  const fromIndex = PHASE_ORDER.indexOf(from);
  const toIndex = PHASE_ORDER.indexOf(to);
  return toIndex === fromIndex + 1;
}

export function isPhaseAllowed(actionPhase: Phase, currentPhase: Phase): boolean {
  return actionPhase === currentPhase;
}

export function isTimerExpired(timer: TimerState): boolean {
  if (timer.startedAt === null || timer.durationSeconds === null) return false;
  const elapsed = (Date.now() - timer.startedAt) / 1000;
  return elapsed >= timer.durationSeconds;
}

export function validateExistingColumnId(
  columns: Column[],
  columnId: unknown,
): { valid: true; columnId: string } | { valid: false; error: string } {
  if (typeof columnId !== "string" || columnId.trim().length === 0) {
    return { valid: false, error: "Column is required" };
  }
  if (!columns.some((column) => column.id === columnId)) {
    return { valid: false, error: "Column not found" };
  }
  return { valid: true, columnId };
}

export function validateExistingColumnIdEffect(
  columns: Column[],
  columnId: unknown,
): Effect.Effect<string, ColumnValidationError> {
  return Effect.gen(function* () {
    const result = validateExistingColumnId(columns, columnId);
    if (!result.valid) {
      return yield* Effect.fail(new ColumnValidationError(result.error));
    }
    return result.columnId;
  });
}
