/**
 * Frame-time / GPU-load spot check: starts one match, steps the sim, then times a short
 * burst of render frames and reports draw calls + triangles. Complements tools/probe.mjs,
 * which runs many full matches (slow); this one exits in a few seconds.
 * Usage: node tools/perfshot.mjs [url]
 */
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
process.env.LD_LIBRARY_PATH = `/tmp/al2023/lib:/tmp:${process.env.LD_LIBRARY_PATH || ''}`;
chromium.setGraphicsMode = true;
const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  executablePath: await chromium.executablePath(),
  headless: true,
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: process.argv[3] !== 'baseline' });
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
  window.app.go('title');
  return { ms: +ms.toFixed(1), simMs: +simMs.toFixed(3), calls, triangles, dpr };
});
console.log(`mobile ms/frame (software GPU, synchronized): ${res.ms} | sim ms/step: ${res.simMs} | draw calls: ${res.calls} | triangles: ${res.triangles} | DPR: ${res.dpr}${errors.length ? ` | PAGE ERRORS: ${errors.length}` : ' | clean'}`);
await browser.close();
process.exit(errors.length ? 1 : 0);
