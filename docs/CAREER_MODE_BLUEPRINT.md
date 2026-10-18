# First-Person Single-Player Career: architecture and reference implementation

## 1. Scope and release status

**Deliverable:** an isolated, strict TypeScript headless reference core in `src/career-mode/`,
not a replacement of the existing browser game. Classes implement domain operations; plain typed
interfaces carry players, teams, items, injuries, matches and save snapshots. Engine-facing code uses
explicit ports and mock console adapters. No hosted services, accounts or API keys are required.

The player begins aged 29 as a **Mature Amateur free agent**, not the manager of an entire club.
They navigate offers, sign a roster slot, earn XP for their own actions, manage recovery and build
reputation. Five original rival clubs plus a potential home club form a six-team league. Rank
thresholds are illustrative tuning: Professional requires a contract and reputation 10, Veteran
level 15/reputation 40, All-Star level 30/reputation 75. Age is narrative data; no invented aging
penalty is imposed.

**Not a production-complete playable mode.** The core is a production-oriented foundation with
strict type checks, input guards, bounded ledgers, seeded math and automated integration tests.
Full teammate/opponent tactical AI, first-person meshes/shaders/audio/input UX, medical balancing,
season resets, release migration tools and an atomic durable storage adapter remain integration
work. The repository's newer root game has independent existing build/module/lockfile problems;
this package deliberately does not inherit or hide them.

### Requirements not supplied in the conversation

Three equations were truncated: match XP level decay, market valuation, and injury sigmoid inputs/
thresholds. The code **requires a `CareerPolicies` object**; it does not silently choose those rules.
`ExamplePolicies` is labeled `EXAMPLE-UNCONFIRMED-v1` and is used only in the runnable demo. Replace
it with approved, versioned production policies before balancing or shipping.

Other explicit interpretations requiring product approval:

* `100 * Level^1.5` means **cumulative total XP threshold to leave the current level**, not a cost
  deducted at each level. Levels are capped at 100; stats capped at 99; leftover attribute points
  remain available. All-Star is reputation + level, not automatically granted for grinding XP alone.
* `Log` means natural log (`Math.log`). Recovery may be fractional; display `ceil(remainingMatches)`.
* Poison reduces **maximum stamina** using a fraction of base maximum HP each periodic tick, then
  clamps current HP. It does not merely damage current HP. Lost max stamina resets after the match;
  status expiry alone does not restore it. Wither refreshes duration rather than stacking halves.
* Example injuries use a 15% minor stat penalty; severe injuries prohibit participation. Example
  severity selection uses impact >= 0.8 and a 35% conditional severe draw. Neither probability was
  specified by the user; both belong in a shipped tuning configuration.
* Contracts count the club's scheduled fixtures, including those the injured user misses—not every
  match played anywhere in the league. Therapy spends actual currency and a calendar off-day.
* Injury status modifier is **0.5 if poisoned OR withered**, never 1.0 when both; otherwise 0.

## 2. Run and artifacts

The isolated lockfile pins TypeScript and Node types; runtime modules have **zero external runtime
dependencies**. Node 22+ runs compiled output; an ES2022 browser/game-engine host can use the built
modules through an adapter.

```bash
npm ci --prefix src/career-mode
npm run --prefix src/career-mode typecheck
npm run --prefix src/career-mode test
npm run --prefix src/career-mode demo
```

`tsconfig.json` enables strict typing, unchecked-index guards, exact optional properties and unused
checks. Compilation emits JS/declarations to ignored `src/career-mode/.build/`. The public entry
point is `index.ts`. Tests use the existing project's Node test runner convention, rather than
adding another testing framework. The demo uses the actual fixed-step runtime for a short shot,
full-time settlement, rival simulation and save/reload, with clearly stated boosted practice stats.

```
src/career-mode/
  models.ts               # JSON-only contracts; no renderer objects or mutable engines
  math.ts                 # guarded vector/quaternion math and serializable seeded RNG
  policies.ts             # required missing-formula interfaces; labeled example formulas
  physics.ts              # sphere containment, water drag, 3-axis body pose, first-person FOV
  encounters.ts           # debounced proximity gate, breakthrough, exponential pass/shot contest
  progression.ts          # action ledger, outcome XP, cumulative levels, point distribution
  statuses.ts             # poison/wither/sleep lifecycle and effective-stat view
  skills.ts               # skill catalog and targeted, timed Techcopy
  injuries.ts             # collision risk policy, injury classes, fixture recovery, therapy
  league.ts               # 5 rivals + home, round-robin, standings, rivals, bids and expirations
  ecosystem.ts            # agent contracts, dialogue chemistry and calendar
  runtime.ts              # first-person match domain loop + command/event slice
  session.ts              # calendar commands and match/off-field orchestration
  persistence.ts          # versioned bounded save validation + storage port
  adapters/ports.ts       # rendering/input/logging ports; explicit mock implementations
  tests/core.test.ts      # formula, invariants and integration cases
  demo.ts                 # executable headless scenario
```

## 3. Ownership, boundaries and execution model

```
Input adapter -> validated tick commands -> CareerMatchRuntime -> immutable event consumers
                           |                     |          |
                           |               physics/status   encounter/flight/Techcopy
                           |                     |
                           +---------- full time + ledger --------> CareerSession
                                                                    |
                                             calendar/contracts/market/chemistry/rivalry
                                                                    |
                                        validated CareerSave -> serialized SavePort commit

Renderer <- pose / underwater FX / geometric FOV / occlusion raycast (presentation only)
```

**Data ownership:** `CareerSession` owns the canonical career roster and economic state. During a
match, `CareerMatchRuntime` owns body poses, HP/effects, ball flight, event order and its match score.
The runtime reads effective career stats through injuries then Wither; it does not write temporary
penalties back to base attributes. Scores and XP must come from authoritative resolved action
events. A menu click is a command, never a successful action or a reward by itself.

**Simulation time:** 60 Hz fixed steps; input is sampled into tick-stamped commands. The proximity
state machine returns time scale 0 (pause) or an optional slow scale. To slow down, the adapter
reduces tick scheduling; it must not feed variable delta into the sim. Cooldowns, effects and
Techcopy windows use simulation ticks/seconds; UI timers may use wall time but never decide a hit.
Off-field calendar time is separate from match time. Pause never advances contracts or recovery.

**RNG:** seeded `SeededRandom` for encounters/ball accuracy, a separate seeded stream for injuries,
and a session economy stream whose state is saved. Ordered defender IDs and bid tie breakers keep
runs repeatable in the same JS runtime. RNG state restoration is tested. Cross-engine/floating-
point bit identity requires a fixed-point implementation or recorded random draws; do not claim
JS doubles provide cross-platform network lockstep by themselves.

**Presentation:** consume events for sounds, commentary, injury prompts and media; never mutate
simulation through animation callbacks. Use the logger/mock renderer until the engine adapter is
available. A future background match port should play the same encounter rules. The included
league background scorer is a seeded, explicitly simplified aggregate model, not full tactical AI.

## 4. Water sphere and first-person orientation

`Body` contains position, velocity, normalized quaternion and collision radius. Local camera/body
forward is **-Z**. Pitch rotates around X, yaw around Y, roll around Z. Quaternion composition and
normalization avoid accumulated Euler drift and gimbal lock during true 3D navigation.

For acceleration `a`, water drag `λ` and fixed step `dt`:

```
v_next = v * exp(-λ dt) + a * (1 - exp(-λ dt)) / λ
```

The zero-drag limit is `v + a*dt`. Thrust magnitude and maximum speed are bounded. If the body exits
`SphereRadius - BodyRadius`, project position onto that sphere and remove the outward normal
velocity component, preserving tangential movement. Sleeping/unavailable bodies cannot translate
or rotate through the physics step. This handles the arena boundary, **not full swimmer/swimmer
contact physics**; integrate swept capsules/continuous collision detection in the engine and pass
resolved collision events to injury/tackle logic.

`FirstPersonCamera.targets()` transforms targets into camera space using the quaternion inverse,
then computes perspective-normalized horizontal/vertical coordinates, depth and frustum membership.
Horizontal FOV and aspect determine vertical FOV. Behind-camera, too-near, too-far and out-of-frustum
targets are excluded. Teams are labeled without revealing occluded entities. The engine MUST
raycast for obstruction with `isOccluded`; geometric FOV alone is not line of sight.

Underwater visibility follows Beer–Lambert attenuation `exp(-absorption*distance)` with a hard
sight-distance cutoff; peripheral blur scales with swim speed. The render adapter should keep the
central reticle/ball clear, mask blur toward the periphery, and honor a reduced-motion toggle that
removes blur/roll effects without changing physics. Tint and shader parameters are passed through a
port—no claim is made that a console log implements a water shader.

## 5. Encounters and water-ball math

Proximity uses an entry radius 3.5 m and exit radius 4.5 m. Entry latches once, freezes/slow-controls
simulation, and collects defenders in a stable order. Resolution resumes movement; another encounter
cannot retrigger until opponents leave the larger boundary. This prevents every-frame menu spam.

For each selected defender, use exactly:

```
v ~ Uniform(0.5, 1.5)
END_remaining = END_current - ATK_defender * v
turnover if END_remaining <= 0
```

No implicit integer flooring changes this formula. All defenders' stats are validated before RNG
consumption. Equality loses possession. The first winning defender receives the ball; subsequent
battles stop. Tackle XP is granted only when the user actually wins possession.

For PAS/SHT along **accumulated trajectory length**, not merely straight-line target separation:

```
Stat_Current = Stat_Initial * exp(-k * d)
DefendingStat = BLK_or_CAT * Uniform(0.5, 1.5)
success iff Stat_Current > DefendingStat
```

Equality is defended. Incremental decay composes across path segments. Intercepts use a swept ball
segment against blocker reach to avoid tunneling at high speed. A blocker is tested once per flight,
not rewarded repeatedly on successive frames. A pass receipt wakes Sleep and gives +2 XP to its
passer, not its receiver. A successful shot updates team score and user goal XP from one event.
Runtime uses demonstration `k=0.08` and flight speed 20 m/s; production should configure these by
ruleset and skill, plus keeper positioning/dive mechanics. The sample flight destination is fixed
on launch; moving receiver lead targeting and richer ricochets remain match-adapter work.

## 6. Progression and action ledger

| Confirmed successful user action | XP |
|---|---:|
| Pass | 2 |
| Tackle or Block | 4 |
| Goal | 10 |
| Techcopy | 15 |

`AwardXP(eventId, action, actorId)` rejects settled ledgers, ignores non-user actors, and deduplicates
authoritative event IDs. Actions are bounded to 10,000 per fixture. `settle` pays once; the ledger
and settlement flag persist, so reload cannot replay full-time rewards.

The supplied outcome multipliers are Win **1.5**, Draw **1.0**, Loss **0.7**. The missing level decay
is injected, so the implemented composition is:

```
MatchXP = floor(ActionXP * OutcomeMultiplier * policies.levelXPFactor(Level))
```

The example—not confirmed—factor is `1/(1+0.05*(Level-1))`. Calculation uses the level at match end,
then grants XP and checks multiple cumulative thresholds:

```
XP_Required(Level) = 100 * Level^1.5
Level += 1; AttributePoints += 3   # for every crossed threshold
```

Attribute allocations verify a positive integer, sufficient points and stat cap 99. No money,
reputation, endorsements or NPC match results directly create action XP. Rank/reputation tuning
and training progression need anti-farming balance before release.

## 7. Techcopy and statuses

`SkillExecution` records execution identity, opponent ID, skill ID and a bounded opening/closing
simulation-tick interval. An observed move must be enemy-owned, specifically targeted, geometrically
in FOV (plus engine occlusion validation), copyable and level-eligible. A copy button pressed inside
the inclusive interval while still targeting that opponent learns the skill once and awards +15 XP.
No permanent skill unlock is emitted for a late, obscured, teammate or already learned execution.

The illustrative catalog uses original move names. `resolveSkillHit` validates learned skill,
minimum level, stamina, opposing target, proximity and cooldown, consumes stamina and applies the
status only after an authoritative hit resolution. It emits a Techcopy execution window. The
method is a **trusted integration hook**, not evidence that the core has a full special-move
animation/targeting/hitbox system.

* **Poison:** active/expired, periodic base-max-HP drain; partition-independent tick accounting
  prevents a large timestep applying ticks after effect expiry. Max stamina minimum 1.
* **Wither:** active/expired, named PHY/PAS/SHT halves; compute an effective view, never overwrite
  the permanent attributes. Reapplication refreshes the status, avoiding multiplicative stacking.
* **Sleep:** asleep/awake; disable movement/actions until pass receipt, opposing hit, or duration
  expiry. Friendly incidental contacts do not wake it. Reset all match statuses at final whistle.

## 8. Living league, contracts and rivalry

Original rivals: **Tidebreak Union** (balanced), **Neon Barracudas** (aggressive), **Alloy Depths**
(technical), **Glade Runners** (speed), **Basalt Titans** (physical). **Harbor Mariners** is a
potential home club, not a guaranteed forced signing. User may accept any club offer; runtime
uses contract/team IDs, not a hard-coded protagonist club.

Roster players all own a contract duration in matches. Six starters and capacity seven permit a
bench/free-agent signing. The circle algorithm produces five unique pairings per club then reverses
venues for a ten-round double round robin. Seeded background matches update standings, results,
seasonal player performance, compensation and fixture-specific contract expiry. Fixture IDs and
recorded history prevent duplicate result submission. Missing free-agent user fixtures are allowed;
severe-injury absences are explicitly simulated without user participation XP.

Market value is a required `policies.marketValue(player, demand)` function. The example is:

```
MV = BaseMV * clamp(1 + 0.25*Demand + 0.50*SeasonalPerformance, 0.5, 2.0)
Demand, SeasonalPerformance in [-1, 1]
```

NPC clubs bid on every eligible free agent using that value, deterministic variance, roster capacity
and remaining budget. Sort by highest salary and stable team ID. The winning bid signs the player,
reserves guaranteed salary for the full duration and removes them from the pool. Issued quotes are
tracked; altered/unissued or stale bids cannot be accepted. NPC signing does not auto-accept the
user's offers. Expiry releases roster membership and recomputes market value using demand/form.

The current NPC decision model is deliberately simple: every vacancy can bid and the highest
salary wins. Production should add role minimums (especially a keeper), injury forecasts, squad
fit, renewals, reservation wages, release clauses, budget replenishment, inflation index limits and
season reset. Exhausted teams must not silently obtain free salary. A maximum budget/roster size
and ledger reconciliation should be part of multi-season balance gates.

`RivalryTracker` stores symmetric team pairs and capped history, counting close games and bounded
intensity. Three meetings and intensity >=24 activate a derby. Aggression increases proportionally,
clamped at 1; media pressure exposes intensity. `runtime.tactics(teamId)` combines derby aggression
with chemistry response latency for the AI adapter. Media/audio/UI read this context rather than
changing player input. The history retains the last 100 match details while total counters survive.

## 9. Off-field calendar and agents

Weekly loop: training → travel → match → recovery → negotiation → recovery → training. The initial
user is a mature-amateur free agent; first negotiation window follows week one's background league
matches. A match day cannot advance while an employed user's fixture remains unresolved. Medical
absence uses explicit simulation instead of trapping the career forever on a match day.

* **Training/travel:** structural calendar slots with mock logging. Implement skill drills,
  rest/fatigue and travel events as commands at these boundaries, not timers in the renderer.
* **Negotiation:** hire Local/Regional/Elite agents with rising fees and quoted salary multipliers,
  endorsement eligibility and goal/win bonuses. Club capacity and guaranteed budget are checked
  before atomically allocating a contract. Example bonuses pay only from available club budget;
  guarantees are reserved at signing. Before shipping, choose guaranteed bonus liability reserves
  or explicit capped-bonus contract terms rather than falsely promising an unlimited bonus.
* **Chemistry:** 0–100; outcomes/contribution and credit/responsibility/blame choices change it.
  Passing accuracy scales from 0.7 to 1.0; teammate response delay from 1.2 to 0.4 s. Choices have
  event IDs so rapid/repeated input doesn't farm chemistry. Engine dialog prompts must whitelist
  available choices, and issue one choice ID per prompt (the headless service cannot authenticate
  arbitrary UI-created IDs).
* **Recovery:** only one available recovery day may be spent per calendar day. Spent-day and
  dialogue state are included in saves so reloading cannot buy another off-day.

## 10. Injuries and therapy

The missing sigmoid is provided by `policies.injuryProbability` with inputs impact/fatigue [0,1],
PHY and `Status_Modifier ∈ {0, 0.5}`. The example, explicitly **not confirmed**, is:

```
z = 4*Impact + 2*Fatigue - PHY/25 - 4 + Status_Modifier
P_injury = 0.30 * sigmoid(z)
sigmoid(z) = 1/(1 + exp(-z))
```

Stable positive/negative branches avoid overflow. A collision identity may be processed only once
per injury-system instance. A risk draw happens on high-impact event resolution, never per-render
frame. Production collision events should include mass, relative velocity/impulse, tackle legality
and equipment; choose unit normalization before approving the coefficients.

Minor strains/bruises reduce named stats for **1–2 club fixtures**; severe fractures/tears prevent
selection for **4–8**. Missing a fixture still consumes a recovery fixture. An injury acquired during
a match records `acquiredFixtureId` and starts its countdown AFTER that match; settlement skips
new injuries from the current fixture. This explicit interpretation avoids an injury advertised as
one match expiring immediately at the whistle of the collision match.

Therapy follows exactly:

```
R_new = clamp(R_current - ln(C + 1) * D, 0, R_current)
```

Zero currency or zero days do not charge money or shorten recovery. Negative/non-finite amounts and
insufficient funds reject. The domain formula accepts nonnegative fractional values; the session
restricts the calendar spend to one actual off-day. Formula is highly generous for large C; limit
available funds/off-days, or approve a coefficient/cap explicitly—do not secretly alter the formula.
Display ceilings without rounding persisted progress, to avoid losing purchased fractions.

## 11. Save boundaries, schemas and replay plan

`CareerSave` version 1 holds policy version, economy RNG state, user ID, day/off-day/dialogue state,
players/rosters/contracts/injuries, fixture/rivalry history and XP settlement ledgers. Schema decoder
validates identities/references, capacity, ranges, enum fields and duplicate entries. Size cap:
**2 MB**. Maximum stored players 500, match records 30,000, ledger entries 10,000. Canonical career
values are JSON numbers, never pointers to a scene/THREE objects.

`SavePort` abstracts storage. `MemorySavePort` is demo-only. `SerializedSaveWriter` preserves commit
order, rejects failed calls and lets subsequent saves retry; it is **not durable persistence**.
Production browser adapter: IndexedDB transaction with revision and backup snapshot. Native adapter:
temporary file + fsync + atomic rename + previous-version backup. Keep schema migrations explicit;
policy version mismatch rejects restore rather than silently rebalancing existing careers.

Career snapshots currently save **between matches only**. They do not contain full in-flight match
poses/status/copy cooldowns. Mid-match resume requires a separate `MatchSnapshot` containing:

```
fixture ID + match seed + tick + independent RNG states
body poses/velocity/quaternions, injuries acquired this fixture
holder/flight path + tested blocker IDs + pass accuracy draw
stamina/effects/accumulators, encounter latch/resolution, skill cooldowns
Techcopy observed/consumed executions, action sequence + XP ledger
```

Replay input schema should be versioned `{tick, commandId, actorId, kind, payload}`, ordered, bounded,
and recorded by the match adapter. Fix timestep/rules/catalog/policy versions and reject unknown
commands, impossible actor IDs, out-of-range values or trailing events. Local career JSON is
user-editable; it is not an anti-cheat boundary. If online leaderboards are added later, replay
validation and identity belong on a server with real authentication, not client `x-user-id` headers.
That service is outside this single-player implementation.

## 12. Engine integration sequence

1. Approve missing formulas and interpretations; implement a versioned `CareerPolicies` ruleset.
2. Construct one `CareerSession`; load only through `CareerSaveCodec`. Start on the calendar screen.
3. During negotiation expose actual offers and run NPC bidding; don't give the user manager powers.
4. On the user's match day create `CareerMatchRuntime` with a match-only seed. It rejects an absent/
   medically unavailable user. Derive team/match from the fixture and contract, not view parameters.
5. Poll an `InputPort`, put commands onto fixed ticks; call `step()` at 60 Hz. Gate menus and slow-mo
   use returned time scale. Route chosen breakthrough/pass/shot/tackle to the domain commands.
6. Feed `body` to the first-person camera. Apply camera-space FOV + engine occlusion; render only
   visible labels and readable contextual actions, not a permanent wall of buttons.
7. Supply teammate/opponent steering via a tactical AI port. Read `runtime.tactics` for response
   latency, aggression and derby pressure; add role positioning and roster legality before release.
8. Call `resolveSkillHit` only from resolved trusted hit logic; observe returned execution in
   Techcopy with validated enemy identity, FOV and timing. Port particles/audio independently.
9. Finish only at the final whistle. `finish()` settles score, action XP, levels, chemistry, contracts
   and history through the session. Advance calendar to simulate remaining league fixtures.
10. Commit a validated immutable career snapshot through durable `SavePort`. Do not interleave
    writable scene objects with a serialized snapshot or mark a failed storage operation successful.

## 13. Production hardening and acceptance gates

Before calling a complete game production-ready:

* Confirm policy coefficients, natural-log units, XP threshold interpretation and injury onset.
* Replace aggregate background scoring with a bounded deterministic AI simulation or approved
  statistical model; compare outcome distributions and measure multi-season economy inflation.
* Add domain transaction rollback/copy-on-write for multi-field commands. Example policies are
  assumed pure; production must avoid arbitrary policy callbacks throwing after partial mutation.
* Ensure legal squads persist after expiry/renewal; reserve keepers and minimum starter count.
* Confirm fixture injury onset behavior; add season archival/reset, limited agent/bonus liabilities,
  regeneration/fatigue, medical clearance and training progression.
* Bound event consumers and history; persist revisions and detect corrupted/unsupported migrations.
  Current history/save caps fail explicitly rather than silently evicting needed ledger state.
* Use a fixed-step input/replay journal with authoritative event IDs; whitelist dialogue/medical
  commands to prevent arbitrary ID farming, even if local single-player editing is not a security issue.
* Complete sphere contact CCD, occlusion and ball/keeper moving-target mechanics.
* Test renderer loss/recovery, browser focus/visibility pause, controller mappings, mobile safe
  areas, stereo/VR if used, motion sickness/accessibility and graphics fallbacks.
* Gates: strict typecheck, subsystem tests, save migration/fuzz tests, multi-match/seasons soak,
  two same-seed replay equality checks, and an actual user-interface playthrough of sign→fixture→
  injury→absence→therapy→expiry→renewal→All-Star. Measure correctness and time/memory on representative
  fixtures; do not assume a passing build is a playtest or report speedups without measurements.

The included tests verify formula values, XP event idempotency, deterministic RNG restoration,
physics bounds, FOV rejection, status partitioning, Techcopy timing, seeded market transactions,
calendar sequencing, rivalry pressure, medical absence, save validation, repeated therapy protection
and a shot-to-career XP settlement. **No actual engine/browser first-person rendering is claimed
verified by these headless tests.**
