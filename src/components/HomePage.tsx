import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createRoom } from "../api";

export function HomePage() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const { roomId } = await createRoom();
      navigate(`/room/${roomId}`);
    } catch {
      setError("Failed to create room. Please try again.");
      setCreating(false);
    }
  }

  return (
    <div className="content-shell content-shell--narrow" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <div className="glass-panel" style={{ textAlign: "center" }}>
        <h1 className="page-title" style={{ marginBottom: "var(--space-3)", letterSpacing: "-0.03em" }}>Retro Board</h1>
        <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-6)", lineHeight: "var(--leading-relaxed)" }}>
          Create a new retrospective room and invite your team to collaborate through timed phases.
        </p>
        <button
          className="btn btn--primary"
          style={{ width: "100%" }}
          onClick={handleCreate}
          disabled={creating}
        >
          {creating ? "Creating…" : "Create Room"}
        </button>
        {error && (
          <div className="status-msg status-msg--error" style={{ marginTop: "var(--space-4)", textAlign: "left" }} role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
