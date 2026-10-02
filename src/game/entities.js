import { Vec3 } from '../core/vec3.js';
import { MOVE } from '../data/constants.js';

/**
 * Runtime entities for the Blitzball simulation. Plain objects so they serialise for tests.
 */

export function createPlayer(data, team, slot) {
  return {
    id: data.id,
    data,
    team,
    slot, // 0 keeper, 1-2 shooters (1 is the captain), 3-6 fielders
    isKeeper: data.role === 'GK',
    isShooter: data.role === 'SH',
    isFielder: data.role === 'FD',
    isCaptain: !!data.captain,
    role: data.role,
    pos: new Vec3(0, 0, 0),
    vel: new Vec3(0, 0, 0),
    y: 0, // vertical offset from the playing plane (breaches)
    vy: 0,
    facing: team === 0 ? Math.PI / 2 : -Math.PI / 2, // yaw; +x = PI/2
    state: 'idle',
    stateTime: 0,
    stateDur: 0,
    airborne: false,
    turbo: 100,
    turboActive: false,
    // Stamina: the body meter behind the turbo button (see MOVE.stamina*). Starts full; drains
    // with effort and contact, recovers when idle, and a gassed swimmer is a reason to reach for
    // the bench.
    stamina: MOVE.staminaMax,
    gassed: false,
    // Discipline: fouls committed. Two bookable offences and the swimmer is off for the match,
    // replaced automatically from the bench.
    cards: 0,
    sentOff: false,
    sentOffAt: 0, // match clock at which the red was shown
    // Substitution bookkeeping.
    subbedIn: false,
    subbedOff: false,
    minutesPlayed: 0,
    stun: 0,
    hasBall: false,
    controlled: false,
    combo: 0,
    comboTimer: 0,
    cd: { tackle: 0, hit: 0, trick: 0, breach: 0, catch: 0, shot: 0, dive: 0 },
    // Committed keeper dive: `diveT` is the live window (extra reach + save chance), `diveDir`
    // the lateral direction it was aimed, `diveCommit` how much of it is still accelerating.
    diveT: 0,
    diveDir: 0,
    diveCommit: 0,
    shot: null,
    trick: null,
    input: emptyInput(),
    ai: {},
    stats: emptyStats(),
    lastPassTime: -99,
    anim: { t: 0, phase: 0 },
    speedNorm: 0,
    dribbleTouch: 0, // glue-dribble touch time (drives Dribble ×N style)
    callingForPass: false, // set when a teammate calls for the pass (Rematch-style)
    knockDir: new Vec3(1, 0, 0),
    moveArmor: 0, // seconds of roll/vault left: untackleable while > 0
  };
}

export function emptyStats() {
  return {
    goals: 0,
    shots: 0,
    sog: 0, // shots on goal
    ast: 0,
    tkl: 0, // successful tackles / picks
    hits: 0, // big hits landed
    saves: 0,
    blk: 0,
    washed: 0, // defenders left in the wash (Blitzball's ankle-breaker)
    style: 0,
    gb: 0,
    to: 0,
    volleys: 0,
  };
}

export function emptyInput() {
  return {
    moveX: 0,
    moveZ: 0,
    moveY: 0, // vertical (free-swim) intent: +1 rise, -1 dive
    jukeHeld: false, // JUKE button held (touch): a stick flick while held aims the move
    jukeDir: null, // { x, y } stick direction at flick time, or null
    turbo: false,
    playcall: 0, // one-shot numeric: 1-3 offense play, 7-9 defense play, 0 none
    shoot: false, // held
    shootPressed: false,
    shootReleased: false,
    pass: false,
    trick: false,
    hit: false,
    breach: false,
    switchPlayer: false,
    gamebreaker: false,
  cage: false, // one-shot: take the cage (hand control to your own keeper)
  };
}

/**
 * Copy the user's input into a player's own struct.
 * Never alias the two: `updateAI` clears every field of `p.input` each tick, so a player who
 * was controlled once and then handed to the AI would zero the live user input and silently
 * swallow the player's one-shot actions (shoot / pass / trick / hit / breach) for the rest of
 * the match.
 */
export function copyInput(dst, src) {
  dst.moveX = src.moveX;
  dst.moveZ = src.moveZ;
  dst.moveY = src.moveY;
  dst.jukeHeld = src.jukeHeld;
  dst.jukeDir = src.jukeDir;
  dst.turbo = src.turbo;
  dst.shoot = src.shoot;
  dst.shootPressed = src.shootPressed;
  dst.shootReleased = src.shootReleased;
  dst.pass = src.pass;
  dst.trick = src.trick;
  dst.hit = src.hit;
  dst.breach = src.breach;
  dst.switchPlayer = src.switchPlayer;
  dst.gamebreaker = src.gamebreaker;
  dst.playcall = src.playcall;
  return dst;
}

export function createBall() {
  return {
    pos: new Vec3(0, 0, 0),
    vel: new Vec3(0, 0, 0),
    holder: null,
    flight: null, // { kind: 'shot' | 'pass' | 'lob' | 'loose', ... }
    lastTeam: 0,
    lastTouch: null,
    spin: 0,
    releaseCooldown: null,
    wallCooldown: 0,
  };
}
