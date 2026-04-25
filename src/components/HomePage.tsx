import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { createRoom } from "../api";

export function HomePage() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const { roomId } = await createRoom();
      navigate(`/room/${roomId}`);
    } catch {
      setError("Failed to create room. Please check your connection and try again.");
      setCreating(false);
      createButtonRef.current?.focus();
    }
  }

  return (
    <div className="content-shell content-shell--narrow" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <div className="glass-panel" style={{ textAlign: "center" }}>
        <div style={{ marginBottom: "var(--space-6)" }}>
          <div className="empty-state__icon" style={{ fontSize: "3rem", marginBottom: "var(--space-4)" }}>📋</div>
          <h1 className="page-title" style={{ marginBottom: "var(--space-3)", letterSpacing: "-0.03em" }}>Retro Board</h1>
          <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-2)", lineHeight: "var(--leading-relaxed)" }}>
            Collaborative retrospectives with timed phases. Write, organise, vote, and reflect — together.
          </p>
        </div>
        <button
          ref={createButtonRef}
          className="btn btn--primary"
          style={{ width: "100%", minHeight: "48px", fontSize: "var(--text-base)" }}
          onClick={handleCreate}
          disabled={creating}
          aria-busy={creating}
        >
          {creating ? (
            <>
              <span className="loading-spinner" aria-hidden="true" />
              Creating room…
            </>
          ) : "Create Room"}
        </button>
        {error && (
          <div className="status-msg status-msg--error" style={{ marginTop: "var(--space-4)", textAlign: "left" }} role="alert">
            {error}
            <button
              className="btn btn--sm"
              style={{ marginTop: "var(--space-2)", display: "block" }}
              onClick={handleCreate}
              disabled={creating}
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
