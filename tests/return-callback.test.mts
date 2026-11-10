import assert from 'node:assert/strict';
import { biasLine } from '../src/estimates.ts';
import { returnCallback } from '../src/return-callback.ts';

const done = (category: string, estimate: number, actual: number) => ({ category, estimate, actual }) as never;
const slowWriting = [done('writing', 60, 85), done('writing', 30, 42), done('writing', 45, 63), done('writing', 60, 84)];

assert.equal(returnCallback({ returning: 0, newWeekLayer: false, insight: undefined }), undefined, 'nothing to say, says nothing');
assert.equal(
  returnCallback({ returning: 3, newWeekLayer: false, insight: undefined }),
  'Good morning. 3 tiles came back from yesterday.',
);
assert.equal(returnCallback({ returning: 1, newWeekLayer: false, insight: undefined }), 'Good morning. 1 tile came back from yesterday.');
const withInsight = returnCallback({ returning: 2, newWeekLayer: true, insight: biasLine(slowWriting) })!;
assert.match(withInsight, /2 tiles came back/);
assert.match(withInsight, /writing tasks run 41% low\. I'll nudge new estimates to match\./);
assert.doesNotMatch(withInsight, /new layer/, 'two parts at most: the jar layer gives way');
assert.equal(
  returnCallback({ returning: 0, newWeekLayer: true, insight: undefined }),
  "Good morning. It's a new week: your next finished task starts a new layer in the jar.",
);
// Two samples are not enough to claim a pattern.
assert.equal(returnCallback({ returning: 0, newWeekLayer: false, insight: biasLine(slowWriting.slice(0, 2)) }), undefined);

console.log('return callback: all assertions passed');
