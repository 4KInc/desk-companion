import { asCategory, type Category } from './estimates.js';

/** A task suggested from a brain dump, before it becomes a tile. */
export interface DraftTask {
  title: string;
  minutes: number;
  /** 1 = high, 2 = normal, 3 = low. */
  priority: number;
  category: Category;
}

export interface BrainDumpResult {
  tasks: DraftTask[];
  /** 'agent' when Claude split it, 'local' when the offline splitter did. */
  source: 'agent' | 'local';
}

const AGENT_TIMEOUT_MS = 15000;

/**
 * Splits free text into draft tasks. Tries the agent first (the key lives on the
 * server), then falls back to a local splitter so planning still works offline.
 */
export async function splitBrainDump(text: string): Promise<BrainDumpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}api/brain-dump`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    if (response.ok) {
      const body = (await response.json()) as { tasks?: DraftTask[] };
      if (Array.isArray(body.tasks) && body.tasks.length > 0) {
        return {
          tasks: body.tasks.map((task) => ({ ...task, category: asCategory(task.category) })),
          source: 'agent',
        };
      }
    }
  } catch {
    // Offline, timed out, or no agent deployed: fall through to the local splitter.
  } finally {
    clearTimeout(timer);
  }
  return { tasks: splitLocally(text), source: 'local' };
}

const DURATION = /\(?\b(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minutes)\b\)?/i;
const QUICK = /\b(email|e-mail|reply|call|text|ping|book|pay|order|send|schedule|check)\b/i;
const MEDIUM = /\b(meeting|review|sync|standup|1:1|read|plan|fix|update)\b/i;
const LONG = /\b(write|draft|design|build|implement|refactor|prepare|research|deck|report|finish)\b/i;
const CATEGORY_KEYWORDS: [Category, RegExp][] = [
  ['review', /\b(review|feedback|read|proofread)\b/i],
  ['meetings', /\b(meeting|1:1|one on one|sync|standup|interview|demo day)\b/i],
  ['communication', /\b(email|e-mail|reply|respond|message|text|ping|call|slack)\b/i],
  ['writing', /\b(write|draft|doc|docs|report|blog|slides|deck|proposal|notes)\b/i],
  ['coding', /\b(code|fix|bug|build|implement|refactor|deploy|test|debug|release|pr)\b/i],
  ['admin', /\b(book|pay|order|schedule|expense|clean|tidy|backlog|appointment|groceries|laundry|plants)\b/i],
];

function categorise(text: string): Category {
  for (const [category, pattern] of CATEGORY_KEYWORDS) if (pattern.test(text)) return category;
  return 'other';
}

const HIGH = /\b(urgent|asap|today|deadline|due|must|blocking|waiting on me)\b|!/i;
const LOW = /\b(maybe|someday|if time|if there'?s time|nice to have|optional|eventually)\b/i;

/** Offline splitter: one task per line / sentence / list item, with keyword estimates. */
export function splitLocally(text: string): DraftTask[] {
  return text
    .split(/\n|;|\.\s+|,\s*(?:and\s+)?|\s+and then\s+|\s+then\s+/i)
    .map((part) => part.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((part) => part.length > 2)
    .slice(0, 12)
    .map((part) => {
      let minutes = 30;
      const stated = part.match(DURATION);
      if (stated) {
        const value = parseFloat(stated[1]);
        minutes = /^h/i.test(stated[2]) ? value * 60 : value;
      } else if (LONG.test(part)) {
        minutes = 90;
      } else if (MEDIUM.test(part)) {
        minutes = 45;
      } else if (QUICK.test(part)) {
        minutes = 15;
      }
      const title = part.replace(DURATION, '').replace(/\s+/g, ' ').trim();
      return {
        title: (title.charAt(0).toUpperCase() + title.slice(1)).slice(0, 40),
        minutes: Math.min(240, Math.max(15, Math.round(minutes / 15) * 15)),
        priority: HIGH.test(part) ? 1 : LOW.test(part) ? 3 : 2,
        category: categorise(part),
      };
    });
}

export interface DraftSubtask {
  title: string;
  minutes: number;
}

/**
 * Breaks one big task into 2-4 steps. The agent names real steps; offline, the
 * task is split into equal numbered parts so the action still works.
 */
export async function splitTaskSteps(title: string, minutes: number): Promise<{ steps: DraftSubtask[]; source: 'agent' | 'local' }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}api/split-task`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, minutes }),
      signal: controller.signal,
    });
    if (response.ok) {
      const body = (await response.json()) as { subtasks?: DraftSubtask[] };
      if (Array.isArray(body.subtasks) && body.subtasks.length >= 2) return { steps: body.subtasks, source: 'agent' };
    }
  } catch {
    // fall through to the local split
  } finally {
    clearTimeout(timer);
  }
  const parts = minutes >= 180 ? 3 : 2;
  const each = Math.max(15, Math.round(minutes / parts / 15) * 15);
  const steps = Array.from({ length: parts }, (_, i) => ({
    title: `${title.slice(0, 30)} (${i + 1}/${parts})`,
    minutes: each,
  }));
  return { steps, source: 'local' };
}

export interface TaskDraft {
  kind: 'email' | 'message' | 'outline' | 'checklist' | 'notes';
  title: string;
  body: string;
  nextStep: string;
}

/** Hands one task to the agent for a short first draft; offline, a simple checklist head start. */
export async function draftForTask(
  title: string,
  minutes: number,
  category: string,
): Promise<{ draft: TaskDraft; source: 'agent' | 'local' }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}api/delegate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, minutes, category }),
      signal: controller.signal,
    });
    if (response.ok) {
      const body = (await response.json()) as { draft?: TaskDraft };
      if (body.draft?.body) return { draft: body.draft, source: 'agent' };
    }
  } catch {
    // fall through to the local head start
  } finally {
    clearTimeout(timer);
  }
  return {
    source: 'local',
    draft: {
      kind: 'checklist',
      title: title.slice(0, 60),
      body: `1. Write down what "done" looks like for: ${title}\n2. Gather what you need (links, notes, people)\n3. Do the first 25 minutes without stopping\n4. Review, then finish or split what is left`,
      nextStep: 'Start with step 1: define done in one sentence',
    },
  };
}
