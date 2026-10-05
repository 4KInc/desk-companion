import assert from 'node:assert/strict';
import { emptyState, endDay, rollover, plannedMinutes } from '../src/planner-store.ts';

const t = (id: number, zone: string, minutes = 30, order = id) => ({ id, title: `T${id}`, minutes, priority: 2, zone: zone as any, order });
const s = emptyState('2026-09-30');
s.tasks = [t(1, 'now', 60), t(2, 'now', 120), t(3, 'drop'), t(4, 'tomorrow'), t(5, 'later'), t(6, 'inbox', 30, 2)];
s.today.doneMinutes = 90; s.today.doneCount = 2;
assert.equal(plannedMinutes(s), 270, 'planned = done + Now');

assert.deepEqual(endDay(s), [3], 'End day removes Drop');
assert.equal(s.streak, 1); assert.equal(s.history.length, 1);
assert.deepEqual(s.history[0], { day: '2026-09-30', plannedMinutes: 270, doneMinutes: 90, doneCount: 2 });
s.today.doneMinutes = 120; endDay(s);
assert.equal(s.history.length, 1, 'same day ended twice updates the record'); assert.equal(s.streak, 1);
assert.equal(s.history[0].doneMinutes, 120);

assert.equal(rollover(s, '2026-09-30'), false, 'same date: no rollover');
assert.equal(rollover(s, '2026-10-01'), true);
const t4 = s.tasks.find((x) => x.id === 4)!;
assert.equal(t4.zone, 'inbox'); assert.equal(t4.order, 3, 'tomorrow tile appended after existing inbox');
assert.deepEqual(s.tasks.map((x) => x.zone).sort(), ['inbox', 'inbox', 'later', 'now', 'now'], 'Now/Later carry over');
assert.equal(s.today.doneMinutes, 0); assert.equal(s.day, '2026-10-01');

endDay(s); assert.equal(s.streak, 2, 'consecutive day extends streak');
rollover(s, '2026-10-03'); endDay(s); assert.equal(s.streak, 1, 'missed day restarts streak');
rollover(s, '2026-11-01'); assert.equal(s.day, '2026-11-01');
const m = emptyState('2026-10-31'); m.lastEndedDay = '2026-10-31'; m.streak = 4; m.day = '2026-11-01'; endDay(m);
assert.equal(m.streak, 5, 'month boundary counts as consecutive');
console.log('store logic: all assertions passed');
import { jarLayers, weekStart } from '../src/planner-store.ts';
assert.equal(weekStart('2026-10-02'), '2026-09-28', 'Friday -> Monday');
assert.equal(weekStart('2026-09-28'), '2026-09-28', 'Monday is its own week');
assert.equal(weekStart('2026-11-01'), '2026-10-26', 'Sunday belongs to the previous Monday');
const j = emptyState('2026-09-14');
j.jar.count = 2; // legacy completions from before history existed
const finish = (n: number) => { j.today.doneCount += n; j.jar.count += n; };
finish(3); rollover(j, '2026-09-15');            // unended day still recorded
finish(1); endDay(j); finish(2); rollover(j, '2026-09-22'); // work after End day counted
finish(4); rollover(j, '2026-10-01');
finish(5);                                        // current week, not ended
const layers = jarLayers(j);
assert.deepEqual(layers.map((l) => [l.week, l.count, l.current]), [
  ['earlier', 2, false], ['2026-09-14', 6, false], ['2026-09-21', 4, false], ['2026-09-28', 5, true],
]);
assert.equal(layers.reduce((s, l) => s + l.count, 0), j.jar.count, 'layers add up to the jar');
assert.equal(jarLayers(j, 1)[0].count, 8, 'old weeks merge into earlier');
console.log('jar layers: all assertions passed');
import { planDay } from '../src/planner-store.ts';
assert.equal(planDay(new Date(2026, 9, 2, 3, 59)), '2026-10-01', '3:59 a.m. still belongs to yesterday');
assert.equal(planDay(new Date(2026, 9, 2, 4, 0)), '2026-10-02', '4 a.m. starts the new plan day');
assert.equal(planDay(new Date(2026, 9, 1, 1, 30)), '2026-09-30', 'month boundary after midnight');
console.log('plan day: all assertions passed');
