import assert from 'node:assert/strict';
import { COMFORT_LIMIT, offAxis, rotateAbout, swingFor } from '../src/fov-swing.ts';

const deg = (r: number) => (r * 180) / Math.PI;
const head = { x: 0, z: 0 };
const forward = { x: 0, z: -1 }; // looking down -Z

assert.ok(Math.abs(offAxis(head, forward, { x: 0, z: -1 })) < 1e-9, 'straight ahead');
assert.ok(Math.abs(deg(offAxis(head, forward, { x: -1, z: -1 })) - 45) < 1e-6, 'front-left is +45');
assert.ok(Math.abs(deg(offAxis(head, forward, { x: 1, z: -1 })) + 45) < 1e-6, 'front-right is -45');

assert.equal(swingFor((20 * Math.PI) / 180), 0, 'inside the cone: no swing');
assert.ok(Math.abs(deg(swingFor((45 * Math.PI) / 180)) + 20) < 1e-6, '45 left swings 20 back to the right');
assert.ok(Math.abs(deg(swingFor((-40 * Math.PI) / 180)) - 15) < 1e-6, '40 right swings 15 back to the left');

// Swinging a point by swingFor(offAxis) lands it exactly on the limit, at the same distance.
for (const point of [{ x: 0.6, z: -0.3 }, { x: -0.5, z: -0.2 }, { x: 0.2, z: -0.6 }]) {
  const theta = offAxis(head, forward, point);
  const moved = rotateAbout(point, head, swingFor(theta));
  const after = offAxis(head, forward, moved);
  assert.ok(Math.abs(after) <= COMFORT_LIMIT + 1e-9, `inside the cone after the swing (${deg(after).toFixed(1)})`);
  assert.ok(Math.abs(Math.hypot(moved.x, moved.z) - Math.hypot(point.x, point.z)) < 1e-9, 'same distance from the head');
}
console.log('fov swing: all assertions passed');
