/**
 * Runtime probe: repeated matches, GPU context churn, JS heap, frame timing, console output.
 * Usage: node tools/probe.mjs [url]
 *
 * Exits non-zero when a match fails to hand its WebGL context back at teardown (a leak that
 * eventually costs you the context of the match you are actually playing) or when the page threw.
 * Frame time and heap are reported for eyeballing only — they depend on the host, not the game.
 *
 * The frame tail (p50/p99/max + hitch count) comes from the game's own ./src/dev/perf.js monitor,
 * read through window.__BB_PERF__ — the same numbers the `?perf` overlay shows on a real device.
 * They are informational here: a software-GL runner's frames say nothing about a phone's. What
 * they DO catch structurally is the program count, which must be stable across a round (a shader
 * compiling mid-play would show up as a new program plus a spike in the same round's tail).
 */
import { launchBrowser } from './lib/browser.mjs';

const url = process.argv[2] || 'http://localhost:4173/';
const browser = await launchBrowser({
  args: ['--js-flags=--expose-gc'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const msgs = [];
page.on('console', (m) => msgs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => msgs.push(`pageerror: ${e.stack || e.message}`));

// Count WebGL contexts created vs released. Only canvases that are actually in the document are
// counted, so the throwaway canvases `probeWebGL()` uses to test capability can't inflate the
// numbers. A release is the `webglcontextlost` event alone — patching `loseContext()` as well
// double-counted every disposal.
await page.evaluateOnNewDocument(() => {
  window.__ctx = { created: 0, lost: 0 };
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = orig.call(this, type, ...rest);
    if (ctx && /webgl/.test(type) && this.isConnected) {
      window.__ctx.created++;
      this.addEventListener('webglcontextlost', () => window.__ctx.lost++);
    }
    return ctx;
  };
});

await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.evaluate(() => { window.app.audio.unlock = () => {}; });

const heap = () => page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1));

const ROUNDS = 6;
const samples = [];
for (let r = 0; r < ROUNDS; r++) {
  await page.evaluate(() => {
    const app = window.app;
    const T = app.teams;
    app.startMatch({ home: T[0], away: T[3], userTeam: 0, mode: "quick" });
  });
  // Drive the match forward, then time a handful of real frames. Keep the timed loop short: on
  // software GL a single frame can take ~1 s, and a long loop is what tips headless swiftshader
  // over (TargetCloseError), which would read as a game failure instead of a slow host.
  await page.evaluate(() => {
    const m = window.app.match;
    for (let i = 0; i < 120; i++) { m.sim.step(1 / 60); m.renderer.update(1 / 60); }
  });
  const t0 = Date.now();
  // Reset per round so a round's tail is its own frames: round 6 must not inherit the hitches of
  // the five matches before it. Each round includes its own match-start frame — deliberately, since
  // a match start is exactly where the first-frame compile lands.
  await page.evaluate(() => window.__BB_PERF__.reset());
  const frames = await page.evaluate(() => {
    const m = window.app.match;
    const n = 12;
    const t = performance.now();
    for (let i = 0; i < n; i++) m.renderer.render();
    return (performance.now() - t) / n;
  });
  const ctxs = await page.evaluate(() => ({ ...window.__ctx }));
  // Let the real loop run for a moment before reading the tail: a distribution over frames the
  // app produced at its own rAF cadence is the point, and probing mid-burst would sample nearly
  // nothing (the evaluate blocks the loop).
  await page.evaluate(() => new Promise((r) => setTimeout(r, 700)));
  const tail = await page.evaluate(() => {
    const s = window.__BB_PERF__.summary();
    return { frames: s.frames, p50: s.frame.p50, p99: s.frame.p99, max: s.frame.max, hitches: s.hitches, programs: s.counters.programs };
  });
  samples.push({ round: r + 1, msPerFrame: +frames.toFixed(1), heapMB: await heap(), ...ctxs, wallMs: Date.now() - t0, ...tail });
  console.log(`round ${r + 1}/${ROUNDS}: ${samples[r].msPerFrame} ms/frame, heap ${samples[r].heapMB} MB, contexts ${ctxs.created}/${ctxs.lost}, frames ${tail.frames} (p50 ${tail.p50} / p99 ${tail.p99} ms, ${tail.hitches} hitches), ${tail.programs} shader programs`);
  // Quit back to the menu the way a player would.
  await page.evaluate(() => window.app.go('title'));
  await new Promise((res) => setTimeout(res, 250));
}

// Quit the last match too, so every context this run created has had its dispose() run.
await page.evaluate(() => window.app.go('title'));
await new Promise((res) => setTimeout(res, 400));
const final = await page.evaluate(() => ({ ...window.__ctx }));

console.log(JSON.stringify(samples, null, 1));
const live = final.created - final.lost;
console.log(`contexts: created=${final.created} released=${final.lost} live=${live}`);
console.log(`heap: ${samples.map((s) => s.heapMB).join(' -> ')} MB`);
console.log(`frame tail (host-dependent, informational): ${samples.map((s) => `p99 ${s.p99}`).join(' / ')} ms`);
const programs = [...new Set(samples.map((s) => s.programs))];
console.log(`shader programs per round: ${programs.join(', ')}`);
const uniq = [...new Set(msgs)];
console.log(`console messages (${uniq.length}):`);
for (const m of uniq.slice(0, 25)) console.log('  ', m.slice(0, 220));
await browser.close();

// A finished match must hand its WebGL context back: three's renderer.dispose() does not, so a
// forgotten forceContextLoss() leaks one live context per match straight into the next one.
const pageErrors = uniq.filter((m) => m.startsWith('pageerror'));
// The overlay/monitor page API must exist on a normal load (the overlay itself is opt-in via
// ?perf): a silent regression there would leave CI printing zeroes instead of numbers.
if (!samples.length || samples.some((s) => !Number.isFinite(s.frames) || s.frames <= 0)) {
  console.log('\nFAIL: window.__BB_PERF__ reported no frames — the frame monitor is not wired in.');
}
if (live > 0) {
  console.log(`\nFAIL: ${live} of ${final.created} WebGL context(s) were never released — `
    + 'MatchRenderer.dispose() must call renderer.forceContextLoss().');
}
for (const e of pageErrors) console.log(`\nFAIL: ${e.slice(0, 300)}`);
const monitorBroken = !samples.length || samples.some((s) => !Number.isFinite(s.frames) || s.frames <= 0);
if (!live && !pageErrors.length && !monitorBroken) {
  console.log(`\nPASS: all ${final.created} matches released their WebGL context, no page errors`);
}
process.exit(live > 0 || pageErrors.length || monitorBroken ? 1 : 0);
