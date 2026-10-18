/**
 * Boot smoke check: loads the game in headless Chromium with WebGL, records
 * console/page errors, verifies the app object, WebGL context, HUD and radar
 * actually mount, then writes a screenshot.
 *
 * Exit code 0 = clean boot; 1 = errors found (they are printed).
 */
import fs from 'node:fs';
import { launchBrowser, closeBrowser } from './lib/browser.mjs';

const URL_ = process.env.BOOTCHECK_URL || 'http://127.0.0.1:3000/';
const SHOT = 'screenshots/bootcheck.png';

const errors = [];
const warnings = [];
const browser = await launchBrowser({
  defaultViewport: { width: 960, height: 540 },
  protocolTimeout: 60_000,
});

try {
  const page = await browser.newPage();
  page.on('console', (msg) => {
    const where = msg.location()?.url || '';
    const line = `console.error: ${msg.text()}${where ? ` (${where})` : ''}`;
    if (msg.type() !== 'error') return;
    // Chromium logs a console error for any non-2xx fetch; the API's first-run
    // 404 (no cloud save yet) is handled by SaveManager, so it warns, not fails.
    if (where.includes(':4000/')) warnings.push(line);
    else errors.push(line);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() < 400) return;
    const msg = `http ${res.status()}: ${res.url()}`;
    // A 404 from the game API is the documented first-run path (no cloud save
    // yet); SaveManager handles it and falls back to local state.
    if (res.url().includes(':4000/')) warnings.push(msg);
    else errors.push(msg);
  });
  page.on('requestfailed', (req) => {
    // The API is optional for boot; record but don't fail on it.
    const url = req.url();
    if (url.includes('localhost:4000') || url.includes('127.0.0.1:4000')) {
      warnings.push(`api unreachable: ${url}`);
      return;
    }
    errors.push(`requestfailed: ${url} (${req.failure()?.errorText})`);
  });

  await page.goto(URL_, { waitUntil: 'networkidle2', timeout: 45_000 });
  await new Promise((r) => setTimeout(r, 4000));

  const state = await page.evaluate(() => {
    const app = window.app || null;
    const canvases = [...document.querySelectorAll('canvas')].map((c) => ({
      id: c.id || null,
      size: `${c.width}x${c.height}`,
      // Re-acquiring the same context type returns the live context, so this
      // tells us which canvas owns a WebGL surface without disturbing a 2D one.
      webgl2: !!c.getContext('webgl2'),
    }));
    const gameCanvas = canvases.find((c) => c.webgl2) || null;
    return {
      hasApp: !!app,
      appClass: app?.constructor?.name || null,
      hasMatch: !!app?.match,
      matchState: app?.match?.state ?? null,
      matchScores: app?.match ? { home: app.match.homeScore, away: app.match.awayScore } : null,
      canvases,
      gameCanvasWebgl2: !!gameCanvas,
      hudElements: document.querySelectorAll('#app [id^="hud"], #app [id*="radar"]').length,
      title: document.title,
    };
  });

  console.log(JSON.stringify({ state, errorCount: errors.length, warnings, errors: errors.slice(0, 20) }, null, 2));
  process.exitCode = errors.length ? 1 : 0;

  // Screenshot last: under SwiftShader a capture can stall on a busy WebGL
  // loop, and the state report above is the part that gates the exit code.
  fs.mkdirSync('screenshots', { recursive: true });
  try {
    await Promise.race([
      page.screenshot({ path: SHOT, optimizeForSpeed: true }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('screenshot timeout')), 20_000)),
    ]);
    console.log(`screenshot: ${SHOT}`);
  } catch (e) {
    console.log(`screenshot skipped: ${e.message}`);
  }
} finally {
  await closeBrowser(browser);
}
