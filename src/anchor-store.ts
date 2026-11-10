/**
 * Where the tray's persistent anchor handle is kept between sessions. localStorage, not the
 * planner's IndexedDB: the handle must be readable synchronously the moment an XR session
 * starts, it is an opaque id (no personal data), and IWSDK keeps its own anchor the same way.
 */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const ANCHOR_KEY = 'desk-companion.desk-anchor';

export interface SavedAnchor {
  /** The handle from XRAnchor.requestPersistentHandle(). */
  uuid: string;
  /** Epoch ms, for diagnostics only. */
  savedAt: number;
}

export function saveAnchorHandle(store: KeyValueStore, uuid: string, now = Date.now()): void {
  store.setItem(ANCHOR_KEY, JSON.stringify({ uuid, savedAt: now } satisfies SavedAnchor));
}

/** The saved handle, or undefined. A corrupt value is cleared so it cannot fail every session. */
export function readAnchorHandle(store: KeyValueStore): SavedAnchor | undefined {
  const raw = store.getItem(ANCHOR_KEY);
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<SavedAnchor>;
    if (typeof value.uuid === 'string' && value.uuid.length > 0 && value.uuid.length < 200) {
      return { uuid: value.uuid, savedAt: Number(value.savedAt) || 0 };
    }
  } catch {
    // fall through to clearing
  }
  store.removeItem(ANCHOR_KEY);
  return undefined;
}

export function clearAnchorHandle(store: KeyValueStore): void {
  store.removeItem(ANCHOR_KEY);
}

/**
 * Whether a restored anchor is still believable as "the desk in front of me": within reach
 * horizontally and at a plausible desk height above the floor (local-floor space, y up).
 */
export function plausibleDeskPose(anchor: { x: number; y: number; z: number }, head: { x: number; y: number; z: number }): boolean {
  const horizontal = Math.hypot(anchor.x - head.x, anchor.z - head.z);
  return horizontal <= 2 && anchor.y >= 0.2 && anchor.y <= 1.6 && anchor.y < head.y;
}
