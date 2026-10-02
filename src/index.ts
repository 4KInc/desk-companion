import { VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { mountBrainDumpOverlay } from './brain-dump-overlay.js';
import { DeskPlacementSystem } from './desk-placement-system.js';
import { PlannerSystem } from './planner-system.js';

// The done jar "never resets": ask the browser not to evict saved state under storage
// pressure. Denial is fine; the app still works, it just has no eviction guarantee.
void navigator.storage?.persist?.().catch(() => false);

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(DeskPlacementSystem);
  world.registerSystem(PlannerSystem);
  const planner = world.getSystem(PlannerSystem);
  const overlay = mountBrainDumpOverlay((text) => planner?.addBrainDump(text) ?? Promise.resolve(0));
  world.visibilityState.subscribe((visibility) => {
    overlay.hidden = visibility !== VisibilityState.NonImmersive;
  });
  if (import.meta.env.DEV) {
    // Alt+Shift+R: start over as a brand-new user (first-run testing, demo recording).
    window.addEventListener('keydown', (event) => {
      if (event.altKey && event.shiftKey && event.code === 'KeyR') void planner?.resetForDemo();
    });
  }
});
