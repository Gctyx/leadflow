/** Backoff exponencial com jitter (50%–100% do teto exponencial) para reprocessar webhooks. */
export function computeBackoffMs(attempt: number, baseMs: number, maxMs: number, rand: () => number = Math.random): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + rand() * (exp / 2));
}
