import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Throw } from './game/api';
import { createDemoApi, createHttpApi } from './game/api';
import { FLY_MS, RINGS, chanceOf, clampTarget } from './game/darts';
import { formatMoney } from './game/money';
import { sound } from './game/sound';
import { useDarts } from './game/useDarts';
import { Scene } from './scene/scene';
import { FairnessModal, HistoryModal, RulesModal } from './components/Modals';

const demo = new URLSearchParams(window.location.search).has('demo') || import.meta.env.VITE_DEMO === '1';
const CHIPS = [1, 5, 10, 25, 50, 100];
const AUTO = [10, 25, 50, 100];
type ModalKind = 'rules' | 'history' | 'fair';
const touch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

/** What the caller shouts for a dart. */
function callFor(t: Throw): { title: string; tone: 'big' | 'win' | 'close' | 'miss' } {
  if (t.win > 0) {
    if (t.target >= 50) return { title: 'BULLSEYE!', tone: 'big' };
    if (t.target >= 10) return { title: 'WHAT A DART!', tone: 'big' };
    if (t.hit >= 50) return { title: 'DEAD CENTRE!', tone: 'win' };
    if (t.target >= 3) return { title: 'ON THE MONEY!', tone: 'win' };
    return { title: 'IN THERE!', tone: 'win' };
  }
  if (t.hit < 1.2) return { title: 'WIDE!', tone: 'miss' };
  if (t.hit >= t.target * 0.75) return { title: 'SO CLOSE!', tone: 'close' };
  return { title: 'JUST SHORT', tone: 'miss' };
}

export default function App() {
  const api = useMemo(() => (demo ? createDemoApi() : createHttpApi()), []);
  const game = useDarts(api);
  const { info, balance, history, flight, windAt, stats, busy, error, auto, actions } = game;
  const [stake, setStake] = useState(10);
  const [target, setTarget] = useState(2);
  const [custom, setCustom] = useState('7.50');
  const [modal, setModal] = useState<ModalKind | null>(null);
  const [menu, setMenu] = useState(false);
  const [soundOn, setSoundOn] = useState(sound.enabled);
  const [now, setNow] = useState(0);
  const [pull, setPull] = useState(0);
  const [insets, setInsets] = useState<{ top: number; bottom: number; left: number; right: number } | undefined>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const pullRef = useRef(false);
  const swipe = useRef<{ y: number; id: number } | null>(null);
  const reduced = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  const currency = info?.currency ?? 'ZAR';
  const min = info?.minBet ?? 1;
  const max = info?.maxBet ?? 500;
  const clampStake = (v: number) => Math.min(max, Math.max(min, Math.round(v * 100) / 100));
  const canThrow = !busy && !auto && !!info;

  useEffect(() => {
    sceneRef.current = new Scene(canvasRef.current!);
    return () => sceneRef.current?.destroy();
  }, []);
  useEffect(() => {
    sceneRef.current?.set({ target, flight, windAt, pull, history, reducedMotion: reduced, insets });
  }, [target, flight, windAt, pull, history, reduced, insets]);

  // the scene plays in the part of the screen the UI leaves free (the stage's grid cell): under the top bar and above
  // the ticker and bet panel in portrait; beside the bet panel on a phone held sideways
  useLayoutEffect(() => {
    const measure = () => {
      const stage = document.querySelector('.stage');
      if (!stage) return;
      const r = stage.getBoundingClientRect();
      const next = { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) };
      setInsets((p) => (p && p.top === next.top && p.bottom === next.bottom && p.left === next.left && p.right === next.right ? p : next));
    };
    measure();
    const obs = new ResizeObserver(measure);
    for (const sel of ['.app', '.stage', '.top-bar', '.ticker', '.panel']) {
      const el = document.querySelector(sel);
      if (el) obs.observe(el);
    }
    window.addEventListener('resize', measure);
    return () => {
      obs.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => {
    const unlock = () => sound.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // the caller speaks once the dart is in the board
  useEffect(() => {
    if (!flight) return;
    const t = window.setTimeout(() => setNow(performance.now()), Math.max(0, flight.at + FLY_MS - performance.now()) + 10);
    return () => clearTimeout(t);
  }, [flight]);

  const shoot = useCallback(
    (cocked = false) => {
      if (canThrow) actions.throwDart(clampStake(stake), target, cocked);
    },
    [canThrow, stake, target, actions], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const draw = useCallback(() => {
    if (!canThrow) return;
    pullRef.current = true;
    setPull(1);
  }, [canThrow]);

  const loose = useCallback(
    (throwIt: boolean) => {
      if (!pullRef.current) return;
      pullRef.current = false;
      setPull(0);
      if (throwIt) shoot(true);
    },
    [shoot],
  );

  // hold Space to draw the dart back; let go to throw
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || e.code !== 'Space') return;
      e.preventDefault();
      if (!e.repeat) draw();
    };
    const up = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || e.code !== 'Space') return;
      e.preventDefault();
      loose(true);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [draw, loose]);

  const close = useCallback(() => setModal(null), []);
  const landed = flight && now >= flight.at + FLY_MS ? flight.t : null;
  const showCall = landed && windAt == null;
  const payout = Math.floor(clampStake(stake) * target * 100 + 1e-7) / 100;
  const isPreset = RINGS.some((r) => r.target === target);
  const call = landed ? callFor(landed) : null;

  // the visit: darts come in threes, like a match
  const n = history.length;
  let inVisit = n === 0 ? 0 : n % 3 || 3;
  if (inVisit === 3 && windAt != null) inVisit = 0;
  const visit = history.slice(0, inVisit);
  const visitNet = visit.reduce((s, h) => s + h.win - h.stake, 0);
  const throwingNow = windAt != null ? 1 : 0;

  return (
    <div className="app">
      <canvas ref={canvasRef} className="scene" aria-hidden />
      <header className="top-bar">
        <div className="logo">
          <span className="logo-mark" aria-hidden />
          <span className="logo-a">BULLS</span>
          <span className="logo-b">EYE</span>
          <span className="logo-tag">OPEN</span>
        </div>
        <div className="top-right">
          {demo && (
            <button className="chip-btn" onClick={() => actions.refill()}>
              DEMO · REFILL
            </button>
          )}
          <div className="balance">
            <span className="balance-label">BALANCE</span>
            <span className="balance-value">{balance == null ? '—' : formatMoney(balance, currency)}</span>
          </div>
          <button
            className={`icon-btn ${soundOn ? '' : 'off'}`}
            onClick={() => {
              sound.enabled = !sound.enabled;
              setSoundOn(sound.enabled);
            }}
            aria-label={soundOn ? 'Mute' : 'Unmute'}
          >
            {soundOn ? '🔊' : '🔈'}
          </button>
          <div className="menu-wrap">
            <button className="icon-btn" onClick={() => setMenu((m) => !m)} aria-label="Menu" aria-expanded={menu}>
              ☰
            </button>
            {menu && (
              <div className="menu" role="menu" onClick={() => setMenu(false)}>
                <button role="menuitem" onClick={() => setModal('rules')}>How to play</button>
                <button role="menuitem" onClick={() => setModal('history')}>My darts</button>
                <button role="menuitem" onClick={() => { actions.refreshFairness(); setModal('fair'); }}>Provably fair</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="stage">
        <div
          className="throw-zone"
          aria-hidden
          onPointerDown={(e) => {
            if (!canThrow) return;
            swipe.current = { y: e.clientY, id: e.pointerId };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            draw();
          }}
          onPointerUp={(e) => {
            const s = swipe.current;
            swipe.current = null;
            if (!s || s.id !== e.pointerId) return;
            loose(s.y - e.clientY > 24);
          }}
          onPointerCancel={() => {
            swipe.current = null;
            loose(false);
          }}
        />

        <div className="scorebug" aria-label="Scoreboard">
          <div className="sb-head">
            <span className="sb-live">LIVE</span>
            <span className="sb-event">THE BULLSEYE OPEN</span>
          </div>
          <div className="sb-main">
            <div className="sb-player">
              <span className="sb-badge" aria-hidden />
              YOU
            </div>
            <div className="sb-stat">
              <b>{stats.throws}</b>
              <i>DARTS</i>
            </div>
            <div className="sb-stat">
              <b>{stats.hits}</b>
              <i>HITS</i>
            </div>
            <div className="sb-stat wide">
              <b>{stats.best ? `×${stats.best.toFixed(2)}` : '—'}</b>
              <i>BEST</i>
            </div>
            <div className={`sb-stat net ${stats.net > 0 ? 'up' : stats.net < 0 ? 'down' : ''}`}>
              <b>{stats.net > 0 ? '+' : stats.net < 0 ? '−' : ''}{formatMoney(Math.abs(stats.net), currency)}</b>
              <i>SESSION</i>
            </div>
          </div>
          <div className="sb-visit">
            <i>VISIT</i>
            {[0, 1, 2].map((i) => {
              const d = visit[inVisit - 1 - i];
              const live = i === inVisit && throwingNow;
              return <span key={i} className={`sb-dart ${d ? (d.win > 0 ? 'hit' : 'miss') : live ? 'live' : ''}`} aria-hidden />;
            })}
            {inVisit > 0 && <b className={visitNet >= 0 ? 'up' : 'down'}>{visitNet >= 0 ? '+' : '−'}{formatMoney(Math.abs(visitNet), currency)}</b>}
          </div>
        </div>

        {showCall && call ? (
          <div className={`caller ${call.tone}`} role="status" key={landed.id}>
            <div className="caller-title">{call.title}</div>
            <div className="caller-sub">
              ×{landed.hit.toFixed(2)} · {landed.win > 0 ? `inside ${landed.target}×` : `needed ${landed.target}×`}
            </div>
            {landed.win > 0 && <div className="caller-amt">+{formatMoney(landed.win, currency)}</div>}
          </div>
        ) : (
          <div className="lower-third">
            <div className="lt-tag">{windAt != null ? 'THROWING' : 'ON THE OCHE'}</div>
            <div className="lt-main">
              AIMING FOR <b>{target}×</b>
              <span>
                {(chanceOf(target) * 100).toFixed(2)}% · pays {formatMoney(payout, currency)}
              </span>
            </div>
            {stats.throws < 3 && !auto && <div className="lt-hint">{touch ? 'Swipe up on the board to throw' : 'Hold SPACE, let go to throw'}</div>}
          </div>
        )}
        {error && (
          <div className="toast" role="alert">
            {error}
          </div>
        )}
      </main>

      <div className="ticker" aria-label="Recent darts">
        <span className="ticker-tag">LAST DARTS</span>
        <div className="ticker-row">
          {history.length === 0 ? (
            <span className="ticker-empty">First dart of the night coming up…</span>
          ) : (
            history.slice(0, 24).map((h) => (
              <span key={h.id} className={`tick ${h.win > 0 ? 'won' : 'lost'}`}>
                ×{h.hit.toFixed(2)}
              </span>
            ))
          )}
        </div>
      </div>

      <section className="panel" aria-label="Bet">
        <div className="field">
          <span className="field-label">STAKE</span>
          <div className="stake-row">
            <button className="step-btn" disabled={!!auto} onClick={() => setStake((s) => clampStake(s / 2))}>½</button>
            <div className="stake-input">
              <span>{currency === 'ZAR' ? 'R' : currency}</span>
              <input type="number" inputMode="decimal" value={stake} disabled={!!auto} onChange={(e) => setStake(Number(e.target.value))} onBlur={() => setStake((s) => clampStake(s || min))} aria-label="Stake" />
            </div>
            <button className="step-btn" disabled={!!auto} onClick={() => setStake((s) => clampStake(s * 2))}>2×</button>
          </div>
          <div className="chips">
            {CHIPS.map((c) => (
              <button key={c} className={`chip ${stake === c ? 'on' : ''}`} disabled={!!auto} onClick={() => setStake(clampStake(c))}>
                {c}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">TARGET RING</span>
          <div className="aims">
            {RINGS.map((r) => (
              <button key={r.target} className={`aim ${target === r.target ? 'on' : ''}`} disabled={!!auto} onClick={() => setTarget(r.target)}>
                <b>{r.label}</b>
                <small>{(chanceOf(r.target) * 100).toFixed(r.target >= 10 ? 1 : 0)}%</small>
              </button>
            ))}
          </div>
          <div className={`custom ${!isPreset ? 'on' : ''}`}>
            <span>Any ring</span>
            <input
              type="number"
              inputMode="decimal"
              min={1.01}
              max={1000}
              step={0.01}
              value={custom}
              disabled={!!auto}
              onChange={(e) => setCustom(e.target.value)}
              onFocus={() => setTarget(clampTarget(Number(custom) || 2))}
              onBlur={() => {
                const t = clampTarget(Number(custom) || 2);
                setCustom(t.toFixed(2));
                setTarget(t);
              }}
              aria-label="Custom target"
            />
            <span>× (1.01–1000)</span>
          </div>
        </div>
        <div className="actions">
          <button className="throw" disabled={!canThrow} onClick={() => shoot(false)}>
            <span className="throw-title">THROW</span>
            <span className="throw-meta">
              {formatMoney(clampStake(stake), currency)} at {target}×
            </span>
          </button>
          {auto ? (
            <button className="auto stop" onClick={actions.stopAuto}>
              STOP AUTO · {auto.left} left
            </button>
          ) : (
            <div className="autos">
              {AUTO.map((a) => (
                <button key={a} className="auto" disabled={busy || !info} onClick={() => actions.startAuto(a, clampStake(stake), target)}>
                  AUTO {a}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {modal === 'rules' && <RulesModal maxBet={max} currency={currency} onClose={close} />}
      {modal === 'history' && <HistoryModal history={history} currency={currency} onClose={close} />}
      {modal === 'fair' && <FairnessModal info={info} history={history} onClose={close} />}
    </div>
  );
}
