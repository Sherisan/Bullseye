import type { Info, Throw } from '../game/api';
import { RINGS, RTP, chanceOf } from '../game/darts';
import { formatMoney } from '../game/money';
import { Modal } from './Modal';

export function RulesModal({ maxBet, currency, onClose }: { maxBet: number; currency: string; onClose: () => void }) {
  return (
    <Modal title="How to play" onClose={onClose}>
      <ol className="rules">
        <li>
          <strong>Aim.</strong> Pick a ring (1.2× to 50×) or type any target from 1.01× to 1000×. The glowing circle is what you need to hit.
        </li>
        <li>
          <strong>Throw.</strong> Press THROW, hold SPACE and let go, or swipe up on the board. If the dart lands inside your circle, you win your
          stake × the target. Anywhere outside it, you lose the stake.
        </li>
        <li>
          <strong>How you throw doesn't matter.</strong> Where every dart lands is decided by the game server when you throw. How long you hold,
          how you swipe and when you let go change nothing: they only play the throw.
        </li>
        <li>
          <strong>Visits.</strong> Darts come in visits of three, like a match. The board is cleared for each new visit, and the scoreboard keeps
          your session: darts, hits, your best dart and how you stand.
        </li>
        <li>
          <strong>The board is honest.</strong> Every circle's area is exactly its chance: the 2× circle covers 48% of the board, the 50× circle
          1.92%. Where the dart lands is decided by the game server; the board just shows it.
        </li>
      </ol>
      <h3>Return to player: {(RTP * 100).toFixed(0)}%</h3>
      <p>
        The server draws a hit value <em>c</em> for every throw, with a 4% house edge: the chance that <em>c</em> reaches any target <em>m</em> is
        0.96 ÷ <em>m</em>. You win when <em>c</em> ≥ <em>m</em>, so every target returns 96% over time, from the safest ring to the bullseye.
        The dart lands at a distance from the centre of 1 ÷ √<em>c</em> of the board's radius.
      </p>
      <table className="odds">
        <thead>
          <tr>
            <th>Ring</th>
            <th>Chance</th>
            <th>Pays</th>
            <th>Return</th>
          </tr>
        </thead>
        <tbody>
          {RINGS.map((r) => (
            <tr key={r.target}>
              <td>{r.label}</td>
              <td>{(chanceOf(r.target) * 100).toFixed(2)}%</td>
              <td>{r.target}× stake</td>
              <td>96%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">
        Bets up to {formatMoney(maxBet, currency)}. Hit values are capped at ×1000. Payouts are rounded down to the cent.
      </p>
    </Modal>
  );
}

export function HistoryModal({ history, currency, onClose }: { history: Throw[]; currency: string; onClose: () => void }) {
  return (
    <Modal title="My darts" onClose={onClose}>
      {history.length === 0 ? (
        <p className="muted">No darts yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Stake</th>
              <th>Aim</th>
              <th>Hit</th>
              <th>Paid</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id} className={h.win > 0 ? 'won' : 'lost'}>
                <td>{new Date(h.time).toLocaleTimeString()}</td>
                <td>{formatMoney(h.stake, currency)}</td>
                <td>{h.target}×</td>
                <td>×{h.hit.toFixed(2)}</td>
                <td>{h.win > 0 ? formatMoney(h.win, currency) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

export function FairnessModal({ info, history, onClose }: { info: Info | null; history: Throw[]; onClose: () => void }) {
  const last = history[0];
  return (
    <Modal title="Provably fair" onClose={onClose}>
      <dl className="fair">
        <dt>Current server seed (SHA-256)</dt>
        <dd className="mono">{info?.currentServerSeedHash ?? '—'}</dd>
        <dt>Previous server seed (revealed)</dt>
        <dd className="mono">{info?.previousServerSeed ?? 'not rotated yet'}</dd>
        {last && (
          <>
            <dt>Your last throw</dt>
            <dd className="mono">
              seed hash {last.proof.serverSeedHash} · client seed {last.proof.clientSeed} · nonce {last.proof.nonce} · hit ×{last.hit.toFixed(2)}
            </dd>
          </>
        )}
      </dl>
      <p className="muted">
        Every hit value comes from the game server's provably fair generator. Its server seed is committed (you see the hash above) before the
        throws it decides, and revealed when it rotates, so past throws can be checked against it.
      </p>
    </Modal>
  );
}
