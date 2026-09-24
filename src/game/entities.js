import { Vec3 } from '../core/vec3.js';

/**
 * Runtime entities for the Blitzball simulation. Plain objects so they serialise for tests.
 */

export function createPlayer(data, team, slot) {
  return {
    id: data.id,
    data,
    team,
    slot, // 0..2 outfield, 3 keeper
    isKeeper: data.role === 'GK',
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
    stun: 0,
    hasBall: false,
    controlled: false,
    combo: 0,
    comboTimer: 0,
    cd: { tackle: 0, hit: 0, trick: 0, breach: 0, catch: 0, shot: 0 },
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
    ballCamToggle: false, // one-shot: flips the player cam between ball lock and forward look
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
  dst.ballCamToggle = src.ballCamToggle;
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
