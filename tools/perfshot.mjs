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
  args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  executablePath: await chromium.executablePath(),
  headless: 'shell',
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.setViewport({ width: 1280, height: 720 });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate(() => {
  window.app.audio.unlock = () => {};
  window.app.startMatch({ home: window.app.teams[0], away: window.app.teams[3], userTeam: 0, mode: 'quick' });
});
const res = await page.evaluate(() => {
  const m = window.app.match;
  for (let i = 0; i < 60; i++) {
    m.sim.step(1 / 60);
    m.renderer.update(1 / 60);
  }
  const t0 = performance.now();
  for (let i = 0; i < 15; i++) m.renderer.render();
  const ms = (performance.now() - t0) / 15;
  const { calls, triangles } = m.renderer.renderer.info.render;
  window.app.go('title');
  return { ms: +ms.toFixed(1), calls, triangles };
});
console.log(`ms/frame (swiftshader): ${res.ms} | draw calls: ${res.calls} | triangles: ${res.triangles}${errors.length ? ` | PAGE ERRORS: ${errors.length}` : ' | clean'}`);
await browser.close();
process.exit(errors.length ? 1 : 0);
