import type { PlannerState } from './planner-store.js';

/**
 * First-run coach. New users learn the loop by doing it with their own tasks:
 * add tasks -> pinch one onto Now -> notice the capacity line -> jar a finished
 * one. One short hint at a time on the panel, plus a spatial cue on the tray.
 */
export type CoachStep = 'add' | 'sort' | 'line' | 'jar' | 'complete' | 'off';

/** Which step a user is on, from saved state alone (so it survives reloads). */
export function coachStep(state: PlannerState): CoachStep {
  const onboarding = state.onboarding;
  if (!onboarding || onboarding.done) return 'off';
  // Calendar meetings arrive pre-sorted in Now; only the user's own tasks teach the loop.
  const onTray = state.tasks.filter((task) => task.zone !== 'tomorrow' && task.kind !== 'meeting');
  const sorted = onTray.some((task) => task.zone === 'now' || task.zone === 'later' || task.zone === 'drop');
  if (state.jar.count > 0) return 'complete';
  if (onTray.length === 0) return 'add';
  if (!sorted) return 'sort';
  if (!onboarding.lineSeen) return 'line';
  return 'jar';
}

export function coachHint(step: CoachStep, capacityHours: number, canDictate: boolean): string {
  switch (step) {
    case 'add':
      return canDictate ? 'Start with your day: pinch Dictate and say what is on your mind' : 'Start with your day: pinch 15m, 30m, 1h or 2h to add a task';
    case 'sort':
      return 'Pinch a tile in the Inbox and drop it on Now';
    case 'line':
      return `That glowing line is your ${capacityHours}h day. Stack past it and Now turns red`;
    case 'jar':
      return 'Finished something? Drop its tile in the jar';
    case 'complete':
      return "You're set. Come back tonight and pinch Wind down";
    default:
      return '';
  }
}
