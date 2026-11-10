/**
 * "Look to select": the pure half. Picks what the head (or eyes) is pointed at with a
 * cone test (no raycaster: just angles to known targets) and runs the hold-still timer.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface DwellCandidate {
  id: string;
  position: Vec3;
  /** Half-angle in degrees within which this target counts as looked at. */
  radiusDeg: number;
}

/** The candidate closest to the view direction, if any lies within its own radius. */
export function pickTarget(
  origin: Vec3,
  forward: Vec3,
  candidates: readonly DwellCandidate[],
  count = candidates.length,
): DwellCandidate | undefined {
  const fl = Math.hypot(forward.x, forward.y, forward.z) || 1;
  let best: DwellCandidate | undefined;
  let bestScore = Infinity;
  for (let i = 0; i < count; i++) {
    const candidate = candidates[i];
    const dx = candidate.position.x - origin.x;
    const dy = candidate.position.y - origin.y;
    const dz = candidate.position.z - origin.z;
    const dl = Math.hypot(dx, dy, dz);
    if (dl < 1e-6) continue;
    const cos = (dx * forward.x + dy * forward.y + dz * forward.z) / (dl * fl);
    const angle = (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
    if (angle > candidate.radiusDeg) continue;
    const score = angle / candidate.radiusDeg; // relative, so a small button beats a big zone it sits inside
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/** Hold-still timer: fires once per continuous look, then waits for the gaze to move on. */
export class DwellTimer {
  readonly seconds: number;
  private target: string | undefined;
  private held = 0;
  private spent = false;

  constructor(seconds: number) {
    this.seconds = seconds;
  }

  /** Progress 0..1 for the radial fill, and the id that fired this frame (if any). */
  update(target: string | undefined, delta: number): { progress: number; fired?: string } {
    if (target !== this.target) {
      this.target = target;
      this.held = 0;
      this.spent = false;
    }
    if (!target || this.spent) return { progress: 0 };
    this.held += delta;
    if (this.held >= this.seconds) {
      this.spent = true;
      return { progress: 1, fired: target };
    }
    return { progress: this.held / this.seconds };
  }

  reset(): void {
    this.target = undefined;
    this.held = 0;
    this.spent = false;
  }
}
