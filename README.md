# Bullseye

Darts, as an instant game, played first person on the stage of a televised championship ("The Bullseye Open"). Aim
for a ring (1.2× up to 50×) or type any target from 1.01× to 1000×, then throw: press THROW, hold SPACE and let go, or
swipe up on the board. If the dart lands inside your circle you win stake × target; anywhere outside it you lose the
stake. **The board is honest:** every circle's area is exactly its chance, so you can see why a throw won or lost.
**How you throw doesn't matter:** the server decides where every dart lands, and the rules say so.

```bash
npm install
npm run dev      # http://localhost:5196   (add ?demo to play offline)
npm run build
```

The game plays against FeedingFranzeeAPI's **Instant** engine with an `Rng` block of Model `Target` (`api/play`, GameId
`bullseye`, ProviderGameId 20). No new server code was needed. In dev, Vite proxies `/api` to http://localhost:5003. `?demo`
plays against an in-browser stand-in with the same distribution (not the server's generator).

## The maths: 96% on every target

For every throw the server draws a hit value *c* with a 4% house edge: P(*c* ≥ *m*) = 0.96 ÷ *m*, capped at ×1000. You
win *m* × stake when *c* ≥ *m*, so every target returns 96%:

| Ring | Chance | Pays |
|---|---|---|
| 1.2× | 80.00% | 1.2× |
| 1.5× | 64.00% | 1.5× |
| 2× | 48.00% | 2× |
| 3× | 32.00% | 3× |
| 5× | 19.20% | 5× |
| 10× | 9.60% | 10× |
| 25× | 3.84% | 25× |
| 50× | 1.92% | 50× |

The board draws ring *m* as a circle of radius R ÷ √*m*, so its area is exactly proportional to its chance. The dart lands
at radius R ÷ √*c*, inside ring *m* exactly when *c* ≥ *m*. MaxBet is 500, so the ×1000 top target always pays in full
(MaxWin 500,000).

The draw is the same EasyRNG Target generator the live crash games use, so `FeedingFranzeeAPI/tools/RtpSim`
(`dotnet run -c Release crash 20000000 4 1000`) is its RTP check: it passed at 96% for targets from 1.01× to 1000×.

## Provably fair

The info endpoint shows the current server seed's hash and the last revealed seed; every throw returns its proof (seed
hash, client seed, nonce). They're shown under **Provably fair**.

## The scene

- **First person:** your hand holds a dart at the bottom right. A throw winds up (or you hold it back yourself with
  SPACE or a finger), snaps forward and lets go, follows through, then drops away so you see the dart land, and comes
  back up with the next one.
- **True perspective:** everything is 3D in "board radii" (the board is 8 radii away). The dart flies a gentle arc
  away from you with its flights spinning, and darts in the board are seen from behind, as from the oche. Each one
  sticks at the angle it arrived at.
- **Visits:** darts come in threes, and the board is cleared for each new visit.
- **Broadcast dressing:** an LED-wall stage with a chasing halo round the board, moving-head beams, and a crowd either
  side that bobs, waves signs and erupts (cameras flashing) for a win. Two big screens show a live board-cam close-up of
  the last dart and the target.
- **TV graphics** (DOM): a scorebug (LIVE · the session's darts, hits, best dart, net, and the current visit), a lower
  third with the target, the caller's banner for each dart ("BULLSEYE!", "WHAT A DART!", "SO CLOSE!", "WIDE!"…), and a
  ticker of recent darts.
- **Sound:** the wind-up, the release whoosh, the thunk into sisal, and the crowd: a cheer that swells with the
  target, a gasp for a near miss, a groan for a big target missed.

**Phones and tablets:** in portrait the TV graphics shrink to slim strips and the bet panel compacts (short phones also drop the stake chips and the ticker). A phone held sideways puts the board on the left and the bet panel beside it. The page fits the visible screen (`100dvh`), stays clear of notches and the home bar, and doesn't select text, zoom or pull-to-refresh while you swipe.

The scene only animates results the server has already decided. App passes it the screen band left free by the UI
(`insets`), so the board always sits between the top bar and the ticker.

## Files

- `src/game/darts.ts` holds the rings, chances, geometry and the throw's timings; `api.ts` the API client and the
  offline demo; `useDarts.ts` throws, auto-throws and the session stats; `sound.ts` the synth sound and crowd
- `src/scene/scene.ts`: the arena, the board, the hand, the darts in 3D, the crowd, the big screens, confetti
- `src/App.tsx`: the TV graphics, the throw controls (THROW, hold-and-release SPACE, swipe up) and the bet panel
  (stake, target ring, AUTO 10/25/50/100); `src/components/Modals.tsx`
- `tools/thumbnail.html`: the 1280×720 lobby thumbnail (`public/thumbnail.png`), a frozen mid-throw from the scene
