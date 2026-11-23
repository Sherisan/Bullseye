/* The lobby thumbnail (see thumbnail.html): first person at the oche, a bullseye already in the board, the next dart in hand, and the title. */
import '@fontsource/teko/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/700.css';
import type { Throw } from '../src/game/api';
import { Scene } from '../src/scene/scene';

const root = document.getElementById('root')!;
root.innerHTML = `
  <div class="thumb">
    <canvas class="thumb-scene"></canvas>
    <div class="thumb-title">BULLS<span>EYE</span><i>OPEN</i></div>
    <div class="thumb-lt"><b>ON THE OCHE</b><div>AIM FOR A RING · ITS SIZE IS YOUR CHANCE</div></div>
    <div class="thumb-sub">UP TO ×1000 · 96% RTP · PROVABLY FAIR</div>
  </div>`;
document.head.append(Object.assign(document.createElement('style'), {
  textContent: `
    html, body { margin: 0; width: 1280px; height: 720px; overflow: hidden; background: #05060f; }
    .thumb { position: relative; width: 1280px; height: 720px; }
    .thumb-scene { position: absolute; inset: 0; width: 1280px; height: 720px; display: block; }
    .thumb-title { position: absolute; left: 40px; top: 26px; font: 600 120px/0.85 'Teko', sans-serif; color: #fff; text-shadow: 0 6px 0 rgba(0,0,0,0.6), 0 0 30px rgba(0,0,0,0.6); }
    .thumb-title span { color: #e8253c; text-shadow: 0 0 30px rgba(232,37,60,0.6), 0 6px 0 rgba(60,0,10,0.7); }
    .thumb-title i { display: inline-block; vertical-align: top; margin: 14px 0 0 14px; padding: 6px 12px 0; font: 600 40px/1 'Teko', sans-serif; font-style: normal; letter-spacing: 0.14em; color: #1a1200; background: linear-gradient(180deg, #ffe07a, #ffcb3a); transform: skewX(-12deg); text-shadow: none; }
    .thumb-lt { position: absolute; left: 40px; bottom: 74px; filter: drop-shadow(0 8px 20px rgba(0,0,0,0.7)); }
    .thumb-lt b { display: inline-block; padding: 5px 14px 0; background: #e8253c; color: #fff; font: 600 30px/1.1 'Teko', sans-serif; letter-spacing: 0.14em; }
    .thumb-lt div { padding: 9px 26px 4px 14px; background: rgba(14,18,54,0.95); clip-path: polygon(0 0, 100% 0, calc(100% - 18px) 100%, 0 100%); font: 600 34px/1 'Teko', sans-serif; letter-spacing: 0.08em; color: #ffcb3a; }
    .thumb-sub { position: absolute; bottom: 22px; width: 100%; text-align: center; font: 700 20px 'JetBrains Mono', monospace; letter-spacing: 0.14em; color: #eef0fa; text-shadow: 0 2px 8px rgba(0,0,0,0.9); }
  `,
}));
const canvas = root.querySelector('canvas')!;
const scene = new Scene(canvas);
const proof = { serverSeedHash: '', clientSeed: '', nonce: 0 };
const t = (id: string, hit: number, target: number): Throw => ({ id, time: 0, stake: 10, target, hit, win: hit >= target ? 10 * target : 0, proof });
// a visit of three in the board, one of them in the bull, and the next dart in hand
const history = [t('c9', 61.5, 50), t('b3', 9.4, 5), t('a7', 3.1, 2)];
document.fonts.ready.then(() => {
  scene.set({ target: 50, flight: null, windAt: null, pull: 0, history, reducedMotion: false, insets: { top: 40, bottom: 700 } });
  setTimeout(() => (document.body.dataset.ready = '1'), 1200);
});
