import {
  BoxGeometry,
  CanvasTexture,
  DoubleSide,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
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

/**
 * A "pinch" glyph (thumb and index finger closing on a spark), drawn with shapes rather
 * than an emoji so it looks the same on every headset.
 */
function pinchGlyph(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(17, 84, 75, 0.9)';
  ctx.lineWidth = 22;
  const outline = () => {
    ctx.beginPath(); // index finger, from the top
    ctx.moveTo(34, 18);
    ctx.quadraticCurveTo(52, 50, 74, 64);
    ctx.stroke();
    ctx.beginPath(); // thumb, from below
    ctx.moveTo(30, 112);
    ctx.quadraticCurveTo(50, 80, 74, 68);
    ctx.stroke();
  };
  outline();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 14;
  outline();
  ctx.strokeStyle = '#2fb5a8';
  ctx.lineWidth = 6;
  for (const [x1, y1, x2, y2] of [[88, 66, 112, 66], [86, 52, 104, 38], [86, 80, 104, 94]]) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** The spatial half of the coach: a looping ghost tile and a pulsing target ring. */
export class CoachVisuals {
  private readonly ghost: Mesh;
  private readonly ghostMaterial: MeshBasicMaterial;
  private readonly pinchMaterial: SpriteMaterial;
  private readonly ring: Mesh;
  private readonly ringMaterial: MeshBasicMaterial;
  private readonly from = new Vector3();
  private readonly to = new Vector3();
  private step: CoachStep = 'off';
  /** Reduce motion: no flying ghost tile and a steady (non-pulsing) ring. */
  private reduceMotion = false;
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
    // The pinch rides just above the ghost tile, so the motion and the gesture read together.
    this.pinchMaterial = new SpriteMaterial({ map: pinchGlyph(), transparent: true, depthTest: false, opacity: 0 });
    const pinch = new Sprite(this.pinchMaterial);
    pinch.name = 'coach-pinch';
    pinch.scale.setScalar(0.06);
    pinch.position.set(0.03, 0.035, 0);
    pinch.renderOrder = 5;
    this.ghost.add(pinch);
    this.ring.visible = false;
  }

  setReduceMotion(on: boolean): void {
    this.reduceMotion = on;
  }

  /** `ghostFrom` is the tray-local position of the tile to demonstrate with (sort step). */
  show(step: CoachStep, capacityY: number, ghostFrom?: { x: number; y: number; z: number }): void {
    if (step !== this.step) this.clock = 0;
    this.step = step;
    this.ghost.visible = step === 'sort' && ghostFrom !== undefined && !this.reduceMotion;
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
      const pulse = this.reduceMotion ? 0.6 : 0.5 + 0.5 * Math.sin(this.clock * 4);
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
      this.pinchMaterial.opacity = Math.min(1, this.ghostMaterial.opacity * 2.2);
    }
  }
}
