import {
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
  type Object3D,
} from '@iwsdk/core';

export type CompanionMode = 'idle' | 'working';

const BUBBLE_W = 0.17;
const BUBBLE_H = 0.06;
const CANVAS_W = 512;
const CANVAS_H = 180;

/**
 * The desk buddy: the agent's face on the desk and a body double during focus.
 * Animates the named parts of the 'desk-buddy' asset and owns its speech bubble.
 * Driven from PlannerSystem.update; nothing is allocated per frame.
 */
export class Companion {
  private readonly root: Object3D;
  private readonly body?: Object3D;
  private readonly face?: Object3D;
  private readonly eyes: Object3D[];
  private readonly hands: Object3D[];
  private readonly handRestY: number[];
  private readonly notebook?: Object3D;
  private readonly bubble: Mesh;
  private readonly bubbleMaterial: MeshBasicMaterial;
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: CanvasTexture;
  private readonly local = new Vector3();
  private readonly head = new Vector3();
  private mode: CompanionMode = 'idle';
  private ready = false;
  private voice = true;
  private reduceMotion = false;
  private clock = 0;
  private nextBlink = 2;
  private blinkTime = -1;
  private bubbleTime = 0;

  constructor(private readonly node: Object3D) {
    this.root = node.getObjectByName('buddy-root') ?? node;
    this.body = node.getObjectByName('buddy-body');
    this.face = node.getObjectByName('buddy-face');
    this.eyes = ['eye-left', 'eye-right'].map((n) => node.getObjectByName(n)).filter((o): o is Object3D => !!o);
    this.hands = ['hand-left', 'hand-right'].map((n) => node.getObjectByName(n)).filter((o): o is Object3D => !!o);
    this.handRestY = this.hands.map((hand) => hand.position.y);
    this.notebook = node.getObjectByName('buddy-notebook');
    if (this.notebook) this.notebook.visible = false;

    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.bubbleMaterial = new MeshBasicMaterial({ map: this.texture, transparent: true, opacity: 0, depthWrite: false });
    this.bubble = new Mesh(new PlaneGeometry(BUBBLE_W, BUBBLE_H), this.bubbleMaterial);
    this.bubble.name = 'buddy-bubble';
    this.bubble.position.set(0, 0.135, 0);
    this.bubble.visible = false;
    node.add(this.bubble);
  }

  setMode(mode: CompanionMode): void {
    this.mode = mode;
    if (this.notebook) this.notebook.visible = mode === 'working';
  }

  /** Read lines aloud too (follows the Sound option). */
  setVoice(on: boolean): void {
    this.voice = on;
    if (!on) globalThis.speechSynthesis?.cancel();
  }

  /** Hands up, ready to take a tile: shown while one is carried over the buddy. */
  setReady(on: boolean): void {
    this.ready = on;
  }

  setReduceMotion(on: boolean): void {
    this.reduceMotion = on;
  }

  /** Shows a short line in the speech bubble for `seconds`. */
  say(text: string, seconds = 7): void {
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = 'rgba(251, 252, 254, 0.97)';
    ctx.beginPath();
    ctx.roundRect(6, 6, CANVAS_W - 12, CANVAS_H - 30, 34);
    ctx.fill();
    ctx.beginPath(); // tail pointing down at the buddy
    ctx.moveTo(CANVAS_W / 2 - 18, CANVAS_H - 25);
    ctx.lineTo(CANVAS_W / 2, CANVAS_H - 4);
    ctx.lineTo(CANVAS_W / 2 + 18, CANVAS_H - 25);
    ctx.fill();
    ctx.fillStyle = '#1f2328';
    ctx.font = '600 34px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    const lines = wrap(ctx, text, CANVAS_W - 64).slice(0, 3);
    const top = (CANVAS_H - 24 - lines.length * 40) / 2;
    lines.forEach((line, i) => ctx.fillText(line, 32, top + i * 40));
    this.texture.needsUpdate = true;
    this.bubbleTime = seconds;
    this.bubble.visible = true;
    this.speak(text);
  }

  /** A small, bright voice through the browser's own speech engine; silently skipped where there is none. */
  private speak(text: string): void {
    const synth = globalThis.speechSynthesis;
    if (!this.voice || !synth || typeof SpeechSynthesisUtterance === 'undefined') return;
    synth.cancel(); // the newest line wins, as it does in the bubble
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 1.35;
    utterance.volume = 0.9;
    synth.speak(utterance);
  }

  update(delta: number, headObject: Object3D): void {
    this.clock += delta;
    const motion = !this.reduceMotion;

    // Turn gently toward the user. Measure in the parent's frame: the animated root may be
    // the placed node itself, and measuring in its own (rotating) frame would feed back.
    headObject.getWorldPosition(this.head);
    this.local.copy(this.head);
    (this.root.parent ?? this.node).worldToLocal(this.local);
    this.local.sub(this.root.position);
    const yaw = Math.atan2(this.local.x, this.local.z);
    this.root.rotation.y += (yaw - this.root.rotation.y) * Math.min(1, delta * 3);

    // Idle bob, or lean in to "work".
    const working = this.mode === 'working';
    this.root.position.y = motion ? Math.sin(this.clock * (working ? 3.2 : 1.6)) * (working ? 0.0012 : 0.002) : 0;
    if (this.body) this.body.rotation.x += ((working ? 0.12 : 0) - this.body.rotation.x) * Math.min(1, delta * 4);
    if (this.face) this.face.position.y += ((working ? -0.004 : 0) - this.face.position.y) * Math.min(1, delta * 4);
    this.hands.forEach((hand, i) => {
      const typing = working && motion ? Math.max(0, Math.sin(this.clock * 14 + i * Math.PI)) * 0.006 : 0;
      const target = this.handRestY[i] - (working ? 0.012 : 0) + typing + (this.ready ? 0.016 : 0);
      hand.position.y += (target - hand.position.y) * Math.min(1, delta * 12);
    });

    // Blink every few seconds.
    this.nextBlink -= delta;
    if (this.nextBlink <= 0) {
      this.blinkTime = 0.14;
      this.nextBlink = 2.5 + ((this.clock * 7.3) % 3.5);
    }
    const open = this.blinkTime > 0 ? 0.15 : 1;
    if (this.blinkTime > 0) this.blinkTime -= delta;
    for (const eye of this.eyes) eye.scale.y = 0.0062 * open;

    // Speech bubble: face the user, fade in and out.
    if (this.bubble.visible) {
      this.bubble.lookAt(this.head);
      this.bubbleTime -= delta;
      const target = this.bubbleTime > 0 ? 1 : 0;
      this.bubbleMaterial.opacity += (target - this.bubbleMaterial.opacity) * Math.min(1, delta * 8);
      if (this.bubbleTime <= 0 && this.bubbleMaterial.opacity < 0.02) this.bubble.visible = false;
    }
  }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}
