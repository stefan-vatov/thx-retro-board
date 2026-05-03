import { type KeyboardEvent } from "react";
import type { RoomState, VoteTarget } from "../domain";
import { getGroupedItems, itemVoteTarget } from "../domain";
import { ReactionBar } from "./Reactions";

export function PairwiseOption({
  roomState,
  participantId,
  send,
  target,
  label,
  columnName,
  selected,
  pending,
  disabled,
  onChoose,
}: {
  roomState: RoomState;
  participantId: string;
  send: (message: unknown) => boolean;
  target: VoteTarget;
  label: string;
  columnName: string;
  selected: boolean;
  pending: boolean;
  disabled: boolean;
  onChoose: () => void;
}) {
  const groupItems =
    target.type === "group"
      ? getGroupedItems(roomState.items, target.id).sort(
          (a, b) => a.order - b.order,
        )
      : [];
  const item =
    target.type === "item"
      ? (roomState.items.find((candidate) => candidate.id === target.id) ??
        null)
      : null;
  const group = item?.groupId
    ? (roomState.groups.find((candidate) => candidate.id === item.groupId) ??
      null)
    : null;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onChoose();
    }
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      className={`pairwise-option${selected ? " pairwise-option--selected" : ""}${pending ? " pairwise-option--pending" : ""}`}
      aria-disabled={disabled}
      aria-pressed={selected}
      onClick={() => {
        if (!disabled) onChoose();
      }}
      onKeyDown={handleKeyDown}
    >
      <span className="pairwise-option__title">{label}</span>
      <small className="pairwise-option__kind">{columnName}</small>
      <ReactionBar
        roomState={roomState}
        target={target}
        participantId={participantId}
        send={send}
        label={label}
        compact
        stopPropagation
      />
      {target.type === "group" ? (
        <div
          className="pairwise-option__cards"
          aria-label={`Cards in ${label}`}
        >
          {groupItems.length > 0 ? (
            <ul>
              {groupItems.map((item) => (
                <li key={item.id}>
                  <span>{item.text}</span>
                  <ReactionBar
                    roomState={roomState}
                    target={itemVoteTarget(item.id)}
                    participantId={participantId}
                    send={send}
                    label={item.text}
                    compact
                    stopPropagation
                  />
                </li>
              ))}
            </ul>
          ) : (
            <small>No cards in this group.</small>
          )}
        </div>
      ) : (
        <small className="pairwise-option__kind">
          {group ? `Card in ${group.name}` : "Ungrouped card"}
        </small>
      )}
      <strong>
        {pending ? "Saving..." : selected ? "Selected" : "Choose this"}
      </strong>
    </div>
  );
}
