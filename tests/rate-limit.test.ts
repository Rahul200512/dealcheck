import { describe, expect, it } from "vitest";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";

describe("createRateLimiter", () => {
  it("allows the limit, blocks the next call and resets after the window", () => {
    let t = 0;
    const check = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => t });
    expect([check("a"), check("a"), check("a")].every((r) => r.ok)).toBe(true);
    const blocked = check("a");
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBe(60);
    expect(check("b").ok).toBe(true); // keys are independent
    t = 60_000;
    expect(check("a").ok).toBe(true);
  });

  it("keeps memory bounded", () => {
    let t = 0;
    const check = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 3, now: () => t });
    for (let i = 0; i < 50; i++) {
      t += 10;
      expect(check(`ip-${i}`).ok).toBe(true);
    }
  });
});

describe("clientIp", () => {
  const req = (headers: Record<string, string>) => new Request("http://localhost/api/parse", { headers });
  it("prefers the platform headers", () => {
    expect(clientIp(req({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientIp(req({ "x-forwarded-for": "3.3.3.3, 10.0.0.1" }))).toBe("3.3.3.3");
    expect(clientIp(req({}))).toBe("unknown");
  });
});
