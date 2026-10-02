import { VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { mountBrainDumpOverlay } from './brain-dump-overlay.js';
import { DeskPlacementSystem } from './desk-placement-system.js';
import { PlannerSystem } from './planner-system.js';

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
