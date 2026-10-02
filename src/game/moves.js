/**
 * BLITZBALL X — signature moves.
 *
 * Every swimmer owns one move, carried on their roster entry as `move: '<key>'`. Holding the TRICK
 * input plays *your* swimmer's move, so switching players genuinely changes what the button does.
 *
 * The old system picked one of six defs at random from a pool filtered only by "do we have turbo",
 * which made SPIN / BARREL ROLL / CORKSCREW / BACK-FLIP / JET STREAM / DOLPHIN KICK the same move
 * with six sets of numbers. Each entry here is a distinct *mechanic* — `kind` decides what the move
 * actually does to the defender it is used on, and how the swimmer travels while it plays:
 *
 *   wash    frontal spin, only beats a defender who is looking at you   -> stumble
 *   feint   plant and reverse; punishes the defender who committed     -> stumble
 *   armor   barrel-rolls through contact, untackleable while rolling   -> shoves past
 *   vault   vertical kick, goes over the top; high = untackleable       -> passes clean
 *   climb   rising spiral, ends elevated for a plunging shot          -> no contact
 *   dash    long committed straight line, widest travel, biggest whiff cost
 *   low     dives under the tackle plane; low = untackleable           -> passes clean
 *   surge   heavy frontal slam, knocks anyone ahead down               -> fallen
 *   cut     instant lateral release, no damage, frees a passing lane   -> nudge
 *   spear   straight power contest; win keeps momentum, lose staggers you
 *
 * `stat` is the attribute that scales the move (power 0.6 at a 40 to 1.15 at a 99), `commit` is the
 * off-balance window the move leaves the swimmer in afterwards — committing is always a gamble.
 * `track` indexes the move's own dedicated pose track in `render/animtracks.js` — ten moves,
 * ten tracks, in MOVES order.
 */

export const MOVES = [
  {
    key: 'spin', name: 'SPIN', voice: 'spin', kind: 'wash', stat: 'hnd',
    dur: 0.42, dist: 1.7, turbo: false, commit: 0.16, track: 0,
    range: 1.9, cone: 1.15,
    blurb: 'Spin the defender staring you down.',
  },
  {
    key: 'roll', name: 'BARREL ROLL', voice: 'barrel roll', kind: 'armor', stat: 'hnd',
    dur: 0.48, dist: 2.2, turbo: false, commit: 0.3, track: 1,
    range: 1.6,
    blurb: 'Roll through contact — untackleable while you spin.',
  },
  {
    key: 'vault', name: 'DOLPHIN KICK', voice: 'dolphin kick', kind: 'vault', stat: 'spd',
    dur: 0.5, dist: 2.5, turbo: true, commit: 0.26, track: 2,
    range: 1.5,
    blurb: 'Kick up and over the challenge.',
  },
  {
    key: 'climb', name: 'CORKSCREW', voice: 'corkscrew', kind: 'climb', stat: 'spd',
    dur: 0.55, dist: 2.0, turbo: true, commit: 0.22, track: 3,
    blurb: 'Spiral upward and drop a shot on them.',
  },
  {
    key: 'feint', name: 'BACK-FLIP FEINT', voice: 'back-flip feint', kind: 'feint', stat: 'hnd',
    dur: 0.46, dist: 1.9, turbo: false, commit: 0.24, track: 4,
    range: 1.8, cone: 1.5,
    blurb: 'Plant, reverse, and leave the committer behind.',
  },
  {
    key: 'dash', name: 'JET STREAM', voice: 'jet stream', kind: 'dash', stat: 'spd',
    dur: 0.6, dist: 3.4, turbo: true, commit: 0.42, track: 5,
    range: 1.5,
    blurb: 'Long committed line. You cannot steer, and you land late.',
  },
  {
    key: 'undertow', name: 'UNDERTOW', voice: 'undertow', kind: 'low', stat: 'hnd',
    dur: 0.5, dist: 2.3, turbo: false, commit: 0.2, track: 6,
    blurb: 'Sink below the tackle plane and slip under.',
  },
  {
    key: 'surge', name: 'WAVE CREST', voice: 'wave crest', kind: 'surge', stat: 'pow',
    dur: 0.52, dist: 2.4, turbo: true, commit: 0.44, track: 7,
    range: 2.2, cone: 1.35,
    blurb: 'Slam forward and knock whoever is in front of you down.',
  },
  {
    key: 'glance', name: 'GLANCE', voice: 'glance', kind: 'cut', stat: 'hnd',
    dur: 0.34, dist: 1.6, turbo: false, commit: 0.12, track: 8,
    range: 1.5,
    blurb: 'Snap out of the tackle the instant it lands.',
  },
  {
    key: 'spear', name: 'PIERCER', voice: 'piercer', kind: 'spear', stat: 'pow',
    dur: 0.44, dist: 2.8, turbo: false, commit: 0.38, track: 9,
    range: 1.7, cone: 0.9,
    blurb: 'Straight power run. Win it and keep going, lose it and you eat it.',
  },
];

const BY_KEY = new Map(MOVES.map((m) => [m.key, m]));

/**
 * The signature move a swimmer owns. Accepts either a live sim player (which wraps its roster entry
 * in `data`) or the roster entry itself, so the UI can look a move up straight off a card. Falls
 * back to SPIN for any malformed entry.
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
  return 0.6 + (clamp01((s - 40) / 59)) * 0.55;
}

/** Moves that make the swimmer untackleable while they play, by getting them out of the plane. */
export function isEvading(player) {
  if (player.moveArmor > 0) return true;
  // Over the top or under the challenge: a tackle that only reaches the playing plane misses.
  return player.y > 0.45 || player.y < -0.45;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
