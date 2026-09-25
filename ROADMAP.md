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
- [ ] Off-ball control depth: give-and-go on call-for-pass, cut-back reads, better support
      positioning against packed defenses.
- [ ] Kickoff variety: possession team's start position varies (currently a fixed funnel both
      sides can predict).
- [ ] Defensive AI marking tuning: closest-man pressure vs zone split by difficulty.

## 2. Graphics & FX

- [x] Fast perf spot-check tool (`tools/perfshot.mjs`) reporting frame time, draw calls and
      triangles, wired into CI (`2b81697`).
- [ ] Bubble wakes on turbo, turbo trails, richer goal-shock FX (budget-checked against
      perfshot draw-call numbers).
- [ ] Draw-call audit: merge/instance repeated arena props if the budget is hot on mobile.

## 3. Robustness & accessibility

- [ ] `webglcontextlost` recovery path (probe tool counts contexts; recovery is not wired).
- [ ] Auto-pause on `visibilitychange` so tabbed-out matches don't burn the clock.
- [ ] Touch UI: reduced-motion option, safe-area insets on notched phones.

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
