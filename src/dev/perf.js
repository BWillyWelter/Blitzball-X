/**
 * BLITZBALL X — frame-time instrumentation (dev + CI).
 *
 * Averages hide the thing players actually feel. `tools/probe.mjs` reports ms/frame "for
 * eyeballing only" — a mean, on a host that is not the player's. What matters is the tail: the
 * occasional long frame (a shader compiling on first use, a GC pause, a texture upload) reads as
 * a stutter even when the mean is fine. So this records a rolling window of frame intervals and
 * reports p50/p95/p99/max plus an explicit hitch count.
 *
 * Integration:
 *   - the monitor is always recording (one timestamp and one ring-buffer write per frame — cheap
 *     enough to leave on in production, and it means CI and a player's own device can both read
 *     `window.__BB_PERF__.summary()` without a flag);
 *   - the on-screen overlay is opt-in: open the app with `?perf`.
 *
 * The overlay only exists to be looked at with human eyes, but the numbers behind it are plain
 * data, so the maths is a separate class that unit-tests in node (tests/perfmonitor.test.mjs).
 */

/** A frame this long is a hitch: three vsyncs at 60 Hz, i.e. visible, not just jitter. */
export const HITCH_MS = 50;

/** Frames in the rolling window. At 60 Hz this is ~4 s of history — long enough to read a
 *  distribution, short enough that a retune shows up immediately. */
const WINDOW = 240;

/** Largest delta accepted as a frame. A tab that was backgrounded (or a slept laptop) reports a
 *  delta of seconds; counting that as a hitch would make the first frame after every alt-tab the
 *  worst frame in the match. */
const MAX_DELTA_MS = 5000;

const round = (n, d = 2) => (Number.isFinite(n) ? +n.toFixed(d) : 0);

/** Percentile of an unsorted array; `p` in [0,1]. Copies, so the caller's array is untouched. */
export function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const at = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[at];
}

class Ring {
  constructor(size, key) {
    this.key = key;
    this.buf = new Float64Array(size);
    this.count = 0; // total samples ever (may exceed size)
    this.idx = 0;
  }

  push(v) {
    this.buf[this.idx] = v;
    this.idx = (this.idx + 1) % this.buf.length;
    this.count++;
  }

  /** Oldest-to-newest contents of the live window. */
  values() {
    const n = Math.min(this.count, this.buf.length);
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = this.buf[(this.idx - n + i + this.buf.length) % this.buf.length];
    return out;
  }

  stats() {
    const values = this.values();
    const max = values.length ? Math.max(...values) : 0;
    const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    return {
      n: this.count,
      // p50 of the window, not of all time: this reports "where the game is now", so a fix shows
      // up in the number instead of being averaged away by the history that prompted it.
      p50: round(percentile(values, 0.5), 2),
      p95: round(percentile(values, 0.95), 2),
      p99: round(percentile(values, 0.99), 2),
      max: round(max, 2),
      mean: round(mean, 2),
    };
  }
}

export class FrameMonitor {
  constructor({ window = WINDOW, hitchMs = HITCH_MS } = {}) {
    this.window = window;
    this.hitchMs = hitchMs;
    this.frames = new Ring(window, 'frame');
    this.samples = new Map(); // name ('sim' | 'render' | …) -> Ring
    this.hitches = 0;
    this._last = null;
    this.gpu = { calls: 0, triangles: 0, programs: 0 };
  }

  /** Call once per rAF callback with `performance.now()`. Times the interval itself. */
  frame(now) {
    const last = this._last;
    this._last = now;
    if (last === null) return;
    const ms = now - last;
    if (!(ms >= 0) || ms > MAX_DELTA_MS) return; // clock skew or a backgrounded tab
    this.frames.push(ms);
    if (ms >= this.hitchMs) this.hitches++;
  }

  /** Record a named sub-cost in ms (sim step cost, render cost, …). */
  sample(name, ms) {
    let ring = this.samples.get(name);
    if (!ring) {
      ring = new Ring(this.window, name);
      this.samples.set(name, ring);
    }
    ring.push(ms);
  }

  /** Latest GPU counters for the frame just drawn (three's renderer.info). */
  counters({ calls, triangles, programs } = {}) {
    if (Number.isFinite(calls)) this.gpu.calls = calls;
    if (Number.isFinite(triangles)) this.gpu.triangles = triangles;
    if (Number.isFinite(programs)) this.gpu.programs = programs;
  }

  /** Plain data — safe to JSON.stringify into a CI artifact. */
  summary() {
    const f = this.frames.stats();
    const subs = {};
    for (const [name, ring] of this.samples) subs[name] = ring.stats();
    return {
      frames: f.n,
      fps: f.mean > 0 ? round(1000 / f.mean, 1) : 0,
      frame: f,
      hitches: this.hitches,
      hitchPct: f.n ? round((this.hitches / f.n) * 100, 2) : 0,
      hitchMs: this.hitchMs,
      subs,
      counters: { ...this.gpu },
    };
  }

  reset() {
    this.frames = new Ring(this.window, 'frame');
    this.samples.clear();
    this.hitches = 0;
    this._last = null;
  }
}

/** Is the dev overlay requested? Same convention as `?bench` and `?diag`. */
export function perfEnabled(loc = typeof window === 'undefined' ? null : window.location) {
  try {
    return !!loc && new URLSearchParams(loc.search).has('perf');
  } catch {
    return false;
  }
}

const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '—');

/**
 * On-screen readout, top-left, `pointer-events:none` so it can never eat a click meant for the
 * game. Repaints ~4x/second: reading it is a human activity, and repainting the DOM every frame
 * would itself show up in the numbers.
 */
export class PerfOverlay {
  constructor(parent = document.body, { intervalMs = 250 } = {}) {
    this.intervalMs = intervalMs;
    this._lastPaint = -Infinity;
    this.el = document.createElement('pre');
    this.el.id = 'perf-hud';
    this.el.style.cssText =
      'position:fixed;top:8px;left:8px;z-index:9998;margin:0;padding:6px 9px;'
      + 'background:rgba(4,12,20,0.72);color:#8ff7ff;border:1px solid rgba(143,247,255,0.35);'
      + 'border-radius:6px;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;'
      + 'white-space:pre;pointer-events:none;letter-spacing:0.02em';
    parent.appendChild(this.el);
  }

  update(summary, now = performance.now()) {
    if (now - this._lastPaint < this.intervalMs) return;
    this._lastPaint = now;
    const sub = (name) => summary.subs[name] || { p50: 0, p99: 0, max: 0 };
    const frame = summary.frame;
    const sim = sub('sim');
    const render = sub('render');
    const gpu = summary.counters;
    // The hitch line goes orange once the tail is stuttering: the number is the point, and a
    // colour is what makes a hitch visible from across the room while playing. Everything rendered
    // here is a number this process produced, so building markup is safe.
    const hitchLine = `HITCH  ${summary.hitches} (${fmt(summary.hitchPct)}%) over ${summary.hitchMs}ms`;
    this.el.innerHTML = [
      `FRAME  p50 ${fmt(frame.p50)}  p99 ${fmt(frame.p99)}  max ${fmt(frame.max, 0)} ms   ${fmt(summary.fps)} fps`,
      frame.p99 >= HITCH_MS ? `<span style="color:#ff8a3d">${hitchLine}</span>` : hitchLine,
      `SIM    p50 ${fmt(sim.p50, 2)}  p99 ${fmt(sim.p99, 2)}  max ${fmt(sim.max, 2)} ms/frame`,
      `RENDER p50 ${fmt(render.p50)}  p99 ${fmt(render.p99)}  max ${fmt(render.max, 0)} ms/frame`,
      `GPU    calls ${gpu.calls}  tris ${(gpu.triangles / 1000).toFixed(1)}k  programs ${gpu.programs}`,
    ].join('\n');
  }

  dispose() {
    this.el.remove();
  }
}
