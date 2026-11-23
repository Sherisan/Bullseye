import { MAX_TARGET, RTP } from './darts';
import { assertOnline, connectionLost, ConnectionLostError, isUnreachableStatus, startConnectionGuard } from '../net/connectionGuard';

/** One throw, as the server settled it. */
export interface Throw {
  id: string;
  time: number;
  stake: number;
  target: number;
  /** The hit value drawn (where the dart lands). */
  hit: number;
  win: number;
  proof: { serverSeedHash: string; clientSeed: string; nonce: number };
  winPending?: boolean;
}

export interface Info {
  minBet: number;
  maxBet: number;
  maxWin: number;
  currency: string;
  maxTarget: number;
  rtp: number;
  currentServerSeedHash: string;
  previousServerSeed: string | null;
}

export interface DartsApi {
  init(): Promise<{ info: Info; balance: number }>;
  play(stake: number, target: number): Promise<{ result: Throw; balance: number | null }>;
  /** Fresh seed info (the current hash, the last revealed seed). */
  fairness(): Promise<{ currentServerSeedHash: string; previousServerSeed: string | null }>;
  refill?(): Promise<number>;
}

/* ── The game API (FeedingFranzeeAPI, Engine Instant, Rng Target) ───────── */

const API_BASE: string = import.meta.env.VITE_API_BASE ?? '';
const GAME_ID = 'bullseye';
let token: string | null = null;

async function getToken(): Promise<string> {
  if (token) return token;
  const fromUrl = new URLSearchParams(window.location.search).get('token');
  if (fromUrl) return (token = fromUrl);
  const res = await fetch(`${API_BASE}/api/dev-token?gameId=${GAME_ID}`);
  if (!res.ok) throw new Error('No session token. Launch the game from the lobby, or run the API in Development mode.');
  token = ((await res.json()) as { token: string }).token;
  return token;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  assertOnline(); // nothing is thrown (or bet) while the connection is down
  const auth = await getToken();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    connectionLost();
    throw new ConnectionLostError();
  }
  if (isUnreachableStatus(res.status)) {
    connectionLost();
    throw new ConnectionLostError();
  }
  if (res.status === 429) throw new Error('Too many requests — slow down a little.');
  if (res.status === 401) throw new Error('Your session has expired. Reopen the game from the lobby.');
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
  return json as T;
}

interface WireInfo {
  minBet: number;
  maxBet: number;
  maxWin: number;
  currency: string;
  maxTarget: number | null;
  rtp: number;
  fairness: { currentServerSeedHash: string; previousServerSeed: { serverSeed: string } | string | null };
}

interface WirePlay {
  roundId: string;
  stake: number;
  win: number;
  multiplier: number;
  crashPoint: number | null;
  balance: number | null;
  proof: { serverSeedHash: string; clientSeed: string; nonce: number };
  winPending: boolean;
}

const seedOf = (p: WireInfo['fairness']['previousServerSeed']) => (p == null ? null : typeof p === 'string' ? p : p.serverSeed ?? null);

export function createHttpApi(): DartsApi {
  return {
    async init() {
      // Connection-loss safety: the server settles anything a dropped connection left open before the game loads.
      await startConnectionGuard({ apiBase: API_BASE, getToken, heartbeat: true });
      const [i, wallet] = await Promise.all([call<WireInfo>('/api/play/info'), call<{ balance: number }>('/api/wallet/balance')]);
      return {
        info: {
          minBet: i.minBet, maxBet: i.maxBet, maxWin: i.maxWin, currency: i.currency, maxTarget: i.maxTarget ?? MAX_TARGET, rtp: i.rtp,
          currentServerSeedHash: i.fairness.currentServerSeedHash, previousServerSeed: seedOf(i.fairness.previousServerSeed),
        },
        balance: wallet.balance,
      };
    },
    async play(stake, target) {
      const r = await call<WirePlay>('/api/play', { stake, target });
      return {
        result: { id: r.roundId, time: Date.now(), stake: r.stake, target, hit: r.crashPoint ?? 1, win: r.win, proof: r.proof, winPending: r.winPending },
        balance: r.balance,
      };
    },
    async fairness() {
      const i = await call<WireInfo>('/api/play/info');
      return { currentServerSeedHash: i.fairness.currentServerSeedHash, previousServerSeed: seedOf(i.fairness.previousServerSeed) };
    },
  };
}

/* ── Offline demo (?demo) ───────────────────────────────────────────────── */

const DEMO_KEY = 'bullseye.demo.v1';

/**
 * In-browser stand-in for the server so the game plays without a backend. It draws hit values with the same
 * distribution (P(c >= m) = 0.96 / m, capped at ×1000), but it isn't the server's generator: real results come from the
 * game API.
 */
export function createDemoApi(): DartsApi {
  let balance = 1000;
  let nonce = 1;
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    if (raw) ({ balance, nonce } = JSON.parse(raw));
  } catch {
    /* fresh */
  }
  const save = () => {
    try {
      localStorage.setItem(DEMO_KEY, JSON.stringify({ balance, nonce }));
    } catch {
      /* private mode */
    }
  };
  const info: Info = { minBet: 1, maxBet: 500, maxWin: 500000, currency: 'ZAR', maxTarget: MAX_TARGET, rtp: RTP, currentServerSeedHash: 'demo', previousServerSeed: null };
  return {
    async init() {
      return { info, balance };
    },
    async play(stake, target) {
      if (stake > balance) throw new Error('Insufficient balance');
      const u = crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
      const hit = Math.max(1, Math.min(MAX_TARGET, Math.floor((RTP / (1 - u)) * 100) / 100));
      const win = hit >= target ? Math.floor(stake * target * 100 + 1e-7) / 100 : 0;
      balance = Math.round((balance - stake + win) * 100) / 100;
      nonce += 1;
      save();
      return { result: { id: `demo-${nonce}`, time: Date.now(), stake, target, hit, win, proof: { serverSeedHash: 'demo', clientSeed: 'demo', nonce } }, balance };
    },
    async fairness() {
      return { currentServerSeedHash: 'demo', previousServerSeed: null };
    },
    async refill() {
      balance = 1000;
      save();
      return balance;
    },
  };
}
