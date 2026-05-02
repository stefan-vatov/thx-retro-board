import { describe, expect, it } from "vitest";
import { withSecurityHeaders } from "./security-headers";

describe("static asset security headers", () => {
  it("adds browser hardening headers without changing the response body or status", async () => {
    const response = withSecurityHeaders(new Response("<html>ok</html>", {
      status: 203,
      headers: { "Content-Type": "text/html" },
    }));

    expect(response.status).toBe(203);
    expect(response.headers.get("Content-Type")).toBe("text/html");
    expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("Permissions-Policy")).toContain("camera=()");
    expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains; preload");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    await expect(response.text()).resolves.toBe("<html>ok</html>");
  });
});
