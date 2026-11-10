import assert from 'node:assert/strict';
import { DwellTimer, pickTarget } from '../src/dwell.ts';

const eye = { x: 0, y: 1.2, z: 0 };
const ahead = { x: 0, y: 0, z: -1 };
const button = { id: 'add-15', position: { x: 0, y: 1.2, z: -0.6 }, radiusDeg: 3 };
const zone = { id: 'zone-now', position: { x: 0.02, y: 1.2, z: -0.6 }, radiusDeg: 12 };
const far = { id: 'jar', position: { x: 0.6, y: 1.2, z: -0.6 }, radiusDeg: 6 };

assert.equal(pickTarget(eye, ahead, [far])?.id, undefined, 'out of every cone');
assert.equal(pickTarget(eye, ahead, [button, far])?.id, 'add-15', 'straight ahead');
assert.equal(pickTarget(eye, ahead, [zone, button])?.id, 'add-15', 'the small target wins inside a big one');
assert.equal(pickTarget(eye, { x: 0.6, y: 0, z: -0.6 }, [button, zone, far])?.id, 'jar', 'turning the head');
assert.equal(pickTarget(eye, ahead, [])?.id, undefined);

const timer = new DwellTimer(0.8);
assert.equal(timer.update('a', 0.4).progress, 0.5);
assert.equal(timer.update('a', 0.3).fired, undefined);
assert.equal(timer.update('a', 0.2).fired, 'a', 'fires at 0.8 s');
assert.equal(timer.update('a', 1).fired, undefined, 'fires once per look');
assert.equal(timer.update('b', 0.5).progress, 0.625, 'a new target restarts');
assert.equal(timer.update(undefined, 0.5).progress, 0, 'looking away resets');
assert.equal(timer.update('b', 0.5).fired, undefined, 'and the hold starts over');
assert.equal(timer.update('a', 0.9).fired, 'a', 'looking back fires again');

console.log('look to select: all assertions passed');
