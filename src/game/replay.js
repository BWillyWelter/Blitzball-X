/**
 * GOAL REPLAY — record the last few seconds of the pool, then play the scoring move back.
 *
 * The sim is deterministic and step-driven, so a replay needs no video and no re-simulation: a
 * rolling ring buffer of poses is enough. Every sample stores where each swimmer was, which way
 * they faced, what state they were in, and where the ball was. On a goal the buffer is frozen
 * into a clip and the director walks it back at a fraction of real speed while a scripted camera
 * (see GameCamera.replayShot) cuts between angles.
 *
 * Nothing here touches the DOM or three.js, so the whole thing is unit-testable in node — the
 * browser harness only covers the overlay and the camera, which genuinely need a GPU.
 *
 * Poses are keyed by player id, not by array index: a substitution rewrites `sim.players`, so an
 * index-keyed buffer would silently swap a body between replay frames. An id that has left the
 * water is simply not posed (the view is hidden), which is exactly what happened in real life.
 */

const SAMPLE_HZ = 30;
/** How much history the ring buffer keeps. Long enough to hold a whole move plus the wind-up. */
export const REPLAY_SECONDS = 3.4;
/** Playback speed of the clip. Slow enough to read the hit, fast enough not to annoy. */
export const REPLAY_RATE = 0.38;

export class ReplayRecorder {
  constructor(seconds = REPLAY_SECONDS, hz = SAMPLE_HZ) {
    this.interval = 1 / hz;
    // `capacity` frames span `capacity - 1` intervals, so this holds the advertised window to
    // within a single sample rather than a sample plus slack.
    this.capacity = Math.round(seconds * hz) + 1;
    this.frames = [];
    this.acc = 0;
    this.lastTime = -1;
  }

  reset() {
    this.frames.length = 0;
    this.acc = 0;
    this.lastTime = -1;
  }

  /**
   * Sample the live pool. Called once per sim step, so it samples off the SIM clock rather than
   * the render clock: a dropped frame thins the clip, it never stretches it.
   */
  record(sim, dt) {
    // Only live play is worth replaying. Sampling the warm-up or a dead ball would fill the whole
    // ring with swimmers standing still and leave nothing of the actual move.
    if (sim.state !== 'live') {
      this.acc = 0;
      return false;
    }
    this.acc += dt;
    if (this.acc < this.interval) return false;
    this.acc -= this.interval;
    // Two samples landing on the same sim time (a rewind or a very coarse step) would make the
    // playback stutter backwards for a frame. Keep the newest only.
    if (this.lastTime === sim.time) {
      this.frames[this.frames.length - 1] = this.sample(sim);
      return true;
    }
    this.lastTime = sim.time;
    this.frames.push(this.sample(sim));
    if (this.frames.length > this.capacity) this.frames.shift();
    return true;
  }

  sample(sim) {
    const poses = [];
    for (const p of sim.players) {
      poses.push({
        id: p.id,
        x: p.pos.x,
        y: p.y,
        z: p.pos.z,
        facing: p.facing,
        state: p.state,
        stateTime: p.stateTime,
        speedNorm: p.speedNorm,
        t: p.anim.t,
      });
    }
    return {
      time: sim.time,
      ball: { x: sim.ball.pos.x, y: sim.ball.pos.y, z: sim.ball.pos.z },
      holder: sim.ball.holder ? sim.ball.holder.id : null,
      poses,
    };
  }

  /**
   * Freeze the buffer into a clip. The frames are copied out of the ring so the recorder can keep
   * sampling the (now dead) pool without disturbing the clip being played.
   */
  cut(meta = {}) {
    if (this.frames.length < 4) return null;
    const frames = this.frames.slice();
    const first = frames[0].time;
    for (const f of frames) f.time -= first;
    return {
      frames,
      duration: frames[frames.length - 1].time,
      scorer: meta.scorer ?? null,
      scorerId: meta.scorerId ?? null,
      team: meta.team ?? 0,
      ring: meta.ring ?? 0,
      points: meta.points ?? 1,
      type: meta.type ?? 'shot',
      gb: !!meta.gb,
      at: meta.at ?? 0,
    };
  }
}

/**
 * Playback director. Owns the clip's playhead, decides when the replay is over, and writes the
 * recorded pose back onto the live entities so the existing character rig and ball mesh animate
 * the replay for free — no second scene graph, no ghost meshes, no cleanup on exit.
 */
export class ReplayDirector {
  constructor() {
    this.clip = null;
    this.t = 0;
    this.rate = REPLAY_RATE;
    this.playing = false;
    this.reduced = false;
    // Positions captured at the cut, restored the moment playback ends. The pool is in a dead
    // ball state for the whole replay, so these are only ever the idle-drift values.
    this.saved = null;
  }

  /** Start a clip. Returns false if there is nothing worth showing. */
  start(clip, { reducedMotion = false } = {}) {
    if (!clip || !clip.frames.length) return false;
    this.clip = clip;
    this.t = 0;
    this.rate = reducedMotion ? Math.min(1, REPLAY_RATE * 2.4) : REPLAY_RATE;
    this.reduced = reducedMotion;
    this.playing = true;
    return true;
  }

  get progress() {
    if (!this.clip || this.clip.duration <= 0) return 1;
    return Math.min(1, this.t / this.clip.duration);
  }

  /** Hold on the final frame for a beat so the finish lands before we cut back to live. */
  get tail() {
    return this.reduced ? 0.35 : 0.7;
  }

  get totalTime() {
    return this.clip ? this.clip.duration / this.rate + this.tail : 0;
  }

  /** Interpolated frame pair at the current playhead, or null once the clip is finished. */
  sampleAt(t) {
    const frames = this.clip.frames;
    let lo = 0;
    let hi = frames.length - 1;
    if (t <= frames[0].time) return { a: frames[0], b: frames[0], k: 0 };
    if (t >= frames[hi].time) return { a: frames[hi], b: frames[hi], k: 0 };
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (frames[mid].time <= t) lo = mid;
      else hi = mid;
    }
    const a = frames[lo];
    const b = frames[hi];
    const span = b.time - a.time;
    return { a, b, k: span > 0 ? (t - a.time) / span : 0 };
  }

  /** Advance the playhead. Returns true while the replay should keep playing. */
  advance(dt) {
    if (!this.playing || !this.clip) return false;
    this.t += dt * this.rate;
    if (this.t >= this.clip.duration + this.tail) {
      this.finish();
      return false;
    }
    return true;
  }

  /** Playhead position in clip time, held on the last frame through the tail. */
  get playTime() {
    if (!this.clip) return 0;
    return Math.min(this.t, this.clip.duration);
  }

  /** The interpolated ball position at the playhead — what the replay camera tracks. */
  ballAt() {
    if (!this.clip) return null;
    const { a, b, k } = this.sampleAt(this.playTime);
    return {
      x: a.ball.x + (b.ball.x - a.ball.x) * k,
      y: a.ball.y + (b.ball.y - a.ball.y) * k,
      z: a.ball.z + (b.ball.z - a.ball.z) * k,
    };
  }

  /**
   * Push the recorded pose onto the live entities. The renderer then does exactly what it does in
   * live play, which is why a replay needs no rendering code of its own.
   */
  pose(sim) {
    if (!this.clip) return null;
    const { a, b, k } = this.sampleAt(this.playTime);
    const byId = new Map();
    for (const pose of a.poses) byId.set(pose.id, pose);
    for (const p of sim.players) {
      const p0 = byId.get(p.id);
      if (!p0) continue;
      const p1 = b.poses.find((q) => q.id === p.id) || p0;
      p.pos.x = p0.x + (p1.x - p0.x) * k;
      p.pos.y = 0;
      p.pos.z = p0.z + (p1.z - p0.z) * k;
      p.y = p0.y + (p1.y - p0.y) * k;
      p.vel.set(0, 0, 0);
      // Yaw has to be interpolated the short way round or a swimmer spins 350° between frames.
      let d = (p1.facing - p0.facing) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      p.facing = p0.facing + d * k;
      p.state = p1.state;
      p.stateTime = p1.stateTime;
      p.speedNorm = p0.speedNorm + (p1.speedNorm - p0.speedNorm) * k;
      p.anim.t = p0.t + (p1.t - p0.t) * k;
      p.turboActive = false;
    }
    const ball = sim.ball;
    const holder0 = a.holder;
    ball.flight = null;
    ball.vel.set(0, 0, 0);
    ball.pos.x = a.ball.x + (b.ball.x - a.ball.x) * k;
    ball.pos.y = a.ball.y + (b.ball.y - a.ball.y) * k;
    ball.pos.z = a.ball.z + (b.ball.z - a.ball.z) * k;
    if (holder0 !== null) {
      const holder = sim.players.find((p) => p.id === holder0);
      if (holder) {
        ball.holder = holder;
        holder.hasBall = true;
        // Glue the ball to the carrier's hands so the dribble reads during the replay.
        ball.pos.x = holder.pos.x;
        ball.pos.y = 0.9 + holder.y;
        ball.pos.z = holder.pos.z;
      }
    } else {
      const old = ball.holder;
      if (old) old.hasBall = false;
      ball.holder = null;
    }
    return { a, b, k };
  }

  /**
   * Snapshot the live pool before the first pose write, so the sim resumes from where it actually
   * was rather than from the replay's last frame.
   */
  capture(sim) {
    this.saved = {
      players: sim.players.map((p) => ({
        p,
        pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z },
        y: p.y,
        vel: { x: p.vel.x, y: p.vel.y, z: p.vel.z },
        facing: p.facing,
        state: p.state,
        stateTime: p.stateTime,
        speedNorm: p.speedNorm,
        t: p.anim.t,
        hasBall: p.hasBall,
      })),
      ball: {
        pos: { x: sim.ball.pos.x, y: sim.ball.pos.y, z: sim.ball.pos.z },
        vel: { x: sim.ball.vel.x, y: sim.ball.vel.y, z: sim.ball.vel.z },
        holder: sim.ball.holder,
        flight: sim.ball.flight,
        lastTouch: sim.ball.lastTouch,
      },
    };
  }

  finish() {
    this.playing = false;
  }

  /** Put the pool back exactly as it was before the replay moved anything. */
  restore(sim) {
    this.playing = false;
    if (!this.saved) return;
    for (const rec of this.saved.players) {
      const p = rec.p;
      p.pos.x = rec.pos.x;
      p.pos.y = rec.pos.y;
      p.pos.z = rec.pos.z;
      p.y = rec.y;
      p.vel.x = rec.vel.x;
      p.vel.y = rec.vel.y;
      p.vel.z = rec.vel.z;
      p.facing = rec.facing;
      p.state = rec.state;
      p.stateTime = rec.stateTime;
      p.speedNorm = rec.speedNorm;
      p.anim.t = rec.t;
      p.hasBall = rec.hasBall;
    }
    const b = sim.ball;
    if (b.holder && b.holder !== this.saved.ball.holder) b.holder.hasBall = false;
    b.pos.x = this.saved.ball.pos.x;
    b.pos.y = this.saved.ball.pos.y;
    b.pos.z = this.saved.ball.pos.z;
    b.vel.x = this.saved.ball.vel.x;
    b.vel.y = this.saved.ball.vel.y;
    b.vel.z = this.saved.ball.vel.z;
    b.holder = this.saved.ball.holder;
    b.flight = this.saved.ball.flight;
    b.lastTouch = this.saved.ball.lastTouch;
    if (b.holder) b.holder.hasBall = true;
    this.saved = null;
    this.clip = null;
    this.t = 0;
  }

  dispose() {
    this.playing = false;
    this.clip = null;
    this.saved = null;
  }
}
