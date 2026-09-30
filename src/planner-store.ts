import type { Zone } from './planner-components.js';

export interface StoredTask {
  id: number;
  title: string;
  minutes: number;
  /** 1 = high, 2 = normal, 3 = low. */
  priority: number;
  zone: Zone;
  order: number;
}

export interface PlannerState {
  nextId: number;
  capacityHours: number;
  tasks: StoredTask[];
  /** The done jar never resets. */
  jar: { count: number; minutes: number };
}

const DB_NAME = 'desk-companion';
const STORE = 'state';
const KEY = 'planner';

export function emptyState(): PlannerState {
  return { nextId: 1, capacityHours: 5, tasks: [], jar: { count: 0, minutes: 0 } };
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
    return value ? { ...emptyState(), ...(value as PlannerState) } : emptyState();
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
