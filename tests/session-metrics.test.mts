import assert from 'node:assert/strict';
import { deviceName, framePercentiles, framePhase, markMoment, msSinceEnter, startSessionMetrics } from '../src/session-metrics.ts';

assert.equal(msSinceEnter('trayPlacedAt'), -1, 'nothing before XR');
markMoment('firstTileAt', 50);
assert.equal(msSinceEnter('firstTileAt'), -1, 'moments before entering XR are ignored');
startSessionMetrics(1000);
markMoment('trayPlacedAt', 3400);
markMoment('trayPlacedAt', 9000);
assert.equal(msSinceEnter('trayPlacedAt'), 2400, 'first time only');
assert.equal(msSinceEnter('firstSortAt'), -1);
startSessionMetrics(20000);
assert.equal(msSinceEnter('trayPlacedAt'), -1, 'a new session starts clean');

const samples = new Float32Array(100);
for (let i = 0; i < 100; i++) samples[i] = i < 90 ? 13.9 : 30 + i;
const p = framePercentiles(samples, 100);
assert.ok(Math.abs(p.p50 - 13.9) < 1e-3 && p.p95 > 100 && p.worst === 129);
assert.deepEqual(framePercentiles(samples, 0), { p50: 0, p95: 0, worst: 0 });
assert.equal(framePercentiles([5, 1, 3], 3).p50, 3, 'unsorted input');

assert.equal(deviceName('Mozilla/5.0 (X11; Linux x86_64; Quest 3) OculusBrowser/33'), 'Quest 3');
assert.equal(deviceName('... Quest 3S) OculusBrowser'), 'Quest 3S');
assert.equal(deviceName('Mozilla/5.0 (Macintosh)'), 'other');

assert.equal(framePhase(6, false, 99), 'idle');
assert.equal(framePhase(6, true, 99), 'sorting', 'holding a tile');
assert.equal(framePhase(6, false, 1.2), 'sorting', 'just let go: the snap and restack');
assert.equal(framePhase(25, true, 0), 'heavy', 'the worst case wins');
assert.equal(framePhase(24, false, 99), 'idle');
console.log('session metrics: all assertions passed');
