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
    return <div style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1rem" }}>Loading...</div>;
  }

  if (pageState === "not-found") {
    return <div style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1rem" }}><h1>Room Not Found</h1><p>This room does not exist or has been closed.</p></div>;
  }

  if (pageState === "join") {
    return (
      <div style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1rem" }}>
        <h1>Join Room</h1>
        <p>Enter your display name to join this retrospective.</p>
        <form onSubmit={handleJoin}>
          <div>
            <label htmlFor="displayName">Display Name</label>
            <br />
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={50}
              placeholder="Your name"
            />
          </div>
          <button type="submit" style={{ marginTop: "0.5rem" }}>Join</button>
          {joinError && <p style={{ color: "red" }}>{joinError}</p>}
        </form>
      </div>
    );
  }

  const currentParticipant = roomState?.participants.find((p) => p.id === participantId);
  const isFacilitator = currentParticipant?.isFacilitator === true;

  return (
    <div style={{ maxWidth: 720, margin: "2rem auto", padding: "0 1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h1>Retro Board</h1>
        <span>
          {connected ? "🟢 Connected" : "🔴 Disconnected"}
        </span>
      </div>

      <div style={{ marginBottom: "1rem", padding: "0.75rem", border: "1px solid #ccc", borderRadius: 4 }}>
        <strong>Phase: {roomState?.phase?.toUpperCase() ?? "UNKNOWN"}</strong>
        <span style={{ marginLeft: "1rem" }}>
          Participants: {roomState?.participants.map((p) => p.displayName).join(", ") || "None"}
        </span>
        {isFacilitator && <span style={{ marginLeft: "1rem" }}>⭐ Facilitator</span>}
      </div>

      {isFacilitator && (
        <div style={{ marginBottom: "1rem", padding: "0.75rem", border: "1px solid #ddd", borderRadius: 4, background: "#f9f9f9" }}>
          <strong>Facilitator Controls</strong>
          <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <label htmlFor="voteBudget">Vote Budget:</label>
            <input
              id="voteBudget"
              type="number"
              min={1}
              max={100}
              value={displayBudget}
              onChange={(e) => setVoteBudgetInput(e.target.value)}
              style={{ width: 80 }}
            />
            <button onClick={handleSetBudget}>Set</button>
            {budgetMsg && <span style={{ fontSize: "0.85rem" }}>{budgetMsg}</span>}
          </div>
          <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <button
              onClick={handleAdvancePhase}
              disabled={roomState?.phase === "review"}
            >
              Advance to Next Phase
            </button>
            {phaseMsg && <span style={{ fontSize: "0.85rem" }}>{phaseMsg}</span>}
          </div>
        </div>
      )}

      <div style={{ marginBottom: "1rem" }}>
        <h2>Board</h2>
        {roomState?.phase === "write" && (
          <form onSubmit={handleAddItem} style={{ marginBottom: "1rem", display: "flex", gap: "0.5rem" }}>
            <input
              type="text"
              value={itemInput}
              onChange={(e) => setItemInput(e.target.value)}
              maxLength={500}
              placeholder="Add a retro item..."
              style={{ flex: 1, padding: "0.4rem" }}
            />
            <button type="submit">Add</button>
          </form>
        )}
        {itemError && <p style={{ color: "red", marginBottom: "0.5rem" }}>{itemError}</p>}

        {roomState?.phase === "organise" ? (
          <OrganiseBoard roomState={roomState} send={send} />
        ) : roomState?.phase === "vote" ? (
          <VoteBoard roomState={roomState} participantId={participantId} send={send} />
        ) : roomState?.phase === "review" ? (
          <ReviewBoard roomState={roomState} />
        ) : roomState?.phase === "write" ? (
          (roomState?.items?.length ?? 0) === 0 ? (
            <p style={{ color: "#888" }}>No items yet. The board is ready for the write phase.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0 }}>
              {roomState?.items?.map((item) => (
                <li key={item.id} style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid #eee" }}>
                  {item.text}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>

      <div style={{ fontSize: "0.85rem", color: "#888" }}>
        Room ID: {roomId}
      </div>
    </div>
  );
}
