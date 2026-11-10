import { createSystem, VisibilityState, XRPlane } from '@iwsdk/core';
import { DeskPlacement, TaskTile } from './planner-components.js';
import { deviceName, framePercentiles, msSinceEnter } from './session-metrics.js';
import { speechRecognitionConstructor } from './speech.js';

const SAMPLE_SECONDS = 15;
const MAX_SAMPLES = 80; // about 20 minutes of a playtest
const FRAME_RING = 2048; // more than 15 s at 120 Hz

/** True when the page was opened with ?playtest=1 (remembered for the tab, so reloads keep it). */
export function playtestEnabled(): boolean {
  try {
    if (new URLSearchParams(location.search).get('playtest') === '1') sessionStorage.setItem('dc-playtest', '1');
    return sessionStorage.getItem('dc-playtest') === '1';
  } catch {
    return false;
  }
}

/**
 * Opt-in remote playtest diagnostics, for testing on headsets we do not have.
 * Every 15 s it posts anonymous capability and performance numbers. It never
 * sends task titles, brain-dump text or anything typed or said.
 */
export class PlaytestSystem extends createSystem({
  tiles: { required: [TaskTile] },
  planes: { required: [XRPlane] },
  desk: { required: [DeskPlacement] },
}) {
  private readonly session = Math.random().toString(36).slice(2, 10);
  private frames = 0;
  private elapsed = 0;
  private sent = 0;
  private readonly frameMs = new Float32Array(FRAME_RING);

  update(delta: number): void {
    if (this.frames < FRAME_RING) this.frameMs[this.frames] = delta * 1000;
    this.frames++;
    this.elapsed += delta;
    if (this.elapsed < SAMPLE_SECONDS || this.sent >= MAX_SAMPLES) return;
    const fps = this.frames / this.elapsed;
    const timing = framePercentiles(this.frameMs, Math.min(this.frames, FRAME_RING));
    this.frames = 0;
    this.elapsed = 0;
    this.sent++;
    void this.post(fps, timing);
  }

  private async post(fps: number, timing: { p50: number; p95: number; worst: number }): Promise<void> {
    const session = this.world.renderer.xr.getSession();
    const desk = this.queries.desk.entities.values().next().value;
    let hands = 0;
    let gaze = false;
    for (const source of session?.inputSources ?? []) {
      if (source.hand) hands++;
      if (source.targetRayMode === ('gaze' as XRTargetRayMode)) gaze = true;
    }
    let planeLabels = false;
    for (const entity of this.queries.planes.entities) {
      if ((entity.getValue(XRPlane, '_plane') as { semanticLabel?: string } | undefined)?.semanticLabel) planeLabels = true;
    }
    const enabled = (session as (XRSession & { enabledFeatures?: string[] }) | null)?.enabledFeatures;
    const sample = {
      session: this.session,
      sample: this.sent,
      ua: navigator.userAgent.slice(0, 160),
      immersive: this.world.visibilityState.peek() !== VisibilityState.NonImmersive,
      device: deviceName(navigator.userAgent),
      fps: Math.round(fps * 10) / 10,
      frameP50Ms: Math.round(timing.p50 * 10) / 10,
      frameP95Ms: Math.round(timing.p95 * 10) / 10,
      worstFrameMs: Math.round(timing.worst),
      tiles: this.queries.tiles.entities.size,
      planes: this.queries.planes.entities.size,
      placement: desk ? String(desk.getValue(DeskPlacement, 'state')) : 'none',
      placementSource: desk ? String(desk.getValue(DeskPlacement, 'source')) : '',
      hands,
      depth: Boolean(session && 'depthUsage' in session && (session as { depthUsage?: string }).depthUsage),
      speech: speechRecognitionConstructor() !== undefined,
      anchors: Boolean(enabled?.includes('anchors')),
      planeLabels,
      gaze,
      msToTrayPlaced: msSinceEnter('trayPlacedAt'),
      msToFirstTile: msSinceEnter('firstTileAt'),
      msToFirstSort: msSinceEnter('firstSortAt'),
    };
    try {
      await fetch(`${import.meta.env.BASE_URL}api/diagnostics`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sample),
        keepalive: true,
      });
    } catch {
      // Diagnostics are best-effort and must never disturb the app.
    }
  }
}
