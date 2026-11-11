import type { Object3D, Vector3 } from '@iwsdk/core';

/**
 * Procedural sound design for the desk: every sound is synthesised with Web Audio
 * (no files, nothing to license) and spatialised at the object that made it, with
 * the listener following the head. Browsers only start audio after a user gesture,
 * so the context is created lazily and resumed on the first pointer/key/XR input.
 */
export type SoundKind =
  | 'snap'
  | 'miss'
  | 'jar'
  | 'overflow'
  | 'whoosh'
  | 'focusStart'
  | 'focusStop'
  | 'click'
  | 'pop'
  | 'endDay'
  | 'crack';

export class DeskSounds {
  private ctx?: AudioContext;
  private master?: GainNode;
  private noise?: AudioBuffer;
  private readonly unlock = () => this.ensure();

  constructor() {
    window.addEventListener('pointerdown', this.unlock);
    window.addEventListener('keydown', this.unlock);
  }

  dispose(): void {
    window.removeEventListener('pointerdown', this.unlock);
    window.removeEventListener('keydown', this.unlock);
    void this.ctx?.close();
  }

  /** Creates or resumes the audio context. Safe to call from any input handler. */
  ensure(): AudioContext | undefined {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return undefined;
      }
      // If the audio device fails (unplugged headphones, a Bluetooth switch), drop the
      // context so the next interaction builds a fresh one instead of staying silent.
      const failed = this.ctx;
      failed.addEventListener('error', () => {
        if (this.ctx === failed) this.ctx = undefined;
        void failed.close().catch(() => undefined);
      });
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      const length = Math.floor(this.ctx.sampleRate * 0.6);
      this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Keeps the Web Audio listener on the head. Reads matrix elements directly: no allocation. */
  updateListener(head: Object3D): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const e = head.matrixWorld.elements;
    const l = ctx.listener;
    if (l.positionX) {
      const t = ctx.currentTime;
      l.positionX.setValueAtTime(e[12], t);
      l.positionY.setValueAtTime(e[13], t);
      l.positionZ.setValueAtTime(e[14], t);
      l.forwardX.setValueAtTime(-e[8], t);
      l.forwardY.setValueAtTime(-e[9], t);
      l.forwardZ.setValueAtTime(-e[10], t);
      l.upX.setValueAtTime(e[4], t);
      l.upY.setValueAtTime(e[5], t);
      l.upZ.setValueAtTime(e[6], t);
    }
  }

  /** Sound on/off from the Options card. */
  muted = false;

  play(kind: SoundKind, at?: Vector3, delay = 0): void {
    if (this.muted) return;
    const ctx = this.ctx;
    if (import.meta.env.DEV) console.info(`[sound] ${kind} ${ctx?.state ?? 'no-context'}`);
    if (!ctx || ctx.state !== 'running' || !this.master) return;
    const out = this.output(ctx, at);
    const t = ctx.currentTime + delay;
    switch (kind) {
      case 'snap':
        this.tone(ctx, out, 'triangle', 880, 660, t, 0.07, 0.35);
        this.tone(ctx, out, 'triangle', 1320, 990, t + 0.035, 0.06, 0.2);
        this.hiss(ctx, out, t, 0.03, 3000, 0.12);
        break;
      case 'miss':
        this.tone(ctx, out, 'sine', 330, 220, t, 0.12, 0.25);
        break;
      case 'jar':
        for (const [freq, level, len] of [[1046.5, 0.3, 1.3], [1568, 0.18, 1.0], [2637, 0.1, 0.5]] as const) {
          this.tone(ctx, out, 'sine', freq, freq, t, len, level);
        }
        this.hiss(ctx, out, t, 0.02, 6000, 0.15);
        break;
      case 'overflow': {
        // A low, wobbling warning: sawtooth through a lowpass with a tremolo.
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = 98;
        filter.type = 'lowpass';
        filter.frequency.value = 420;
        lfo.frequency.value = 9;
        depth.gain.value = 0.08;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.16, t + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
        lfo.connect(depth).connect(gain.gain);
        osc.connect(filter).connect(gain).connect(out);
        osc.start(t);
        lfo.start(t);
        osc.stop(t + 0.75);
        lfo.stop(t + 0.75);
        break;
      }
      case 'whoosh': {
        const src = ctx.createBufferSource();
        const band = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        src.buffer = this.noise!;
        band.type = 'bandpass';
        band.Q.value = 1.4;
        band.frequency.setValueAtTime(350, t);
        band.frequency.exponentialRampToValueAtTime(2600, t + 0.32);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.35, t + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
        src.connect(band).connect(gain).connect(out);
        src.start(t);
        src.stop(t + 0.4);
        break;
      }
      case 'focusStart':
        this.tone(ctx, out, 'sine', 523.25, 523.25, t, 0.25, 0.22);
        this.tone(ctx, out, 'sine', 783.99, 783.99, t + 0.12, 0.45, 0.22);
        break;
      case 'focusStop':
        this.tone(ctx, out, 'sine', 783.99, 783.99, t, 0.2, 0.18);
        this.tone(ctx, out, 'sine', 523.25, 523.25, t + 0.1, 0.35, 0.18);
        break;
      case 'click':
        this.tone(ctx, out, 'sine', 1400, 1200, t, 0.035, 0.12);
        break;
      case 'pop':
        this.tone(ctx, out, 'sine', 620, 940, t, 0.09, 0.2);
        break;
      case 'crack':
        // A dry snap: short bright noise burst over a low thump.
        this.hiss(ctx, out, t, 0.06, 1800, 0.45);
        this.tone(ctx, out, 'sine', 140, 70, t, 0.12, 0.35);
        break;
      case 'endDay':
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) =>
          this.tone(ctx, out, 'sine', freq, freq, t + i * 0.11, 1.2 - i * 0.15, 0.16),
        );
        break;
    }
  }

  private output(ctx: AudioContext, at?: Vector3): AudioNode {
    if (!at) return this.master!;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 0.5;
    panner.positionX.value = at.x;
    panner.positionY.value = at.y;
    panner.positionZ.value = at.z;
    panner.connect(this.master!);
    return panner;
  }

  private tone(
    ctx: AudioContext,
    out: AudioNode,
    type: OscillatorType,
    from: number,
    to: number,
    t: number,
    length: number,
    level: number,
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t + length);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(level, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }

  private hiss(ctx: AudioContext, out: AudioNode, t: number, length: number, freq: number, level: number): void {
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    src.buffer = this.noise!;
    filter.type = 'highpass';
    filter.frequency.value = freq;
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    src.connect(filter).connect(gain).connect(out);
    src.start(t);
    src.stop(t + length + 0.02);
  }
}
