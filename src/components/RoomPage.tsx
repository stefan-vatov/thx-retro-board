import { useState, useEffect, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import { joinRoom, getRoomState, setVoteBudget, setPhase } from "../api";
import { useRoom } from "../hooks";
import type { RoomState, Phase } from "../domain";
import { sanitizeItemText, isValidItemText, PHASE_ORDER } from "../domain";
import { OrganiseBoard } from "./OrganiseBoard";
import { VoteBoard } from "./VoteBoard";
import { ReviewBoard } from "./ReviewBoard";

type PageState = "loading" | "join" | "room" | "not-found";

function mergeRoomState(local: RoomState | null, ws: RoomState | null): RoomState | null {
  if (!local && !ws) return null;
  if (!local) return ws;
  if (!ws) return local;
  if (ws.version >= local.version) return ws;
  return local;
}

function TimerDisplay({ timer }: { timer: RoomState["timer"] }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (timer.startedAt === null || timer.durationSeconds === null) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [timer.startedAt, timer.durationSeconds]);

  if (timer.startedAt === null || timer.durationSeconds === null) {
    return <span className="timer-display">No timer set</span>;
  }

  const elapsed = (now - timer.startedAt) / 1000;
  const remaining = Math.max(0, timer.durationSeconds - elapsed);
  const expired = remaining <= 0;
  const mins = Math.floor(remaining / 60);
  const secs = Math.floor(remaining % 60);

  return (
    <span className={`timer-display${expired ? " timer-display--expired" : " timer-display--running"}`}>
      {expired ? "⏰ Timer expired" : `⏱ ${mins}:${secs.toString().padStart(2, "0")} remaining`}
    </span>
  );
}

function getStoredIdentity(roomId: string): { participantId: string; displayName: string; connectionToken?: string } {
  const pidKey = `retro-participant-${roomId}`;
  const nameKey = `retro-name-${roomId}`;
  const tokenKey = `retro-token-${roomId}`;
  const participantId = localStorage.getItem(pidKey) ?? crypto.randomUUID();
  const displayName = localStorage.getItem(nameKey) ?? "";
  const connectionToken = localStorage.getItem(tokenKey) ?? undefined;
  if (!localStorage.getItem(pidKey)) {
    localStorage.setItem(pidKey, participantId);
  }
  return { participantId, displayName, connectionToken };
}

function ConnectionStatus({ connected }: { connected: boolean }) {
  return (
    <span
      className="connection-badge"
      aria-live="polite"
      aria-label={connected ? "Connected" : "Disconnected"}
    >
      <span
        className={`connection-dot ${connected ? "connection-dot--connected" : "connection-dot--disconnected"}`}
        aria-hidden="true"
      />
      <span className="connection-badge__text">{connected ? "Connected" : "Disconnected"}</span>
    </span>
  );
}

function InviteButton({ roomId }: { roomId: string }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [copySupported] = useState(() => typeof navigator !== "undefined" && typeof navigator.clipboard !== "undefined");
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  function handleInvite() {
    const inviteUrl = `${window.location.origin}/room/${roomId}`;
    if (copySupported) {
      navigator.clipboard.writeText(inviteUrl).then(() => {
        setCopied(true);
        setCopyFailed(false);
        setManualUrl(null);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => {
        // fallback: show manual URL for selection
        setCopied(false);
        setCopyFailed(true);
        setManualUrl(inviteUrl);
      });
    } else {
      // No clipboard API: expose URL for manual selection
      setCopied(false);
      setCopyFailed(true);
      setManualUrl(inviteUrl);
    }
  }

  const accessibleLabel = copied
    ? "Room invite link copied!"
    : copyFailed
    ? "Copy failed — select the URL below"
    : "Copy room invite link";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", alignItems: "flex-end" }}>
      <button
        ref={buttonRef}
        className={`btn btn--secondary btn--sm invite-btn${copied ? " invite-btn--copied" : ""}`}
        onClick={handleInvite}
        aria-label={accessibleLabel}
        type="button"
      >
        {copied ? (
          <>
            <span aria-hidden="true">✓</span>
            Copied!
          </>
        ) : copyFailed ? (
          <>
            <span aria-hidden="true">!</span>
            Error
          </>
        ) : (
          <>
            <span aria-hidden="true">🔗</span>
            Invite
          </>
        )}
      </button>
      {manualUrl && (
        <input
          type="text"
          readOnly
          value={manualUrl}
          aria-label="Room invite URL — select and copy manually"
          style={{
            fontSize: "var(--text-xs)",
            padding: "var(--space-1) var(--space-2)",
            borderRadius: "var(--radius-md)",
            background: "var(--glass-bg)",
            border: "1px solid var(--glass-border)",
            color: "var(--text-secondary)",
            width: "220px",
            cursor: "text",
          }}
          onClick={(e) => (e.target as HTMLInputElement).select()}
        />
      )}
    </div>
  );
}

function ParticipantList({ participants, currentId }: { participants: RoomState["participants"]; currentId: string }) {
  if (!participants || participants.length === 0) {
    return <span className="text-muted">No participants yet</span>;
  }
  return (
    <ul className="participant-list" aria-label="Participants">
      {participants.map((p) => (
        <li key={p.id} className={`participant-chip${p.id === currentId ? " participant-chip--self" : ""}`}>
          <span className="participant-chip__name">{p.displayName}</span>
          {p.isFacilitator && (
            <span className="facilitator-badge facilitator-badge--sm" aria-label={`${p.displayName} is facilitator`}>
              ⭐ Facilitator
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const [pageState, setPageState] = useState<PageState>("loading");
  const [identity] = useState(() => getStoredIdentity(roomId!));
  const [participantId] = useState(() => identity.participantId);
  const [displayName, setDisplayName] = useState(() => identity.displayName);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinLoading, setJoinLoading] = useState(false);
  const [localRoomState, setLocalRoomState] = useState<RoomState | null>(null);
  const [connectionToken, setConnectionToken] = useState<string | undefined>(() => identity.connectionToken);
  const [voteBudgetInput, setVoteBudgetInput] = useState("5");
  const [budgetMsg, setBudgetMsg] = useState<string | null>(null);
  const [timerMinutesInput, setTimerMinutesInput] = useState("5");
  const [timerMsg, setTimerMsg] = useState<string | null>(null);
  const [timerInputError, setTimerInputError] = useState<string | null>(null);
  const [phaseMsg, setPhaseMsg] = useState<string | null>(null);

  const { state: wsState, connected, send } = useRoom(roomId ?? "", participantId, connectionToken);

  const roomState = mergeRoomState(localRoomState, wsState);

  const [itemInput, setItemInput] = useState("");
  const [itemError, setItemError] = useState<string | null>(null);

  const isNearCharLimit = itemInput.length > 400;
  const charCountId = "item-char-count";
  const itemErrorId = "item-error";

  useEffect(() => {
    if (!roomId) return;
    (async () => {
      try {
        const state = await getRoomState(roomId);
        setLocalRoomState(state);
        const existing = state.participants.find((p) => p.id === participantId);
        if (existing) {
          const name = identity.displayName || existing.displayName;
          try {
            const result = await joinRoom(roomId, participantId, name);
            if (result.success) {
              localStorage.setItem(`retro-name-${roomId}`, name);
              setLocalRoomState(result.state ?? state);
              if (result.connectionToken) {
                localStorage.setItem(`retro-token-${roomId}`, result.connectionToken);
                setConnectionToken(result.connectionToken);
              }
            }
          } catch {
            // Re-join failed; still show room with stale token if available
          }
          setPageState("room");
        } else {
          setPageState("join");
        }
      } catch {
        setPageState("not-found");
      }
    })();
  }, [roomId, participantId, identity.displayName]);

  const displayBudget = useMemo(() => {
    if (roomState) return String(roomState.voteBudget);
    return voteBudgetInput;
  }, [roomState, voteBudgetInput]);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!roomId) return;
    setJoinError(null);

    const trimmed = displayName.trim();
    if (!trimmed) {
      setJoinError("Please enter a display name.");
      return;
    }

    setJoinLoading(true);
    try {
      const result = await joinRoom(roomId, participantId, trimmed);
      if (!result.success) {
        setJoinError(result.error ?? "Failed to join room. Please try again.");
        return;
      }
      localStorage.setItem(`retro-name-${roomId}`, trimmed);
      setLocalRoomState(result.state ?? null);
      if (result.connectionToken) {
        localStorage.setItem(`retro-token-${roomId}`, result.connectionToken);
        setConnectionToken(result.connectionToken);
      }
      setPageState("room");
    } catch {
      setJoinError("Failed to join room. Please check your connection and try again.");
    } finally {
      setJoinLoading(false);
    }
  }

  async function handleSetBudget() {
    if (!roomId) return;
    const budget = parseInt(voteBudgetInput, 10);
    if (isNaN(budget) || budget < 1 || budget > 100) {
      setBudgetMsg("Vote budget must be between 1 and 100.");
      return;
    }
    const result = await setVoteBudget(roomId, participantId, budget);
    if (result.success) {
      setBudgetMsg("Vote budget updated.");
      // Refetch authoritative state to handle any missed WebSocket broadcasts during reconnect
      try {
        const state = await getRoomState(roomId);
        setLocalRoomState(state);
      } catch {
        // Refetch failed; local optimistic update stands and WebSocket will reconcile
      }
    } else {
      setBudgetMsg(result.error ?? "Failed to update budget.");
    }
  }

  async function handleAdvancePhase() {
    if (!roomId || !roomState) return;
    setPhaseMsg(null);
    const currentIdx = PHASE_ORDER.indexOf(roomState.phase);
    const nextPhase = PHASE_ORDER[currentIdx + 1] as Phase | undefined;
    if (!nextPhase) return;
    const result = await setPhase(roomId, participantId, nextPhase);
    if (result.success) {
      setPhaseMsg(`Advanced to ${nextPhase}.`);
      // Refetch authoritative state so the UI updates even if the WebSocket broadcast
      // was missed during a post-reload reconnect window
      try {
        const state = await getRoomState(roomId);
        setLocalRoomState(state);
      } catch {
        // Refetch failed; local optimistic update stands and WebSocket will reconcile
      }
    } else {
      setPhaseMsg(result.error ?? "Failed to change phase.");
    }
  }

  function handleSetTimer() {
    if (!roomState) return;
    setTimerMsg(null);
    setTimerInputError(null);
    const raw = timerMinutesInput.trim();
    if (!raw) {
      setTimerInputError("Timer cannot be blank.");
      return;
    }
    const minutes = parseInt(raw, 10);
    if (isNaN(minutes) || minutes < 1) {
      setTimerInputError("Timer must be at least 1 minute.");
      return;
    }
    if (minutes > 60) {
      setTimerInputError("Timer cannot exceed 60 minutes.");
      return;
    }
    const durationSeconds = minutes * 60;
    send({ type: "set-timer", durationSeconds });
    setTimerMsg("Timer started.");
  }

  function handleAddItem(e: React.FormEvent) {
    e.preventDefault();
    setItemError(null);
    if (!isValidItemText(itemInput)) {
      setItemError("Item text cannot be blank.");
      return;
    }
    send({ type: "add-item", text: sanitizeItemText(itemInput) });
    setItemInput("");
  }

  if (pageState === "loading") {
    return (
      <div className="content-shell content-shell--narrow" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div className="glass-panel loading-state" role="status" aria-label="Loading room">
          <span className="loading-spinner" aria-hidden="true" />
          <p className="loading-state__text" style={{ marginTop: "var(--space-3)" }}>Loading room…</p>
        </div>
      </div>
    );
  }

  if (pageState === "not-found") {
    return (
      <div className="content-shell content-shell--narrow" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div className="glass-panel empty-state" style={{ textAlign: "center" }}>
          <div className="empty-state__icon" role="img" aria-label="Room not found">🔍</div>
          <h1 className="page-title" style={{ marginBottom: "var(--space-3)", marginTop: "var(--space-3)" }}>Room Not Found</h1>
          <p className="empty-state__text" style={{ marginBottom: "var(--space-5)" }}>
            This room does not exist, has been closed, or the link may be incorrect.
          </p>
          <a href="/" className="btn btn--primary">Return to Home</a>
        </div>
      </div>
    );
  }

  if (pageState === "join") {
    return (
      <div className="content-shell content-shell--narrow" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div className="glass-panel">
          <h1 className="page-title" style={{ marginBottom: "var(--space-3)" }}>Join Room</h1>
          <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-5)", lineHeight: "var(--leading-relaxed)" }}>
            Enter your display name to join this retrospective.
          </p>
          <form onSubmit={handleJoin} noValidate>
            <div className="input-group" style={{ marginBottom: "var(--space-4)" }}>
              <label className="input-label" htmlFor="displayName">
                Display Name
              </label>
              <input
                id="displayName"
                className={`input${joinError ? " input--error" : ""}`}
                type="text"
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  if (joinError) setJoinError(null);
                }}
                maxLength={50}
                placeholder="Your name"
                autoComplete="nickname"
                aria-required="true"
                aria-describedby={joinError ? "join-error" : undefined}
                aria-invalid={joinError ? "true" : undefined}
              />
            </div>
            <button
              type="submit"
              className="btn btn--primary"
              style={{ width: "100%" }}
              disabled={joinLoading}
              aria-busy={joinLoading}
            >
              {joinLoading ? (
                <>
                  <span className="loading-spinner" aria-hidden="true" />
                  Joining…
                </>
              ) : "Join Room"}
            </button>
            {joinError && (
              <div id="join-error" className="status-msg status-msg--error" style={{ marginTop: "var(--space-3)" }} role="alert">
                {joinError}
              </div>
            )}
          </form>
        </div>
      </div>
    );
  }

  const currentParticipant = roomState?.participants.find((p) => p.id === participantId);
  const isFacilitator = currentParticipant?.isFacilitator === true;

  return (
    <div className="content-shell">
      {/* Room Header */}
      <header className="room-header" role="banner">
        <div className="room-header__left">
          <h1 className="room-header__title">Retro Board</h1>
          <ConnectionStatus connected={connected} />
        </div>
        <div className="room-header__right">
          <InviteButton roomId={roomId!} />
        </div>
      </header>

      {/* Phase Status Bar */}
      <div className="phase-status" role="region" aria-label="Room status">
        <span className="phase-status__label">Phase: </span>
        <span
          className="phase-status__value badge badge--phase"
          data-phase={roomState?.phase?.toUpperCase() ?? "UNKNOWN"}
        >
          {roomState?.phase?.toUpperCase() ?? "UNKNOWN"}
        </span>
        <TimerDisplay timer={roomState?.timer ?? { startedAt: null, durationSeconds: null, expired: false }} />
      </div>

      {/* Participants */}
      <section
        className="participants-bar"
        role="region"
        aria-label="Participants"
        style={{ marginBottom: "var(--space-4)" }}
      >
        <h2 className="sr-only">Participants</h2>
        <ParticipantList participants={roomState?.participants ?? []} currentId={participantId} />
      </section>

      {/* Facilitator Controls */}
      {isFacilitator && (
        <div className="facilitator-panel" role="region" aria-label="Facilitator controls">
          <p className="facilitator-panel__title">Facilitator Controls</p>
          <div className="facilitator-panel__controls">
            <div className="facilitator-panel__row">
              <label className="input-label" htmlFor="voteBudget">Vote Budget</label>
              <input
                id="voteBudget"
                className={`input${budgetMsg && budgetMsg.includes("must be") ? " input--error" : ""}`}
                type="number"
                min={1}
                max={100}
                value={displayBudget}
                onChange={(e) => {
                  setVoteBudgetInput(e.target.value);
                  if (budgetMsg) setBudgetMsg(null);
                }}
                style={{ width: "5rem" }}
                aria-describedby={budgetMsg && budgetMsg.includes("must be") ? "budget-error" : undefined}
                aria-invalid={budgetMsg && budgetMsg.includes("must be") ? "true" : undefined}
              />
              <button className="btn btn--secondary btn--sm" onClick={handleSetBudget}>Set</button>
              {budgetMsg && budgetMsg.includes("must be") ? (
                <span id="budget-error" className="status-msg status-msg--error" style={{ padding: "var(--space-1) var(--space-2)", fontSize: "var(--text-xs)" }} role="alert">
                  {budgetMsg}
                </span>
              ) : budgetMsg ? (
                <span className="status-msg status-msg--info" style={{ padding: "var(--space-1) var(--space-2)", fontSize: "var(--text-xs)" }} role="status">
                  {budgetMsg}
                </span>
              ) : null}
            </div>
            <div className="facilitator-panel__row">
              <button
                className="btn btn--primary"
                onClick={handleAdvancePhase}
                disabled={roomState?.phase === "review"}
                aria-label="Advance to next phase"
              >
                Advance to Next Phase
              </button>
              {phaseMsg && (
                <span className="status-msg status-msg--info" style={{ padding: "var(--space-1) var(--space-2)", fontSize: "var(--text-xs)" }} role="status">
                  {phaseMsg}
                </span>
              )}
            </div>
            <div className="facilitator-panel__row">
              <label className="input-label" htmlFor="timerMinutes">Timer (minutes)</label>
              <input
                id="timerMinutes"
                className={`input${timerInputError ? " input--error" : ""}`}
                type="number"
                min={1}
                max={60}
                value={timerMinutesInput}
                onChange={(e) => {
                  setTimerMinutesInput(e.target.value);
                  if (timerInputError) setTimerInputError(null);
                }}
                style={{ width: "5rem" }}
                aria-describedby={timerInputError ? "timer-error" : undefined}
                aria-invalid={timerInputError ? "true" : undefined}
              />
              <button className="btn btn--secondary btn--sm" onClick={handleSetTimer}>Start Timer</button>
              {timerInputError && (
                <span id="timer-error" className="status-msg status-msg--error" style={{ padding: "var(--space-1) var(--space-2)", fontSize: "var(--text-xs)" }} role="alert">
                  {timerInputError}
                </span>
              )}
              {timerMsg && !timerInputError && (
                <span className="status-msg status-msg--info" style={{ padding: "var(--space-1) var(--space-2)", fontSize: "var(--text-xs)" }} role="status">
                  {timerMsg}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Board Area */}
      <div className="board-area glass-panel">
        <div className="board-header">
          <h2 className="section-title">Board</h2>
          {roomState?.phase === "write" && (
            <span className="phase-hint" aria-hidden="true">Add your retro items</span>
          )}
        </div>

        {/* Write Phase Composer */}
        {roomState?.phase === "write" && (
          <div className="write-composer">
            <form
              onSubmit={handleAddItem}
              className="write-composer__form"
              aria-label="Add retro item"
            >
              <div className="write-composer__input-row">
                <div className="write-composer__input-wrapper">
                  <input
                    type="text"
                    id="itemText"
                    className={`input write-composer__input${itemError ? " input--error" : ""}`}
                    value={itemInput}
                    onChange={(e) => {
                      setItemInput(e.target.value);
                      if (itemError) setItemError(null);
                    }}
                    maxLength={500}
                    placeholder="Add a retro item…"
                    aria-required="true"
                    aria-describedby={[itemError ? itemErrorId : "", isNearCharLimit ? charCountId : ""].filter(Boolean).join(" ") || undefined}
                    aria-invalid={itemError ? "true" : undefined}
                    disabled={!connected}
                  />
                  {isNearCharLimit && (
                    <span
                      id={charCountId}
                      className="write-composer__char-count"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      {itemInput.length}/500
                    </span>
                  )}
                </div>
                <button
                  type="submit"
                  className="btn btn--primary write-composer__submit"
                  disabled={!connected || !itemInput.trim()}
                  aria-label="Add item"
                >
                  <span aria-hidden="true">+</span>
                  Add
                </button>
              </div>
              {itemError && (
                <div id={itemErrorId} className="status-msg status-msg--error write-composer__error" role="alert">
                  {itemError}
                </div>
              )}
              {!connected && (
                <div className="status-msg status-msg--muted write-composer__offline" role="status" aria-live="polite">
                  <span aria-hidden="true">⏳</span> Your changes are queued. Reconnecting…
                </div>
              )}
            </form>
          </div>
        )}

        {roomState?.phase === "organise" ? (
          <OrganiseBoard roomState={roomState} send={send} />
        ) : roomState?.phase === "vote" ? (
          <VoteBoard roomState={roomState} participantId={participantId} send={send} />
        ) : roomState?.phase === "review" ? (
          <ReviewBoard roomState={roomState} />
        ) : roomState?.phase === "write" ? (
          (roomState?.items?.length ?? 0) === 0 ? (
            <div className="empty-state write-empty-state">
              <div className="empty-state__icon" aria-hidden="true">✍️</div>
              <p className="empty-state__text">No items yet. Add your first retro item above.</p>
            </div>
          ) : (
            <div className="item-list-container">
              <div className="item-list-header">
                <span className="item-list-count">{roomState!.items.length} item{roomState!.items.length !== 1 ? "s" : ""}</span>
              </div>
              <ul className="item-list" aria-label="Retro items">
                {roomState?.items?.map((item, index) => {
                  const isLong = item.text.length > 400;
                  const author = roomState?.participants.find((p) => p.id === item.authorId);
                  return (
                    <li key={item.id} className={`item-card${isLong ? " item-card--long" : ""}`}>
                      <div className="item-card__content">
                        <span className="item-card__text">{item.text}</span>
                        {isLong && (
                          <span className="item-card__length-indicator" aria-label={`${item.text.length} characters`}>
                            {item.text.length}/500
                          </span>
                        )}
                      </div>
                      <div className="item-card__meta">
                        <span className="item-card__author">{author?.displayName ?? "Unknown"}</span>
                        <span className="item-card__index" aria-label={`Item ${index + 1}`}>#{index + 1}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )
        ) : null}
      </div>

      {/* Room Footer — safe room code only, no tokens */}
      <footer className="room-footer" role="contentinfo">
        <span className="room-footer__label">Room</span>
        <span className="room-footer__code truncate" aria-label="Room code">
          {roomId}
        </span>
      </footer>
    </div>
  );
}
