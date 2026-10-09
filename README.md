# BLITZBALL X

**Arcade underwater 7-a-side Blitzball. Turbo, tricks, big hits, keepers, Gamebreakers, subs and cards. Two halves, most points wins. Broadcast-grade replays.**

BLITZBALL X is a finished, browser-playable arcade **Blitzball** game — the sphere-pool team sport
(swimmers, a ring goal at each end, keepers, tackles, long-range shots) — built with the mechanics and
attitude of classic street-ball arcade titles: **Turbo**, trick swims that **wash** defenders, **big
hits** that knock the ball loose, a **style meter** that charges an unstoppable **Gamebreaker**, **ON
FIRE** streaks, lob-and-volley plays, a Rematch-style shoulder camera with a **broadcast goal replay**
(letterboxed, two camera cuts, skippable), a **bench** with four substitutions a side driven by a
**stamina** model, a **keeper you can take over** mid-play with a committed **dive**, **lead passes**
aimed into space ahead of a running swimmer, **fouls, yellows and red cards** with automatic bench
replacements, a halftime **montage** and a full-time **match recap** with a shot chart, cel-shaded
characters, a graffiti / hip-hop UI, live commentary, and a "Run The Pools" career ladder against
seven rival crews. It runs entirely client-side (three.js + Vite) — no backend, no accounts, no
downloads.

## Play

```bash
npm install
npm run dev        # http://localhost:5173
```

Production build:

```bash
npm run build      # outputs static site to dist/
npm run preview    # serve dist/ locally on http://localhost:4173
```

`dist/` is a static bundle with relative asset paths — drop it on any static host (GitHub Pages,
Netlify, S3, nginx). A GitHub Pages workflow is included (`.github/workflows/deploy-pages.yml`).

### Controls

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Swim | WASD / Arrows | Left stick / D-pad | Left half of the screen |
| Swing the camera | — | — | Right half of the screen |
| Rise / dive (free swim) | R / F | Right stick (Y) | ▲ / ▼ |
| Turbo (Burst) | Shift | RT / RB | BURST (hold) |
| Shoot (hold to charge, release in the PERFECT window) | J / Space | A / Cross | Strike pad: hold, swipe, lift |
| Pass (hold Turbo to lob for a volley) | K | X / Square | PASS |
| Trick (with ball) / Tackle (defense) | L | B / Circle | TACKLE |
| Big hit | I | Y / Triangle | HIT |
| Breach (leap) / Block / Volley a loose ball | U (or J on defense) | A / Cross on defense | BLOCK |
| Switch swimmer | Q / Tab | LB | automatic — you take the ball carrier |
| Take the cage (control your keeper) | V | L3 (left-stick click) | GK (press again to come back out) |
| Gamebreaker | E | LT + RT | Strike pad while it glows cyan |
| Call play (offense / defense) | 1 2 3 / 7 8 9 | — | ATTACK / DEFEND |
| Bench / substitutions | T, then 1-4 | — | — |
| Skip a goal replay | any key or tap | any button | any tap |
| Pause | Esc | Start | II |

The touch layout is **two zones and a pad**. The **left half** is the stick: press anywhere and a
joystick appears under your thumb. It is read *relative to the camera*, so "forward" is always away
from the lens. The **right half** swings the camera — drag sideways to turn the view, up and down to
raise or lower the boom. While touch is on, the boom holds your chosen yaw instead of auto-following
your heading (an auto-follow camera plus a camera-relative stick would spiral).

The **strike pad** in the bottom right corner is the shot: hold to wind up, **swipe** to bend the
shot to that side and to pick your ring tier, lift to fire. Release inside the **PERFECT** window for
the cleanest strike. It glows cyan while the Gamebreaker meter is full, and the same gesture then
launches the Gamebreaker.

Beside it: **PASS**, **BURST** (hold to sprint), **BLOCK** (leap/block off the ball), **HIT** (big
hit) and **TACKLE** — the poke-slide tackle off the ball and your signature move with it. None of
them ever change their name or their job mid-match. **ATTACK** cycles Drive / Spread / Isolation;
**DEFEND** cycles Man / Zone / Press. Your selections persist until you change them — CPU teammates
never override your playbook. Each finger owns one control from press to release, so a thumb on the
camera never steals the stick; pause, focus loss, rotation, and cancelled touches clear held input.

On phones the renderer uses the lean pipeline (lower pixel density, no real-time shadows or
bloom) to prioritize responsive play. Desktop graphics preferences are unchanged.

### Rules

- **7-a-side** (six outfield swimmers + a keeper) in a sphere of water, with **4 substitutes** on the
  bench per team. Team 0 attacks +x.
- Two halves of 2:30. Most points wins. Level at full time → **golden-goal overtime** (keepers tire
  after two OT minutes, so a winner is guaranteed).
- **24-second possession clock** — shoot before it runs out or it's a turnover.
- Keepers must release the ball within 4 seconds.
- **Mercy rule**: up by 12 in the second half and it's over.
- **Three scoring windows** at each end: the top ring is worth **3**, the two low rings **1** each.
  The premium window is small, so taking it is a decision.
- **Gamebreaker goal = 4 and takes 2 off the other team.**
- **The cage is a role you can pick up.** When play reaches your end, **V / L3 / GK**
  hands you the keeper; press it again (or **Q / LB**) to leave. Pre-position with movement
  (A/D or left-stick left/right shuffles across the cage), set height with **R/F / right-stick Y /
  ▲▼**, then commit a **U/J/L / A/B** dive. On touch, **swipe the DIVE pad** to pick side and
  height, then **lift to dive**; the stick can keep setting position independently. PASS distributes
  a caught ball, subject to the four-second hold limit. Dives lock their axes, cost stamina and
  recover for a second. A correct, timely two-axis read earns **READ SAVE**; wrong height or side
  loses save probability. Neutral depth holds the position you prepared; leaving the cage restores
  normal buoyancy. The fixed cage camera cannot spin with a shuffle; its indicator shows your own
  position and dive intent, never the attacker's hidden target. CPU-only balance is unchanged.

- **Passing is a lead, not a delivery.** The stick aims the *landing spot* rather than the receiver:
  the sim solves where a moving swimmer will actually be when the ball arrives, so a pass held down
  the line finds a runner in space instead of trailing him. Land it and the passer is paid — a
  **LEAD PASS** is real style, and only counts if the receiver was genuinely running and the spot
  was genuinely open.
- **The water is real.** Swimmers accelerate toward the stick with bounded thrust: light analog
  input cruises, full deflection drives, and reversals brake through zero without a sideways orbit.
  Mass affects acceleration and release eases the body to rest. The carried ball stays at hand
  height at every swim depth; fast passes, shots, and pickups use swept contact checks. Shots are struck with **spin**: the
  lateral stick at release curls the flight around a keeper's dive (a **CURLED FINISH** pays style),
  a badly-timed strike wobbles off line instead, and the pool's own slow current nudges anything
  drifting, so a loose ball wanders rather than hanging where it stopped.
- **Signature moves pay for themselves.** Each swimmer owns one, and it beats the defenders it
  actually *travels* through — not just whoever stood in front at the moment you pressed it.
  Beating a man hands turbo back, leaves you clean (the off-balance bill is only for the move you
  wasted), pays style, and drops the pool into a beat of slow-mo so you see it happen.
- **Contact has body behind it.** A standing swing staggers; the same blow taken at pace puts a
  swimmer down and gets the ref's attention. Heavy bodies (power) move less when hit and get their
  footing back sooner.
- Style comes from tricks, washes, tackles, big hits, blocks, saves, volleys and long-range goals.
  Chaining moves builds a combo multiplier; turnovers drain the meter. A full meter unlocks the
  Gamebreaker. Two straight goals and your crew is **ON FIRE**.
- **Stamina** drains with sprinting, contact and repeated effort, and recovers at rest. A gassed
  swimmer is slower and can barely turbo — the reason to use a substitution.
- **Discipline**: swinging at a swimmer who is already down, or a clean square big hit over the
  line, is a foul. The fouled side keeps the ball at the spot and the offender is booked. Two
  bookings — or one outright ugly one — is a **red**: out for the match, replaced straight from the
  bench at no cost to your four substitutions. Tackles are never whistled; the violence is the
  big-hit button, where the risk is yours to take.

### Modes

- **Pick Up Match** — quick match vs CPU, pick both crews and the difficulty (Rookie / Pro / Legend).
- **Run The Pools** — career ladder: pick a crew, name your own **starting seven** from the twelve
  you manage (your created swimmer swims as a third shooter), then beat the other seven crews.
  Venues **alternate** — even rungs at your sphere, odd ones on their water. **Injuries carry
  between fixtures**: whoever took the hardest hit, or who spent the match on the floor, is out for
  one (sometimes two) fixtures and the squad screen forces a replacement in. Form swings the crew's
  ratings a couple of points either way (**SHAKEN → UNSTOPPABLE**), and a crew you meet twice becomes
  a marked **rivalry** on the ladder. Rep, titles, records and the Legend unlock persist in
  `localStorage`.
- **Watch** — CPU vs CPU exhibition.

### Sound

Everything is synthesized at runtime — there are no audio files. That covers the one-shot SFX
(bounces, swishes, slams, whistles, stingers), the crowd bed, the **announcer**, and the
**backing music**.

- **The announcer speaks.** Commentary lines are read aloud with the Web Speech API, tuned up in
  rate and pitched to land as a hyped poolside caster rather than a default assistant, with the
  music ducked underneath each line so the call reads. A high-priority call (a goal) cuts off
  whatever was mid-sentence. Voice, volume and an on/off switch live in Settings. Browsers differ
  wildly here — macOS and Windows have a dozen voices to pick a casting one from, while headless
  Linux exposes none and falls back to the engine default — and if speech is genuinely unavailable
  the text ticker still carries every line.
- **Four backing tracks**, all boom-bap/hip-hop: **BADDIES** (90 BPM, dusty D minor, the original),
  **DEEP END** (104, G-funk-leaning rolling bass), **DEAD WEIGHT** (82, slow half-time) and
  **HYPERFLOW** (112, busy and bright, and it lifts a whole tone in-match). They differ in tempo
  pocket, drum grid, key, bassline and swing, and **AUTO** picks a different one each match so
  consecutive games don't sit on the same four bars. Pick a specific track in Settings to pin it.

## Architecture

```
src/
  core/        vec3, seeded RNG, event bus
  data/        constants (arena / rules / physics / tuning / difficulty), 8 crews × 11 swimmers
  game/        MatchSim (deterministic, headless, fixed 60 Hz), career ladder
               subsystems: shooting, ball, rules, combat, passing, movement
               CPU brains, one module per role: ai-carrier / ai-offense / ai-defense /
               ai-loose / ai-keeper / ai-plays, with shared helpers in ai-core
               replay (goal recorder + playback), report (the match story),
               career (squad, injuries, form, rivalry, fixtures)
  render/      three.js: sphere pool + goals + stadium, cel-shaded characters, FX, camera
  ui/          input (keyboard + gamepad), HUD, bench, commentary, replay + montage overlays,
               match recap, procedural audio (backing tracks + announcer voice),
               screens (incl. squad selection), save
  main.js      app shell: screens, match lifecycle, fixed-step loop
tests/         node:test suite (rules, determinism, bounds, mechanics coverage)
scripts/       headless simulation runner (balance / stall detection)
tools/         headless Chromium QA (screenshots, scripted playtest, screen walk, bench, touch)
```

The simulation has no DOM or three.js dependency; presentation, audio and commentary subscribe to
its event bus (`score`, `save`, `tackle`, `bighit`, `washed`, `block`, `gamebreaker`, `foul`, `card`,
`sub`, `halftime`, …). The same `setUserInput()` contract drives both the human and the CPU, so AI
and player go through identical rules. The goal replay is the one place the sim is *read* rather
than played: a ring buffer of poses is recorded off the sim clock and played back onto the live
entities, so a replay costs no video, no re-simulation and no second scene graph.

## QA

```bash
npm test                        # unit + simulation tests (incl. the golden sim snapshot)
npm run sim -- 24 pro           # 24 headless CPU matches, one line each; exits 1 if any match stalls
npm run balance -- --games 24   # the same slate, summarised + audited (see below)
npm run golden:update           # regenerate tests/golden/sim-baseline.json (intended rebalances only)
npm run qa:screens -- http://localhost:4173/ screenshots/screens   # walk every screen headlessly
npm run qa:play -- http://localhost:4173/ screenshots/prod         # scripted playtest to results
npm run qa:probe -- http://localhost:4173/                         # repeat matches: GPU contexts, heap, frame time
npm run qa:anim -- http://localhost:5173/                         # screenshot every animation state / trick / swim speed
npm run qa:bench -- http://localhost:5173/                        # bench, subs, cards, goal replay, halftime, recap, career squad
npm run qa:touch -- http://localhost:5173/                        # touch pad, settings, portrait/landscape
npm run qa:merge -- http://localhost:5173/                        # static-merge geometry + draw-call budget
npm run qa:perf -- http://localhost:4173/ --max-calls 700 --max-sim-ms 1.5   # perf budget gate
npm run qa:devtools -- http://localhost:4173/                     # ?perf overlay + ?tune panel mount and behave
npm run qa:lighthouse                                             # Lighthouse audit of the built site (npm run build first)
```

The sim's behavior is pinned by a committed baseline (`tests/golden/sim-baseline.json`): three
fixed seeds are replayed on every `npm test` and any moved scoreline, match length, stat or event
count fails the build with a field-by-field diff. An intended rebalance therefore has to run
`npm run golden:update` deliberately, and the regenerated baseline shows exactly what it changed.

Browser QA harnesses pin the match seed, so a run reproduces the same match every time instead of
rolling the dice. `startMatch({ …, seed })` takes one directly, and `?seed=123` in the URL does the
same for a manual session; `tools/touchtest.mjs` also honours `QA_SEED` to sweep known-good seeds:

```bash
QA_SEED=777 npm run qa:touch -- http://localhost:5173/
```

`qa:anim` drives the single-swimmer animation bench that the app serves at `?bench=anim`
(`src/dev/animbench.js`), so poses can be scrubbed and captured deterministically.

`npm run balance` plays a slate of CPU-vs-CPU matches and reports what the current tuning produces —
match length, margin split, the ring-point share, a per-crew table, event rates — and audits the
scoring path while it does (the goal log minus gamebreaker steals must equal the final score). It
fails on a broken match (unfinished, non-finite, inconsistent scoring), never on the shape of the
numbers, which is the thing being judged; `--json path` writes the whole slate out for an artifact.
`npm run qa:perf` is the gate version of the perf spot-check: deterministic counters (draw calls,
triangles) are held tightly, sim ms/step loosely, and a breach exits 1.

Two dev flags exist for looking at the game while it runs. `?perf` paints a frame-tail overlay
(p50/p99/max, hitch count and threshold, sim and render cost, live draw calls / triangles / shader
programs) and `window.__BB_PERF__.summary()` returns the same numbers as JSON — the monitor is
always recording, so a real device can report a stutter without a flag. `?tune` opens the live
balance panel: every numeric dial in `src/data/constants.js` (188 of them, discovered by walking the
objects, so it cannot fall behind a new constant) with a slider and an exact-entry box, editing the
running match's rules through `MatchSim.syncTuning()` and printing the changes as lines to paste
back into the constants file. `ARENA` is deliberately excluded — the pool's geometry is built from it
at match start.

CI (`.github/workflows/ci.yml`) runs lint, the tests, the balance report and a production build, and
uploads the built `dist/` as the `blitzball-x-dist` artifact and the balance slate as
`balance-report` on every push. A `browser-qa` job serves that build and runs `qa:touch`, `qa:probe`,
`qa:merge`, `qa:devtools` and the perf budget; `qa:probe` fails if a match leaks its WebGL context at
teardown, reports no frames, or the page throws. A `lighthouse` job audits the built site with mobile
emulation and uploads the full HTML report as the `lighthouse-report` artifact. `qa:lighthouse` needs
an environment with system fonts to score first paint — fontless containers report `INCONCLUSIVE` (exit 2) instead of a fake zero.

## Releasing

1. Bump `version` in `package.json`. This is the single source of truth — the release workflow
   refuses to publish a tag that disagrees with it.
2. Commit and push that bump to `main`.
3. Tag the commit and push the tag:

   ```bash
   git tag -a v1.1.0 -m "BLITZBALL X v1.1.0"
   git push origin v1.1.0
   ```

Pushing the tag runs `.github/workflows/release.yml`, which re-runs the full test suite, the
balance sweep and a production build, then attaches a `dist` tarball to a GitHub Release with
auto-generated notes. If any step fails, no release is published.

The built site also deploys to GitHub Pages on every push to `main`
(`.github/workflows/deploy-pages.yml`), independently of releases.

## Original IP

All crews, swimmers, arenas, names and art are original to this project.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the professional-grade improvement plan — landed work with the
commits that closed it, plus what's next for gameplay depth, FX, robustness and releases.
