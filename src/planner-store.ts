import type { Category, Completion } from './estimates.js';
import type { Zone } from './planner-components.js';

export interface StoredTask {
  id: number;
  title: string;
  minutes: number;
  /** 1 = high, 2 = normal, 3 = low. */
  priority: number;
  category?: Category;
  /** Time spent on this task in focus mode, in milliseconds. */
  focusMs?: number;
  /** The user said Keep to the agent's offer to split this task; don't ask again. */
  splitDeclined?: boolean;
  /** 'meeting' tiles come from the calendar: fixed in Now, never grabbed, refreshed daily. */
  kind?: 'task' | 'meeting';
  /** Meeting start and end (epoch ms). */
  startMs?: number;
  endMs?: number;
  /** The agent's latest draft for this task, if any. */
  draftId?: number;
  zone: Zone;
  order: number;
}

/** A first draft the agent wrote for a task (kept on this device, most recent last). */
export interface StoredDraft {
  id: number;
  taskId: number;
  taskTitle: string;
  kind: string;
  title: string;
  body: string;
  nextStep: string;
  day: string;
}

export interface DayRecord {
  day: string;
  plannedMinutes: number;
  doneMinutes: number;
  doneCount: number;
}

export interface PlannerState {
  nextId: number;
  capacityHours: number;
  tasks: StoredTask[];
  /** The done jar never resets. */
  jar: { count: number; minutes: number };
  /** Local date (YYYY-MM-DD) the current plan belongs to. */
  day: string;
  /** Running totals for `day`, reset at rollover. */
  today: { doneCount: number; doneMinutes: number; deferredCount: number };
  /** One record per ended day, oldest first. */
  history: DayRecord[];
  /** Consecutive days ended with a wind-down. */
  streak: number;
  lastEndedDay: string;
  /** Finished tasks with estimated vs actual time; drives the estimation-bias model. */
  completions: Completion[];
  /** Task currently floating in focus mode, or 0. */
  focusTaskId: number;
  /** First-run coach progress. Users who already had data skip it. */
  onboarding: { lineSeen: boolean; done: boolean };
  /** First drafts the agent wrote for tasks; the 20 most recent. */
  drafts: StoredDraft[];
  /** Calendar link (kept only on this device) or the built-in sample day. */
  calendar: { url: string; sample: boolean };
  /** Accessibility options, chosen on the panel's Options card. */
  settings: { largeTiles: boolean; highContrast: boolean; reduceMotion: boolean; sound: boolean };
}

const DB_NAME = 'desk-companion';
const STORE = 'state';
const KEY = 'planner';

export function emptyState(day = planDay()): PlannerState {
  return {
    nextId: 1,
    capacityHours: 5,
    tasks: [],
    jar: { count: 0, minutes: 0 },
    day,
    today: { doneCount: 0, doneMinutes: 0, deferredCount: 0 },
    history: [],
    streak: 0,
    lastEndedDay: '',
    completions: [],
    focusTaskId: 0,
    onboarding: { lineSeen: false, done: false },
    settings: { largeTiles: false, highContrast: false, reduceMotion: false, sound: true },
    calendar: { url: '', sample: false },
    drafts: [],
  };
}

/** The plan day starts at 4 a.m. local, so working past midnight still counts as "today". */
export const DAY_START_HOUR = 4;

/** The plan day a moment belongs to: the local date, shifted back by DAY_START_HOUR. */
export function planDay(date = new Date()): string {
  return localDay(new Date(date.getTime() - DAY_START_HOUR * 60 * 60 * 1000));
}

/** YYYY-MM-DD in the device's local time zone. */
export function localDay(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function previousDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d - 1));
}

/** What the day was planned at: already finished plus what is still sitting in Now. */
export function plannedMinutes(state: PlannerState): number {
  let now = 0;
  for (const task of state.tasks) if (task.zone === 'now') now += task.minutes;
  return state.today.doneMinutes + now;
}

/**
 * Wind-down "End day": records the day, extends or restarts the streak and
 * clears the Drop pile. Ending the same day twice updates its record instead of
 * counting it again. Returns the ids of the dropped tasks that were removed.
 */
export function endDay(state: PlannerState): number[] {
  const record: DayRecord = {
    day: state.day,
    plannedMinutes: plannedMinutes(state),
    doneMinutes: state.today.doneMinutes,
    doneCount: state.today.doneCount,
  };
  const last = state.history[state.history.length - 1];
  if (last?.day === state.day) {
    state.history[state.history.length - 1] = record;
  } else {
    state.history.push(record);
    state.streak = state.lastEndedDay === previousDay(state.day) ? state.streak + 1 : 1;
  }
  state.lastEndedDay = state.day;
  const dropped = state.tasks.filter((task) => task.zone === 'drop').map((task) => task.id);
  state.tasks = state.tasks.filter((task) => task.zone !== 'drop');
  return dropped;
}

/**
 * New local date: tomorrow's pile returns to the Inbox, leftover Drop tiles are
 * cleared and today's totals reset. Now and Later carry over untouched. Returns
 * false when `today` is still the plan's day.
 */
export function rollover(state: PlannerState, today = planDay()): boolean {
  if (state.day === today) return false;
  // Keep a record of every day with finished work, ended or not, so the jar's weekly
  // layers never lose a day. Work done after End day updates that day's record.
  const last = state.history[state.history.length - 1];
  if (last?.day === state.day) {
    last.doneCount = Math.max(last.doneCount, state.today.doneCount);
    last.doneMinutes = Math.max(last.doneMinutes, state.today.doneMinutes);
  } else if (state.today.doneCount > 0) {
    state.history.push({
      day: state.day,
      plannedMinutes: plannedMinutes(state),
      doneMinutes: state.today.doneMinutes,
      doneCount: state.today.doneCount,
    });
  }
  let order = 0;
  for (const task of state.tasks) if (task.zone === 'inbox') order = Math.max(order, task.order);
  // Yesterday's meetings are over; today's are fetched fresh from the calendar.
  state.tasks = state.tasks.filter((task) => task.zone !== 'drop' && task.kind !== 'meeting');
  for (const task of state.tasks) {
    if (task.zone !== 'tomorrow') continue;
    task.zone = 'inbox';
    task.order = ++order;
  }
  state.day = today;
  state.today = { doneCount: 0, doneMinutes: 0, deferredCount: 0 };
  return true;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadState(): Promise<PlannerState> {
  try {
    const db = await openDb();
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    if (!value) return emptyState();
    const saved = value as Partial<PlannerState>;
    const merged = { ...emptyState(), ...saved } as PlannerState;
    // Saved before the coach existed: anyone with tasks or a filled jar already knows the loop.
    if (!saved.onboarding) {
      const experienced = (saved.tasks?.length ?? 0) > 0 || (saved.jar?.count ?? 0) > 0;
      merged.onboarding = { lineSeen: experienced, done: experienced };
    }
    return merged;
  } catch (error) {
    console.warn('[DeskCompanion] could not load saved state', error);
    return emptyState();
  }
}

export async function saveState(state: PlannerState): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(state, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (error) {
    console.warn('[DeskCompanion] could not save state', error);
  }
}

/** Monday of the week containing `day` (YYYY-MM-DD, local). */
export function weekStart(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const sinceMonday = (date.getDay() + 6) % 7;
  return localDay(new Date(y, m - 1, d - sinceMonday));
}

export interface JarLayer {
  /** Week start (YYYY-MM-DD), or 'earlier' for merged older weeks. */
  week: string;
  count: number;
  current: boolean;
}

/**
 * The done jar as weekly strata, oldest first and the current week last (on top).
 * Weeks beyond `maxPastWeeks`, and anything finished before history existed, are
 * merged into one 'earlier' layer at the bottom. Counts always add up to jar.count.
 */
export function jarLayers(state: PlannerState, maxPastWeeks = 6): JarLayer[] {
  const byWeek = new Map<string, number>();
  const add = (week: string, n: number) => byWeek.set(week, (byWeek.get(week) ?? 0) + n);
  for (const record of state.history) if (record.doneCount > 0) add(weekStart(record.day), record.doneCount);
  const last = state.history[state.history.length - 1];
  const todayExtra = last?.day === state.day ? state.today.doneCount - last.doneCount : state.today.doneCount;
  const current = weekStart(state.day);
  add(current, Math.max(0, todayExtra));

  let tracked = 0;
  for (const n of byWeek.values()) tracked += n;
  let earlier = Math.max(0, state.jar.count - tracked);
  const past = [...byWeek.keys()].filter((week) => week !== current).sort();
  while (past.length > maxPastWeeks) earlier += byWeek.get(past.shift()!) ?? 0;

  const layers: JarLayer[] = [];
  if (earlier > 0) layers.push({ week: 'earlier', count: earlier, current: false });
  for (const week of past) layers.push({ week, count: byWeek.get(week)!, current: false });
  layers.push({ week: current, count: byWeek.get(current) ?? 0, current: true });
  return layers.filter((layer) => layer.count > 0);
}
