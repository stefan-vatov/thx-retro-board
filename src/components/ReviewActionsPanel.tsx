import { Effect } from "effect";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import type { ActionItem } from "../domain";
import { MAX_ACTION_TEXT_LENGTH } from "../domain";
import { submitFormOnModEnter } from "./form-shortcuts";
import {
  buildActionCreateCommandEffect,
  buildActionDeleteCommandEffect,
  buildActionEditCommandEffect,
} from "./review-actions-effect";

export function ActionItemsPanel({
  actions,
  send,
  serverError,
  clearServerError,
}: {
  actions: ActionItem[];
  send: (message: unknown) => boolean;
  serverError?: string | null;
  clearServerError?: () => void;
}) {
  const sortedActions = useMemo(
    () => [...(actions ?? [])].sort((a, b) => a.order - b.order),
    [actions],
  );
  const [newActionText, setNewActionText] = useState("");
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const command = Effect.runSync(
      buildActionCreateCommandEffect(newActionText),
    );
    if (!command.success) {
      setLocalError(command.error);
      return;
    }
    clearServerError?.();
    setLocalError(null);
    const sent = send(command.message);
    if (!sent) {
      setLocalError("Action not saved. Reconnect and try again.");
      return;
    }
    setNewActionText("");
  }

  function startEdit(action: ActionItem) {
    clearServerError?.();
    setLocalError(null);
    setEditingActionId(action.id);
    setEditingText(action.text);
  }

  function cancelEdit() {
    setEditingActionId(null);
    setEditingText("");
  }

  function saveEdit(actionId: string) {
    const command = Effect.runSync(
      buildActionEditCommandEffect(actionId, editingText),
    );
    if (!command.success) {
      setLocalError(command.error);
      return;
    }
    clearServerError?.();
    setLocalError(null);
    const sent = send(command.message);
    if (!sent) {
      setLocalError("Action not updated. Reconnect and try again.");
      return;
    }
    cancelEdit();
  }

  function deleteAction(actionId: string) {
    clearServerError?.();
    setLocalError(null);
    const sent = send(Effect.runSync(buildActionDeleteCommandEffect(actionId)));
    if (!sent) {
      setLocalError("Action not deleted. Reconnect and try again.");
      return;
    }
    if (editingActionId === actionId) cancelEdit();
  }

  return (
    <aside className="review-actions-panel" aria-label="Action items">
      <div className="review-actions-panel__header">
        <div>
          <p className="review-slide__eyebrow">Action items</p>
          <h3>Assign next steps</h3>
        </div>
        <span className="review-section-count">{sortedActions.length}</span>
      </div>

      <form className="review-action-form" onSubmit={handleCreate}>
        <label className="sr-only" htmlFor="review-action-input">
          New action item
        </label>
        <input
          id="review-action-input"
          className="input review-action-form__input"
          maxLength={MAX_ACTION_TEXT_LENGTH}
          value={newActionText}
          onChange={(event) => {
            setNewActionText(event.target.value);
            setLocalError(null);
          }}
          onKeyDown={submitFormOnModEnter}
          placeholder="Add a concrete owner/action..."
        />
        <button
          type="submit"
          className="btn btn--primary review-action-form__button"
        >
          Add
        </button>
      </form>

      {localError || serverError ? (
        <p
          className="status-msg status-msg--error review-action-error"
          role="alert"
        >
          {localError ?? serverError}
        </p>
      ) : null}

      {sortedActions.length === 0 ? (
        <div className="review-action-empty">
          <p>No actions assigned yet.</p>
          <span>
            Capture decisions as short, concrete follow-ups while the team is
            aligned.
          </span>
        </div>
      ) : (
        <ol className="review-action-list">
          {sortedActions.map((action, index) => (
            <ActionRow
              key={action.id}
              action={action}
              index={index}
              isEditing={editingActionId === action.id}
              editingText={editingText}
              setEditingText={setEditingText}
              setLocalError={setLocalError}
              startEdit={startEdit}
              cancelEdit={cancelEdit}
              saveEdit={saveEdit}
              deleteAction={deleteAction}
            />
          ))}
        </ol>
      )}
    </aside>
  );
}

function ActionRow({
  action,
  index,
  isEditing,
  editingText,
  setEditingText,
  setLocalError,
  startEdit,
  cancelEdit,
  saveEdit,
  deleteAction,
}: {
  action: ActionItem;
  index: number;
  isEditing: boolean;
  editingText: string;
  setEditingText: (value: string) => void;
  setLocalError: (value: string | null) => void;
  startEdit: (action: ActionItem) => void;
  cancelEdit: () => void;
  saveEdit: (actionId: string) => void;
  deleteAction: (actionId: string) => void;
}) {
  return (
    <li className="review-action-row">
      <span className="review-action-row__index" aria-hidden="true">
        {index + 1}
      </span>
      <div className="review-action-row__body">
        {isEditing ? (
          <div className="review-action-edit">
            <input
              className="input review-action-edit__input"
              maxLength={MAX_ACTION_TEXT_LENGTH}
              value={editingText}
              onChange={(event) => {
                setEditingText(event.target.value);
                setLocalError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  saveEdit(action.id);
                }
              }}
              aria-label={`Edit action ${index + 1}`}
            />
            <div className="review-action-row__controls">
              <ActionIconButton
                className="review-action-icon review-action-icon--save"
                onClick={() => saveEdit(action.id)}
                label={`Save action ${index + 1}`}
                title="Save"
                icon={<Check size={14} aria-hidden="true" />}
              />
              <ActionIconButton
                onClick={cancelEdit}
                label={`Cancel editing action ${index + 1}`}
                title="Cancel"
                icon={<X size={14} aria-hidden="true" />}
              />
              <ActionIconButton
                className="review-action-icon review-action-icon--danger"
                onClick={() => deleteAction(action.id)}
                label={`Delete action ${index + 1}`}
                title="Delete"
                icon={<Trash2 size={14} aria-hidden="true" />}
              />
            </div>
          </div>
        ) : (
          <>
            <p className="review-action-row__text">{action.text}</p>
            <div className="review-action-row__controls">
              <ActionIconButton
                onClick={() => startEdit(action)}
                label={`Edit action ${index + 1}`}
                title="Edit"
                icon={<Pencil size={14} aria-hidden="true" />}
              />
              <ActionIconButton
                className="review-action-icon review-action-icon--danger"
                onClick={() => deleteAction(action.id)}
                label={`Delete action ${index + 1}`}
                title="Delete"
                icon={<Trash2 size={14} aria-hidden="true" />}
              />
            </div>
          </>
        )}
      </div>
    </li>
  );
}

function ActionIconButton({
  className = "review-action-icon",
  onClick,
  label,
  title,
  icon,
}: {
  className?: string;
  onClick: () => void;
  label: string;
  title: string;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      aria-label={label}
      title={title}
    >
      {icon}
    </button>
  );
}
