/**
 * ONLINE DUEL — the wire protocol.
 *
 * The match simulation is deterministic: same seed, same rule snapshot, same inputs, same result.
 * So the network never sends positions — it sends *inputs*, one small packet per simulation tick,
 * and both machines run the identical fixed-step simulation. That keeps the bandwidth tiny, the
 * cheat surface narrow (only your own input can be forged) and the feel identical to local play.
 *
 * This module is shared by the browser client (src/net/online.js) and the Node room server
 * (server/ws.js), so neither can drift from the other. It has no DOM and no THREE dependency.
 */

/** Bumped whenever the message shape or the simulation contract changes. Mismatched peers refuse. */
export const PROTOCOL_VERSION = 2;

/** An online duel is a best-of-three series. Two rounds take the set. */
export const SERIES_BEST_OF = 3;
export const SERIES_WINS_REQUIRED = Math.ceil(SERIES_BEST_OF / 2);

/** Fixed simulation step both peers must use. Variable dt would desync the floats. */
export const TICK_RATE = 60;
export const TICK_SECONDS = 1 / TICK_RATE;

/** How many ticks of input each peer runs ahead of the confirmed tick (hides round-trip jitter). */
export const INPUT_LOOKAHEAD = 6;

/** Highest acceptable input gap before the client reports a stalled opponent. */
export const STALL_MS = 2500;

export const MSG = Object.freeze({
  HELLO: 'hello',
  WELCOME: 'welcome',
  CREATE: 'create',
  JOIN: 'join',
  ROOM: 'room',
  TEAM: 'team',
  READY: 'ready',
  START: 'start',
  RESULT: 'result',
  SERIES: 'series',
  CONCEDE: 'concede',
  INPUT: 'input',
  PING: 'ping',
  PONG: 'pong',
  LEAVE: 'leave',
  ERROR: 'error',
});

/** Boolean input fields, packed into one bitmask in this order. */
const FLAGS = [
  'turbo',
  'shoot',
  'shootPressed',
  'shootReleased',
  'pass',
  'trick',
  'hit',
  'breach',
  'switchPlayer',
  'gamebreaker',
  'cage',
  'jukeHeld',
];

/** Quantise a unit-range float to two decimals — plenty for a stick and cheap on the wire. */
const q = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.max(-1, Math.min(1, n)) * 100);
};
const unq = (v) => (Number(v) || 0) / 100;

/**
 * Pack an input struct into a short number array.
 * @param {Object} input the sim input struct (see emptyInput in src/game/entities.js)
 * @returns {number[]} [moveX, moveZ, moveY, aimX, aimZ, flags, playcall]
 */
export function packInput(input = {}) {
  let mask = 0;
  FLAGS.forEach((key, i) => {
    if (input[key]) mask |= 1 << i;
  });
  return [q(input.moveX), q(input.moveZ), q(input.moveY), q(input.aimX), q(input.aimZ), mask, Math.trunc(input.playcall) || 0];
}

/**
 * Unpack a wire array back into an input struct. Touch-only fields (jukeDir, keeperAim) are not
 * transmitted: an online duel is played on a keyboard or a pad, and a null there means "no stick
 * flick", which is exactly what those fields already use to mean nothing.
 * @param {number[]} data
 */
export function unpackInput(data) {
  const [moveX, moveZ, moveY, aimX, aimZ, mask = 0, playcall = 0] = Array.isArray(data) ? data : [];
  const out = {
    moveX: unq(moveX),
    moveZ: unq(moveZ),
    moveY: unq(moveY),
    aimX: unq(aimX),
    aimZ: unq(aimZ),
    jukeHeld: false,
    jukeDir: null,
    shoot: false,
    shootPressed: false,
    shootReleased: false,
    pass: false,
    trick: false,
    hit: false,
    breach: false,
    switchPlayer: false,
    gamebreaker: false,
    cage: false,
    keeperAim: null,
    playcall: playcall >= 1 && playcall <= 9 ? playcall : 0,
  };
  FLAGS.forEach((key, i) => {
    out[key] = (mask & (1 << i)) !== 0;
  });
  return out;
}

/**
 * A cheap fingerprint of the live simulation. Both peers exchange one every second; a mismatch
 * means the two pools have diverged, and the client can say so instead of pretending the match is
 * fine. FNV-1a over the parts of the state that must agree: clock, score, and every swimmer's
 * position.
 */
export function simChecksum(sim) {
  let hash = 2166136261;
  const mix = (value) => {
    const n = Number.isFinite(value) ? Math.round(value * 1000) : 0;
    hash ^= n | 0;
    hash = Math.imul(hash, 16777619);
  };
  mix(sim.time);
  mix(sim.score[0]);
  mix(sim.score[1]);
  mix(sim.possession);
  mix(sim.ball.pos.x);
  mix(sim.ball.pos.y);
  mix(sim.ball.pos.z);
  for (const p of sim.players) {
    mix(p.pos.x);
    mix(p.pos.z);
    mix(p.y);
    mix(p.stamina);
  }
  return hash >>> 0;
}

/** A human-readable room code: four letters/digits, no vowels (so it can never spell a word). */
const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXYZ23456789';
export function randomRoomCode(rng = Math.random) {
  let out = '';
  for (let i = 0; i < 4; i++) out += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  return out;
}

/** Normalise whatever the player typed into something that can match a room. */
export function cleanRoomCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
}

/** Is this a complete, well-formed room code? */
export function validRoomCode(code) {
  return typeof code === 'string' && /^[A-Z0-9]{4}$/.test(code);
}

/**
 * A series as both peers read it. `champion` is a seat index, `forfeit` the seat that quit (or
 * null), and `history` one entry per completed round so the results screen can tell the story.
 *
 * @param {{ bestOf: number, wins: number[], round: number, over: boolean, champion: number|null,
 *           forfeit: number|null, history: Array<{round: number, winner: number|null}> }} series
 */
export function seriesSnapshot(series) {
  if (!series) return null;
  return {
    bestOf: series.bestOf,
    wins: [...series.wins],
    round: series.round,
    over: !!series.over,
    champion: Number.isInteger(series.champion) ? series.champion : null,
    forfeit: Number.isInteger(series.forfeit) ? series.forfeit : null,
    history: Array.isArray(series.history) ? series.history.map((r) => ({ round: r.round, winner: r.winner })) : [],
  };
}

/** Where the duel socket lives. Same origin by default, so a deployed build needs no config. */
export function duelSocketUrl(location = typeof window !== 'undefined' ? window.location : null) {
  if (!location) return 'ws://localhost:4000/ws';
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}
