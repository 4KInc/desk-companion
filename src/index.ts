import { DepthSensingSystem, VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { mountBrainDumpOverlay } from './brain-dump-overlay.js';
import { DeskPlacementSystem } from './desk-placement-system.js';
import { PlannerSystem } from './planner-system.js';
import { PlaytestSystem, playtestEnabled } from './playtest-system.js';
import { startSessionMetrics } from './session-metrics.js';

// The done jar "never resets": ask the browser not to evict saved state under storage
// pressure. Denial is fine; the app still works, it just has no eviction guarantee.
void navigator.storage?.persist?.().catch(() => false);

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  // Real-world occlusion (Quest 3 depth): only tiles in the air use it, see PlannerSystem.
  // Depth sensing is an optional session feature, so devices without it simply skip this.
  world.registerSystem(DepthSensingSystem, {
    configData: { enableDepthTexture: true, enableOcclusion: true, useFloat32: true, blurRadius: 20 },
  });
  world.registerSystem(DeskPlacementSystem);
  world.registerSystem(PlannerSystem);
  if (playtestEnabled()) world.registerSystem(PlaytestSystem); // opt-in: ?playtest=1
  const planner = world.getSystem(PlannerSystem);
  // ?playtest=1&stress=1 on a headset: load the worst case (25 tiles, 8 weeks of jar layers)
  // once per tab, so one Quest run also measures the heavy phase. Replaces local planner data.
  try {
    if (playtestEnabled() && new URLSearchParams(location.search).get('stress') === '1' && !sessionStorage.getItem('dc-stress-done')) {
      sessionStorage.setItem('dc-stress-done', '1');
      void planner?.seedStress();
    }
  } catch {
    // storage blocked: skip the stress state
  }
  const overlay = mountBrainDumpOverlay((text) => planner?.addBrainDump(text) ?? Promise.resolve(0), {
    connect: (source) => planner?.connectCalendar(source) ?? Promise.reject(new Error('Not ready yet')),
    disconnect: () => planner?.disconnectCalendar(),
    connected: () => planner?.calendarState() ?? { url: '', sample: false },
    onChange: (listener) => planner?.setCalendarListener(listener),
  }, {
    list: () => planner?.draftsList() ?? [],
    onChange: (listener) => planner?.setDraftListener(listener),
  });
  // Browser view (before XR): look down at the desk from a seated eye, framed to the right
  // of the 2D card so the buddy and its first greeting are never hidden behind it.
  const frameDesk = () => {
    world.camera.position.set(-0.18, 1.5, 0.62);
    world.camera.lookAt(-0.18, 0.74, -0.4);
  };
  frameDesk();
  let inXR = false;
  world.visibilityState.subscribe((visibility) => {
    overlay.hidden = visibility !== VisibilityState.NonImmersive;
    if (visibility === VisibilityState.NonImmersive) {
      inXR = false;
      frameDesk();
      return;
    }
    if (inXR) return; // Visible <-> VisibleBlurred (system menu) is the same session
    inXR = true;
    startSessionMetrics();
    // 72 Hz gives the most frame time per frame on Quest; asked for only where the browser allows it.
    const session = world.renderer.xr.getSession() as
      | (XRSession & { supportedFrameRates?: Float32Array; updateTargetFrameRate?: (rate: number) => Promise<void> })
      | null;
    if (session?.supportedFrameRates?.includes(72) && session.updateTargetFrameRate) {
      session.updateTargetFrameRate(72).catch(() => undefined);
    }
  });
  // Installed Quest app (Trusted Web Activity): there is no page to click, so the launch tap
  // starts the AR session. getDigitalGoodsService exists only in the installed app, so browser
  // tabs keep their Enter XR button.
  const nav = navigator as Navigator & { xr?: { isSessionSupported?: (mode: string) => Promise<boolean> } };
  if ('getDigitalGoodsService' in window && nav.xr?.isSessionSupported) {
    nav.xr
      .isSessionSupported('immersive-ar')
      .then((supported) => {
        if (supported) world.launchXR();
      })
      .catch(() => {});
  }
  if (import.meta.env.DEV) {
    // Alt+Shift+R: start over as a brand-new user (first-run testing, demo recording).
    window.addEventListener('keydown', (event) => {
      if (event.altKey && event.shiftKey && event.code === 'KeyR') void planner?.resetForDemo();
      // Alt+Shift+S: the worst-case state for profiling.
      if (event.altKey && event.shiftKey && event.code === 'KeyS') void planner?.seedStress();
      // Alt+Shift+P: turn on ?playtest=1 diagnostics for this tab (samples print in the dev log).
      if (event.altKey && event.shiftKey && event.code === 'KeyP') {
        sessionStorage.setItem('dc-playtest', '1');
        location.reload();
      }
    });
  }
});
