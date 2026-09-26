/**
 * WebGL context-loss recovery check.
 *
 * Forces a real context loss via WEBGL_lose_context against a live match and asserts the app
 * freezes the clock, receives `webglcontextrestored`, rebuilds its post chain and renders again
 * instead of leaving a permanently black pool.
 *
 * Usage: node tools/contexttest.mjs [url]
 */
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const url = process.argv[2] || 'http://localhost:4173/';
process.env.LD_LIBRARY_PATH = `/tmp/al2023/lib:/tmp:${process.env.LD_LIBRARY_PATH || ''}`;
chromium.setGraphicsMode = true;
const browser = await puppeteer.launch({
  args: [
    ...chromium.args,
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
  executablePath: await chromium.executablePath(),
  headless: 'shell',
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.stack || e.message));

let failures = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate(() => document.fonts.ready);

// Start a match and run it forward so there is real state to protect.
await page.evaluate(() => {
  const app = window.app;
  app.audio.unlock = () => {};
  app.startMatch({ home: app.teams[0], away: app.teams[1], userTeam: 0, mode: 'quick' });
  for (let i = 0; i < 180; i++) app.match.sim.step(1 / 60);
});

// Stash the extension BEFORE losing: WebGL returns null for getExtension() on a lost context.
const armed = await page.evaluate(() => {
  const r = window.app.match.renderer;
  const gl = r.renderer.getContext();
  window.__loseExt = gl.getExtension('WEBGL_lose_context');
  window.__restored = false;
  r.canvas.addEventListener(
    'webglcontextrestored',
    () => {
      window.__restored = true;
    },
    false
  );
  return {
    supported: !!window.__loseExt,
    flag: r.contextLost,
    score: [...window.app.match.sim.score],
    time: window.app.match.sim.time,
  };
});
ok('WEBGL_lose_context is available in the test browser', armed.supported === true);
ok('renderer starts with contextLost = false', armed.flag === false);

const lost = await page.evaluate(async () => {
  const r = window.app.match.renderer;
  window.__loseExt.loseContext();
  await new Promise((res) => setTimeout(res, 400));
  return {
    flag: r.contextLost,
    paused: window.app.match.paused,
    time: window.app.match.sim.time,
  };
});
ok('a forced loss flags the renderer', lost.flag === true);
ok('a forced loss freezes the match clock', lost.paused === true);

// Prove the clock really is stopped: step the app's own loop and check sim.time does not move.
const held = await page.evaluate(async () => {
  const before = window.app.match.sim.time;
  await new Promise((res) => setTimeout(res, 500));
  return { before, after: window.app.match.sim.time };
});
ok(
  'match time does not advance while lost',
  Math.abs(held.after - held.before) < 1e-6,
  `t ${held.before.toFixed(2)} -> ${held.after.toFixed(2)}`
);

const recovered = await page.evaluate(async () => {
  const r = window.app.match.renderer;
  window.__loseExt.restoreContext();
  await new Promise((res) => setTimeout(res, 800));
  r.render();
  return {
    restored: window.__restored === true,
    flag: r.contextLost,
    paused: window.app.match.paused,
    hasComposer: !!r.composer,
    hasBloom: r.bloom === null || !!r.bloom,
  };
});
ok('browser fired webglcontextrestored', recovered.restored === true);
ok('renderer clears contextLost after restore', recovered.flag === false);
ok('match clock resumes after recovery', recovered.paused === false);
ok('post chain exists after rebuild', recovered.hasComposer === true);
ok('bloom pass rebuilt to a consistent state', recovered.hasBloom === true);

// Render a batch of frames: proves the rebuilt composer draws instead of throwing.
const frame = await page.evaluate(() => {
  const r = window.app.match.renderer;
  const t0 = performance.now();
  for (let i = 0; i < 12; i++) r.render();
  return (performance.now() - t0) / 12;
});
ok(
  'renders finite frames after recovery',
  Number.isFinite(frame) && frame < 500,
  `${frame.toFixed(1)}ms/frame`
);

// The clock must move again now that we are un-paused.
const resumed = await page.evaluate(async () => {
  const before = window.app.match.sim.time;
  await new Promise((res) => setTimeout(res, 600));
  return { before, after: window.app.match.sim.time };
});
ok(
  'match time advances again after recovery',
  resumed.after > resumed.before,
  `t ${resumed.before.toFixed(2)} -> ${resumed.after.toFixed(2)}`
);

ok('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(failures === 0 ? '\nALL CONTEXT TESTS PASSED' : `\n${failures} CONTEXT TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
