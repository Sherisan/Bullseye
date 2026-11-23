/*
 * BULLSEYE's scene, seen from the oche: you stand on the stage of a televised darts championship with a dart in your
 * hand. Hold or press THROW and the arm winds up, snaps forward and lets go; the dart flies away from you in true
 * perspective, flights spinning, arcs into the board and sticks, seen from behind like every dart you've ever thrown.
 * Darts come in visits of three; the board is cleared for each new visit.
 *
 * The board's rings are sized by their chance (ring m has radius R/√m, so its area is its chance) and a dart lands at
 * radius R/√hit, so you can see exactly why it won or lost. The arena around it is set dressing: the LED halo, the
 * moving-head lights, the crowd, and two big screens: a live board-cam close-up of your last dart and the target.
 *
 * Everything 3D lives in "board radii": the board is ZB radii in front of you, and a point (x, y, z) shows on screen
 * at the board centre + (x, y) × R × ZB / z. The scene animates results the server has already decided.
 */

import type { Throw } from '../game/api';
import { FLY_MS, RINGS, WIND_MS, chanceOf, landRadius, radiusFor } from '../game/darts';

export interface SceneView {
  /** the target being aimed at */
  target: number;
  /** the dart in the air (or just landed); `at` is when it left the hand */
  flight: { t: Throw; at: number } | null;
  /** when the throw in progress started its wind-up, or null between throws */
  windAt: number | null;
  /** 0..1: the player holding the throw back (Space held, or a finger on the stage) */
  pull: number;
  history: Throw[];
  reducedMotion: boolean;
  /** the part of the screen the UI leaves free for the stage (left/right default to the full width) */
  insets?: { top: number; bottom: number; left?: number; right?: number };
  /** thumbnail only: freeze the throw this many seconds after the release */
  freeze?: number;
}

type Ctx = CanvasRenderingContext2D;
interface V3 {
  x: number;
  y: number;
  z: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  age: number;
  life: number;
  size: number;
  color: string;
  rot: number;
  vr: number;
  kind: 'confetti' | 'chip' | 'flash';
}

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const strHash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const easeInOut = (x: number) => {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
const add = (a: V3, b: V3): V3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a: V3, b: V3): V3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a: V3, k: number): V3 => v3(a.x * k, a.y * k, a.z * k);
const norm = (a: V3): V3 => mul(a, 1 / (Math.hypot(a.x, a.y, a.z) || 1));
const cross = (a: V3, b: V3): V3 => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const lerp3 = (a: V3, b: V3, t: number): V3 => v3(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));

/** The board's distance from your eye, in board radii (a real board is ~14 radii away; a little closer here). */
const ZB = 8;
/** The dart, in board radii, measured from the tip back. */
const DART = { len: 0.64, point: 0.12, barrel: 0.33, shaft: 0.45, flightFront: 0.42, flightBack: 0.64, vane: 0.11, barrelR: 0.016, shaftR: 0.0075 };
/** Where the fingers pinch the barrel, measured from the tip. */
const GRIP = 0.23;
/** The hand's size: screen pixels per hand unit (about a centimetre), per unit of perspective scale. */
const HAND_SCALE = 0.036;
/** The arc of the throw: how far (in board radii) the dart rises above the straight line. */
const ARC = 0.32;
const FLY = FLY_MS / 1000;
/** The flights' roll while the dart is in your hand. */
const HELD_SPIN = 0.35;
const WIND = WIND_MS / 1000;

/** Ring colours, outermost first: each ring alternates between two tones in twenty wedges, like a real board. */
const RING_TONES: [string, string][] = [
  ['#16161c', '#1f1f27'],
  ['#1f7a44', '#196a3a'],
  ['#efe3c6', '#e2d3b0'],
  ['#c8262a', '#b31f24'],
  ['#efe3c6', '#e2d3b0'],
  ['#1f7a44', '#196a3a'],
  ['#c8262a', '#b31f24'],
  ['#ffcb3a', '#f2b81e'],
];
const SKIN = { light: '#e2aa86', mid: '#b47a5c', dark: '#6a4232', rim: 'rgba(255,220,196,0.6)', line: 'rgba(60,30,20,0.6)' };
/** A hex colour darkened by factor k (1 = as is). */
const shadeHex = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.round(v * k);
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
};
const CROWD_SHIRTS = ['#2a2f52', '#4a1f2c', '#1f3a33', '#3d3420', '#2c2c36', '#5a2a1a', '#203a5a', '#3a2050'];
const SIGNS = ['BULLSEYE!', 'GO ON!', '×50', 'ONE MORE!', 'ON THE OCHE', 'WHAT A DART'];

export class Scene {
  private ctx: Ctx;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private view: SceneView | null = null;
  private raf = 0;
  private last = 0;
  private time = 0;
  private obs: ResizeObserver;
  private particles: Particle[] = [];
  private landedFx = new Set<string>();
  private cheer = 0;
  private pull = 0;
  private cock = 0;
  private shake = 0;
  private haloFlash = 0;
  private cachedFor = '';
  private backdrop: HTMLCanvasElement | null = null;
  private boardFace: HTMLCanvasElement | null = null;
  private vignette: CanvasGradient | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.obs = new ResizeObserver(() => this.resize());
    this.obs.observe(canvas);
    this.resize();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.obs.disconnect();
  }

  set(view: SceneView) {
    this.view = view;
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, Math.round(r.width));
    this.h = Math.max(1, Math.round(r.height));
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.cachedFor = '';
  }

  private loop = (now: number) => {
    const dt = Math.min(0.05, this.last ? (now - this.last) / 1000 : 0.016);
    this.last = now;
    this.time += dt;
    if (this.view) this.draw(now, dt, this.view);
    this.raf = requestAnimationFrame(this.loop);
  };

  /* ── Layout ────────────────────────────────────────────────────────── */

  private get top() {
    return this.view?.insets?.top ?? this.h * 0.08;
  }

  private get bottom() {
    return this.view?.insets?.bottom ?? this.h * 0.8;
  }

  private get left() {
    return this.view?.insets?.left ?? 0;
  }

  private get right() {
    return this.view?.insets?.right ?? this.w;
  }

  /** Board centre and scoring radius (the edge of the miss rim), centred in the free part of the screen. */
  private get board() {
    const band = Math.max(120, this.bottom - this.top);
    const width = Math.max(120, this.right - this.left);
    const R = Math.max(40, Math.min(band * 0.35, width * 0.32));
    const cy = this.top + Math.max(R * 1.3, band * 0.43);
    return { cx: (this.left + this.right) / 2, cy, R };
  }

  /** Where the hand rests (screen), just above the bet panel, to the right. */
  private get handRest() {
    const { cx, R } = this.board;
    // kept in from the right edge so the dart's flights stay on a narrow screen
    return { x: Math.min(cx + R * 1.15, this.right - R * 1.1), y: this.bottom - R * 0.78, z: 3.2 };
  }

  private proj(p: V3) {
    const { cx, cy, R } = this.board;
    const k = (R * ZB) / Math.max(0.05, p.z);
    return { x: cx + this.shakeX + p.x * k, y: cy + this.shakeY + p.y * k, k };
  }

  private unproj(sx: number, sy: number, z: number): V3 {
    const { cx, cy, R } = this.board;
    const k = (R * ZB) / z;
    return v3((sx - cx) / k, (sy - cy) / k, z);
  }

  private get shakeX() {
    return Math.sin(this.time * 83) * this.shake;
  }

  private get shakeY() {
    return Math.cos(this.time * 71) * this.shake * 0.6;
  }

  /* ── The throw in 3D ───────────────────────────────────────────────── */

  /** Where a throw sticks in the board (board radii, on the board's plane). */
  private landing(t: Throw): V3 {
    const a = hash(strHash(t.id) * 0.0137 + 0.5) * Math.PI * 2;
    const r = landRadius(t.hit);
    return v3(Math.cos(a) * r, Math.sin(a) * r, ZB);
  }

  /** The hand's pose: grip position (3D) and the dart's direction, for a wind-up amount c (0..1) and a thrust (0..1). */
  private handPose(c: number, thrust: number, bob: number) {
    const rest = this.handRest;
    const { R } = this.board;
    const sx = rest.x + R * 0.12 * c - R * 0.1 * thrust;
    const sy = rest.y + R * 0.24 * c - R * 0.3 * thrust + bob;
    const z = rest.z - 0.3 * c + 0.5 * thrust;
    const grip = this.unproj(sx, sy, z);
    // the dart points up and across towards the board; drawn back it tilts up more, and the throw levels it out
    const dir = norm(v3(-0.72 + 0.25 * thrust, -0.36 - 0.42 * c + 0.22 * thrust, 0.6 + 0.3 * thrust));
    return { grip, dir };
  }

  /** The release point and direction every throw starts from (the fully wound-up pose). */
  private releasePose() {
    return this.handPose(1, 0, 0);
  }

  /** The dart's tip and back-axis (tip → tail) at time f (0..1) through its flight to `end`. */
  private flightAt(f: number, end: V3) {
    const rel = this.releasePose();
    const start = add(rel.grip, mul(rel.dir, GRIP));
    const along = lerp3(start, end, f);
    const tip = v3(along.x, along.y - ARC * 4 * f * (1 - f), along.z);
    const tangent = add(sub(end, start), v3(0, -ARC * 4 * (1 - 2 * f), 0));
    const fly = norm(tangent);
    // it leaves the hand pointing the way the hand held it, and turns into its line of flight
    const blend = easeOut(f / 0.25);
    const dir = norm(lerp3(rel.dir, fly, blend));
    return { tip, back: mul(dir, -1) };
  }

  /** A stuck dart's back-axis: the way it was flying when it hit. */
  private stuckBack(end: V3) {
    return this.flightAt(1, end).back;
  }

  /* ── Frame ─────────────────────────────────────────────────────────── */

  draw(now: number, dt: number, v: SceneView) {
    const ctx = this.ctx;
    const t = this.time;
    const key = `${this.w}x${this.h}@${this.dpr}:${Math.round(this.top)}:${Math.round(this.bottom)}:${Math.round(this.left)}:${Math.round(this.right)}`;
    if (key !== this.cachedFor) this.buildCaches(key);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.shake *= Math.exp(-dt * 9);
    this.haloFlash = Math.max(0, this.haloFlash - dt * 0.7);
    const clock = v.freeze != null && v.flight ? v.flight.at + v.freeze * 1000 : now;

    if (this.backdrop) ctx.drawImage(this.backdrop, 0, 0, this.w, this.h);
    this.lights(t);
    this.halo(t);
    this.boardDraw(v, t, clock);
    const darts = this.dartsOnBoard(v, clock);
    for (const d of darts) this.stuckDart(d.t, d.alpha, d.t.id === v.flight?.t.id ? clock - v.flight.at : null, v);
    this.screens(v, t, darts);
    this.crowd(t, dt);
    this.inFlight(v, clock);
    this.hand(v, dt, clock);
    this.stepParticles(dt);
    this.grade();
  }

  /** The darts in the board this visit (three per visit; a new visit clears the board as the next throw starts). */
  private dartsOnBoard(v: SceneView, now: number) {
    const n = v.history.length;
    const out: { t: Throw; alpha: number }[] = [];
    if (n > 0) {
      const k = n % 3 || 3;
      const clearing = k === 3 && v.windAt != null;
      const alpha = clearing ? 1 - clamp01((now - v.windAt!) / 220) : 1;
      if (alpha > 0) for (const h of v.history.slice(0, k)) out.push({ t: h, alpha });
    }
    // the dart that just landed, if the history hasn't caught up with it yet
    const f = v.flight;
    if (f && (now - f.at) / 1000 >= FLY && !out.some((d) => d.t.id === f.t.id) && (now - f.at) / 1000 < FLY + 0.4) out.unshift({ t: f.t, alpha: 1 });
    return out.reverse();
  }

  /* ── Caches: the arena and the board face ──────────────────────────── */

  private buildCaches(key: string) {
    this.cachedFor = key;
    const { w, h, dpr } = this;
    const mk = (cw: number, chh: number) => {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(cw * dpr));
      c.height = Math.max(1, Math.round(chh * dpr));
      const x = c.getContext('2d')!;
      x.scale(dpr, dpr);
      return [c, x] as const;
    };
    const { cx, cy, R } = this.board;
    // the arena
    const [bc, b] = mk(w, h);
    const g = b.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#05060f');
    g.addColorStop(0.45, '#0b0e24');
    g.addColorStop(1, '#04040a');
    b.fillStyle = g;
    b.fillRect(0, 0, w, h);
    // the stage backdrop: an LED wall of tiny dim pixels, brighter in a band behind the board
    const wallTop = this.top - 10;
    const floorY = cy + R * 1.62;
    const wallL = cx - R * 2.6;
    const wallR = cx + R * 2.6;
    const wg = b.createLinearGradient(0, wallTop, 0, floorY);
    wg.addColorStop(0, '#0a0d2a');
    wg.addColorStop(1, '#141a46');
    b.fillStyle = wg;
    b.fillRect(wallL, wallTop, wallR - wallL, floorY - wallTop);
    const pitch = Math.max(5, R * 0.045);
    for (let y = wallTop + pitch / 2; y < floorY; y += pitch) {
      for (let x = wallL + pitch / 2; x < wallR; x += pitch) {
        const d = Math.hypot((x - cx) / (R * 2.6), (y - cy) / (R * 1.6));
        const glow = Math.max(0, 1 - d);
        const a = 0.06 + glow * 0.22 + (hash(x * 0.37 + y * 1.3) < 0.04 ? 0.25 : 0);
        b.fillStyle = `rgba(90,120,255,${a.toFixed(3)})`;
        b.fillRect(x - pitch * 0.18, y - pitch * 0.18, pitch * 0.36, pitch * 0.36);
      }
    }
    // the wall's frame and LED edge strips
    b.fillStyle = '#05060f';
    b.fillRect(wallL - R * 0.08, wallTop, R * 0.08, floorY - wallTop);
    b.fillRect(wallR, wallTop, R * 0.08, floorY - wallTop);
    b.fillStyle = 'rgba(232,37,60,0.3)';
    b.fillRect(wallL - 2, wallTop, 2, floorY - wallTop);
    b.fillRect(wallR, wallTop, 2, floorY - wallTop);
    // the stage floor: a glossy deck, with the oche mat running towards you from the board
    const fg = b.createLinearGradient(0, floorY, 0, h);
    fg.addColorStop(0, '#15172c');
    fg.addColorStop(1, '#07070e');
    b.fillStyle = fg;
    b.fillRect(0, floorY, w, h - floorY);
    b.fillStyle = 'rgba(232,37,60,0.9)';
    b.fillRect(wallL, floorY - 2, wallR - wallL, 3);
    const vy = cy;
    const matW0 = R * 0.9;
    const matW1 = R * 4.2;
    const yMatEnd = h + R;
    const t0 = (floorY - vy) / (yMatEnd - vy);
    b.fillStyle = '#1c1d2e';
    b.beginPath();
    b.moveTo(cx - matW0 / 2, floorY);
    b.lineTo(cx + matW0 / 2, floorY);
    b.lineTo(cx + matW1 / 2, yMatEnd);
    b.lineTo(cx - matW1 / 2, yMatEnd);
    b.closePath();
    b.fill();
    b.strokeStyle = 'rgba(232,37,60,0.8)';
    b.lineWidth = 2;
    b.stroke();
    // distance stripes across the mat, closer together towards the board
    for (let i = 1; i < 7; i++) {
      const tt = t0 + (1 - t0) * Math.pow(i / 7, 1.8);
      const y = vy + (yMatEnd - vy) * tt;
      const halfW = lerp(matW0, matW1, (y - floorY) / (yMatEnd - floorY)) / 2;
      b.fillStyle = i === 5 ? 'rgba(255,203,58,0.85)' : 'rgba(255,255,255,0.08)';
      b.fillRect(cx - halfW, y, halfW * 2, i === 5 ? 3 : 1);
    }
    // reflections of the board's halo in the deck
    const rf = b.createRadialGradient(cx, floorY + R * 0.1, 0, cx, floorY + R * 0.1, R * 2);
    rf.addColorStop(0, 'rgba(255,190,90,0.12)');
    rf.addColorStop(1, 'rgba(255,190,90,0)');
    b.fillStyle = rf;
    b.fillRect(cx - R * 2, floorY, R * 4, R * 2);
    // the truss across the top, with lamps hanging from it
    const ty = Math.max(4, this.top - R * 0.02);
    b.strokeStyle = 'rgba(120,128,160,0.35)';
    b.lineWidth = 1.5;
    b.beginPath();
    b.moveTo(0, ty);
    b.lineTo(w, ty);
    b.moveTo(0, ty + R * 0.12);
    b.lineTo(w, ty + R * 0.12);
    for (let x = 0; x < w; x += R * 0.12) {
      b.moveTo(x, ty);
      b.lineTo(x + R * 0.12, ty + R * 0.12);
    }
    b.stroke();
    this.backdrop = bc;

    // the board face: rings (each sized by its chance) split into wedges, the spider wire, labels, the surround
    const S = Math.ceil(R * 2.5);
    const [fc, f] = mk(S, S);
    const c = S / 2;
    // the surround: a black catch ring with the event's name printed round it
    f.fillStyle = '#0b0b10';
    f.beginPath();
    f.arc(c, c, R * 1.2, 0, Math.PI * 2);
    f.fill();
    f.save();
    f.font = `700 ${Math.max(8, Math.round(R * 0.07))}px 'Inter', sans-serif`;
    f.fillStyle = 'rgba(255,255,255,0.32)';
    f.textAlign = 'center';
    f.textBaseline = 'middle';
    const text = 'BULLSEYE OPEN  ·  ';
    const chars = (text + text + text).split('');
    chars.forEach((ch, i) => {
      const a = -Math.PI / 2 + (i / chars.length) * Math.PI * 2;
      f.save();
      f.translate(c + Math.cos(a) * R * 1.1, c + Math.sin(a) * R * 1.1);
      f.rotate(a + Math.PI / 2);
      f.fillText(ch, 0, 0);
      f.restore();
    });
    f.restore();
    // the miss rim
    f.fillStyle = '#121218';
    f.beginPath();
    f.arc(c, c, R, 0, Math.PI * 2);
    f.fill();
    // the rings, outermost first, in twenty alternating wedges
    const wedges = 20;
    RINGS.forEach((ring, i) => {
      const r = R * radiusFor(ring.target);
      const [t1, t2] = RING_TONES[i];
      for (let s = 0; s < wedges; s++) {
        const a0 = -Math.PI / 2 - Math.PI / wedges + (s * Math.PI * 2) / wedges;
        f.fillStyle = s % 2 ? t2 : t1;
        f.beginPath();
        f.moveTo(c, c);
        f.arc(c, c, r, a0, a0 + (Math.PI * 2) / wedges);
        f.closePath();
        f.fill();
      }
    });
    // sisal: fine fibres
    f.strokeStyle = 'rgba(0,0,0,0.07)';
    f.lineWidth = 1;
    f.beginPath();
    for (let i = 0; i < 160; i++) {
      const a = (i / 160) * Math.PI * 2;
      f.moveTo(c + Math.cos(a) * R * 0.05, c + Math.sin(a) * R * 0.05);
      f.lineTo(c + Math.cos(a) * R * 0.91, c + Math.sin(a) * R * 0.91);
    }
    f.stroke();
    // the spider: silver wire round every ring and along the wedge edges
    f.strokeStyle = 'rgba(214,220,232,0.75)';
    f.lineWidth = Math.max(1, R * 0.006);
    for (const ring of RINGS) {
      f.beginPath();
      f.arc(c, c, R * radiusFor(ring.target), 0, Math.PI * 2);
      f.stroke();
    }
    f.beginPath();
    const rIn = R * radiusFor(RINGS[RINGS.length - 2].target);
    for (let s = 0; s < wedges; s++) {
      const a = -Math.PI / 2 - Math.PI / wedges + (s * Math.PI * 2) / wedges;
      f.moveTo(c + Math.cos(a) * rIn, c + Math.sin(a) * rIn);
      f.lineTo(c + Math.cos(a) * R * radiusFor(RINGS[0].target), c + Math.sin(a) * R * radiusFor(RINGS[0].target));
    }
    f.stroke();
    // MISS in the rim
    f.font = `800 ${Math.max(8, Math.round(R * 0.042))}px 'Inter', sans-serif`;
    f.fillStyle = 'rgba(255,255,255,0.3)';
    f.textAlign = 'center';
    f.textBaseline = 'middle';
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      f.save();
      f.translate(c + Math.cos(a) * R * 0.957, c + Math.sin(a) * R * 0.957);
      f.rotate(a + Math.PI / 2);
      f.fillText('MISS', 0, 0);
      f.restore();
    }
    // ring labels, on dark chips up the left of the board where nothing else is
    RINGS.forEach((ring, i) => {
      const rOut = R * radiusFor(ring.target);
      const rNext = i < RINGS.length - 1 ? R * radiusFor(RINGS[i + 1].target) : 0;
      const rr = (rOut + rNext) / 2;
      const a = -Math.PI * 0.62;
      const fs = Math.max(9, Math.round(Math.min(R * 0.065, (rOut - rNext) * 0.7 + 4)));
      f.font = `800 ${fs}px 'JetBrains Mono', monospace`;
      const tw = f.measureText(ring.label).width;
      const x = c + Math.cos(a) * rr;
      const y = c + Math.sin(a) * rr;
      f.fillStyle = 'rgba(8,8,14,0.72)';
      f.beginPath();
      f.roundRect(x - tw / 2 - fs * 0.3, y - fs * 0.62, tw + fs * 0.6, fs * 1.24, fs * 0.3);
      f.fill();
      f.fillStyle = i === RINGS.length - 1 ? '#ffcb3a' : '#fff6e6';
      f.fillText(ring.label, x, y + 0.5);
    });
    // a sheen across the face
    const sh = f.createLinearGradient(c - R, c - R, c + R, c + R);
    sh.addColorStop(0, 'rgba(255,255,255,0.1)');
    sh.addColorStop(0.45, 'rgba(255,255,255,0)');
    f.fillStyle = sh;
    f.beginPath();
    f.arc(c, c, R, 0, Math.PI * 2);
    f.fill();
    this.boardFace = fc;

    const vig = this.ctx.createRadialGradient(cx, cy, R * 1.2, cx, cy, Math.max(w, h) * 0.85);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,6,0.62)');
    this.vignette = vig;
  }

  /* ── Lights ────────────────────────────────────────────────────────── */

  /** Moving-head beams sweeping down from the truss through the haze, and the spotlight on the board. */
  private lights(t: number) {
    const ctx = this.ctx;
    const { cx, cy, R } = this.board;
    const ty = Math.max(4, this.top);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const beams = 6;
    for (let i = 0; i < beams; i++) {
      const x0 = this.left + (this.right - this.left) * ((i + 0.5) / beams);
      const a = Math.PI / 2 + Math.sin(t * (0.35 + i * 0.07) + i * 1.7) * 0.55 + (x0 < cx ? 0.12 : -0.12);
      const len = this.h * 0.9;
      const spread = 0.07;
      const col = i % 3 === 0 ? '255,60,90' : i % 3 === 1 ? '90,140,255' : '255,200,110';
      const gb = ctx.createLinearGradient(x0, ty, x0 + Math.cos(a) * len, ty + Math.sin(a) * len);
      gb.addColorStop(0, `rgba(${col},${(0.1 + this.haloFlash * 0.15).toFixed(3)})`);
      gb.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = gb;
      ctx.beginPath();
      ctx.moveTo(x0, ty);
      ctx.lineTo(x0 + Math.cos(a - spread) * len, ty + Math.sin(a - spread) * len);
      ctx.lineTo(x0 + Math.cos(a + spread) * len, ty + Math.sin(a + spread) * len);
      ctx.closePath();
      ctx.fill();
      // the lamp head
      ctx.fillStyle = `rgba(${col},0.8)`;
      ctx.beginPath();
      ctx.arc(x0, ty + R * 0.06, Math.max(2, R * 0.022), 0, Math.PI * 2);
      ctx.fill();
    }
    // the spotlight on the board
    const sp = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 2.2);
    sp.addColorStop(0, 'rgba(255,236,200,0.14)');
    sp.addColorStop(1, 'rgba(255,236,200,0)');
    ctx.fillStyle = sp;
    ctx.fillRect(cx - R * 2.2, cy - R * 2.2, R * 4.4, R * 4.4);
    ctx.restore();
  }

  /** The LED ring round the board: a chase of gold and red that blazes when you win. */
  private halo(t: number) {
    const ctx = this.ctx;
    const { cx, cy, R } = this.board;
    const n = 56;
    const r = R * 1.34;
    // the ring's body
    ctx.strokeStyle = '#1a1d36';
    ctx.lineWidth = R * 0.09;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const chase = 0.5 + 0.5 * Math.sin(i * 0.9 - t * 6);
      const on = Math.max(chase * 0.55, this.haloFlash);
      const col = i % 2 ? '255,203,58' : '232,37,60';
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      ctx.fillStyle = `rgba(${col},${(0.25 + on * 0.75).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, R * 0.022, 0, Math.PI * 2);
      ctx.fill();
      if (on > 0.4) {
        ctx.fillStyle = `rgba(${col},${(on * 0.18).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, R * 0.07, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /* ── The board ─────────────────────────────────────────────────────── */

  private boardDraw(v: SceneView, t: number, now: number) {
    const ctx = this.ctx;
    const { cx, cy, R } = this.board;
    const x = cx + this.shakeX;
    const y = cy + this.shakeY;
    // its shadow on the wall
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.arc(x + R * 0.04, y + R * 0.07, R * 1.22, 0, Math.PI * 2);
    ctx.fill();
    if (this.boardFace) {
      const S = this.boardFace.width / this.dpr;
      ctx.drawImage(this.boardFace, x - S / 2, y - S / 2, S, S);
    }
    // a winning dart lights its ring
    const fl = this.winFlash(v, now);
    if (fl) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,240,200,${(0.35 * fl.k).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, R * radiusFor(fl.target), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // the aim: the circle you need to land inside, glowing
    const ra = R * radiusFor(v.target);
    ctx.save();
    ctx.strokeStyle = '#7affd8';
    ctx.lineWidth = Math.max(2, R * 0.014);
    ctx.shadowColor = '#7affd8';
    ctx.shadowBlur = 14;
    ctx.setLineDash([R * 0.05, R * 0.04]);
    ctx.lineDashOffset = -t * 30;
    ctx.beginPath();
    ctx.arc(x, y, ra, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** A landed winning throw makes its ring flash. */
  private winFlash(v: SceneView, now: number) {
    if (!v.flight || v.flight.t.win <= 0) return null;
    const age = (now - v.flight.at) / 1000 - FLY;
    if (age < 0 || age > 0.9) return null;
    let ring = RINGS[0];
    for (const r of RINGS) if (v.flight.t.hit >= r.target) ring = r;
    return { target: Math.max(ring.target, v.flight.t.target), k: Math.max(0, Math.sin((age / 0.9) * Math.PI)) };
  }

  /* ── Darts ─────────────────────────────────────────────────────────── */

  /** The dart's body (point, barrel, shaft): drawn from the tip back along `back`, in perspective. */
  private dartBody(tip: V3, back: V3, alpha: number) {
    const ctx = this.ctx;
    const at = (s: number) => this.proj(add(tip, mul(back, s)));
    const seg = (s0: number, s1: number, r0: number, r1: number, fill: string | CanvasGradient) => {
      const a = at(s0);
      const b = at(s1);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L;
      const ny = dx / L;
      const wa = Math.max(0.6, r0 * a.k);
      const wb = Math.max(0.6, r1 * b.k);
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(a.x + nx * wa, a.y + ny * wa);
      ctx.lineTo(b.x + nx * wb, b.y + ny * wb);
      ctx.lineTo(b.x - nx * wb, b.y - ny * wb);
      ctx.lineTo(a.x - nx * wa, a.y - ny * wa);
      ctx.closePath();
      ctx.fill();
      return { a, b, nx, ny, wa, wb };
    };
    ctx.globalAlpha = alpha;
    seg(0, DART.point, 0.002, 0.008, '#cfd5de');
    // the barrel: tungsten, with a highlight down one side and knurled grip rings
    const a = at(DART.point);
    const b = at(DART.barrel);
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / L;
    const ny = (b.x - a.x) / L;
    const wmid = DART.barrelR * (a.k + b.k) / 2;
    const bg = ctx.createLinearGradient((a.x + b.x) / 2 + nx * wmid, (a.y + b.y) / 2 + ny * wmid, (a.x + b.x) / 2 - nx * wmid, (a.y + b.y) / 2 - ny * wmid);
    bg.addColorStop(0, '#5a606c');
    bg.addColorStop(0.35, '#f2f5fa');
    bg.addColorStop(0.6, '#9aa0ac');
    bg.addColorStop(1, '#2c3038');
    seg(DART.point, DART.barrel, DART.barrelR * 0.8, DART.barrelR, bg);
    ctx.strokeStyle = 'rgba(20,22,28,0.55)';
    ctx.lineWidth = Math.max(0.6, wmid * 0.12);
    ctx.beginPath();
    for (let i = 1; i < 7; i++) {
      const s = lerp(DART.point + 0.04, DART.barrel - 0.06, i / 7);
      const p = at(s);
      const wr = DART.barrelR * p.k * 0.95;
      ctx.moveTo(p.x + nx * wr, p.y + ny * wr);
      ctx.lineTo(p.x - nx * wr, p.y - ny * wr);
    }
    ctx.stroke();
    // the shaft
    seg(DART.barrel, DART.shaft + 0.02, DART.shaftR, DART.shaftR, '#14151c');
    ctx.globalAlpha = 1;
  }

  /** The flights: four vanes round the back of the shaft, spun by `spin`, nearest drawn last. */
  private dartFlights(tip: V3, back: V3, spin: number, alpha: number) {
    const ctx = this.ctx;
    const ref = Math.abs(back.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
    const u = norm(cross(back, ref));
    const w = cross(back, u);
    const at = (s: number) => add(tip, mul(back, s));
    const vanes = [0, 1, 2, 3].map((i) => {
      const th = spin + (i * Math.PI) / 2;
      const d = add(mul(u, Math.cos(th)), mul(w, Math.sin(th)));
      const p0 = add(at(DART.flightFront), mul(d, 0.012));
      const p1 = add(at(DART.flightFront + 0.1), mul(d, DART.vane));
      const p2 = add(at(DART.flightBack), mul(d, DART.vane));
      const p3 = add(at(DART.flightBack), mul(d, 0.012));
      const depth = (p1.z + p2.z) / 2;
      // light comes from the stage in front: vanes turned up and to the left catch more of it
      const light = 0.72 + 0.28 * clamp01(-d.y * 0.7 - d.x * 0.4 + 0.3);
      return { pts: [p0, p1, p2, p3], depth, i, light };
    });
    vanes.sort((a, b) => b.depth - a.depth);
    ctx.globalAlpha = alpha;
    for (const v of vanes) {
      const s = v.pts.map((p) => this.proj(p));
      const base = v.i % 2 ? [232, 37, 60] : [245, 245, 250];
      const k = v.light;
      ctx.fillStyle = `rgb(${Math.round(base[0] * k)},${Math.round(base[1] * k)},${Math.round(base[2] * k)})`;
      ctx.beginPath();
      ctx.moveTo(s[0].x, s[0].y);
      for (let j = 1; j < 4; j++) ctx.lineTo(s[j].x, s[j].y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // a gold stripe near the trailing edge
      const m1 = this.proj(lerp3(v.pts[1], v.pts[2], 0.62));
      const m2 = this.proj(lerp3(v.pts[0], v.pts[3], 0.62));
      ctx.strokeStyle = 'rgba(255,203,58,0.85)';
      ctx.lineWidth = Math.max(1, s[1].k * 0.012);
      ctx.beginPath();
      ctx.moveTo(m1.x, m1.y);
      ctx.lineTo(m2.x, m2.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** A dart in the board; the newest one wobbles as it lands. `since` = ms since its release, if it's the newest. */
  private stuckDart(t: Throw, alpha: number, since: number | null, v: SceneView) {
    const end = this.landing(t);
    let back = this.stuckBack(end);
    if (since != null) {
      const w = since / 1000 - FLY;
      if (w < 0) return;
      if (!v.reducedMotion && w < 1) {
        const k = Math.exp(-w * 6);
        back = norm(add(back, v3(Math.sin(w * 42) * 0.12 * k, Math.cos(w * 35) * 0.09 * k, 0)));
      }
      this.impact(t, end);
    }
    // its shadow on the board, cast down and to the right by the spotlight above and behind you
    const sp = this.proj(end);
    const tail3 = add(end, mul(back, DART.len));
    const out = ZB - tail3.z;
    const sh = this.proj(v3(tail3.x + out * 0.22, tail3.y + out * 0.42, ZB));
    const ctx = this.ctx;
    ctx.globalAlpha = 0.32 * alpha;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = Math.max(2, DART.barrelR * sp.k * 1.6);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sp.x, sp.y);
    ctx.lineTo(sh.x, sh.y);
    ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(sh.x, sh.y, DART.vane * sp.k * 0.8, DART.vane * sp.k * 0.35, 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineCap = 'butt';
    ctx.globalAlpha = 1;
    const spin = this.spinAt(t, 1);
    this.dartBody(end, back, alpha);
    this.dartFlights(end, back, spin, alpha);
  }

  /** The dart in the air. */
  private inFlight(v: SceneView, now: number) {
    const f = v.flight;
    if (!f) return;
    const age = (now - f.at) / 1000;
    if (age < 0 || age >= FLY) return;
    const k = age / FLY;
    const end = this.landing(f.t);
    const { tip, back } = this.flightAt(k, end);
    const spin = this.spinAt(f.t, k);
    // a faint streak behind it
    const ctx = this.ctx;
    const a = this.proj(tip);
    const prev = this.flightAt(Math.max(0, k - 0.12), end).tip;
    const b = this.proj(prev);
    const sg = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    sg.addColorStop(0, 'rgba(255,255,255,0.25)');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = sg;
    ctx.lineWidth = Math.max(1, DART.vane * a.k * 0.5);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.lineCap = 'butt';
    this.dartBody(tip, back, 1);
    this.dartFlights(tip, back, spin, 1);
  }

  /** The flights leave the hand at HELD_SPIN and spin up in the air; each dart comes to rest at its own angle. */
  private spinAt(t: Throw, k: number) {
    return HELD_SPIN + k * (Math.PI * 5 + hash(strHash(t.id) * 0.031) * Math.PI);
  }

  /** The moment a dart lands: sisal dust, a shake, and for a win the crowd goes up. */
  private impact(t: Throw, end: V3) {
    if (this.landedFx.has(t.id)) return;
    this.landedFx.add(t.id);
    if (this.landedFx.size > 200) this.landedFx = new Set([...this.landedFx].slice(-50));
    const p = this.proj(end);
    this.shake = Math.max(this.shake, this.view?.reducedMotion ? 0 : 2.2);
    for (let i = 0; i < 12; i++) this.particles.push({ x: p.x, y: p.y, vx: rnd(-90, 90), vy: rnd(-110, 10), g: 340, age: 0, life: rnd(0.3, 0.6), size: rnd(1, 2.6), color: '#d8c8a0', rot: 0, vr: 0, kind: 'chip' });
    if (t.win > 0) {
      const size = Math.min(1, 0.3 + Math.log10(t.target) * 0.45);
      this.cheer = Math.max(this.cheer, size);
      this.haloFlash = Math.max(this.haloFlash, 0.4 + size * 0.6);
      const n = t.target >= 10 ? 140 : t.target >= 3 ? 70 : t.target >= 1.5 ? 30 : 10;
      const colors = ['#e8253c', '#ffcb3a', '#ffffff', '#7affd8', '#5a8cff'];
      for (let i = 0; i < n; i++) {
        this.particles.push({ x: this.w / 2 + rnd(-0.5, 0.5) * this.w, y: -10 - rnd(0, 60), vx: rnd(-60, 60), vy: rnd(40, 200), g: 60, age: 0, life: rnd(2.2, 3.8), size: rnd(4, 9), color: colors[i % colors.length], rot: rnd(0, 6), vr: rnd(-8, 8), kind: 'confetti' });
      }
    } else if (t.hit >= t.target * 0.7) this.cheer = Math.max(this.cheer, 0.15);
  }

  /* ── The hand ──────────────────────────────────────────────────────── */

  /**
   * Your throwing hand, seen from behind its thumb side as you'd see your own: thumb under the barrel, index finger over
   * it, the other fingers tucked in. It rests holding a dart; winds up (pulls back, the dart tilting up); snaps forward
   * and lets go, fingers opening after the dart; drops out of view and comes back up with the next one.
   */
  private hand(v: SceneView, dt: number, now: number) {
    // how far wound up: held by the player, or the throw's own wind-up, eased so nothing jumps
    this.pull += (v.pull - this.pull) * Math.min(1, dt * 14);
    const f = v.flight;
    const sinceRelease = f ? (now - f.at) / 1000 : Infinity;
    const released = sinceRelease >= 0 && sinceRelease < 0.75;
    let target = this.pull;
    if (v.windAt != null && !f) target = Math.max(target, easeInOut((now - v.windAt) / 1000 / WIND));
    if (released) target = 0;
    this.cock += (target - this.cock) * Math.min(1, dt * (target > this.cock ? 22 : 10));
    const bob = v.reducedMotion || this.cock > 0.05 ? 0 : Math.sin(this.time * 1.7) * this.board.R * 0.012;

    let thrust = 0;
    let drop = 0;
    let open = 0;
    let hasDart = true;
    let c = this.cock;
    if (released) {
      const p = sinceRelease;
      c = 1 - easeOut(p / 0.09);
      // a short, snappy follow-through with the fingers opening after the dart, then the hand drops away so you see
      // it land, closes, and comes back up holding the next one
      thrust = p < 0.09 ? easeOut(p / 0.09) : p < 0.16 ? 1 : 1 - easeInOut((p - 0.16) / 0.3);
      open = p < 0.3 ? easeOut(p / 0.06) : 1 - easeInOut((p - 0.3) / 0.1);
      drop = p < 0.14 ? 0 : p < 0.38 ? easeInOut((p - 0.14) / 0.24) : p < 0.45 ? 1 : 1 - easeOut((p - 0.45) / 0.28);
      hasDart = p >= 0.4;
    }
    const { grip, dir } = this.handPose(c, thrust, bob);
    const dropPx = drop * this.board.R * 2.2;
    const tip = add(grip, mul(dir, GRIP));
    const back = mul(dir, -1);
    const g = this.proj(grip);
    // the hand's frame: origin at the pinch, the dart's point along −x (as it shows on screen), the hand below it
    const t2 = this.proj(add(grip, mul(dir, 0.2)));
    const ang = Math.atan2(t2.y - g.y, t2.x - g.x) + Math.PI;
    const S = g.k * HAND_SCALE;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(0, dropPx);
    this.inHand(g.x, g.y, ang, S, () => this.handBehind(open, thrust));
    if (hasDart) this.dartBody(tip, back, 1);
    this.inHand(g.x, g.y, ang, S, () => this.handFront(open));
    if (hasDart) this.dartFlights(tip, back, HELD_SPIN, 1);
    ctx.restore();
  }

  /** Runs `draw` in the hand's frame (units are about a centimetre of hand). */
  private inHand(x: number, y: number, ang: number, S: number, draw: () => void) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.scale(S, S);
    draw();
    ctx.restore();
  }

  /**
   * A finger (or thumb): a tapered tube along a smooth curve through its joints, shaded like a cylinder lit from above,
   * with creases at the knuckles and a nail. `shade` darkens fingers further from you.
   */
  private digit(pts: [number, number][], w0: number, w1: number, shade = 1, nail = true) {
    const ctx = this.ctx;
    const P = [pts[0], ...pts, pts[pts.length - 1]];
    const samples: [number, number][] = [];
    for (let i = 1; i < P.length - 2; i++) {
      const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
      for (let s = 0; s < 8; s++) {
        const t = s / 8;
        const t2 = t * t;
        const t3 = t2 * t;
        const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        samples.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    samples.push(pts[pts.length - 1]);
    const n = samples.length;
    const left: [number, number][] = [];
    const right: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = samples[Math.max(0, i - 1)];
      const b = samples[Math.min(n - 1, i + 1)];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const L = Math.hypot(dx, dy) || 1;
      // a little wider at the knuckles
      const seg = (i / (n - 1)) * (pts.length - 1);
      const bump = 1 + 0.07 * Math.cos((seg - Math.round(seg)) * Math.PI * 2);
      const half = (lerp(w0, w1, i / (n - 1)) / 2) * bump;
      left.push([samples[i][0] - (dy / L) * half, samples[i][1] + (dx / L) * half]);
      right.push([samples[i][0] + (dy / L) * half, samples[i][1] - (dx / L) * half]);
    }
    const [ex, ey] = samples[n - 1];
    const [px, py] = samples[n - 3];
    const ea = Math.atan2(ey - py, ex - px);
    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (const p of left) ctx.lineTo(p[0], p[1]);
    ctx.arc(ex, ey, w1 / 2, ea + Math.PI / 2, ea - Math.PI / 2, true);
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
    // shade across the finger: the side facing up the screen catches the stage light
    const [sx, sy] = samples[0];
    const al = Math.hypot(ex - sx, ey - sy) || 1;
    let nx = -(ey - sy) / al;
    let ny = (ex - sx) / al;
    if (nx + ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    const mx = (sx + ex) / 2;
    const my = (sy + ey) / 2;
    const wm = (w0 + w1) / 2;
    const g = ctx.createLinearGradient(mx + nx * wm * 0.55, my + ny * wm * 0.55, mx - nx * wm * 0.55, my - ny * wm * 0.55);
    g.addColorStop(0, shadeHex(SKIN.light, shade));
    g.addColorStop(0.5, shadeHex(SKIN.mid, shade));
    g.addColorStop(1, shadeHex(SKIN.dark, shade));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = SKIN.line;
    ctx.lineWidth = 0.1;
    ctx.stroke();
    // creases at the inner knuckles
    ctx.strokeStyle = 'rgba(80,40,26,0.45)';
    ctx.lineWidth = 0.08;
    for (let j = 1; j < pts.length - 1; j++) {
      const i = Math.min(n - 1, j * 8);
      const a = left[i];
      const b = right[i];
      ctx.beginPath();
      ctx.moveTo(lerp(a[0], b[0], 0.25), lerp(a[1], b[1], 0.25));
      ctx.quadraticCurveTo(samples[i][0] + (b[0] - a[0]) * 0.08 - (ex - sx) * 0.02, samples[i][1] + (b[1] - a[1]) * 0.08 - (ey - sy) * 0.02, lerp(a[0], b[0], 0.72), lerp(a[1], b[1], 0.72));
      ctx.stroke();
    }
    if (!nail) return;
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(ea);
    const ng = ctx.createLinearGradient(0, -w1 * 0.3, 0, w1 * 0.3);
    ng.addColorStop(0, 'rgba(255,238,226,0.9)');
    ng.addColorStop(1, 'rgba(222,170,150,0.75)');
    ctx.fillStyle = ng;
    ctx.beginPath();
    ctx.ellipse(-w1 * 0.32, -w1 * 0.06, w1 * 0.34, w1 * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,70,50,0.35)';
    ctx.lineWidth = 0.06;
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Everything of the hand behind the dart: the forearm in its match shirt, the curled little and ring fingers, the
   * middle finger, the back of the hand, and the index finger curling over the top of the barrel.
   */
  private handBehind(open: number, thrust: number) {
    const ctx = this.ctx;
    const M = (a: [number, number][], b: [number, number][]) => a.map((p, i): [number, number] => [lerp(p[0], b[i][0], open), lerp(p[1], b[i][1], open)]);
    // the forearm, from the wrist down off the screen, into a long sleeve with a red-and-gold cuff
    const wx = 12.2;
    const wy = 4.9;
    const fx = 0.96;
    const fy = 0.28;
    const nx = -fy;
    const ny = fx;
    const at = (d: number, side: number, half: number): [number, number] => [wx + fx * d + nx * side * half, wy + fy * d + ny * side * half];
    const arm = ctx.createLinearGradient(...at(2, -1, 3.2), ...at(2, 1, 3.2));
    arm.addColorStop(0, SKIN.light);
    arm.addColorStop(0.5, SKIN.mid);
    arm.addColorStop(1, SKIN.dark);
    ctx.fillStyle = arm;
    ctx.beginPath();
    ctx.moveTo(...at(-1, -1, 2.9));
    ctx.lineTo(...at(5.4, -1, 3.3));
    ctx.lineTo(...at(5.4, 1, 3.3));
    ctx.lineTo(...at(-1, 1, 2.9));
    ctx.closePath();
    ctx.fill();
    const sleeve = ctx.createLinearGradient(...at(10, -1, 4), ...at(10, 1, 4));
    sleeve.addColorStop(0, '#2c3478');
    sleeve.addColorStop(0.45, '#181d4c');
    sleeve.addColorStop(1, '#090b22');
    ctx.fillStyle = sleeve;
    ctx.beginPath();
    ctx.moveTo(...at(5, -1, 3.9));
    ctx.lineTo(...at(60, -1, 5.5));
    ctx.lineTo(...at(60, 1, 5.5));
    ctx.lineTo(...at(5, 1, 3.9));
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#c41f36';
    ctx.beginPath();
    ctx.moveTo(...at(4.8, -1, 3.9));
    ctx.lineTo(...at(6.3, -1, 4.0));
    ctx.lineTo(...at(6.3, 1, 4.0));
    ctx.lineTo(...at(4.8, 1, 3.9));
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#ffcb3a';
    ctx.lineWidth = 0.22;
    ctx.beginPath();
    ctx.moveTo(...at(6.2, -1, 4.0));
    ctx.lineTo(...at(6.2, 1, 4.0));
    ctx.stroke();
    // the ring and little fingers, curled into the palm: from here only their knuckles show, under the thumb
    this.digit(M([[7.8, 6.6], [6.4, 8.1], [6.5, 9.0]], [[7.8, 6.6], [5.8, 7.8], [5.0, 8.9]]), 1.6, 1.5, 0.78, false);
    this.digit(M([[7.4, 4.6], [5.3, 6.2], [5.0, 7.25]], [[7.4, 4.6], [4.8, 5.8], [3.6, 6.8]]), 1.8, 1.65, 0.84, false);
    // the middle finger, under the barrel towards its point
    this.digit(M([[8.4, 2.0], [5.0, 1.5], [2.2, 1.7], [0.1, 2.9]], [[8.4, 2.0], [4.8, 1.4], [1.9, 1.3], [-0.8, 1.7]]), 1.7, 1.5, 0.86);
    // the back of the hand
    const bg = ctx.createRadialGradient(7.6, 0.8, 0.6, 9.2, 3.6, 7.2);
    bg.addColorStop(0, SKIN.light);
    bg.addColorStop(0.55, SKIN.mid);
    bg.addColorStop(1, SKIN.dark);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(6.1, -0.75);
    ctx.bezierCurveTo(8.2, -1.5, 11.0, -0.4, 13.1, 2.1);
    ctx.lineTo(11.4, 7.8);
    ctx.bezierCurveTo(10.2, 8.5, 8.6, 8.6, 7.3, 8.0);
    ctx.bezierCurveTo(5.8, 7.2, 4.5, 5.7, 4.0, 4.1);
    ctx.bezierCurveTo(3.8, 2.9, 4.6, 1.5, 5.3, 0.8);
    ctx.bezierCurveTo(5.5, 0.2, 5.7, -0.4, 6.1, -0.75);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = SKIN.line;
    ctx.lineWidth = 0.1;
    ctx.stroke();
    // knuckles catching the light, and the tendons running back to the wrist
    for (const [kx, ky, r] of [[6.9, -0.3, 0.95], [8.6, 0.6, 0.85], [9.6, 2.2, 0.75]] as const) {
      const kg = ctx.createRadialGradient(kx - r * 0.3, ky - r * 0.3, 0.05, kx, ky, r);
      kg.addColorStop(0, 'rgba(255,226,206,0.55)');
      kg.addColorStop(1, 'rgba(255,226,206,0)');
      ctx.fillStyle = kg;
      ctx.beginPath();
      ctx.arc(kx, ky, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,222,200,0.16)';
    ctx.lineWidth = 0.18;
    ctx.beginPath();
    ctx.moveTo(7.4, 0.4);
    ctx.quadraticCurveTo(9.8, 2.0, 12.0, 3.4);
    ctx.moveTo(8.9, 1.5);
    ctx.quadraticCurveTo(10.6, 3.0, 12.0, 4.6);
    ctx.stroke();
    // a rim of stage light along the top of the hand
    ctx.strokeStyle = SKIN.rim;
    ctx.lineWidth = 0.16;
    ctx.beginPath();
    ctx.moveTo(6.3, -0.8);
    ctx.bezierCurveTo(8.2, -1.45, 10.6, -0.5, 12.4, 1.3);
    ctx.stroke();
    // the index finger: over the top of the barrel, pad pressing down on it; straight out after the dart once it's gone
    const reach = thrust * 0.6;
    this.digit(M([[6.7, 0.1], [3.9, -2.75], [1.0, -2.45], [-0.75, -0.75]], [[6.7, 0.1], [3.2, -1.0 - reach * 0.3], [0.3, -1.4 - reach * 0.4], [-2.2 - reach, -1.5 - reach * 0.5]]), 1.8, 1.55);
  }

  /** The thumb: nearest to you, its pad pressing up under the barrel (dropping away once the dart's gone). */
  private handFront(open: number) {
    const M = (a: [number, number][], b: [number, number][]) => a.map((p, i): [number, number] => [lerp(p[0], b[i][0], open), lerp(p[1], b[i][1], open)]);
    this.digit(M([[6.6, 6.6], [3.9, 4.7], [1.4, 2.75], [-0.5, 1.05]], [[6.6, 6.6], [3.9, 5.3], [1.4, 4.7], [-0.9, 4.6]]), 2.2, 1.78);
  }

  /* ── The big screens and the crowd ─────────────────────────────────── */

  /** Two screens beside the stage: a live board-cam close-up of the last dart, and the target. */
  private screens(v: SceneView, t: number, darts: { t: Throw; alpha: number }[]) {
    const { cx, cy, R } = this.board;
    const room = cx - R * 1.55 - this.left;
    if (room < R * 0.8) return;
    const ctx = this.ctx;
    const sw = Math.min(room - R * 0.2, R * 1.45);
    const sh = sw * 0.62;
    const sy = cy - sh * 0.62;
    const left = { x: cx - R * 1.55 - sw, y: sy };
    const right = { x: cx + R * 1.55, y: sy };
    for (const s of [left, right]) {
      ctx.fillStyle = '#05060c';
      ctx.fillRect(s.x - 5, s.y - 5, sw + 10, sh + 10);
      ctx.fillStyle = '#0c1030';
      ctx.fillRect(s.x, s.y, sw, sh);
    }
    // board cam: the board around the newest dart, copied from what's on screen and zoomed in
    const last = darts.length ? darts[darts.length - 1].t : null;
    const focus = last ? this.proj(this.landing(last)) : { x: cx, y: cy };
    const z = R * 0.62;
    const zh = z * (sh / sw);
    const d = this.dpr;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left.x, left.y, sw, sh);
    ctx.clip();
    ctx.drawImage(this.canvas, (focus.x - z / 2) * d, (focus.y - zh / 2 - R * 0.06) * d, z * d, zh * d, left.x, left.y, sw, sh);
    // scan lines and a broadcast tag
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = left.y; y < left.y + sh; y += 3) ctx.fillRect(left.x, y, sw, 1);
    ctx.restore();
    const fs = Math.max(9, Math.round(sw * 0.075));
    ctx.font = `700 ${fs}px 'Inter', sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(5,6,16,0.75)';
    ctx.fillRect(left.x, left.y, fs * 6.6, fs * 1.6);
    ctx.fillStyle = Math.sin(t * 4) > 0 ? '#e8253c' : '#7a1020';
    ctx.beginPath();
    ctx.arc(left.x + fs * 0.7, left.y + fs * 0.8, fs * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText('BOARD CAM', left.x + fs * 1.2, left.y + fs * 0.82);
    if (last) {
      ctx.textAlign = 'right';
      ctx.font = `600 ${Math.round(fs * 1.9)}px 'Teko', sans-serif`;
      ctx.fillStyle = last.win > 0 ? '#7affd8' : '#ff8a9a';
      ctx.fillText(`×${last.hit.toFixed(2)}`, left.x + sw - fs * 0.5, left.y + sh - fs * 1.1);
    }
    // the target screen
    const m = v.target;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(232,37,60,0.9)';
    ctx.fillRect(right.x, right.y, sw, fs * 1.6);
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${fs}px 'Inter', sans-serif`;
    ctx.fillText('AIMING FOR', right.x + sw / 2, right.y + fs * 0.82);
    ctx.font = `600 ${Math.round(sh * 0.48)}px 'Teko', sans-serif`;
    ctx.fillStyle = '#ffcb3a';
    ctx.shadowColor = 'rgba(255,203,58,0.5)';
    ctx.shadowBlur = 18;
    ctx.fillText(`${m}×`, right.x + sw / 2, right.y + sh * 0.56);
    ctx.shadowBlur = 0;
    ctx.font = `700 ${fs}px 'JetBrains Mono', monospace`;
    ctx.fillStyle = '#c6cbea';
    ctx.fillText(`1 IN ${(1 / chanceOf(m)).toFixed(2)}`, right.x + sw / 2, right.y + sh - fs * 0.95);
    // screen glare
    for (const s of [left, right]) {
      const gl = ctx.createLinearGradient(s.x, s.y, s.x + sw, s.y + sh);
      gl.addColorStop(0, 'rgba(255,255,255,0.07)');
      gl.addColorStop(0.4, 'rgba(255,255,255,0)');
      ctx.fillStyle = gl;
      ctx.fillRect(s.x, s.y, sw, sh);
    }
  }

  /** The crowd either side of the stage: three tiers that bob, wave signs, and go up (cameras flashing) for a win. */
  private crowd(t: number, dt: number) {
    const ctx = this.ctx;
    const { cx, cy, R } = this.board;
    this.cheer = Math.max(0, this.cheer - dt * 0.45);
    const innerL = cx - R * 1.5;
    const innerR = cx + R * 1.5;
    const tiers = [
      { y: cy + R * 0.62, sc: R * 0.1, light: 0.55 },
      { y: cy + R * 1.0, sc: R * 0.14, light: 0.38 },
      { y: cy + R * 1.5, sc: R * 0.2, light: 0.18 },
    ];
    tiers.forEach((tier, row) => {
      const { sc } = tier;
      const step = sc * 2.5;
      for (const side of [-1, 1]) {
        const x0 = side < 0 ? this.left - sc : innerR + sc * 0.6;
        const x1 = side < 0 ? innerL - sc * 0.6 : this.right + sc;
        // the inner end of each tier steps back, like seating curving round the stage
        let i = 0;
        for (let x = x0 + (row % 2) * step * 0.5; x < x1; x += step, i++) {
          const id = i * 7 + row * 131 + (side > 0 ? 977 : 0);
          const edge = side < 0 ? (x1 - x) / (R * 0.8) : (x - x0) / (R * 0.8);
          const lift = Math.max(0, 1 - edge) * sc * 0.6;
          const jump = this.cheer * Math.abs(Math.sin(t * 8 + id)) * sc * 1.3;
          const bob = Math.sin(t * (1.5 + hash(id) * 1.5) + id) * sc * 0.07;
          const y = tier.y - lift - jump - bob;
          const r = sc * (0.82 + hash(id * 3) * 0.3);
          const shirt = CROWD_SHIRTS[Math.floor(hash(id * 5) * CROWD_SHIRTS.length)];
          const up = this.cheer > 0.25 && hash(id * 7) < 0.6;
          ctx.save();
          ctx.globalAlpha = 1;
          // body and shoulders (the far tiers catch the stage light; the front row is in silhouette)
          ctx.fillStyle = row < 2 ? shirt : '#0b0b14';
          ctx.beginPath();
          ctx.ellipse(x, y + r * 2.35, r * 1.8, r * 1.35, 0, Math.PI, 0);
          ctx.fill();
          ctx.fillRect(x - r * 1.8, y + r * 2.33, r * 3.6, this.h);
          if (up) {
            ctx.fillRect(x - r * 1.65, y - r * 1.5 - this.cheer * r, r * 0.46, r * 3.3);
            ctx.fillRect(x + r * 1.2, y - r * 1.5 - this.cheer * r, r * 0.46, r * 3.3);
          }
          // head
          ctx.fillStyle = row < 2 ? '#1a1620' : '#09090f';
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
          // the stage light catching the top of heads and shoulders
          ctx.strokeStyle = `rgba(255,214,170,${(0.12 + tier.light * 0.35).toFixed(2)})`;
          ctx.lineWidth = Math.max(1, r * 0.12);
          ctx.beginPath();
          ctx.arc(x, y, r * 0.95, Math.PI * 1.1, Math.PI * 1.75);
          ctx.stroke();
          // dim the far tiers into the haze
          ctx.fillStyle = `rgba(8,10,30,${(0.55 - tier.light * 0.8 + (row === 0 ? 0.25 : 0)).toFixed(2)})`;
          if (row === 0) {
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
          }
          // the odd sign held up, higher when they cheer
          if (hash(id * 11) < (row === 2 ? 0.07 : 0.1)) {
            const lift2 = up ? r * 1.6 : 0;
            ctx.translate(x, y - r * 1.5 - lift2);
            ctx.rotate(Math.sin(t * 2 + id) * 0.1);
            const sw = r * 4.6;
            const shh = r * 1.8;
            ctx.fillStyle = row === 2 ? '#d8d4c6' : '#f4f1e6';
            ctx.fillRect(-sw / 2, -shh, sw, shh);
            ctx.fillStyle = hash(id) < 0.5 ? '#c41f36' : '#14162a';
            ctx.font = `600 ${Math.round(shh * 0.84)}px 'Teko', sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(SIGNS[Math.floor(hash(id * 13) * SIGNS.length)], 0, -shh / 2 + shh * 0.07, sw * 0.9);
          }
          ctx.restore();
        }
      }
    });
    // phone screens glowing, and camera flashes when the place goes up
    for (let i = 0; i < 16; i++) {
      if (Math.sin(t * 0.6 + i * 2.3) < 0.5) continue;
      const side = i % 2 ? 1 : -1;
      const x = side < 0 ? hash(i * 9.1) * (innerL - 10) : innerR + 10 + hash(i * 9.1) * (this.right - innerR - 10);
      const y = cy + R * (0.75 + hash(i * 4.3) * 0.7);
      ctx.fillStyle = 'rgba(180,210,255,0.6)';
      ctx.fillRect(x, y, 3, 5);
    }
    if (this.cheer > 0.2 && Math.random() < this.cheer * 0.5) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const x = side < 0 ? rnd(this.left, innerL) : rnd(innerR, this.right);
      this.particles.push({ x, y: cy + R * rnd(0.5, 1.4), vx: 0, vy: 0, g: 0, age: 0, life: 0.14, size: rnd(R * 0.08, R * 0.16), color: '#ffffff', rot: 0, vr: 0, kind: 'flash' });
    }
  }

  /* ── Particles and grade ───────────────────────────────────────────── */

  private stepParticles(dt: number) {
    const ctx = this.ctx;
    const keep: Particle[] = [];
    for (const p of this.particles) {
      p.age += dt;
      if (p.age >= p.life) continue;
      p.vy += p.g * dt;
      p.x += p.vx * dt + (p.kind === 'confetti' ? Math.sin(p.age * 4 + p.size) * 0.8 : 0);
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      const k = p.age / p.life;
      if (p.kind === 'flash') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        g.addColorStop(0, `rgba(255,255,255,${(0.9 * (1 - k)).toFixed(2)})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
        ctx.restore();
        keep.push(p);
        continue;
      }
      ctx.globalAlpha = Math.min(1, (1 - k) * 2);
      ctx.fillStyle = p.color;
      if (p.kind === 'confetti') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.abs(Math.cos(p.rot * 1.3)));
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      } else ctx.fillRect(p.x, p.y, p.size, p.size);
      keep.push(p);
    }
    ctx.globalAlpha = 1;
    this.particles = keep;
  }

  private grade() {
    const ctx = this.ctx;
    if (this.vignette) {
      ctx.fillStyle = this.vignette;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }
}
