/**
 * The buddy's one line when someone comes back on a new day, built only from what was
 * stored: yesterday's carry-overs, the jar starting a new weekly layer, and one learned
 * estimation insight. Never invented: each part appears only when the data supports it.
 * At most two parts, so the line fits the speech bubble.
 */
export function returnCallback(input: {
  returning: number;
  newWeekLayer: boolean;
  /** biasLine(completions): the most notable estimation bias, already worded. */
  insight: string | undefined;
}): string | undefined {
  const parts: string[] = [];
  if (input.returning > 0) {
    parts.push(`${input.returning} ${input.returning === 1 ? 'tile' : 'tiles'} came back from yesterday.`);
  }
  const insight = input.insight;
  // Anything biasLine mentions is past the adjustment threshold too, so this promise holds.
  if (insight) parts.push(`${insight} I'll nudge new estimates to match.`);
  // The new layer is drawn once something lands in it, so promise it rather than claim it.
  if (input.newWeekLayer && parts.length < 2) parts.push("It's a new week: your next finished task starts a new layer in the jar.");
  return parts.length > 0 ? `Good morning. ${parts.slice(0, 2).join(' ')}` : undefined;
}
