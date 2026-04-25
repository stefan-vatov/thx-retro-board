import { useState, useEffect, useMemo } from "react";
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
    return <span className="timer-display" style={{ marginLeft: "var(--space-3)" }}>No timer set</span>;
  }

  const elapsed = (now - timer.startedAt) / 1000;
  const remaining = Math.max(0, timer.durationSeconds - elapsed);
  const expired = remaining <= 0;
  const mins = Math.floor(remaining / 60);
  const secs = Math.floor(remaining % 60);

  return (
    <span
      className={`timer-display${expired ? " timer-display--expired" : " timer-display--running"}`}
      style={{ marginLeft: "var(--space-3)" }}
    >
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

export function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const [pageState, setPageState] = useState<PageState>("loading");
  const [identity] = useState(() => getStoredIdentity(roomId!));
  const [participantId] = useState(() => identity.participantId);
  const [displayName, setDisplayName] = useState(() => identity.displayName);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [localRoomState, setLocalRoomState] = useState<RoomState | null>(null);
  const [connectionToken, setConnectionToken] = useState<string | undefined>(() => identity.connectionToken);
  const [voteBudgetInput, setVoteBudgetInput] = useState("5");
  const [budgetMsg, setBudgetMsg] = useState<string | null>(null);
  const [timerMinutesInput, setTimerMinutesInput] = useState("5");
  const [timerMsg, setTimerMsg] = useState<string | null>(null);
  const [phaseMsg, setPhaseMsg] = useState<string | null>(null);

  const { state: wsState, connected, send } = useRoom(roomId ?? "", participantId, connectionToken);

  const roomState = mergeRoomState(localRoomState, wsState);

  const [itemInput, setItemInput] = useState("");
  const [itemError, setItemError] = useState<string | null>(null);

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

    try {
      const result = await joinRoom(roomId, participantId, trimmed);
      if (!result.success) {
        setJoinError(result.error ?? "Failed to join room.");
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
      setJoinError("Failed to join room. Please try again.");
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
      if (localRoomState) {
        setLocalRoomState({ ...localRoomState, voteBudget: budget });
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
    } else {
      setPhaseMsg(result.error ?? "Failed to change phase.");
    }
  }

  function handleSetTimer() {
    if (!roomState) return;
    setTimerMsg(null);
    const minutes = parseInt(timerMinutesInput, 10);
    if (isNaN(minutes) || minutes < 1) {
      setTimerMsg("Timer must be at least 1 minute.");
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
      setItemError("Item text cannot be empty.");
      return;
    }
    send({ type: "add-item", text: sanitizeItemText(itemInput) });
    setItemInput("");
  }

  if (pageState === "loading") {
    return (
      <div className="content-shell content-shell--narrow" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div className="glass-panel loading-state">
          <p className="loading-state__text">Loading room…</p>
        </div>
      </div>
    );
  }

  if (pageState === "not-found") {
    return (
      <div className="content-shell content-shell--narrow" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div className="glass-panel empty-state">
          <div className="empty-state__icon">🔍</div>
          <h1 className="page-title" style={{ marginBottom: "var(--space-3)" }}>Room Not Found</h1>
          <p className="empty-state__text">This room does not exist or has been closed.</p>
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
          <form onSubmit={handleJoin}>
            <div className="input-group" style={{ marginBottom: "var(--space-4)" }}>
              <label className="input-label" htmlFor="displayName">Display Name</label>
              <input
                id="displayName"
                className="input"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={50}
                placeholder="Your name"
                autoComplete="nickname"
              />
            </div>
            <button type="submit" className="btn btn--primary" style={{ width: "100%" }}>
              Join
            </button>
            {joinError && (
              <div className="status-msg status-msg--error" style={{ marginTop: "var(--space-3)" }} role="alert">
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
      <div className="room-header">
        <h1 className="room-header__title">Retro Board</h1>
        <div className="room-header__meta">
          <span className="connection-dot-wrapper" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <span className={`connection-dot ${connected ? "connection-dot--connected" : "connection-dot--disconnected"}`} aria-hidden="true" />
            <span className="sr-only">{connected ? "Connected" : "Disconnected"}</span>
            <span aria-live="polite">{connected ? "Connected" : "Disconnected"}</span>
          </span>
        </div>
      </div>

      <div className="phase-status" role="region" aria-label="Room status">
        <span className="phase-status__label">Phase</span>
        <span className="phase-status__value badge badge--phase">{roomState?.phase?.toUpperCase() ?? "UNKNOWN"}</span>
        <TimerDisplay timer={roomState?.timer ?? { startedAt: null, durationSeconds: null, expired: false }} />
        <span style={{ marginLeft: "var(--space-2)", color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
          Participants: {roomState?.participants.map((p) => p.displayName).join(", ") || "None"}
        </span>
        {isFacilitator && (
          <span className="facilitator-badge">
            ⭐ Facilitator
          </span>
        )}
      </div>

      {isFacilitator && (
        <div className="facilitator-panel" role="region" aria-label="Facilitator controls">
          <p className="facilitator-panel__title">Facilitator Controls</p>
          <div className="facilitator-panel__controls">
            <div className="facilitator-panel__row">
              <label className="input-label" htmlFor="voteBudget">Vote Budget</label>
              <input
                id="voteBudget"
                className="input"
                type="number"
                min={1}
                max={100}
                value={displayBudget}
                onChange={(e) => setVoteBudgetInput(e.target.value)}
                style={{ width: "5rem" }}
              />
              <button className="btn btn--secondary btn--sm" onClick={handleSetBudget}>Set</button>
              {budgetMsg && <span className="status-msg status-msg--info" style={{ padding: "var(--space-1) var(--space-2)", fontSize: "var(--text-xs)" }}>{budgetMsg}</span>}
            </div>
            <div className="facilitator-panel__row">
              <button
                className="btn btn--primary"
                onClick={handleAdvancePhase}
                disabled={roomState?.phase === "review"}
              >
                Advance to Next Phase
              </button>
              {phaseMsg && <span className="status-msg status-msg--info" style={{ padding: "var(--space-1) var(--space-2)", fontSize: "var(--text-xs)" }}>{phaseMsg}</span>}
            </div>
            <div className="facilitator-panel__row">
              <label className="input-label" htmlFor="timerMinutes">Timer (minutes)</label>
              <input
                id="timerMinutes"
                className="input"
                type="number"
                min={1}
                max={60}
                value={timerMinutesInput}
                onChange={(e) => setTimerMinutesInput(e.target.value)}
                style={{ width: "5rem" }}
              />
              <button className="btn btn--secondary btn--sm" onClick={handleSetTimer}>Start Timer</button>
              {timerMsg && <span className="status-msg status-msg--info" style={{ padding: "var(--space-1) var(--space-2)", fontSize: "var(--text-xs)" }}>{timerMsg}</span>}
            </div>
          </div>
        </div>
      )}

      <div className="board-area glass-panel">
        <h2 className="section-title" style={{ marginBottom: "var(--space-4)" }}>Board</h2>
        {roomState?.phase === "write" && (
          <form onSubmit={handleAddItem} style={{ marginBottom: "var(--space-5)", display: "flex", gap: "var(--space-2)" }}>
            <input
              type="text"
              className="input"
              value={itemInput}
              onChange={(e) => setItemInput(e.target.value)}
              maxLength={500}
              placeholder="Add a retro item…"
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn--primary">Add</button>
          </form>
        )}
        {itemError && (
          <div className="status-msg status-msg--error" style={{ marginBottom: "var(--space-3)" }} role="alert">
            {itemError}
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
            <div className="empty-state">
              <div className="empty-state__icon">📝</div>
              <p className="empty-state__text">No items yet. The board is ready for the write phase.</p>
            </div>
          ) : (
            <ul className="item-list">
              {roomState?.items?.map((item) => (
                <li key={item.id} className="item-row">
                  <span className="item-row__text">{item.text}</span>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>

      <div className="room-footer">
        Room ID: {roomId}
      </div>
    </div>
  );
}
