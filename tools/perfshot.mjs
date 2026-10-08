/**
 * Frame-time / GPU-load spot check: starts one match, steps the sim, then times a short
 * burst of render frames and reports draw calls + triangles. Complements tools/probe.mjs,
 * which runs many full matches (slow); this one exits in a few seconds.
 *
 * With budgets it doubles as a gate. The counter budgets (`--max-calls`, `--max-triangles`)
 * are deterministic for a fixed seed and match state, so they can be held tightly; the timing
 * budget (`--max-sim-ms`) is host-dependent, so it is deliberately loose and only catches
 * order-of-magnitude regressions, not a few percent of runner noise. Any breach exits 1.
 *
 * Usage:
 *   node tools/perfshot.mjs [url] [baseline] [--max-calls N] [--max-triangles N] [--max-sim-ms X]
 *   (passing `baseline` — or --baseline — disables touch emulation, as before)
 */
import { launchBrowser, closeBrowser } from './lib/browser.mjs';

const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    if (key === 'baseline') flags.baseline = true;
    else flags[key] = argv[++i];
  } else positional.push(a);
}
const url = positional[0] || 'http://127.0.0.1:4173/';
const baseline = flags.baseline === true || positional[1] === 'baseline';
const num = (v) => (v === undefined ? null : Number(v));
const budget = {
  calls: num(flags['max-calls']),
  triangles: num(flags['max-triangles']),
  simMs: num(flags['max-sim-ms']),
};

const browser = await launchBrowser({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: !baseline, hasTouch: !baseline });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate(() => {
  window.app.audio.unlock = () => {};
  window.app.state.settings.quality = 'high';
  window.app.startMatch({ home: window.app.teams[0], away: window.app.teams[3], userTeam: 0, mode: 'quick', seed: 2468 });
  window.app.match.paused = true;
});
const res = await page.evaluate(() => {
  const m = window.app.match;
  for (let i = 0; i < 60; i++) {
    m.sim.step(1 / 60);
    m.renderer.update(1 / 60);
  }
  while (m.sim.state !== 'live') m.sim.step(1 / 60);
  const simStart = performance.now();
  for (let i = 0; i < 600; i++) m.sim.step(1 / 60);
  const simMs = (performance.now() - simStart) / 600;
  const gpu = m.renderer.renderer;
  gpu.info.autoReset = false;
  const gl = gpu.getContext();
  // Finish GPU work so timing includes rendering, not just queued commands.
  for (let i = 0; i < 3; i++) { m.renderer.update(1 / 60); m.renderer.render(); gl.finish(); }
  const samples = [];
  for (let i = 0; i < 12; i++) {
    gpu.info.reset();
    const t0 = performance.now();
    m.renderer.update(1 / 60);
    m.hud.update();
    m.renderer.render();
    gl.finish();
    samples.push(performance.now() - t0);
  }
  const ms = samples.reduce((a, b) => a + b, 0) / samples.length;
  const { calls, triangles } = gpu.info.render;
  const dpr = gpu.getPixelRatio();
  // The frame monitor (src/dev/perf.js) must be wired into the real loop: if this is missing, the
  // `?perf` overlay and every tail number on a real device are silently dead.
  const monitor = typeof window.__BB_PERF__ === 'object' && window.__BB_PERF__ !== null;
  window.app.go('title');
  return { ms: +ms.toFixed(1), simMs: +simMs.toFixed(3), calls, triangles, dpr, programs: gpu.info.programs.length, monitor };
});
console.log(`mobile ms/frame (software GPU, synchronized): ${res.ms} | sim ms/step: ${res.simMs} | draw calls: ${res.calls} | triangles: ${res.triangles} | programs: ${res.programs} | DPR: ${res.dpr} | frame monitor: ${res.monitor ? 'wired' : 'MISSING'}${errors.length ? ` | PAGE ERRORS: ${errors.length}` : ' | clean'}`);

const breaches = [];
if (budget.calls !== null && res.calls > budget.calls) breaches.push(`draw calls ${res.calls} > ${budget.calls}`);
if (budget.triangles !== null && res.triangles > budget.triangles) breaches.push(`triangles ${res.triangles} > ${budget.triangles}`);
if (budget.simMs !== null && res.simMs > budget.simMs) breaches.push(`sim ms/step ${res.simMs} > ${budget.simMs}`);
if (errors.length) breaches.push(`${errors.length} page error(s)`);
if (!res.monitor) breaches.push('window.__BB_PERF__ missing — frame monitor not wired into the loop');
if (breaches.length) for (const b of breaches) console.log(`FAIL  ${b}`);
else if (budget.calls !== null || budget.triangles !== null || budget.simMs !== null) console.log('PASS  perf budgets met');
await closeBrowser(browser);
process.exit(breaches.length ? 1 : 0);
