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
    <div style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Retro Board</h1>
      <p>Create a new retrospective room and invite your team.</p>
      <button onClick={handleCreate} disabled={creating}>
        {creating ? "Creating..." : "Create Room"}
      </button>
      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}
