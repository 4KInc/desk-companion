import assert from 'node:assert/strict';
import { nudgeDone, nudgeWhy } from '../src/nudge-words.ts';

assert.equal(
  nudgeWhy([{ title: 'Tidy up the backlog', priority: 3 }], '3h 30m', '45m', false),
  'You\'re 45m over. Meetings fill 3h 30m, so "Tidy up the backlog" is low priority and can wait.',
);
assert.equal(
  nudgeWhy([{ title: 'Book flights', priority: 2 }], undefined, '30m', true),
  'That\'s more than your day holds. "Book flights" isn\'t urgent and can wait.',
);
assert.match(nudgeWhy([{ title: 'A', priority: 3 }, { title: 'B', priority: 3 }, { title: 'C', priority: 3 }], undefined, '2h', false), /"A" and 2 more are the lowest priority and can wait\./);
assert.match(nudgeWhy([{ title: 'A', priority: 2 }, { title: 'B', priority: 3 }], undefined, '2h', false), /least urgent/);
assert.match(nudgeWhy([{ title: 'Finish the Q4 roadmap document for the board', priority: 2 }], undefined, '1h', false), /"Finish the Q4 roadmap doc\.\.\."/);
assert.ok(nudgeWhy([{ title: 'Finish the Q4 roadmap document for the board', priority: 1 }], '3h 30m', '1h 15m', true).length <= 140, 'fits the bubble');
assert.equal(nudgeDone([{ title: 'Tidy up', priority: 3 }], 8), 'Moved "Tidy up" to Later. Now fits your 8h day.');
assert.equal(nudgeDone([{ title: 'A', priority: 3 }, { title: 'B', priority: 3 }], 6), 'Moved 2 tiles to Later. Now fits your 6h day.');
console.log('nudge words: all assertions passed');
