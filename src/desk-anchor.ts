import { clearAnchorHandle, readAnchorHandle, saveAnchorHandle, type KeyValueStore } from './anchor-store.js';

/**
 * The tray's own spatial anchor, so it comes back on the same real desk next session.
 * Raw WebXR (IWSDK's XRAnchor anchors the session origin, not an arbitrary pose); every
 * call is feature-detected, and any failure just means the desk is found the usual way.
 */
type PersistentAnchor = XRAnchor & { requestPersistentHandle?: () => Promise<string> };
type PersistentSession = XRSession & {
  restorePersistentAnchor?: (uuid: string) => Promise<XRAnchor>;
  deletePersistentAnchor?: (uuid: string) => Promise<void>;
};
type AnchorFrame = XRFrame & { createAnchor?: (pose: XRRigidTransform, space: XRSpace) => Promise<XRAnchor> };

/** Restoring waits at most this long before the table / pinch fallbacks take over. */
export const RESTORE_TIMEOUT_MS = 3000;

function storage(): KeyValueStore | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined; // private mode or blocked storage
  }
}

export class DeskAnchor {
  /** The live anchor for this session, created or restored. */
  anchor?: XRAnchor;
  private creating = false;

  /** Whether this session can keep an anchor across sessions at all. */
  static canPersist(session: XRSession): boolean {
    return typeof (session as PersistentSession).restorePersistentAnchor === 'function';
  }

  /** Restores last session's anchor, or resolves undefined (none saved, unsupported, stale, slow). */
  async restore(session: XRSession): Promise<XRAnchor | undefined> {
    const store = storage();
    const saved = store && readAnchorHandle(store);
    const restoreFn = (session as PersistentSession).restorePersistentAnchor;
    if (!saved || !store || typeof restoreFn !== 'function') return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), RESTORE_TIMEOUT_MS);
    });
    try {
      const anchor = await Promise.race([restoreFn.call(session, saved.uuid), timeout]);
      if (anchor) this.anchor = anchor;
      return anchor ?? undefined;
    } catch {
      clearAnchorHandle(store); // the runtime no longer knows this handle
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Anchors the tray at its new pose (reference-space coordinates) and makes it persistent,
   * replacing the previous one. Must run inside an XR frame callback.
   */
  async create(
    session: XRSession,
    frame: XRFrame,
    space: XRReferenceSpace,
    position: { x: number; y: number; z: number },
    yaw: number,
  ): Promise<void> {
    const createFn = (frame as AnchorFrame).createAnchor;
    if (this.creating || typeof createFn !== 'function') return;
    this.creating = true;
    try {
      const half = yaw / 2;
      const pose = new XRRigidTransform(position, { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) });
      const anchor = (await createFn.call(frame, pose, space)) as PersistentAnchor;
      await this.forget(session);
      this.anchor = anchor;
      const store = storage();
      if (store && typeof anchor.requestPersistentHandle === 'function') {
        saveAnchorHandle(store, await anchor.requestPersistentHandle());
      }
    } catch {
      // Anchors are an improvement, never a requirement: the tray stays where it was placed.
    } finally {
      this.creating = false;
    }
  }

  /** Drops the live anchor and its saved handle (Move tray, or a restored pose that makes no sense). */
  async forget(session: XRSession): Promise<void> {
    const store = storage();
    const saved = store && readAnchorHandle(store);
    if (saved && store) {
      clearAnchorHandle(store);
      try {
        await (session as PersistentSession).deletePersistentAnchor?.(saved.uuid);
      } catch {
        // already gone
      }
    }
    try {
      this.anchor?.delete();
    } catch {
      // already gone
    }
    this.anchor = undefined;
  }

  /** The session ended: its XRSpaces are dead, but the saved handle is kept for next time. */
  endSession(): void {
    this.anchor = undefined;
    this.creating = false;
  }
}
