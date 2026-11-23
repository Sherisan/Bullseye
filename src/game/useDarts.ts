import { useCallback, useEffect, useRef, useState } from 'react';
import type { DartsApi, Info, Throw } from './api';
import { FLY_MS, MIN_RELEASE_MS, WIND_MS } from './darts';
import { sound } from './sound';
import { onConnectionChange, onRecovered } from '../net/connectionGuard';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Flight {
  /** the throw in the air (or just landed) */
  t: Throw;
  /** when the dart left the hand (performance.now ms); it lands FLY_MS later */
  at: number;
}

/** This session's numbers, for the scoreboard. */
export interface Stats {
  throws: number;
  hits: number;
  best: number;
  net: number;
}

const NO_STATS: Stats = { throws: 0, hits: 0, best: 0, net: 0 };

export function useDarts(api: DartsApi) {
  const [info, setInfo] = useState<Info | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [history, setHistory] = useState<Throw[]>([]);
  const [flight, setFlight] = useState<Flight | null>(null);
  /** When the throw in progress started (the wind-up), or null between throws. */
  const [windAt, setWindAt] = useState<number | null>(null);
  const [stats, setStats] = useState<Stats>(NO_STATS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState<{ left: number } | null>(null);
  const busyRef = useRef(false);
  const autoRef = useRef<{ left: number } | null>(null);

  useEffect(() => {
    api.init().then(
      ({ info, balance }) => {
        setInfo(info);
        setBalance(balance);
      },
      (e: Error) => setError(e.message),
    );
  }, [api]);

  // Connection-loss safety: a drop stops autoplay; after a reconnect, re-read the balance (and seeds) from the server.
  useEffect(
    () =>
      onConnectionChange((online) => {
        if (online) return;
        autoRef.current = null;
        setAuto(null);
      }),
    [],
  );
  useEffect(
    () =>
      onRecovered(async () => {
        const { info, balance } = await api.init();
        setInfo(info);
        setBalance(balance);
      }),
    [api],
  );

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 3400);
    return () => clearTimeout(t);
  }, [error]);

  /**
   * One throw. The arm winds up while the server decides where the dart lands, lets go once both are done, and the
   * result counts when the dart hits the board. `cocked`: the player already pulled back (held Space, or swiped), so
   * the wind-up is skipped.
   */
  const throwDart = useCallback(
    async (stake: number, target: number, cocked = false) => {
      if (busyRef.current) return false;
      busyRef.current = true;
      setBusy(true);
      const started = performance.now();
      const wound = cocked ? started - WIND_MS + MIN_RELEASE_MS : started;
      setWindAt(wound);
      setFlight(null);
      if (!cocked) sound.windup();
      try {
        const res = await api.play(stake, target);
        const release = Math.max(performance.now(), wound + WIND_MS);
        await wait(release - performance.now());
        if (res.balance != null) setBalance(res.balance - res.result.win);
        setFlight({ t: res.result, at: performance.now() });
        sound.release();
        await wait(FLY_MS);
        if (res.balance != null) setBalance(res.balance);
        setHistory((h) => [res.result, ...h].slice(0, 60));
        setWindAt(null);
        const r = res.result;
        setStats((s) => ({ throws: s.throws + 1, hits: s.hits + (r.win > 0 ? 1 : 0), best: Math.max(s.best, r.hit), net: Math.round((s.net + r.win - r.stake) * 100) / 100 }));
        sound.land(r.hit, r.target, r.win > 0);
        return true;
      } catch (e) {
        setError((e as Error).message);
        setWindAt(null);
        return false;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [api],
  );

  /** Auto-throw `count` darts at the same stake and target; stops on an error or when cancelled. */
  const startAuto = useCallback(
    async (count: number, stake: number, target: number) => {
      autoRef.current = { left: count };
      setAuto({ left: count });
      while (autoRef.current && autoRef.current.left > 0) {
        const ok = await throwDart(stake, target);
        if (!ok || !autoRef.current) break;
        autoRef.current.left -= 1;
        setAuto(autoRef.current.left > 0 ? { left: autoRef.current.left } : null);
        await wait(420);
      }
      autoRef.current = null;
      setAuto(null);
    },
    [throwDart],
  );

  const stopAuto = useCallback(() => {
    autoRef.current = null;
    setAuto(null);
  }, []);

  const refill = useCallback(async () => {
    if (api.refill) setBalance(await api.refill());
  }, [api]);

  const refreshFairness = useCallback(async () => {
    try {
      const f = await api.fairness();
      setInfo((i) => (i ? { ...i, ...f } : i));
    } catch {
      /* keep the old one */
    }
  }, [api]);

  return { info, balance, history, flight, windAt, stats, busy, error, auto, actions: { throwDart, startAuto, stopAuto, refill, refreshFairness } };
}

export type Game = ReturnType<typeof useDarts>;
