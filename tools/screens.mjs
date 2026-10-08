/** Screenshot every menu screen + pause overlay for visual QA. Usage: node tools/screens.mjs [url] [dir] */
import fs from 'node:fs';
import { launchBrowser } from './lib/browser.mjs';
const url = process.argv[2] || 'http://localhost:5173/';
const dir = process.argv[3] || 'screenshots/screens';
fs.mkdirSync(dir, { recursive: true });
const browser = await launchBrowser({
  defaultViewport: { width: parseInt(process.env.W || '1280', 10), height: parseInt(process.env.H || '720', 10) },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') console.log('[page:error]', m.text()); });
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.stack || e.message); });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.evaluate(() => { window.app.audio.unlock = () => {}; });
const shot = async (name, wait = 400) => { await new Promise((r) => setTimeout(r, wait)); await page.screenshot({ path: `${dir}/${name}.png` }); console.log('shot', name); };
const go = async (name, params) => page.evaluate((n, p) => window.app.go(n, p), name, params || {});
const press = async (code, times = 1) => { for (let i = 0; i < times; i++) { await page.keyboard.press(code); await new Promise((r) => setTimeout(r, 120)); } };

await shot('title');
await press('ArrowDown', 2); await shot('title-nav', 200);
await go('teamselect', { mode: 'quick' }); await shot('teamselect');
await press('ArrowRight', 3); await shot('teamselect-nav', 200);
await go('howto'); await shot('howto');
await go('settings', { back: 'title' }); await shot('settings');
await press('ArrowDown', 3); await press('ArrowRight', 1); await shot('settings-nav', 200);
await page.evaluate(() => window.app.startCareer('dockside_kraken')); await shot('career', 600);
await go('roster', { teamId: 'dockside_kraken', back: 'title' }); await shot('roster');
await go('teamselect', { mode: 'career' }); await shot('teamselect-career');
// Start a match and pause it
await page.evaluate(async () => { const TEAMS = window.app.teams; window.app.startMatch({ home: TEAMS[2], away: TEAMS[5], userTeam: 0, mode: 'quick' }); });
await shot('match-tip', 800);
await page.evaluate(() => { const m = window.app.match; for (let i = 0; i < 400; i++) m.sim.step(1 / 60); m.renderer.update(0.05); m.hud.update(); });
await shot('match-live', 600);
await press('Escape'); await shot('pause', 300);
await press('ArrowDown', 1); await press('Enter'); await shot('pause-settings', 300);
await press('Escape'); await shot('pause-back', 300);
await press('Escape'); await shot('resumed', 300);
// Simulate to end of game to see results + career flow
await page.evaluate(() => { const m = window.app.match; let n = 0; while (m.sim.state !== 'over' && n++ < 60000) m.sim.step(1 / 60); m.renderer.update(0.05); m.hud.update(); });
await shot('gameover', 800);
await new Promise((r) => setTimeout(r, 3800)); await shot('results', 200);
await press('Enter'); await shot('after-results', 500);
const teamsCount = await page.evaluate(() => window.app.teams.length);
console.log('teams', teamsCount, errors.length ? `${errors.length} error(s)` : 'clean');
await browser.close();
process.exit(errors.length ? 1 : 0);
