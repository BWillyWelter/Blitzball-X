/**
 * Screenshot every animation state / trick / swim speed for visual QA.
 * Usage: node tools/anim.mjs [url] [dir]
 *   url: app root (bench query is appended automatically), default http://localhost:5173/
 *   dir: default screenshots/anim
 *
 * Sweep: 17 states x 3 samples, 10 tricks x 3, swim at 3 speeds x 4 phases,
 * save mirrored, turbo tackle, carry pose for ball states. ~100 shots.
 * Exit code 1 if the page threw.
 */
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const baseUrl = process.argv[2] || 'http://localhost:5173/';
const dir = process.argv[3] || 'screenshots/anim';
fs.mkdirSync(dir, { recursive: true });
process.env.LD_LIBRARY_PATH = `/tmp/al2023/lib:/tmp:${process.env.LD_LIBRARY_PATH || ''}`;
chromium.setGraphicsMode = true;

const browser = await puppeteer.launch({
  args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  defaultViewport: { width: parseInt(process.env.W || '900', 10), height: parseInt(process.env.H || '900', 10) },
  executablePath: await chromium.executablePath(),
  headless: 'shell',
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') console.log('[page:error]', m.text()); });
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.stack || e.message); });

const sep = baseUrl.includes('?') ? '&' : '?';
await page.goto(`${baseUrl}${sep}bench=anim`, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForFunction(() => window.__bench && window.__bench.ready, { timeout: 30000 });
await page.evaluate(() => document.fonts.ready);

let n = 0;
const shot = async (name, settleMs = 220) => {
  await new Promise((r) => setTimeout(r, settleMs));
  await page.screenshot({ path: `${dir}/${name}.png` });
  n++;
  if (n % 10 === 0) console.log('shot', n, '—', name);
};

const pose = (state, u, opts) => page.evaluate(
  (s, v, o) => window.__bench.pose(s, v, o), state, u, opts || {},
);

const STATES = await page.evaluate(() => window.__bench.states);
const TRICKS = await page.evaluate(() => window.__bench.tricks);

// States that should ALSO be shot with the ball carried (carry-arm tuck visible).
const CARRY_STATES = new Set(['idle', 'swim', 'catch', 'shoot', 'pass', 'trick']);

for (const state of STATES) {
  for (const u of [0.15, 0.5, 0.85]) {
    await pose(state, u, { held: CARRY_STATES.has(state) });
    await shot(`${state}_${Math.round(u * 100)}`);
  }
}

// Swim cycle at three speeds, four phases each.
for (const speed of [0.2, 0.6, 1.0]) {
  for (const u of [0, 0.25, 0.5, 0.75]) {
    await pose('swim', u, { speed, held: true });
    await shot(`swim_s${speed}_${u * 100}`);
  }
}

// Every trick, mid-roll is the money frame.
for (const t of TRICKS) {
  for (const u of [0.25, 0.5, 0.75]) {
    await pose('trick', u, { trick: t.id, held: true });
    await shot(`trick${t.id}_${t.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Math.round(u * 100)}`);
  }
}

// Directional / variant checks.
await pose('save', 0.5, { mirror: true });
await shot('save_mirrored_50');
await pose('tackle', 0.25, { turbo: true });
await shot('tackle_turbo_25');
await pose('idle', 0.5, { held: false });
await shot('idle_free_50');

await browser.close();
console.log(`done: ${n} screenshots in ${dir}/`, errors.length ? `${errors.length} error(s)` : 'clean');
process.exit(errors.length ? 1 : 0);
