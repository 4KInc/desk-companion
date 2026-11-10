/**
 * Moments in one XR session that matter for the first five minutes, for the opt-in
 * playtest diagnostics. Times are performance.now() ms; 0 means "not yet".
 */
export const sessionMetrics = {
  xrEnteredAt: 0,
  trayPlacedAt: 0,
  firstTileAt: 0,
  firstSortAt: 0,
};

export type SessionMoment = Exclude<keyof typeof sessionMetrics, 'xrEnteredAt'>;

export function startSessionMetrics(now = performance.now()): void {
  sessionMetrics.xrEnteredAt = now;
  sessionMetrics.trayPlacedAt = 0;
  sessionMetrics.firstTileAt = 0;
  sessionMetrics.firstSortAt = 0;
}

/** Records the first time `moment` happens in this XR session (later ones are ignored). */
export function markMoment(moment: SessionMoment, now = performance.now()): void {
  if (sessionMetrics.xrEnteredAt > 0 && sessionMetrics[moment] === 0) sessionMetrics[moment] = now;
}

/** Milliseconds from entering XR to `moment`, or -1 if it has not happened. */
export function msSinceEnter(moment: SessionMoment): number {
  const at = sessionMetrics[moment];
  return at > 0 && sessionMetrics.xrEnteredAt > 0 ? Math.round(at - sessionMetrics.xrEnteredAt) : -1;
}

/** p50 / p95 / worst of the first `count` samples (copied, so the ring buffer is untouched). */
export function framePercentiles(samples: ArrayLike<number>, count: number): { p50: number; p95: number; worst: number } {
  if (count <= 0) return { p50: 0, p95: 0, worst: 0 };
  const sorted = Array.from({ length: count }, (_, i) => samples[i]).sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(count - 1, Math.floor(p * count))];
  return { p50: at(0.5), p95: at(0.95), worst: sorted[count - 1] };
}

/** "Quest 3S", "Quest 3", "Quest Pro", "Quest 2" or "other", from the user agent. */
export function deviceName(userAgent: string): string {
  const match = userAgent.match(/Quest (3S|3|Pro|2)/);
  return match ? `Quest ${match[1]}` : 'other';
}
