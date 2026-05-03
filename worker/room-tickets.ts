import { Effect } from "effect";

export function generateTokenEffect(): Effect.Effect<string> {
  return Effect.sync(() => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  });
}

export function generateToken(): string {
  return Effect.runSync(generateTokenEffect());
}

export function getWebSocketTicketEffect(request: Request): Effect.Effect<string | null> {
  return Effect.sync(() => {
  const protocols = (request.headers.get("Sec-WebSocket-Protocol") ?? "")
    .split(",")
    .map((protocol) => protocol.trim());
  const ticketProtocol = protocols.find((protocol) => protocol.startsWith("ticket-"));
  return ticketProtocol ? ticketProtocol.slice("ticket-".length) : null;
  });
}

export function getWebSocketTicket(request: Request): string | null {
  return Effect.runSync(getWebSocketTicketEffect(request));
}
