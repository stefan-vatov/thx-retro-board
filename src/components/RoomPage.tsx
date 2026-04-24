import { useState, useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { joinRoom, getRoomState, setVoteBudget } from "../api";
import { useRoom } from "../hooks";
import type { RoomState } from "../domain";

type PageState = "loading" | "join" | "room" | "not-found";

function mergeRoomState(local: RoomState | null, ws: RoomState | null): RoomState | null {
  if (!local && !ws) return null;
  if (!local) return ws;
  if (!ws) return local;
  if (ws.version >= local.version) return ws;
  return local;
}

export function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const [pageState, setPageState] = useState<PageState>("loading");
  const [participantId] = useState(() => {
    const key = `retro-participant-${roomId}`;
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
    return id;
  });
  const [displayName, setDisplayName] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [localRoomState, setLocalRoomState] = useState<RoomState | null>(null);
  const [connectionToken, setConnectionToken] = useState<string | undefined>(() => {
    const key = `retro-token-${roomId}`;
    return sessionStorage.getItem(key) ?? undefined;
  });
  const [voteBudgetInput, setVoteBudgetInput] = useState("5");
  const [budgetMsg, setBudgetMsg] = useState<string | null>(null);

  const { state: wsState, connected } = useRoom(roomId ?? "", participantId, connectionToken);

  const roomState = mergeRoomState(localRoomState, wsState);

  useEffect(() => {
    if (!roomId) return;
    (async () => {
      try {
        const state = await getRoomState(roomId);
        setLocalRoomState(state);
        const existing = state.participants.find((p) => p.id === participantId);
        if (existing) {
          setPageState("room");
        } else {
          setPageState("join");
        }
      } catch {
        setPageState("not-found");
      }
    })();
  }, [roomId, participantId]);

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
      setLocalRoomState(result.state ?? null);
      if (result.connectionToken) {
        const key = `retro-token-${roomId}`;
        sessionStorage.setItem(key, result.connectionToken);
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
        </div>
      )}

      <div style={{ marginBottom: "1rem" }}>
        <h2>Board</h2>
        {(roomState?.items?.length ?? 0) === 0 ? (
          <p style={{ color: "#888" }}>No items yet. The board is ready for the write phase.</p>
        ) : (
          <ul>
            {roomState?.items?.map((item) => (
              <li key={item.id}>{item.text}</li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ fontSize: "0.85rem", color: "#888" }}>
        Room ID: {roomId}
      </div>
    </div>
  );
}
