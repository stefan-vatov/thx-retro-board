let createRoomRequestIndex = 0;
const testIpSubnet = Math.floor(Math.random() * 200) + 1;

export function createRoomRequest(): Request {
  createRoomRequestIndex += 1;
  return new Request("http://localhost/api/rooms", {
    method: "POST",
    headers: { "CF-Connecting-IP": `203.0.${testIpSubnet}.${createRoomRequestIndex}` },
  });
}
