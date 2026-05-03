import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { Effect } from "effect";
import type { ReactionTarget, RoomState } from "../domain";
import {
  getReactionCount,
  getReactionsForTarget,
  hasParticipantReaction,
  voteTargetKey,
} from "../domain";
import { loadEmojiPicker } from "./emoji-picker-effect";
import {
  shouldCloseReactionMenuForKeyEffect,
  shouldCloseReactionMenuForPointerEffect,
} from "./reaction-menu-close";
import { getReactionMenuPositionEffect } from "./reaction-menu-position";

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

export function ReactionBar({
  roomState,
  target,
  participantId,
  send,
  label,
  compact = false,
  stopPropagation = false,
}: ReactionBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const [pickerReady, setPickerReady] = useState(
    typeof window !== "undefined" &&
      customElements.get("emoji-picker") !== undefined,
  );
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const pickerRef = useRef<HTMLElement | null>(null);
  const activeEmojis = Array.from(
    new Set(
      getReactionsForTarget(roomState.reactions, target).map(
        (reaction) => reaction.emoji,
      ),
    ),
  );

  useEffect(() => {
    if (pickerReady) return;
    let cancelled = false;
    void loadPicker();
    return () => {
      cancelled = true;
    };

    async function loadPicker() {
      try {
        await loadEmojiPicker();
        if (!cancelled) setPickerReady(true);
      } catch {
        if (!cancelled) setPickerReady(false);
      }
    }
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
      const rawDetail = (
        event as CustomEvent<
          | { unicode?: string; emoji?: { unicode?: string } }
          | Promise<{ unicode?: string; emoji?: { unicode?: string } }>
        >
      ).detail;
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
      setMenuStyle(
        Effect.runSync(
          getReactionMenuPositionEffect({
            anchorRect: {
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
            },
            viewport: {
              width: window.innerWidth,
              height: window.innerHeight,
            },
            picker: {
              width: PICKER_WIDTH,
              height: PICKER_HEIGHT,
              gutter: PICKER_GUTTER,
              offset: PICKER_OFFSET,
            },
          }),
        ),
      );
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
      const shouldClose = Effect.runSync(
        shouldCloseReactionMenuForPointerEffect({
          targetNode,
          menu: menuRef.current,
          addButton: addButtonRef.current,
        }),
      );
      if (shouldClose) setMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (Effect.runSync(shouldCloseReactionMenuForKeyEffect(event.key))) {
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

  const reactionMenu =
    menuOpen && menuStyle && typeof document !== "undefined"
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
              <div
                className="reaction-picker reaction-picker--loading"
                role="status"
              >
                Loading emojis…
              </div>
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      className={`reaction-bar${compact ? " reaction-bar--compact" : ""}`}
      aria-label={`Reactions for ${label}`}
      data-reaction-target={voteTargetKey(target)}
    >
      {activeEmojis.map((emoji) => {
        const count = getReactionCount(roomState.reactions, target, emoji);
        const selected = hasParticipantReaction(
          roomState.reactions,
          participantId,
          target,
          emoji,
        );
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
            <span className="reaction-pill__emoji" aria-hidden="true">
              {emoji}
            </span>
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
