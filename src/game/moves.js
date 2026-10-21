/**
 * BLITZBALL X — signature moves.
 *
 * Every swimmer owns one move, carried on their roster entry as `move: '<key>'`. Holding the TRICK
 * input plays *your* swimmer's move, so switching players genuinely changes what the button does.
 *
 * Each move has a `kind` that decides how it physically plays out (what it beats, how the swimmer
 * travels), and a pair of timed STAT EDGES:
 *
 *   foe   applied to every defender the move actually beats (the stat drop lasts `secs`)
 *   self  applied to the swimmer when the move beats someone (a temporary boost)
 *
 * Stat edges shift `p.data` for a few seconds and then unwind exactly. They are copy-on-write: the
 * roster entry is never mutated, the swimmer's data is copied the first time an edge lands.
 *
 *   kind    what it does on contact
 *   wash    frontal spin, only beats a defender who is looking at you
 *   feint   plant and reverse; punishes the defender who committed
 *   armor   barrel-roll through contact, untackleable while rolling; shoves past
 *   vault   kick over the top; high = untackleable, passes clean
 *   climb   rising spiral, ends elevated for a plunging shot; no contact
 *   dash    long committed line, widest travel, biggest whiff cost
 *   low     dives under the tackle plane; low = untackleable, passes clean
 *   surge   heavy frontal slam, anyone ahead is knocked down
 *   cut     instant lateral release, no damage, frees a passing lane
 *   spear   straight power contest; win keeps momentum, lose staggers you
 *
 * `stat` scales the move (power 0.6 at a 40 to 1.15 at a 99), `commit` is the off-balance window
 * afterwards. `track` indexes the move's own pose track in `render/animtracks.js`, in MOVES order.
 */

export const MOVES = [
  {
    key: 'tempest', name: 'TEMPEST SPIN', voice: 'tempest spin', kind: 'wash', stat: 'hnd',
    dur: 0.42, dist: 1.7, turbo: false, commit: 0.16, track: 0,
    range: 1.9, cone: 1.15,
    foe: { stat: 'tkl', amt: 14, secs: 4 },
    self: { stat: 'hnd', amt: 6, secs: 3 },
    blurb: 'Spin the defender staring you down: they lose 14 TKL for 4s.',
  },
  {
    key: 'riptide', name: 'RIPTIDE ROLL', voice: 'riptide roll', kind: 'armor', stat: 'hnd',
    dur: 0.48, dist: 2.2, turbo: false, commit: 0.3, track: 1,
    range: 1.6,
    foe: { stat: 'spd', amt: 8, secs: 3 },
    self: { stat: 'spd', amt: 6, secs: 2 },
    blurb: 'Roll through contact, untackleable while spinning. Shoved men lose 8 SPD.',
  },
  {
    key: 'tidal', name: 'TIDAL KICK', voice: 'tidal kick', kind: 'vault', stat: 'spd',
    dur: 0.5, dist: 2.5, turbo: true, commit: 0.26, track: 2,
    range: 1.5,
    self: { stat: 'pow', amt: 8, secs: 3 },
    blurb: 'Kick up and over the challenge. Land with 8 POW for 3s.',
  },
  {
    key: 'spiral', name: 'DEEP SPIRAL', voice: 'deep spiral', kind: 'climb', stat: 'spd',
    dur: 0.55, dist: 2.0, turbo: true, commit: 0.22, track: 3,
    self: { stat: 'sht', amt: 10, secs: 4 },
    blurb: 'Spiral upward and drop a shot on them. Land with 10 SHT for 4s.',
  },
  {
    key: 'phantom', name: 'GHOST FEINT', voice: 'ghost feint', kind: 'feint', stat: 'hnd',
    dur: 0.46, dist: 1.9, turbo: false, commit: 0.24, track: 4,
    range: 1.8, cone: 1.5,
    foe: { stat: 'spd', amt: 12, secs: 3 },
    blurb: 'Plant, reverse and leave the committed defender behind. They lose 12 SPD for 3s.',
  },
  {
    key: 'current', name: 'UNDERCURRENT', voice: 'undercurrent', kind: 'dash', stat: 'spd',
    dur: 0.6, dist: 3.4, turbo: true, commit: 0.42, track: 5,
    range: 1.5,
    self: { stat: 'spd', amt: 10, secs: 2 },
    blurb: 'Long committed line. You cannot steer, but you come out with 10 SPD for 2s.',
  },
  {
    key: 'sinker', name: 'SINKER', voice: 'sinker', kind: 'low', stat: 'hnd',
    dur: 0.5, dist: 2.3, turbo: false, commit: 0.2, track: 6,
    self: { stat: 'hnd', amt: 8, secs: 3 },
    blurb: 'Sink below the tackle plane and slip under. Land with 8 HND for 3s.',
  },
  {
    key: 'tsunami', name: 'TSUNAMI SLAM', voice: 'tsunami slam', kind: 'surge', stat: 'pow',
    dur: 0.52, dist: 2.4, turbo: true, commit: 0.44, track: 7,
    range: 2.2, cone: 1.35,
    foe: { stat: 'tkl', amt: 12, secs: 5 },
    self: { stat: 'pow', amt: 6, secs: 3 },
    blurb: 'Slam forward and knock whoever is in front down. They lose 12 TKL for 5s.',
  },
  {
    key: 'shore', name: 'SHORE BREAK', voice: 'shore break', kind: 'cut', stat: 'hnd',
    dur: 0.34, dist: 1.6, turbo: false, commit: 0.12, track: 8,
    range: 1.5,
    foe: { stat: 'hnd', amt: 10, secs: 3 },
    blurb: 'Snap out of the tackle the instant it lands. The defender loses 10 HND for 3s.',
  },
  {
    key: 'harpoon', name: 'HARPOON', voice: 'harpoon', kind: 'spear', stat: 'pow',
    dur: 0.44, dist: 2.8, turbo: false, commit: 0.38, track: 9,
    range: 1.7, cone: 0.9,
    foe: { stat: 'spd', amt: 10, secs: 3 },
    self: { stat: 'pow', amt: 6, secs: 3 },
    blurb: 'Straight power run. Win it and keep going with 6 POW; lose it and you eat it.',
  },
];

const BY_KEY = new Map(MOVES.map((m) => [m.key, m]));

/**
 * The signature move a swimmer owns. Accepts either a live sim player (which wraps its roster entry
 * in `data`) or the roster entry itself, so the UI can look a move up straight off a card. Falls
 * back to the first move for any malformed entry.
 */
export function moveFor(player) {
  const key = player?.data?.move ?? player?.move;
  return (key && BY_KEY.get(key)) || MOVES[0];
}

/**
 * How well this swimmer performs their move: 0.60 at a 40 in the relevant stat, 1.15 at a 99.
 * Drives range, force and how long they are left off balance afterwards.
 */
export function movePower(move, player) {
  const s = Number.isFinite(player?.data?.[move.stat]) ? player.data[move.stat] : 60;
  return 0.6 + clamp01((s - 40) / 59) * 0.55;
}

/** Moves that make the swimmer untackleable while they play, by getting them out of the plane. */
export function isEvading(player) {
  if (player.moveArmor > 0) return true;
  // Over the top or under the challenge: a tackle that only reaches the playing plane misses.
  return player.y > 0.45 || player.y < -0.45;
}

/**
 * Apply a timed stat edge to a swimmer. `spec` is `{ stat, amt, secs }`; a negative `amt` is a
 * debuff. Copy-on-write so the roster entry is never mutated. Stacks, and each edge unwinds on
 * its own timer by exactly the amount it actually moved (ratings are clamped to 1..99).
 */
export function applyEdge(p, spec) {
  if (!spec || !p?.data || !Number.isFinite(p.data[spec.stat])) return;
  if (!p.edgeOwn) {
    p.data = { ...p.data };
    p.edgeOwn = true;
    p.edges = [];
  }
  const before = p.data[spec.stat];
  const after = clamp(before + spec.amt, 1, 99);
  const delta = after - before;
  if (delta === 0) return;
  p.data[spec.stat] = after;
  p.edges.push({ stat: spec.stat, delta, t: spec.secs });
}

/** Unwind expired stat edges. Called once per frame from the physics step. */
export function tickEdges(p, dt) {
  if (!p?.edges || p.edges.length === 0) return;
  for (let i = p.edges.length - 1; i >= 0; i--) {
    const e = p.edges[i];
    e.t -= dt;
    if (e.t > 0) continue;
    p.data[e.stat] = clamp(p.data[e.stat] - e.delta, 1, 99);
    p.edges.splice(i, 1);
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
