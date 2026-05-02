export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function getWebSocketTicket(request: Request): string | null {
  const protocols = (request.headers.get("Sec-WebSocket-Protocol") ?? "")
    .split(",")
    .map((protocol) => protocol.trim());
  const ticketProtocol = protocols.find((protocol) => protocol.startsWith("ticket-"));
  return ticketProtocol ? ticketProtocol.slice("ticket-".length) : null;
}
