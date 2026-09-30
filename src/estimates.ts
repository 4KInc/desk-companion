/** Task categories shared by the agent schema, the offline splitter and the bias model. */
export const CATEGORIES = ['writing', 'coding', 'meetings', 'communication', 'review', 'admin', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

export function asCategory(value: unknown): Category {
  return CATEGORIES.includes(value as Category) ? (value as Category) : 'other';
}

/** One finished task: what it was estimated at and what it actually took (minutes). */
export interface Completion {
  category: Category;
  estimate: number;
  actual: number;
}

/** Only the most recent completions per category count, so the model follows habits as they change. */
const WINDOW = 20;
/** Minimum finished tasks in a category before we say anything about it. */
export const MIN_SAMPLES = 3;
/** Ratios this close to 1 are "about right" and not worth mentioning or correcting. */
const MENTION_THRESHOLD = 0.2;
const ADJUST_THRESHOLD = 0.15;
const MIN_FACTOR = 0.75;
const MAX_FACTOR = 1.6;

export interface Bias {
  /** Actual / estimated time; 1.4 means tasks take 40% longer than estimated. */
  ratio: number;
  samples: number;
}

export function biasByCategory(completions: readonly Completion[]): Map<Category, Bias> {
  const recent = new Map<Category, Completion[]>();
  for (let i = completions.length - 1; i >= 0; i--) {
    const c = completions[i];
    const list = recent.get(c.category) ?? [];
    if (list.length < WINDOW) list.push(c);
    recent.set(c.category, list);
  }
  const result = new Map<Category, Bias>();
  for (const [category, list] of recent) {
    let estimate = 0;
    let actual = 0;
    for (const c of list) {
      estimate += c.estimate;
      actual += c.actual;
    }
    if (estimate > 0) result.set(category, { ratio: actual / estimate, samples: list.length });
  }
  return result;
}

/** The single most notable bias, phrased for the recap ("run 40% low"), or undefined. */
export function biasLine(completions: readonly Completion[]): string | undefined {
  let best: [Category, Bias] | undefined;
  for (const entry of biasByCategory(completions)) {
    const [, bias] = entry;
    if (bias.samples < MIN_SAMPLES || Math.abs(bias.ratio - 1) < MENTION_THRESHOLD) continue;
    if (!best || Math.abs(bias.ratio - 1) > Math.abs(best[1].ratio - 1)) best = entry;
  }
  if (!best) return undefined;
  const [category, { ratio }] = best;
  const percent = Math.round(Math.abs(ratio - 1) * 100);
  const label = category === 'other' ? 'uncategorised' : category;
  return ratio > 1
    ? `Your estimates on ${label} tasks run ${percent}% low.`
    : `Your ${label} tasks finish ${percent}% faster than you estimate.`;
}

/**
 * Nudges a fresh estimate toward what this kind of task has actually taken,
 * clamped so one bad day cannot wildly distort a plan. Rounds to 15 minutes.
 */
export function adjustEstimate(
  minutes: number,
  category: Category,
  biases: Map<Category, Bias>,
): { minutes: number; adjusted: boolean } {
  const bias = biases.get(category);
  if (!bias || bias.samples < MIN_SAMPLES || Math.abs(bias.ratio - 1) < ADJUST_THRESHOLD) {
    return { minutes, adjusted: false };
  }
  const factor = Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, bias.ratio));
  const next = Math.min(240, Math.max(15, Math.round((minutes * factor) / 15) * 15));
  return { minutes: next, adjusted: next !== minutes };
}
