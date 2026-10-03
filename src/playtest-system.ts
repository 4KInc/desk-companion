import { createSystem, VisibilityState, XRPlane } from '@iwsdk/core';
import { DeskPlacement, TaskTile } from './planner-components.js';
import { speechRecognitionConstructor } from './speech.js';

const SAMPLE_SECONDS = 15;
const MAX_SAMPLES = 80; // about 20 minutes of a playtest

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
  private worstFrameMs = 0;
  private sent = 0;

  update(delta: number): void {
    this.frames++;
    this.elapsed += delta;
    this.worstFrameMs = Math.max(this.worstFrameMs, delta * 1000);
    if (this.elapsed < SAMPLE_SECONDS || this.sent >= MAX_SAMPLES) return;
    const fps = this.frames / this.elapsed;
    const worst = this.worstFrameMs;
    this.frames = 0;
    this.elapsed = 0;
    this.worstFrameMs = 0;
    this.sent++;
    void this.post(fps, worst);
  }

  private async post(fps: number, worstFrameMs: number): Promise<void> {
    const session = this.world.renderer.xr.getSession();
    const desk = this.queries.desk.entities.values().next().value;
    let hands = 0;
    for (const source of session?.inputSources ?? []) if (source.hand) hands++;
    const sample = {
      session: this.session,
      sample: this.sent,
      ua: navigator.userAgent.slice(0, 160),
      immersive: this.world.visibilityState.peek() !== VisibilityState.NonImmersive,
      fps: Math.round(fps * 10) / 10,
      worstFrameMs: Math.round(worstFrameMs),
      tiles: this.queries.tiles.entities.size,
      planes: this.queries.planes.entities.size,
      placement: desk ? String(desk.getValue(DeskPlacement, 'state')) : 'none',
      placementSource: desk ? String(desk.getValue(DeskPlacement, 'source')) : '',
      hands,
      depth: Boolean(session && 'depthUsage' in session && (session as { depthUsage?: string }).depthUsage),
      speech: speechRecognitionConstructor() !== undefined,
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
