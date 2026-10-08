/**
 * Automated browser playtest through the real app (renderer + HUD + audio + commentary).
 * Software-GL frames are slow, so the sim is advanced directly between frames to reach a
 * full game quickly; every event still flows through the presentation layer.
 * Usage: node tools/playtest.mjs [url] [shotsDir] [maxSimSeconds]
 * Env: USER_TEAM=1 -> user-controlled match with scripted keyboard input; VERBOSE=1 -> console
 */
import fs from 'node:fs';
import { launchBrowser } from './lib/browser.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const dir = process.argv[3] || 'screenshots/play';
const maxSim = parseFloat(process.argv[4] || '600');
fs.mkdirSync(dir, { recursive: true });
const browser = await launchBrowser({
  args: ['--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: parseInt(process.env.W || '1280', 10), height: parseInt(process.env.H || '720', 10) },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { const t = m.type(); if (t === 'error') console.log(`[page:${t}]`, m.text()); else if (process.env.VERBOSE) console.log('[page]', m.text()); });
page.on('pageerror', (e) => { errors.push(e.stack || e.message); console.log('[pageerror]', e.stack || e.message); });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
const userMode = !!process.env.USER_TEAM;
await page.evaluate(async (userTeam, mode) => {
  const app = window.app;
  const TEAMS = app.teams;
  app.audio.unlock = () => {};
  app.startMatch({ home: TEAMS[0], away: TEAMS[3], userTeam, mode });
}, userMode ? 0 : null, userMode ? 'quick' : 'versus');

await page.evaluate((n) => { window.__stepsPerIter = n; }, parseInt(process.env.STEPS || '240', 10));
let i = 0;
const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'KeyJ', 'KeyK', 'KeyL', 'KeyI', 'KeyU', 'KeyE', 'Tab'];
for (;;) {
  // Advance ~4 sim seconds (240 fixed steps) via the app's own loop path when possible.
  const snap = await page.evaluate((userMode) => {
    const app = window.app;
    const m = app.match;
    if (!m) return { none: true, screen: app.screen && app.screen.name };
    const s = m.sim;
    if (s.state !== 'over') {
      for (let k = 0; k < (window.__stepsPerIter || 240); k++) {
        if (userMode) {
          const inp = app.input.poll();
          s.setUserInput(inp);
        }
        s.step(1 / 60);
      }
    }
    m.renderer.update(1 / 30);
    m.hud.update();
    return { ...s.snapshot(), cam: m.renderer.camera.position.toArray().map((v) => +v.toFixed(1)), finished: m.finished };
  }, userMode);
  if (userMode) {
    // scripted chaos: hold a random movement key + random action taps
    for (const k of keys) await page.keyboard.up(k);
    const mv = keys[Math.floor(Math.random() * 4)];
    await page.keyboard.down(mv);
    if (Math.random() < 0.5) await page.keyboard.down('ShiftLeft');
    const act = keys[5 + Math.floor(Math.random() * 7)];
    await page.keyboard.press(act);
  }
  await new Promise((r) => setTimeout(r, 150));
  console.log(`[${i}]`, JSON.stringify(snap));
  if (!process.env.NOSHOTS) await page.screenshot({ path: `${dir}/${String(i).padStart(2, '0')}.png` });
  i++;
  if (snap.none) break;
  if (snap.state === 'over' || snap.t > maxSim) {
    // let finishMatch + results screen run in real time
    await new Promise((r) => setTimeout(r, 4500));
    const scr = await page.evaluate(() => ({ screen: window.app.screen && window.app.screen.name, hasMatch: !!window.app.match, results: !!document.querySelector('.results') }));
    console.log('after game:', JSON.stringify(scr));
    await page.screenshot({ path: `${dir}/results.png` });
    break;
  }
}
await browser.close();
console.log(errors.length ? `${errors.length} error(s)` : 'clean');
process.exit(errors.length ? 1 : 0);
