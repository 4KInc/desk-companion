import {
  BoxGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Vector3,
  type Object3D,
} from '@iwsdk/core';
import type { CoachStep } from './coach-steps.js';
import { JAR } from './scene-assets/done-jar.scene-asset.js';
import { TRAY } from './scene-assets/day-tray.scene-asset.js';
import { TILE_DEPTH, TILE_WIDTH } from './task-tile-visual.js';

/** The spatial half of the first-run coach (steps live in coach-steps.ts). */
const GHOST_TRAVEL = 1.6;
const GHOST_PAUSE = 0.7;
const GHOST_ARC = 0.12;

/** The spatial half of the coach: a looping ghost tile and a pulsing target ring. */
export class CoachVisuals {
  private readonly ghost: Mesh;
  private readonly ghostMaterial: MeshBasicMaterial;
  private readonly ring: Mesh;
  private readonly ringMaterial: MeshBasicMaterial;
  private readonly from = new Vector3();
  private readonly to = new Vector3();
  private step: CoachStep = 'off';
  private clock = 0;

  private readonly tray: Object3D;
  private readonly jar: Object3D;

  constructor(tray: Object3D, jar: Object3D) {
    this.tray = tray;
    this.jar = jar;
    this.ghostMaterial = new MeshBasicMaterial({ color: 0x5fe0d0, transparent: true, opacity: 0, depthWrite: false });
    this.ghost = new Mesh(new BoxGeometry(TILE_WIDTH, 0.01, TILE_DEPTH), this.ghostMaterial);
    this.ghost.name = 'coach-ghost';
    this.ringMaterial = new MeshBasicMaterial({
      color: 0x5fe0d0,
      transparent: true,
      opacity: 0,
      side: DoubleSide,
      depthWrite: false,
    });
    this.ring = new Mesh(new RingGeometry(0.088, 0.1, 48), this.ringMaterial);
    this.ring.name = 'coach-ring';
    this.ring.rotation.x = -Math.PI / 2;
    this.ghost.visible = false;
    this.ring.visible = false;
  }

  /** `ghostFrom` is the tray-local position of the tile to demonstrate with (sort step). */
  show(step: CoachStep, capacityY: number, ghostFrom?: { x: number; y: number; z: number }): void {
    if (step !== this.step) this.clock = 0;
    this.step = step;
    this.ghost.visible = step === 'sort' && ghostFrom !== undefined;
    this.ring.visible = step === 'sort' || step === 'line' || step === 'jar';
    if (this.ghost.visible && ghostFrom) {
      this.from.set(ghostFrom.x, ghostFrom.y, ghostFrom.z);
      this.to.set(TRAY.zones.Now.x, TRAY.surfaceY + 0.01, TRAY.zones.Now.z);
      if (this.ghost.parent !== this.tray) this.tray.add(this.ghost);
    }
    if (step === 'jar') {
      this.jar.add(this.ring);
      this.ring.position.set(0, JAR.height + 0.004, 0);
      this.ring.scale.setScalar(0.7);
    } else if (this.ring.visible) {
      this.tray.add(this.ring);
      const y = step === 'line' ? capacityY : TRAY.surfaceY + 0.004;
      this.ring.position.set(TRAY.zones.Now.x, y, TRAY.zones.Now.z);
      this.ring.scale.setScalar(1);
    }
  }

  update(delta: number): void {
    if (!this.ghost.visible && !this.ring.visible) return;
    this.clock += delta;
    if (this.ring.visible) {
      const pulse = 0.5 + 0.5 * Math.sin(this.clock * 4);
      this.ringMaterial.opacity = 0.35 + 0.5 * pulse;
      const base = this.step === 'jar' ? 0.7 : 1;
      this.ring.scale.setScalar(base * (1 + 0.08 * pulse));
    }
    if (this.ghost.visible) {
      const cycle = this.clock % (GHOST_TRAVEL + GHOST_PAUSE);
      const t = Math.min(1, cycle / GHOST_TRAVEL);
      const eased = t * t * (3 - 2 * t);
      this.ghost.position.lerpVectors(this.from, this.to, eased);
      this.ghost.position.y += Math.sin(Math.PI * eased) * GHOST_ARC;
      // Fade in as it lifts off, fade out as it lands.
      this.ghostMaterial.opacity = 0.55 * Math.sin(Math.PI * Math.min(1, cycle / GHOST_TRAVEL));
    }
  }
}
