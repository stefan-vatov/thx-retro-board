import { useEffect, useEffectEvent, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
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

const PICKER_WIDTH = 352;
const PICKER_HEIGHT = 384;
const PICKER_GUTTER = 12;
const PICKER_OFFSET = 8;

export function ReactionBar({ roomState, target, participantId, send, label, compact = false, stopPropagation = false }: ReactionBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const [pickerReady, setPickerReady] = useState(typeof window !== "undefined" && customElements.get("emoji-picker") !== undefined);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
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
    let handledSelection = false;

    async function handleEmojiClick(event: Event) {
      if (handledSelection) return;
      handledSelection = true;
      const rawDetail = (event as CustomEvent<
        { unicode?: string; emoji?: { unicode?: string } } | Promise<{ unicode?: string; emoji?: { unicode?: string } }>
      >).detail;
      const detail = await rawDetail;
      const unicode = detail.unicode ?? detail.emoji?.unicode;
      if (unicode) handlePickedEmoji(unicode);
    }

    picker.addEventListener("emoji-click", handleEmojiClick);
    picker.addEventListener("emoji-click-sync", handleEmojiClick);
    return () => {
      picker.removeEventListener("emoji-click", handleEmojiClick);
      picker.removeEventListener("emoji-click-sync", handleEmojiClick);
    };
  }, [menuOpen, menuStyle, pickerReady]);

  useEffect(() => {
    if (!menuOpen) return;

    function updateMenuPosition() {
      const button = addButtonRef.current;
      if (!button) return;

      const rect = button.getBoundingClientRect();
      const width = Math.min(PICKER_WIDTH, window.innerWidth - PICKER_GUTTER * 2);
      const height = Math.min(PICKER_HEIGHT, window.innerHeight - PICKER_GUTTER * 2);
      const spaceAbove = rect.top - PICKER_GUTTER;
      const spaceBelow = window.innerHeight - rect.bottom - PICKER_GUTTER;
      const shouldOpenAbove = spaceAbove >= height || spaceAbove > spaceBelow;
      const rawTop = shouldOpenAbove
        ? rect.top - height - PICKER_OFFSET
        : rect.bottom + PICKER_OFFSET;
      const top = Math.max(PICKER_GUTTER, Math.min(rawTop, window.innerHeight - height - PICKER_GUTTER));
      const rawLeft = rect.right - width + PICKER_OFFSET;
      const left = Math.max(PICKER_GUTTER, Math.min(rawLeft, window.innerWidth - width - PICKER_GUTTER));

      setMenuStyle({ top, left, width, height });
    }

    updateMenuPosition();
    const animationFrame = window.requestAnimationFrame(updateMenuPosition);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const targetNode = event.target instanceof Node ? event.target : null;
      if (!targetNode) return;
      if (menuRef.current?.contains(targetNode) || addButtonRef.current?.contains(targetNode)) return;
      setMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        addButtonRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const reactionMenu = menuOpen && menuStyle && typeof document !== "undefined"
    ? createPortal(
      <div
        ref={menuRef}
        className="reaction-menu reaction-menu--portal"
        style={menuStyle}
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
      </div>,
      document.body,
    )
    : null;

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
          ref={addButtonRef}
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
        {reactionMenu}
      </div>
    </div>
  );
}
