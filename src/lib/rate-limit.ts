/**
 * fixed-window rate limiter kept in memory.
 * best effort on serverless: each instance counts on its own, so pair it with a
 * platform firewall rule for hard limits. it stops a single client looping on the endpoint.
 */
export interface RateLimitResult {
  ok: boolean;
  retryAfter: number; // seconds until the window resets, 0 when ok
}

export function createRateLimiter(opts: { limit: number; windowMs: number; maxKeys?: number; now?: () => number }) {
  const now = opts.now ?? Date.now;
  const maxKeys = opts.maxKeys ?? 5000;
  const hits = new Map<string, { count: number; resetAt: number }>();

  function prune(t: number) {
    for (const [key, entry] of hits) if (entry.resetAt <= t) hits.delete(key);
    // still full: drop the oldest keys rather than grow without bound
    while (hits.size > 0 && hits.size >= maxKeys) hits.delete(hits.keys().next().value as string);
  }

  return function check(key: string): RateLimitResult {
    const t = now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      if (!entry && hits.size >= maxKeys) prune(t);
      entry = { count: 0, resetAt: t + opts.windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > opts.limit) return { ok: false, retryAfter: Math.max(1, Math.ceil((entry.resetAt - t) / 1000)) };
    return { ok: true, retryAfter: 0 };
  };
}

/** client ip as seen by the platform; falls back to one shared bucket */
export function clientIp(request: Request): string {
  const h = request.headers;
  const forwarded = h.get("x-vercel-forwarded-for") ?? h.get("x-forwarded-for") ?? "";
  return h.get("x-real-ip") ?? (forwarded.split(",")[0].trim() || "unknown");
}
