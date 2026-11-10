/**
 * Off-centre trays: how far to swing the panel and buddy around the seated user so they land
 * inside the comfortable cone, while the tray itself stays where the user put it.
 * Angles in radians, horizontal plane (x right, z toward the user, y up).
 */
export const COMFORT_LIMIT = (25 * Math.PI) / 180;

/** Signed horizontal angle from head-forward to the direction of `point` (positive = to the left). */
export function offAxis(head: { x: number; z: number }, forward: { x: number; z: number }, point: { x: number; z: number }): number {
  const fx = forward.x;
  const fz = forward.z;
  const dx = point.x - head.x;
  const dz = point.z - head.z;
  return Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz) * -1;
}

/** The swing (about the head's vertical axis) that brings an angle `theta` back to the limit; 0 inside it. */
export function swingFor(theta: number, limit = COMFORT_LIMIT): number {
  if (Math.abs(theta) <= limit) return 0;
  return -(theta - Math.sign(theta) * limit);
}

/** Rotates `point` about the vertical axis through `pivot` by `angle` (counter-clockwise seen from above). */
export function rotateAbout(point: { x: number; z: number }, pivot: { x: number; z: number }, angle: number): { x: number; z: number } {
  const dx = point.x - pivot.x;
  const dz = point.z - pivot.z;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: pivot.x + dx * c + dz * s, z: pivot.z - dx * s + dz * c };
}
