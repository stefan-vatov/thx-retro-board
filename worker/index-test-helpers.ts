let createRoomRequestIndex = 0;

export function createRoomRequest(): Request {
  createRoomRequestIndex += 1;
  return new Request("http://localhost/api/rooms", {
    method: "POST",
    headers: { "CF-Connecting-IP": `203.0.113.${createRoomRequestIndex}` },
  });
}
