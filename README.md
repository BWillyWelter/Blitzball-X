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

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Swim | WASD / Arrows | Left stick / D-pad |
| Rise / dive (free swim) | R / F | Right stick (Y) |
| Turbo | Shift | RT / RB |
| Shoot (hold to charge, release in the PERFECT window) | J / Space | A / Cross |
| Pass (hold Turbo to lob for a volley) | K | X / Square |
| Trick (with ball) / Tackle (defense) | L | B / Circle |
| Big hit | I | Y / Triangle |
| Breach (leap) / Block / Volley a loose ball | U (or J on defense) | A / Cross on defense |
| Switch swimmer | Q / Tab | LB |
| Take the cage (control your keeper) | V | L3 (left-stick click) |
| Gamebreaker | E | LT + RT |
| Bench / substitutions | T, then 1-4 | — |
| Skip a goal replay | any key or tap | any button |
| Pause | Esc | Start |

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
- **The cage is a role you can pick up.** When the play comes to your end, **V / L3** hands you
  your own keeper instead of an outfield swimmer; **PASS** hands it straight back. While you have the
  cage the actions remap to a **dive** — a committed lateral lunge, worth a save if you pick the
  right side and a sore one if you don't, then locked out for a second. The CPU keeper dives too,
  so an unmarked one will get punished.
- **Passing is a lead, not a delivery.** The stick aims the *landing spot* rather than the receiver:
  the sim solves where a moving swimmer will actually be when the ball arrives, so a pass held down
  the line finds a runner in space instead of trailing him. Land it and the passer is paid — a
  **LEAD PASS** is real style, and only counts if the receiver was genuinely running and the spot
  was genuinely open.
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
  game/        MatchSim (deterministic, headless, fixed 60 Hz), AI brains, career ladder
               subsystems: shooting, ball, rules, combat, passing, movement
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
npm test                        # unit + simulation tests
npm run sim -- 24 pro           # 24 headless CPU matches; exits 1 if any match stalls
npm run qa:screens -- http://localhost:4173/ screenshots/screens   # walk every screen headlessly
npm run qa:play -- http://localhost:4173/ screenshots/prod         # scripted playtest to results
npm run qa:probe -- http://localhost:4173/                         # repeat matches: GPU contexts, heap, frame time
npm run qa:anim -- http://localhost:5173/                         # screenshot every animation state / trick / swim speed
npm run qa:bench -- http://localhost:5173/                        # bench, subs, cards, goal replay, halftime, recap, career squad
npm run qa:touch -- http://localhost:5173/                        # touch pad, settings, portrait/landscape
npm run qa:lighthouse                                             # Lighthouse audit of the built site (npm run build first)
```

`qa:anim` drives the single-swimmer animation bench that the app serves at `?bench=anim`
(`src/dev/animbench.js`), so poses can be scrubbed and captured deterministically.

CI (`.github/workflows/ci.yml`) runs the tests, the simulation sweep and a production build, and
uploads the built `dist/` as the `blitzball-x-dist` artifact on every push. A `browser-qa` job
serves that build and runs `qa:touch` plus `qa:probe`; `qa:probe` fails if a match leaks its WebGL
context at teardown or the page throws. A `lighthouse` job audits the built site with mobile
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
