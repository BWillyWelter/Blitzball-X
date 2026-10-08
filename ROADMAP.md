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
- [x] **Draw-call audit: 814 -> 697 per frame.** The arena was built from hundreds of small props
      that never move — a 40-building skyline plus ~230 lit windows, 16 boundary pylons, 8 energy
      lanes, 5 stand rings, 4 floodlight masts, the cradle arms — each one its own draw call, every
      frame, for a silhouette that never animates. `mergeStatic()`/`mergeInPlace()`
      (`src/render/materials.js`) bake a set of same-material meshes into one, and the arena now
      draws the identical skyline in 2 calls instead of ~270 (stadium 249 -> 15, machinery 66 -> 18,
      disc 18 -> 3). In the character rig the rule is stricter: parts merge only WITHIN one joint,
      never across two, or the baked transform would freeze the animation — so the torso's number
      decals and shoulder pads and each knee's sock+sole collapse, and the arms/legs stay articulated.
      The crowd was already 2 InstancedMeshes. `tools/mergecheck.mjs` (16 checks, in CI) asserts the
      bakes landed correctly — the failure mode here is a wrong origin moving props, not a crash, so
      it checks the merged skyline's world bounding box still spans the 95–125 m ring — plus that the
      rigs kept their joints and the budget holds.

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
- [x] **Deterministic seeds for the browser QA harnesses.** Normal play is clock-seeded so every
      match feels fresh, but that made the browser harnesses a lottery — a run could begin inside a
      kickoff reset where the controlled swimmer is legally frozen, and a check that passed locally
      would fail CI on an unlucky roll. That is exactly what broke the touch QA once already. A
      match seed can now be pinned (`startMatch({ …, seed })`, `?seed=123`, or `window.__BBX_SEED__`),
      and `tools/touchtest.mjs` takes `QA_SEED` so a sweep can re-run known-good seeds. Real players
      never set any of it.
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
- [x] **AI brains out of `ai.js` into per-role modules.** 607 lines had become six distinct brains
      sharing one file: playcalling, carrier, off-ball offense, defense, loose ball, keeper. `ai.js`
      is now just the input reset, the 0.25 s decision cadence and the routing; the decisions live in
      `ai-carrier.js`, `ai-offense.js`, `ai-defense.js`, `ai-loose.js`, `ai-keeper.js`, `ai-plays.js`,
      with the three shared primitives (`moveToward`, `nearestOpponentDist`, `shotLaneOpen`) in
      `ai-core.js`. Only `updateAI` is imported outside, so the seam was clean. Verified
      behavior-identical, not just test-green: `npm run sim -- 4 pro` (fixed seeds 1000..1003)
      produces a byte-identical scoreline, match length and event census against the pre-split code.
      That check earned its keep — the first extraction silently mistyped `diff.tackleRate` as
      `diff.tactleRate`, which read as `undefined`, zeroed every CPU dive tackle, and had the sim
      quietly playing a different sport (avg 378.6s -> 362.8s). Only the seeded diff caught it.

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

## 6. Phase 7 — lifelike physics & movement

The sport played correctly but moved like a diagram: swimmers vectoring on the spot, flat shots,
and a dead pool. This phase gives the sim mass, spin and water:

- [x] **Swimmer momentum and carving.** Locomotion is no longer a velocity-chase to the stick. The
      velocity vector swings toward the input at a capped angular rate (`MOVE.turnRate`, scaled by
      `spd`, body mass from `pow`, and travel speed), and a hard carve scrubs pace while eating the
      stroke — thrust fades as the cut sharpens, so speed lost in the turn has to be re-earned on
      the exit. Straight-line pace is untouched; what changed is that a 180 at speed is now a real
      commitment that travels an arc. Heavier bodies (`pow`) turn lazier and accelerate slower.
      The first pass had the scrub instantly cancelled by thrust (turns cost nothing — caught by
      the regression test), fixed by gating thrust through the carve.
- [x] **Struck spin: shots curl.** Every shot is hit with english. The lateral stick at release is
      the curve for the user (bend it round the keeper's dive), timing decides how clean it is, and
      CPU shooters carry natural curve off their shot rating so no flight is perfectly flat. The
      strike line is **pre-compensated** — the ball is released a little wide and the spin brings it
      back onto the aimed ring, like a free kick — so curl changes the *path* (beats a diving keeper
      from an angle) without silently moving the aim, and only a badly-timed strike's wobble bends
      off line for a genuine miss. Bends via Magnus-style lateral acceleration in `ball.js`
      (`PHYS.ballCurve`), a **CURLED FINISH** pays style in `rules.js`, and the ball mesh now rolls
      around its flight axis so the bend is visible on the ball itself.
- [x] **The pool has a current.** `MatchSim.currentAt()` is a deterministic gyre (pure function of
      sim time and position) that nudges anything drifting — mostly a loose ball — so a dead ball
      wanders instead of hanging exactly where it stopped, identically on every run of a seed.
- [x] Coverage: three new regressions in `tests/sim.test.mjs` (momentum reversal, spin bend,
      current drift + determinism). Verified: 67/67 tests, `npm run sim -- 4 pro` (seeds 1000..1003)
      plays clean at a new baseline avg of **347.5 s** (the old 378.6 s baseline is retired — the
      sport intentionally plays differently now), `npm run build` clean, and the browser harnesses
      (`qa:touch`, `qa:bench`, `qa:merge`) all green against the preview.

## 7. Phase 8 — moves that pay, professional shape, real contact, permanent pad

The play worked but the pieces didn't reward you: signature moves almost never beat anyone
(8 washes over 4 seeded matches), the CPU spammed alley-oop lobs as its metagame, contact flopped
bodies from a standing start, and the touch pad relabeled its skill button (JUKE → TACKLE →
JUMP → DIVE) under the player's thumb mid-play.

- [x] **Signature moves beat the defenders they TRAVEL into — and pay.** The contact sweep used
      to run once, at the moment of the input: a move that dove through a gap beat nobody. It now
      re-sweeps every frame of the move (`stepMove` in `combat.js`, driven from `movement.js`),
      with each defender beatable once per move. The payoff is real too: beating a man refunds
      turbo (`MOVE.moveTurboRefund`), drops the pool into a beat of slow-mo (`COMBAT.wowSlowmo`)
      so the moment lands, and leaves you clean — the commit stun is only 25% for a move that
      connected, full price for one you wasted. WASHED volume over 4 seeded matches: 8 → 44-65.
- [x] **Professional play, not lob-ball.** The alley-oop was a 60% roll any time a mate was near
      the ring — it was the metagame. It is now a set piece: the target must be cutting into open
      water near the ring, the lane must be clear, the passer must have time, and even then it is
      a 35% roll; the volley finish was pulled back from 0.95 to 0.82 quality. Result over 4
      seeded matches: 2 alley-oop volleys (a highlight again) against 1238 ground passes, with
      lead passes and build-up up. The midfield randomness went too: off-ball support swimmers no
      longer throw random big hits (hit attempts 91 → 30), and the CPU presser dives on odds, not
      on range.
- [x] **Contact with body behind it.** Momentum decides what a hit DOES: a standing swing
      staggers (`reel`), the same blow at charging pace knocks down (`fallen`) and earns the slow-mo
      (`COMBAT.hitMomentum*` + `hitFallenSeverity`). Body mass from `pow` scales the knockback and
      the recovery (`massOf`), so heavy swimmers don't fly and get up faster. The foul is judged on
      the blow itself (the angle), not the momentum. This pass also caught a real bug: the MatchSim
      `callFoul`/`isFoul` delegators silently dropped `victimWasDown`, so the documented "hitting a
      swimmer who is already down is always a whistle" never fired — fixed. Discipline over 4
      seeded matches: 7 fouls + a card, against 30 wilder hit attempts before.
- [x] **Permanent HUD buttons.** The touch pad no longer swaps its skill button between
      JUKE / TACKLE / JUMP / DIVE as possession flips. **SKILL** keeps one label and one edge all
      match — the sim routes the single `trick` edge by possession (signature move on the ball,
      poke-slide tackle off it, dive in the cage) — and the SHOOT anchor keeps its label, with the
      Gamebreaker reading as a glow instead of a rename. `tools/touchtest.mjs` now asserts
      permanence (same label + same edge across every state) instead of the old remapping.
- [x] Verified: 70/70 tests (3 new — travel-beat + payoff, momentum contact, alley-oop rarity),
      `npm run sim -- 4 pro` (seeds 1000..1003) balanced at avg **352.5 s** with lobs rare but
      present, fouls/cards live and hit-spam gone, `npm run build` clean, `qa:touch` fully green
      against the preview, `qa:bench` green (8/9 runs; the one failure never reproduced and the
      harness is not a CI gate).

## 8. Phase 9 — seeing what the game is doing

The gates from the previous pass protected the game from *breaking*; nothing helped understand it
while it ran. Perf numbers were means on a host that is not the player's phone, and balance work went
guess → edit constant → rebuild → play a few minutes → guess. This phase adds the two instruments
that make a change answerable in seconds, and uses the first one to close a question that had been
sitting open as "shader compiles must be causing that hitch".

- [x] **Frame-tail instrumentation (`src/dev/perf.js`).** A rolling window (240 frames) of frame
      intervals plus named sub-costs, reported as p50/p95/p99/max with an explicit hitch count
      (a frame ≥ 50 ms, i.e. three vsyncs). Recording is always on — one timestamp and one
      ring-buffer write per frame — so `window.__BB_PERF__.summary()` works on a real device without
      a flag; `?perf` adds the on-screen readout (units spelled out per line, orange once the tail
      is stuttering). The live path also samples the fixed-step block and the render submit, and
      reads the whole frame's GPU counters — three resets `renderer.info` on every `render()` call,
      so a naive read after `composer.render()` reports only the last pass (one full-screen quad).
      `tools/probe.mjs` now prints each round's tail and shader-program count, and `qa:perf` fails if
      the monitor is missing. Verified by `qa:devtools` in CI, and by hand: on this software-GL host a
      probe round is p50 ~17 ms with p99 ~230–390 ms, and the p99 is the match's first frame.
- [x] **The shader-compile hitch: measured, and deliberately NOT "fixed".** Every rendered frame of a
      match was instrumented to find first-use compiles. Result: the whole 31-program set compiles on
      the first rendered frame of a match, and the count never moves again — checked across goals,
      every FX burst, both goal replays, the halftime montage, and a forced substitution (a fresh
      CharacterView for the incoming swimmer). That first frame is expensive (~3.7 s on swiftshader,
      where each program is compiled on one core) but it lands behind the match intro: a 1.8 s tip
      card and the ~7 s warmup before the ball drops. So the obvious fix was tried and rejected on
      measurement: `renderer.compile(scene, camera)` warmed only 19 of the variants and the first real
      frame still compiled the rest, while `compileAsync()` covered the set but also built 19 unused
      variants and cost the same time up front (this host has no `KHR_parallel_shader_compile`, so
      none of it was parallel). The measurement and the decision are recorded in `renderer.js` so the
      next person does not re-open it.
- [x] **Live balance workbench — the tuning constants are now playable.** `?tune` opens a panel with
      every numeric dial in `src/data/constants.js` (188 today, discovered by walking the objects one
      level deep, so a new constant appears without anyone remembering to add it): a slider with
      bounds derived from the value, an exact-entry box beside it, a filter, a RESET, and a diff box
      that prints the changes as lines to paste straight back into the constants file. Edits apply to
      the match already in flight — `MatchSim.syncTuning()` re-reads `RULES` (the sim keeps a snapshotted
      copy; the other groups are read live from their modules), and timers already running keep their
      value until their next reset, which is what changing the shot clock mid-match should mean.
      `ARENA` is excluded on purpose: the pool's geometry, water and camera are built from it at match
      start, so editing it live would leave the arena disagreeing with its own physics. The panel is a
      separate 7 kB chunk, loaded only with the flag, and `tests/tuning.test.mjs` pins the plumbing
      (every dial resolves to a finite number, slider bounds always contain their value, the diff is
      exactly the file's format, and a live edit reaches a running sim).
- [x] **Balance report with a scoring audit (`npm run balance`).** The old `npm run sim` printed one
      line per game, which cannot answer the questions tuning actually asks. The report aggregates a
      slate: match length, goals and margin split (one-goal share, blowouts), overtime rate, the ring
      split in points (is the 3-point top ring worth the risk?), a per-crew win table, and per-match
      event rates for 28 event types. It also audits the scoring path: the goal log minus the
      gamebreaker steal ledger must equal the final score, the ring split must account for every
      logged goal, and every match must finish — those three are failures; the shape of the numbers
      never is. CI runs the same 24-game slate and uploads `balance-report.json`.
- [x] **What the first 24-game slate says** (seed base 1000, PRO, CPU vs CPU — a first read, not a
      verdict): matches 350 s mean (327–382) with 16.7% overtime; 9.5 goals/match, mean margin 3.7,
      12.5% one-goal games; 36 shots/match but only 16.6% of them scoring with 16 saves and 5.9 posts
      — shots are cheap and the keeper/posts take half of them; the top ring is 48 goals for 144
      points = **60% of all points**, against ~20% for each low ring, so the hardest window is also
      the default one; volleys (0.13/match) and alley-oops (0.13/match) are nearly extinct in CPU
      play; subs run 0.58/match, i.e. the bench is still a user-facing feature the AI does not use;
      the crew table spreads 66.7% (BTP/DCK/SSP/SYK) down to 0% (NSS 0-6, −21 goal difference) on this
      pairing rule. Each of those is now a question with a number attached instead of a hunch.
- [x] **The fontless-container crash, root-caused while wiring the tool gate.** `?tune` and the
      devtools harness kept killing the renderer mid-navigation on this host. The cause was not the
      page: a stripped container has no `/etc/fonts/fonts.conf`, and Chromium does not fall back — the
      first form control or styled text it must rasterise dies with
      `FATAL: SkFontMgr_FontConfigInterface.cpp Not implemented`, which puppeteer reports as a detached
      frame. `tools/lib/browser.mjs` now extracts the font set `@sparticuz/chromium` already ships and
      names its config, but only when the machine has no config of its own (a distro's fonts are the
      ones a screenshot should show). This retires a documented sandbox limitation: `qa:touch`, which
      used to stop at check 62 in the Freebuff sandbox, now runs to **all touch checks passed**.
- [x] Verified: `npm run lint` clean, **102/102 tests** (17 new: frame stats, tuning plumbing, balance
      aggregation + audit), `npm run build` clean (main 339 kB + three 542 kB + the 7 kB `?tune` chunk),
      perf budget PASS (662 draw calls / 140.5k triangles / 0.47 ms per sim step), `qa:probe` PASS
      (6/6 contexts released, frame tail + program count reported), `qa:merge` 16/16, `qa:touch` fully
      green, `qa:devtools` 8/8 (overlay mounts, panel mounts, a dial edit reaches a live match, RESET
      restores), and the 24-game balance slate reconciles with no problems.
