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
      A five-button **expert row** (HIT / JUMP / SWAP / GB / CAM) used to sit above it, auto-swapping
      per play state and re-ranking itself; with the camera unified and the pad carrying the ball,
      it was more surface to hunt than depth it added, so it is **gone** and the pad is six buttons
      (four primary + RISE/DIVE, stick, pause). Gamebreaker now fires off the SHOOT anchor lighting
      up as "GAMEBREAKER", and the contextual anchor has an off-ball *support* state so it stops
      offering a trick to a player without the ball. Covered by `tools/touchtest.mjs`.
- [x] Fixed: a dropped ball was stranded. Loose balls sank under gravity to the pool floor (y=-1.7)
      while pickup only reached 1.1 above a swimmer's body centre, so once a hit/tackle knocked the
      ball loose nobody could ever grab it again. Loose balls are now buoyant (they drift back to
      the playing plane) and the grab reach extends downward, so a knocked-loose ball is always
      recoverable. Regression test in `tests/sim.test.mjs`.
- [x] Free-swim depth: RISE/DIVE (touch), R/F (keyboard) and the right stick (gamepad) steer the
      controlled swimmer up and down; with no input they are buoyant and ease back to the playing
      plane. Wired through `moveY` end-to-end (`input` → `entities` → `movement`). Covered by
      `tests/sim.test.mjs` and the touch harness.
- [x] Fixed: the on-screen joystick rendered in the wrong place. The ring was positioned with
      viewport coordinates inside the stick zone (its offset parent), so it drew a whole zone-height
      too low — usually off-screen. It now subtracts the zone origin and sits exactly under the
      thumb, asserted by `tools/touchtest.mjs`.
- [x] **Stamina, benches and substitutions.** The sim got a body meter behind the turbo button
      (`MOVE.stamina*`): sprinting, contact and repeated effort drain it, rest recovers it, and a
      gassed swimmer is slower with almost no turbo left. Both crews carry **4 substitutes** and
      **4 changes**. A sub swaps the slot in place (the replacement inherits the slot index, so
      formation and role never break) and the outgoing swimmer joins the bench. A stoppage opens a
      **substitution window** — goal, foul, turnover, halftime — and the bench panel shows water
      against wall with live stamina bars, so the change is a decision rather than a menu. CPU
      coaches make their own (`cpuCoach`). Covered by `tests/sim.test.mjs` and `tools/benchtest.mjs`.
- [x] **Discipline: fouls, bookings and red cards.** Swinging at a swimmer who is already down is
      always a whistle; a clean square big hit over the line is called some of the time, so
      aggression is a gamble rather than a certainty. The fouled side keeps the ball at the spot.
      Bookings accumulate, a second booking (or one outright ugly hit) is a **red**, and the
      swimmer is off for the match with the bench coming straight on at no cost to your changes.
      **Tackles are deliberately never whistled** — a dive tackle is the sport's legal answer to a
      carrier, and making it whistlable would make defending unplayable. The violence is the
      big-hit button, where the risk is visible and chosen. The player card escalates with the
      bookings (amber ring at one, flashing red pips and a struck-through name at a red) and the
      announcer calls every whistle, booking and send-off.
- [x] **Goal replay cinematic.** Every goal cuts to a broadcast replay: a 3.4 s ring buffer of poses
      recorded off the **sim** clock (a dropped frame thins the clip, it never stretches it) is
      frozen at the whistle and played back at 0.38x. The recorded pose is written onto the live
      entities, so the existing character rig and ball mesh animate the replay for free — no video,
      no re-simulation, no second scene graph, and no cleanup on exit. Poses are keyed by player id
      so a substitution mid-clip cannot swap a body between frames. Two scripted camera shots with
      a hard cut (a low tracking dolly, then a long lens from behind the cage), letterbox bars, a
      REPLAY flag, a caption naming the scorer and the window, a progress hairline, and skip on any
      key or tap. Reduced-motion users get a shortened, cut-free clip; the whole thing is off in
      Settings. `src/game/replay.js`, `src/ui/replay.js`, covered by `tests/sim.test.mjs` and
      `tools/benchtest.mjs`.
- [x] **Halftime montage and match recap.** The break used to be two minutes of dead air, so it now
      explains the half: the score, where each side's points came from (the top ring is worth triple,
      so the window split is the story), the top scorer, the discipline bill and the biggest hit of
      the half — auto-dismissing before the second-half kickoff. Full time gets a **shot chart**
      (a pip per goal in the order it happened, ring-weighted), the half-by-half split, the ring
      split, the biggest hit, the biggest run, and the discipline/bench bill. Both read the same
      `buildReport()` output, so they can never disagree with each other or with the box score
      below. `src/game/report.js`, `src/ui/montage.js`, `src/ui/recap.js`.

- [x] **Career that survives a bad week.** The ladder was a conveyor belt: every rung was the same
  auto-picked seven at the same venue. Now you **name the seven** from the twelve you manage (your
  created swimmer swims as a third shooter), and the sim reads a real lineup instead of assuming
  "first keeper, first two shooters, first four fielders" (`lineupOf()` — an illegal or half-written
  save degrades to the default seven instead of booting). **Venues alternate** by rung, so the crew
  is home on even stages and away on odd, and the fixture card and results line say which.
  **Injuries carry over**: the roll reads the match story the sim already recorded (the hardest hit
  landed on your crew, plus anyone whose contact count says they spent the night on the floor), costs
  one or two fixtures, heals gradually, and can never rule out your own swimmer. **Form swings the
  crew** a couple of rating points either way (SHAKEN → UNSTOPPABLE) and is shown on the career hub.
  A crew met twice is flagged as a **rivalry** with the running record on the ladder. Squad screen
  at `PICK THE SEVEN`, injuries on the hub strip, `rollInjuries`/`squadFor`/`fixtureFor` covered by
  `tests/sim.test.mjs` and `tools/benchtest.mjs`.
- [x] **Keeper switch and pass lead as skill expression.** The keeper was a wall you watched: the
      only defensive verbs lived on the other six swimmers, and the two goalmouth decisions in the
      sport — *should I take the cage?* and *where do I aim the pass?* — were both fixed costs.
      **Taking the cage** (V / L3, plus a GK button on the touch pad) hands control to your own
      keeper once the ball comes within 19 m of your goal, and the actions remap to a **dive**: a
      committed lateral lunge that extends the reach on the side you chose, is punished on the wrong
      side, costs stamina and locks out for a second. A dive is a commitment, not a block — and the
      CPU keeper dives too (`ai.js`), so leaving one alone in the cage is a decision with a price.
      **Passing became a lead.** The aim no longer points at a swimmer, it points at a *landing
      spot*: `passLanding()` solves the intercept with a fixed-point iteration over the receiver's
      live velocity, clamped inside the pool, so a pass held down the line finds the runner instead
      of trailing him. Grading is measured at the catch against the receiver's frame at release
      (not the passer's intent), so a **LEAD PASS** only pays when the receiver was genuinely running
      into space and the spot was genuinely open. The first tuning pass was a lesson: a fixed 0.28 s
      lead was shorter than real flight time, so 74% of catches scored a "lead pass" that actually
      landed *behind* the runner. Fixing the solve, freezing release state, and grading on outcome
      brought it to ~12% of catches at a stable sim average (363.8 s, 8 matches, +5% style with
      flowstart and scores unmoved). Player card, style popup, commentary, audio and the HUD
      dive-cooldown bar all read the same events. Covered by `tests/sim.test.mjs` (64) and
      `tools/benchtest.mjs`.

- [x] **Announcer voice, and four backing tracks instead of one.** The announcer had never had a
      voice: `voice` in `moves.js` is only the spoken-form *string* for a commentary line, and
      nothing ever spoke it — every "call" was text on a ticker. It now speaks through the Web
      Speech API, pitched and sped up as a poolside caster, ducking the music under each line and
      letting a goal cut off the previous call. The important part was not assuming an empty
      `getVoices()` means speech is dead: headless Chromium and Linux report **zero** voices and
      still speak through the engine default, so a missing voice falls back rather than silencing
      the announcer (verified: lines speak with an empty voice list). Music went from one four-bar
      loop to four tracks — BADDIES / DEEP END / DEAD WEIGHT / HYPERFLOW — each with its own tempo
      pocket, drum grid, key, bassline and swing, and AUTO picks a fresh one per match.
      `ANNOUNCER VOICE`, `ANNOUNCER VOLUME` and `MUSIC TRACK` in Settings; the ticker is unchanged
      so the lines survive when speech is unavailable.
- [x] **Fixed: the match went choppy part way through and never recovered.** The fixed-step loop
      ran at most 5 sim steps per rendered frame, but `dt` is clamped to 0.1s — six steps at
      1/60. So any frame slower than 100ms deposited backlog the loop could never drain, and each
      further slow frame added more: a textbook spiral of death. The sim fell permanently behind the
      wall clock, so the match crawled in slow motion and never got better, which is exactly the
      "fine for a while, then laggy" report. The leftover is now dropped so the sim falls back onto
      real time — the match clock is simulated anyway, so this only skips catch-up frames.
      Reproduced arithmetically (600 consecutive 100ms frames left a 10s backlog) and covered by
      the accumulator now peaking at one step.

## 2. Graphics & FX
- [x] Fast perf spot-check tool (`tools/perfshot.mjs`) reporting frame time, draw calls and
      triangles, wired into CI (`2b81697`).
- [x] Bubble wakes on turbo and richer goal-shock FX: turbo swimmers now emit a shared particle
      wake, and goals layer a secondary pressure wave with a bubble curtain. Player-specific
      turbo ribbons remain a follow-up once their mobile cost is measured.
- [ ] Draw-call audit: merge/instance repeated arena props if the budget is hot on mobile.

## 3. Robustness & accessibility

- [x] `webglcontextlost` recovery path (`ca6087d`). `webglcontextlost` is `preventDefault`ed so
      the browser will actually fire `webglcontextrestored`; the loss flags the renderer (making
      `render()` a no-op), pauses the match, suspends audio and shows a "SIGNAL LOST" popup, and the
      restore disposes and rebuilds the post chain before resuming with a reset frame clock so the
      first frame back can't swallow a huge `dt`. Covered by `tools/contexttest.mjs` (13 checks).
- [x] Auto-pause on `visibilitychange` so tabbed-out matches don't burn the clock.
- [x] Fixed: a finished match's delayed results transition could fire into the NEXT match. The
      3.2 s `setTimeout` in `finishMatch()` only checked "is there a match", so quitting to title
      and starting again inside that window let the stale timer dispose the new match and route to
      results mid-game (found by the touch harness's portrait check). `startMatch` and `endMatch`
      now cancel the pending timer.
- [x] Touch UI: reduced-motion option, safe-area insets on notched phones.
- [x] Touch UI presets: right/left-handed pad (which mirrors the whole scheme, ring included) plus
      size and opacity sliders, all applied live — including mid-match from the pause menu.
- [x] Camera: the multi-mode rig (broadcast / first-person / player-chase / ball-cam) is gone in
      favour of a single **Rematch-style shoulder cam** — a low tight boom behind the controlled
      swimmer, off-axis so you see past them, yaw following their heading and easing back to the
      attack direction when idle, a soft ball-forward look bias (never a hard lock, which was ball
      cam), FLOW widening the FOV, and a boom trimmed against the sphere so the lens can never clip
      the wall. The touch pad lost its expert row at the same time: six buttons, one thumb arc,
      and Gamebreaker now fires off the SHOOT anchor lighting up.
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

- [x] Version bump + git tag per release; attach `dist/` artifact in CI. `ci.yml` has uploaded the
      built `dist/` as `blitzball-x-dist` on every push since it was written, so only the release
      half was missing: `.github/workflows/release.yml` now fires on a `v*` tag, refuses to
      publish if the tag disagrees with `package.json` (so the two can't drift), re-runs the test
      suite, the balance sweep and a production build, fails if `dist/index.html` is missing, and
      attaches a `dist` tarball to a generated GitHub Release. First tag: `v1.1.0`.
- [x] Lighthouse/Pagespeed pass on the built site (fonts, preload, first paint). `npm run
      qa:lighthouse` (`tools/lighthouse.mjs`) serves `dist/` and audits it with mobile emulation,
      printing category scores and the audits that cost points; a CI job publishes the full HTML
      report as an artifact. The audit found the real first-paint gap: `index.html` shipped zero
      paintable markup, so on a cold 3G-ish load nothing contentful could appear until the whole
      770 kB bundle executed — fixed with a critical inline boot splash (system fonts, no web-font
      dependency) that `App.go()` and the anim bench remove once real UI mounts. Note: the
      Freebuff sandbox has no system fonts, so no glyph can rasterize and FCP can never fire —
      the tool reports INCONCLUSIVE (exit 2) there instead of a fake zero, and the scored audit
      runs in CI where Chrome and fonts exist. The first scored CI run (a11y 74) drove two real
      fixes: text-bearing pink surfaces moved to a darker `--pink-deep` (6.45:1 vs 3.39:1, WCAG AA
      pass) and the a11y-hostile `user-scalable=no` left the viewport meta — pinch-zoom during
      play is still blocked by `touch-action: none` on the pad.
