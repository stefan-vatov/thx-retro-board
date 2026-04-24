// @ts-expect-error -- cloudflare:workers vitest module
import { exports } from "cloudflare:workers";
import { describe, it, expect } from "vitest";

describe("Worker fetch", () => {
  it("returns JSON from /api/ route", async () => {
    const response = await exports.default.fetch("http://localhost/api/");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ message: "Retro Board API" });
  });

  it("returns 404 for non-API, non-asset routes", async () => {
    const response = await exports.default.fetch("http://localhost/nonexistent-path");
    expect(response.status).toBe(404);
  });
});
