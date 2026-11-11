/**
 * The buddy's one-line "why" for an overflow suggestion. Only facts the planner holds:
 * the priority of what it picked, and how much of the day meetings already take.
 */
export interface NudgePick {
  title: string;
  priority: number; // 1 urgent, 2 normal, 3 low
}

const short = (title: string) => `"${title.length > 26 ? `${title.slice(0, 25).trimEnd()}...` : title}"`;

export function nudgeWhy(
  picks: readonly NudgePick[],
  meetingsLabel: string | undefined,
  overLabel: string,
  firstTime: boolean,
): string {
  const lead = firstTime ? "That's more than your day holds. " : `You're ${overLabel} over. `;
  const meetings = meetingsLabel ? `Meetings fill ${meetingsLabel}, so ` : '';
  let why: string;
  if (picks.length === 1) {
    const [pick] = picks;
    const reason = pick.priority >= 3 ? 'is low priority' : pick.priority === 2 ? "isn't urgent" : 'is urgent but frees the most time';
    why = `${short(pick.title)} ${reason}`;
  } else {
    const allLow = picks.every((pick) => pick.priority >= 3);
    why = `${short(picks[0].title)} and ${picks.length - 1} more are the ${allLow ? 'lowest priority' : 'least urgent'}`;
  }
  return `${lead}${meetings}${why} and can wait.`;
}

/** After the user accepts: what moved, and that the day now fits. */
export function nudgeDone(moved: readonly NudgePick[], hours: number): string {
  const what = moved.length === 1 ? short(moved[0].title) : `${moved.length} tiles`;
  return `Moved ${what} to Later. Now fits your ${hours}h day.`;
}
