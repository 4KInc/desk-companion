import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { CATEGORIES } from '../src/estimates.js';

/**
 * Brain dump -> task tiles. Shared by the Vercel function (api/brain-dump.ts)
 * and the Vite dev middleware so local dev and production run the same code.
 * The API key stays server-side; the headset only ever sees task JSON.
 */

const MAX_INPUT_CHARS = 4000;

const TaskList = z.object({
  tasks: z
    .array(
      z.object({
        title: z.string().describe('Short imperative task title, at most 40 characters'),
        minutes: z.number().int().describe('Realistic estimate in minutes, a multiple of 15, between 15 and 240'),
        priority: z.number().int().describe('1 = must happen today or blocks others, 2 = normal, 3 = nice to have'),
        category: z.enum(CATEGORIES).describe('The kind of work, used to learn how long this kind of task really takes'),
      }),
    )
    .describe('Actionable tasks in the order they were mentioned'),
});

export type DraftTask = z.infer<typeof TaskList>['tasks'][number];

const SYSTEM_PROMPT = `You turn a person's morning brain dump into task cards for today's plan.

- Make one card per distinct piece of work the person mentioned. Skip feelings, context and anything that is not something to do.
- Titles are short imperative phrases (at most 40 characters), keeping the person's own names for things.
- Estimate honest durations: people underestimate, so round up. Use multiples of 15 minutes. If the person states a duration, use it.
- Split anything over 4 hours into smaller cards.
- Priority 1 only for things with a deadline today or that other people are waiting on; 3 for explicitly optional items; otherwise 2.
- Category: writing (docs, reports, drafts, slides), coding (building, fixing, deploying software), meetings (1:1s, syncs, calls with a set time), communication (email, messages, quick calls), review (reviewing or reading others' work), admin (errands, bookings, chores, tidying), other.
- Return at most 12 cards.`;

let client: Anthropic | undefined;

export async function splitBrainDump(text: string): Promise<DraftTask[]> {
  client ??= new Anthropic();
  const response = await client.beta.messages.parse({
    model: 'claude-opus-5-5',
    max_tokens: 4000,
    // Short structured extraction: low effort keeps the round trip quick.
    output_config: { effort: 'low', format: betaZodOutputFormat(TaskList) },
    // Refusal fallback: if a safety classifier declines, the API reroutes by category.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: text }],
  });
  if (response.stop_reason === 'refusal' || !response.parsed_output) return [];
  return response.parsed_output.tasks.map(clampTask).filter((task) => task.title.length > 0);
}

function clampTask(task: DraftTask): DraftTask {
  return {
    title: task.title.trim().slice(0, 40),
    minutes: Math.min(240, Math.max(15, Math.round(task.minutes / 15) * 15)),
    priority: Math.min(3, Math.max(1, Math.round(task.priority))),
    category: task.category,
  };
}

/** Web-standard handler: POST { text } -> { tasks }. */
export async function handleBrainDumpRequest(request: Request): Promise<Response> {
  if (request.method !== 'POST') return Response.json({ error: 'POST only' }, { status: 405 });
  let text = '';
  try {
    const body = (await request.json()) as { text?: unknown };
    text = typeof body.text === 'string' ? body.text.trim() : '';
  } catch {
    return Response.json({ error: 'Expected JSON { text }' }, { status: 400 });
  }
  if (!text) return Response.json({ error: 'Empty brain dump' }, { status: 400 });
  if (text.length > MAX_INPUT_CHARS) {
    return Response.json({ error: `Keep it under ${MAX_INPUT_CHARS} characters` }, { status: 413 });
  }
  try {
    return Response.json({ tasks: await splitBrainDump(text) });
  } catch (error) {
    // The client falls back to its local splitter on any non-200.
    if (error instanceof Anthropic.RateLimitError) {
      return Response.json({ error: 'Rate limited' }, { status: 429 });
    } else if (error instanceof Anthropic.AuthenticationError) {
      return Response.json({ error: 'Agent not configured' }, { status: 503 });
    } else if (error instanceof Anthropic.APIError) {
      return Response.json({ error: `Agent error ${error.status ?? ''}`.trim() }, { status: 502 });
    }
    // Never log the error object itself: parse failures can carry the user's task text.
    console.error('[brain-dump] failed:', error instanceof Error ? error.name : typeof error);
    return Response.json({ error: 'Agent unavailable' }, { status: 503 });
  }
}

// --- split a big task -----------------------------------------------------------

const SubtaskList = z.object({
  subtasks: z
    .array(
      z.object({
        title: z.string().describe('Short imperative step title, at most 40 characters'),
        minutes: z.number().int().describe('Estimate in minutes, a multiple of 15'),
      }),
    )
    .describe('2 to 4 concrete steps, in the order they would be done'),
});

export type DraftSubtask = z.infer<typeof SubtaskList>['subtasks'][number];

const SPLIT_PROMPT = `You break one large task from someone's day plan into 2 to 4 smaller, concrete steps.

- Each step is something that could be finished in one sitting, named as a short imperative phrase (at most 40 characters) that keeps the person's own words.
- The step estimates should add up to roughly the original estimate (within 25%). Use multiples of 15 minutes.
- Do not add steps the person did not imply, and do not include a step that just restates the whole task.`;

export async function splitTask(title: string, minutes: number): Promise<DraftSubtask[]> {
  client ??= new Anthropic();
  const response = await client.beta.messages.parse({
    model: 'claude-opus-5-5',
    max_tokens: 2000,
    output_config: { effort: 'low', format: betaZodOutputFormat(SubtaskList) },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SPLIT_PROMPT,
    messages: [{ role: 'user', content: `Task: ${title}\nEstimate: ${minutes} minutes` }],
  });
  if (response.stop_reason === 'refusal' || !response.parsed_output) return [];
  const steps = response.parsed_output.subtasks
    .map((step) => ({
      title: step.title.trim().slice(0, 40),
      minutes: Math.min(240, Math.max(15, Math.round(step.minutes / 15) * 15)),
    }))
    .filter((step) => step.title.length > 0);
  return steps.length >= 2 && steps.length <= 4 ? steps : [];
}

/** Web-standard handler: POST { title, minutes } -> { subtasks }. */
export async function handleSplitRequest(request: Request): Promise<Response> {
  if (request.method !== 'POST') return Response.json({ error: 'POST only' }, { status: 405 });
  let title = '';
  let minutes = 0;
  try {
    const body = (await request.json()) as { title?: unknown; minutes?: unknown };
    title = typeof body.title === 'string' ? body.title.trim().slice(0, 80) : '';
    minutes = typeof body.minutes === 'number' ? body.minutes : 0;
  } catch {
    return Response.json({ error: 'Expected JSON { title, minutes }' }, { status: 400 });
  }
  if (!title || minutes < 30 || minutes > 480) {
    return Response.json({ error: 'Need a title and 30 to 480 minutes' }, { status: 400 });
  }
  try {
    return Response.json({ subtasks: await splitTask(title, minutes) });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return Response.json({ error: 'Rate limited' }, { status: 429 });
    if (error instanceof Anthropic.APIError) return Response.json({ error: 'Agent error' }, { status: 502 });
    console.error('[split-task] failed:', error instanceof Error ? error.name : typeof error);
    return Response.json({ error: 'Agent unavailable' }, { status: 503 });
  }
}
