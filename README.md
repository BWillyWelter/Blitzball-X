# BLITZBALL X

**Arcade underwater 3-on-3 Blitzball. Turbo, tricks, big hits, keepers, Gamebreakers. Two halves, most goals wins. No refs.**

BLITZBALL X is a finished, browser-playable arcade **Blitzball** game — the sphere-pool team sport
(swimmers, a ring goal at each end, keepers, tackles, long-range shots) — built with the mechanics and
attitude of classic street-ball arcade titles: **Turbo**, trick swims that **wash** defenders, **big
hits** that knock the ball loose, a **style meter** that charges an unstoppable **Gamebreaker**, **ON
FIRE** streaks, lob-and-volley plays, a broadcast camera that punches in on goals, cel-shaded
characters, a graffiti / hip-hop UI, live commentary, and a "Run The Pools" career ladder against
seven rival crews. It runs entirely client-side (three.js + Vite) — no backend, no accounts, no downloads.

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
| Turbo | Shift | RT / RB |
| Shoot (hold to charge, release in the PERFECT window) | J / Space | A / Cross |
| Pass (hold Turbo to lob for a volley) | K | X / Square |
| Trick (with ball) / Tackle (defense) | L | B / Circle |
| Big hit | I | Y / Triangle |
| Breach (leap) / Block / Volley a loose ball | U (or J on defense) | A / Cross on defense |
| Switch swimmer | Q / Tab | LB |
| Ball cam / player cam toggle | C | R3 (stick click) |
| Gamebreaker | E | LT + RT |
| Pause | Esc | Start |

### Rules

- 3 outfield swimmers + a keeper per side inside a sphere of water. Team 0 attacks +x.
- Two halves of 2:30. Most goals wins. Level at full time → **golden-goal overtime** (keepers tire
  after two OT minutes, so a winner is guaranteed).
- **20-second possession clock** — shoot before it runs out or it's a turnover.
- Keepers must release the ball within 4 seconds.
- **Mercy rule**: up by 8 in the second half and it's over.
- Goal = 1. **Gamebreaker goal = 2 and takes 1 off the other team.**
- Style comes from tricks, washes, tackles, big hits, blocks, saves, volleys and long-range goals.
  Chaining moves builds a combo multiplier; turnovers drain the meter. A full meter unlocks the
  Gamebreaker. Two straight goals and your crew is **ON FIRE**.

### Modes

- **Pick Up Match** — quick match vs CPU, pick both crews and the difficulty (Rookie / Pro / Legend).
- **Run The Pools** — career ladder: pick a crew, beat the other seven in their home spheres. Rep,
  titles, records and Legend unlock persist in `localStorage`.
- **Watch** — CPU vs CPU exhibition.

## Architecture

```
src/
  core/        vec3, seeded RNG, event bus
  data/        constants (arena / rules / physics / tuning / difficulty), 8 crews × 6 swimmers
  game/        MatchSim (deterministic, headless, fixed 60 Hz), AI brains, career ladder
               subsystems: shooting, ball, rules, combat, passing, movement
  render/      three.js: sphere pool + goals + stadium, cel-shaded characters, FX, camera
  ui/          input (keyboard + gamepad), HUD, commentary, procedural audio, screens, save
  main.js      app shell: screens, match lifecycle, fixed-step loop
tests/         node:test suite (rules, determinism, bounds, mechanics coverage)
scripts/       headless simulation runner (balance / stall detection)
tools/         headless Chromium QA (screenshots, scripted playtest, screen walk)
```

The simulation has no DOM or three.js dependency; presentation, audio and commentary subscribe to
its event bus (`score`, `save`, `tackle`, `bighit`, `washed`, `block`, `gamebreaker`, …). The same
`setUserInput()` contract drives both the human and the CPU, so AI and player go through identical rules.

## QA

```bash
npm test                        # unit + simulation tests
npm run sim -- 24 pro           # 24 headless CPU matches; exits 1 if any match stalls
npm run qa:screens -- http://localhost:4173/ screenshots/screens   # walk every screen headlessly
npm run qa:play -- http://localhost:4173/ screenshots/prod         # scripted playtest to results
npm run qa:probe -- http://localhost:4173/                         # repeat matches: GPU contexts, heap, frame time
```

CI (`.github/workflows/ci.yml`) runs the tests, the simulation sweep and a production build.

## Original IP

All crews, swimmers, arenas, names and art are original to this project.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the professional-grade improvement plan — landed work with the
commits that closed it, plus what's next for gameplay depth, FX, robustness and releases.
