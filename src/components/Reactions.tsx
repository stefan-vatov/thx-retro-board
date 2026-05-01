import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { ReactionTarget, RoomState } from "../domain";
import { getReactionCount, getReactionsForTarget, hasParticipantReaction, voteTargetKey } from "../domain";

interface ReactionBarProps {
  roomState: Pick<RoomState, "reactions">;
  target: ReactionTarget;
  participantId: string;
  send: (message: unknown) => boolean;
  label: string;
  compact?: boolean;
  stopPropagation?: boolean;
}

export function ReactionBar({ roomState, target, participantId, send, label, compact = false, stopPropagation = false }: ReactionBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerReady, setPickerReady] = useState(typeof window !== "undefined" && customElements.get("emoji-picker") !== undefined);
  const pickerRef = useRef<HTMLElement | null>(null);
  const activeEmojis = Array.from(new Set(getReactionsForTarget(roomState.reactions, target).map((reaction) => reaction.emoji)));

  useEffect(() => {
    if (pickerReady) return;
    let cancelled = false;
    import("emoji-picker-element").then(() => {
      if (!cancelled) setPickerReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [pickerReady]);

  function toggleReaction(emoji: string) {
    send({ type: "toggle-reaction", target, emoji });
    setMenuOpen(false);
  }

  const handlePickedEmoji = useEffectEvent((emoji: string) => {
    toggleReaction(emoji);
  });

  useEffect(() => {
    if (!menuOpen) return;
    const picker = pickerRef.current;
    if (!picker) return;

    function handleEmojiClick(event: Event) {
      const detail = (event as CustomEvent<{ unicode?: string }>).detail;
      if (detail.unicode) handlePickedEmoji(detail.unicode);
    }

    picker.addEventListener("emoji-click", handleEmojiClick);
    return () => picker.removeEventListener("emoji-click", handleEmojiClick);
  }, [menuOpen]);

  return (
    <div className={`reaction-bar${compact ? " reaction-bar--compact" : ""}`} aria-label={`Reactions for ${label}`} data-reaction-target={voteTargetKey(target)}>
      {activeEmojis.map((emoji) => {
        const count = getReactionCount(roomState.reactions, target, emoji);
        const selected = hasParticipantReaction(roomState.reactions, participantId, target, emoji);
        return (
          <button
            key={emoji}
            type="button"
            className={`reaction-pill${selected ? " reaction-pill--selected" : ""}${count > 0 ? " reaction-pill--active" : ""}`}
            onClick={(event) => {
              if (stopPropagation) event.stopPropagation();
              toggleReaction(emoji);
            }}
            aria-pressed={selected}
            aria-label={`${selected ? "Remove" : "Add"} ${emoji} reaction ${count > 0 ? `(${count})` : ""} for ${label}`}
          >
            <span className="reaction-pill__emoji" aria-hidden="true">{emoji}</span>
            {count > 0 && <span className="reaction-pill__count">{count}</span>}
          </button>
        );
      })}
      <div className="reaction-add">
        <button
          type="button"
          className="reaction-add__button"
          onClick={(event) => {
            if (stopPropagation) event.stopPropagation();
            setMenuOpen((open) => !open);
          }}
          aria-expanded={menuOpen}
          aria-label={`Add reaction for ${label}`}
        >
          +
        </button>
        {menuOpen && (
          <div
            className="reaction-menu"
            onClick={(event) => {
              if (stopPropagation) event.stopPropagation();
            }}
            onKeyDown={(event) => {
              if (stopPropagation) event.stopPropagation();
            }}
          >
            {pickerReady ? (
              <emoji-picker ref={pickerRef} className="reaction-picker" />
            ) : (
              <div className="reaction-picker reaction-picker--loading" role="status">Loading emojis…</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
