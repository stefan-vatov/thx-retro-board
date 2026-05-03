import { Effect } from "effect";
import type { Column, Phase } from "../domain";
import {
  isValidColumnName,
  MAX_COLUMNS,
  MAX_COLUMN_NAME_LENGTH,
  sanitizeColumnName,
} from "../domain";

export type ColumnCreateMessage = {
  type: "create-column";
  name: string;
};

export type ColumnEditMessage = {
  type: "edit-column";
  columnId: string;
  name: string;
};

export type ColumnReorderMessage = {
  type: "reorder-columns";
  columnIds: string[];
};

export type ColumnDeleteMessage = {
  type: "delete-column";
  columnId: string;
};

export type SetupCommandResult<TMessage> =
  | { success: true; message: TMessage }
  | { success: false; error: string | null };

function validateColumnName(raw: string): string | null {
  if (!isValidColumnName(raw)) return "Column name cannot be empty.";
  if (raw.trim().length > MAX_COLUMN_NAME_LENGTH) {
    return `Column names must be ${MAX_COLUMN_NAME_LENGTH} characters or fewer.`;
  }
  return null;
}

export function buildColumnCreateCommandEffect({
  phase,
  isAtMax,
  rawName,
}: {
  phase: Phase;
  isAtMax: boolean;
  rawName: string;
}): Effect.Effect<SetupCommandResult<ColumnCreateMessage>> {
  return Effect.sync(() => {
    if (phase !== "setup") {
      return {
        success: false,
        error: "Columns can only be configured during setup.",
      };
    }
    if (isAtMax) {
      return {
        success: false,
        error: `Rooms can have at most ${MAX_COLUMNS} columns.`,
      };
    }
    const validationError = validateColumnName(rawName);
    if (validationError) return { success: false, error: validationError };
    return {
      success: true,
      message: { type: "create-column", name: sanitizeColumnName(rawName) },
    };
  });
}

export function buildColumnEditCommandEffect(
  columnId: string,
  rawName: string,
): Effect.Effect<SetupCommandResult<ColumnEditMessage>> {
  return Effect.sync(() => {
    const validationError = validateColumnName(rawName);
    if (validationError) return { success: false, error: validationError };
    return {
      success: true,
      message: {
        type: "edit-column",
        columnId,
        name: sanitizeColumnName(rawName),
      },
    };
  });
}

export function buildColumnReorderCommandEffect(
  columns: Column[],
  fromIdx: number,
  toIdx: number,
): Effect.Effect<SetupCommandResult<ColumnReorderMessage>> {
  return Effect.sync(() => {
    const reordered = [...columns];
    const [moved] = reordered.splice(fromIdx, 1);
    if (!moved) return { success: false, error: null };
    reordered.splice(toIdx, 0, moved);
    return {
      success: true,
      message: {
        type: "reorder-columns",
        columnIds: reordered.map((column) => column.id),
      },
    };
  });
}

export function buildColumnDeleteCommandEffect(
  columnId: string,
  phase: Phase,
): Effect.Effect<SetupCommandResult<ColumnDeleteMessage>> {
  return Effect.sync(() => {
    if (phase !== "setup") {
      return {
        success: false,
        error: "Columns can only be configured during setup.",
      };
    }
    return { success: true, message: { type: "delete-column", columnId } };
  });
}
