/*
 * Synth sound, no samples: the murmur of a packed arena; the swish of the wind-up and the whoosh of the release; the
 * thunk of the dart into sisal; a chime that rises with the target you hit; the crowd cheering, clapping, gasping or
 * groaning at each dart.
 */

const SOUND_KEY = 'bullseye.sound';

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private unlocked = false;
  private _enabled: boolean;

  constructor() {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(SOUND_KEY);
    } catch {
      /* private mode */
    }
    this._enabled = saved !== 'off';
  }

  get enabled() {
    return this._enabled;
  }

  set enabled(v: boolean) {
    this._enabled = v;
    try {
      localStorage.setItem(SOUND_KEY, v ? 'on' : 'off');
    } catch {
      /* ignore */
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v ? 0.9 : 0, this.ctx.currentTime, 0.05);
    if (v) this.unlock();
  }

  unlock() {
    if (!this._enabled) return;
    if (!this.ctx) this.build();
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
    this.unlocked = true;
  }

  private build() {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this._enabled ? 0.9 : 0;
    this.master.connect(comp);
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    // the bed: the hall's low rumble and the murmur of the crowd
    const loop = (type: BiquadFilterType, f: number, gain: number) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filt = ctx.createBiquadFilter();
      filt.type = type;
      filt.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(filt);
      filt.connect(g);
      g.connect(this.master!);
      src.start();
    };
    loop('lowpass', 180, 0.05);
    loop('bandpass', 700, 0.012);
    loop('bandpass', 1400, 0.006);
  }

  private get ready() {
    return this._enabled && this.unlocked && this.ctx?.state === 'running';
  }

  private burst(o: { dur: number; gain: number; type?: BiquadFilterType; freq?: number; freqEnd?: number; q?: number; delay?: number; attack?: number }) {
    if (!this.ready || !this.ctx || !this.noise) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? 'bandpass';
    f.frequency.setValueAtTime(o.freq ?? 1000, t0);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t0 + o.dur);
    f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.gain, t0 + (o.attack ?? 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master!);
    src.start(t0);
    src.stop(t0 + o.dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', delay = 0, freqEnd?: number, attack = 0.006) {
    if (!this.ready || !this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(this.master!);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  /** The arm draws back: a soft swish of a sleeve. */
  windup() {
    this.burst({ dur: 0.22, gain: 0.05, type: 'bandpass', freq: 700, freqEnd: 350, q: 1.2, attack: 0.08 });
  }

  /** The dart leaves the hand: a quick whoosh. */
  release() {
    this.burst({ dur: 0.34, gain: 0.15, type: 'bandpass', freq: 900, freqEnd: 2600, q: 1.4 });
  }

  /** The dart hits the board, and the crowd reacts. */
  land(hit: number, target: number, won: boolean) {
    if (won) {
      this.win(target);
      this.cheer(target);
    } else {
      this.miss(hit);
      if (hit >= target * 0.7 && target >= 2) this.gasp();
      else if (target >= 5) this.groan();
    }
  }

  /** The crowd: a roar that swells with the target, and a scatter of claps. */
  private cheer(target: number) {
    const size = Math.min(1, 0.25 + Math.log10(target) * 0.45);
    this.burst({ dur: 1.2 + size * 2.2, gain: 0.06 + size * 0.22, type: 'bandpass', freq: 1100, q: 0.5, delay: 0.08, attack: 0.18 });
    this.burst({ dur: 1 + size * 1.6, gain: 0.03 + size * 0.1, type: 'bandpass', freq: 2600, q: 0.7, delay: 0.12, attack: 0.25 });
    const claps = Math.round(6 + size * 30);
    for (let i = 0; i < claps; i++) this.burst({ dur: 0.04, gain: 0.04 + Math.random() * 0.05, type: 'highpass', freq: 1500 + Math.random() * 1500, delay: 0.15 + Math.random() * (0.8 + size * 1.6) });
  }

  /** So close: a sharp intake of breath from the crowd. */
  private gasp() {
    this.burst({ dur: 0.7, gain: 0.12, type: 'bandpass', freq: 1600, freqEnd: 700, q: 0.8, delay: 0.05, attack: 0.05 });
  }

  /** A big target missed: a low groan. */
  private groan() {
    this.burst({ dur: 0.9, gain: 0.1, type: 'bandpass', freq: 520, freqEnd: 260, q: 2.5, delay: 0.1, attack: 0.12 });
  }

  /** It sticks (a thunk) and pays: a chime that climbs with the target. */
  private win(target: number) {
    this.thunk();
    const lift = Math.min(12, Math.log2(target) * 3);
    const f = 523 * Math.pow(2, lift / 12);
    this.tone(f, 0.18, 0.1, 'triangle', 0.05);
    this.tone(f * 1.25, 0.2, 0.09, 'triangle', 0.12);
    this.tone(f * 1.5, 0.3, 0.09, 'triangle', 0.19);
  }

  /** It sticks short of the ring: a duller thunk and a low note (off the rings entirely: a clank off the wire). */
  private miss(hit: number) {
    if (hit < 1.2) {
      this.burst({ dur: 0.08, gain: 0.25, type: 'bandpass', freq: 3000, q: 4 });
      this.tone(1800, 0.12, 0.06, 'square', 0, 900);
    } else this.thunk();
    this.tone(196, 0.25, 0.08, 'triangle', 0.08, 150);
  }

  private thunk() {
    this.burst({ dur: 0.08, gain: 0.35, type: 'lowpass', freq: 700 });
    this.tone(140, 0.1, 0.25, 'sine', 0, 80);
  }

  click() {
    this.burst({ dur: 0.03, gain: 0.08, type: 'bandpass', freq: 2200 });
  }
}

export const sound = new SoundEngine();
