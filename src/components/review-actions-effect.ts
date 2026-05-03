import { Effect } from "effect";
import { isValidActionText, sanitizeActionText } from "../domain";

export type CreateActionMessage = {
  type: "create-action";
  text: string;
};

export type EditActionMessage = {
  type: "edit-action";
  actionId: string;
  text: string;
};

export type DeleteActionMessage = {
  type: "delete-action";
  actionId: string;
};

export type ActionCommandResult<TMessage> =
  | { success: true; message: TMessage }
  | { success: false; error: string };

export function buildActionCreateCommandEffect(
  rawText: string,
): Effect.Effect<ActionCommandResult<CreateActionMessage>> {
  return Effect.sync(() => {
    const text = sanitizeActionText(rawText);
    if (!isValidActionText(text)) {
      return { success: false, error: "Add a clear action before saving." };
    }
    return { success: true, message: { type: "create-action", text } };
  });
}

export function buildActionEditCommandEffect(
  actionId: string,
  rawText: string,
): Effect.Effect<ActionCommandResult<EditActionMessage>> {
  return Effect.sync(() => {
    const text = sanitizeActionText(rawText);
    if (!isValidActionText(text)) {
      return { success: false, error: "Action text cannot be empty." };
    }
    return { success: true, message: { type: "edit-action", actionId, text } };
  });
}

export function buildActionDeleteCommandEffect(
  actionId: string,
): Effect.Effect<DeleteActionMessage> {
  return Effect.sync(() => ({ type: "delete-action", actionId }));
}
