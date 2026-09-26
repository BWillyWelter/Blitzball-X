# BLITZBALL X — Road to Professional Grade

Working plan for gameplay, presentation, robustness and release quality. Checked items are
landed on `main` with the commit that closed them.

## 1. Gameplay feel

- [x] Touch controls in first-person mode: PASS / SWAP / CAM dead after the input `poll()`
      rewrite — one-shot edges clobbered. Fixed with regression coverage
      (`tools/touchtest.mjs`) added to CI (`7ea4da9`).
- [x] Ball cam toggle with wall-safe camera and lifecycle persistence (`bcb4749`).
- [x] Sim decomposition preserved behavior: deterministic-identical sim before/after every
      extraction (see §4), verified by the 21-test suite and headless sweeps.
- [x] Off-ball control depth: give-and-go on call-for-pass, cut-back reads, better support
      positioning against packed defenses. Pass-and-move now keeps both passer and receiver moving;
      support calls also flag the receiver and the return lane.
- [x] Kickoff variety: possession team's start position varies across seeded opening shapes
      (centre, wing-loaded, and staggered support lanes) instead of a fixed funnel both sides can
      predict.
- [x] Defensive AI marking tuning: closest-man pressure vs zone split by difficulty. The nearest
      defender presses, the remaining defenders rotate to the nearest live attacker, and rookie
      coverage sags toward the crease while Legend stays tighter on the man.
- [x] Touch pad rework: SHOOT is a giant anchor in the resting-thumb corner with PASS / the
      contextual action / TURBO ringing it on one thumb arc, so no core action needs a grid hunt.
      The expert row (HIT / JUMP / SWAP / GB / CAM) auto-swaps: each play state re-ranks it, lights
      the prime slots nearest the thumb and dims what the sim ignores right now (BREACH while
      carrying, GB off the dribble), and the contextual anchor gained an off-ball *support* state
      so it stops offering a trick to a player without the ball. Covered by `tools/touchtest.mjs`.

## 2. Graphics & FX

- [x] Fast perf spot-check tool (`tools/perfshot.mjs`) reporting frame time, draw calls and
      triangles, wired into CI (`2b81697`).
- [x] Bubble wakes on turbo and richer goal-shock FX: turbo swimmers now emit a shared particle
      wake, and goals layer a secondary pressure wave with a bubble curtain. Player-specific
      turbo ribbons remain a follow-up once their mobile cost is measured.
- [ ] Draw-call audit: merge/instance repeated arena props if the budget is hot on mobile.

## 3. Robustness & accessibility

- [ ] `webglcontextlost` recovery path (probe tool counts contexts; recovery is not wired).
- [x] Auto-pause on `visibilitychange` so tabbed-out matches don't burn the clock.
- [x] Touch UI: reduced-motion option, safe-area insets on notched phones.
- [x] Touch UI presets: right/left-handed pad (which mirrors the whole scheme, ring included) plus
      size and opacity sliders, all applied live — including mid-match from the pause menu.
- [x] Fixed: BACK in the in-match settings overlay also ran the screen's own back handler
      (`app.go('title')`), so tweaking settings mid-match threw the paused game away. The overlay
      now closes itself and returns to the pause menu.

## 4. Code health (MatchSim decomposition)

Monolith → modules, each extraction verified behavior-identical (tests + `npm run sim`):

- [x] Remove 749 lines of dead shadowed methods (`c8f8183`)
- [x] `shooting.js` — shots, volleys, Gamebreaker (`83e8f70`)
- [x] `ball.js` — flight, saves, blocks, pickups (`f308313`)
- [x] `rules.js` — flow, style meter, scoring, game state (`66de79f`)
- [x] `combat.js` + `passing.js` (`1e03e2c`)
- [x] `movement.js` — locomotion/turbo, glue dribble, separation, constraints (`5b7eb70`)
- [ ] AI brains out of `ai.js` into per-role modules if it keeps growing

## 5. Release hygiene

- [ ] Version bump + git tag per release; attach `dist/` artifact in CI.
- [ ] Lighthouse/Pagespeed pass on the built site (fonts, preload, first paint).
