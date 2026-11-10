import assert from 'node:assert/strict';
import { ANCHOR_KEY, clearAnchorHandle, plausibleDeskPose, readAnchorHandle, saveAnchorHandle } from '../src/anchor-store.ts';

const memory = () => {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
};

const store = memory();
assert.equal(readAnchorHandle(store), undefined, 'nothing saved yet');
saveAnchorHandle(store, 'uuid-1', 1000);
assert.deepEqual(readAnchorHandle(store), { uuid: 'uuid-1', savedAt: 1000 }, 'save then read');
saveAnchorHandle(store, 'uuid-2', 2000);
assert.equal(readAnchorHandle(store)?.uuid, 'uuid-2', 'Move tray replaces the handle');
clearAnchorHandle(store);
assert.equal(readAnchorHandle(store), undefined, 'clear');

for (const corrupt of ['{not json', '"just a string"', '{"uuid":""}', '{"uuid":42}', 'null', `{"uuid":"${'x'.repeat(300)}"}`]) {
  store.map.set(ANCHOR_KEY, corrupt);
  assert.equal(readAnchorHandle(store), undefined, `corrupt value ${corrupt.slice(0, 20)} is ignored`);
  assert.equal(store.map.has(ANCHOR_KEY), false, 'and cleared');
}

const head = { x: 0, y: 1.2, z: 0 };
assert.ok(plausibleDeskPose({ x: 0, y: 0.74, z: -0.5 }, head), 'a desk in front');
assert.ok(!plausibleDeskPose({ x: 3, y: 0.74, z: 0 }, head), 'too far away');
assert.ok(!plausibleDeskPose({ x: 0, y: -0.1, z: -0.5 }, head), 'below the floor');
assert.ok(!plausibleDeskPose({ x: 0, y: 1.4, z: -0.5 }, head), 'above the head');

console.log('anchor store: all assertions passed');
