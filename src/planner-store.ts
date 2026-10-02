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
  zone: Zone;
  order: number;
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
}

const DB_NAME = 'desk-companion';
const STORE = 'state';
const KEY = 'planner';

export function emptyState(day = localDay()): PlannerState {
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
  };
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
export function rollover(state: PlannerState, today = localDay()): boolean {
  if (state.day === today) return false;
  let order = 0;
  for (const task of state.tasks) if (task.zone === 'inbox') order = Math.max(order, task.order);
  state.tasks = state.tasks.filter((task) => task.zone !== 'drop');
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
