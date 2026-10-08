/**
 * Dev-tool gate: `?perf` (frame-tail overlay) and `?tune` (live balance panel) must mount and work
 * against the real app, and a dial edited in the panel must reach a match that is already running.
 *
 * Both tools are opt-in, so nothing in the normal test run touches them — which is exactly how a
 * broken dynamic import or a renamed DOM id rots unnoticed until someone needs the panel mid
 * rebalance. This drives them the way a developer does: open the flag, start a match, edit a dial,
 * read it back through the sim, then hit RESET.
 *
 * Each flag runs in its own browser. On a GPU-less host a page that has held a software-GL context
 * through a live match is the least stable thing there is (the same limitation qa:touch reports), and
 * re-navigating it or opening a second page next to it takes the renderer process down — which would
 * read as "the panel is broken" instead of "the host is a software rasteriser".
 *
 * Usage: node tools/devtools.mjs [url] [dir]      (also writes the screenshots it took)
 */
import fs from 'node:fs';
import { launchBrowser, closeBrowser } from './lib/browser.mjs';

const url = process.argv[2] || 'http://localhost:4173/';
const dir = process.argv[3] || 'screenshots/devtools';
const base = url.replace(/\/$/, '');
const withFlag = (flag) => `${base}/${base.includes('?') ? '&' : '?'}${flag}`;

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
fs.mkdirSync(dir, { recursive: true });

/** Run `fn(page)` in a browser of its own, and always hand the machine back. */
async function withPage(fn) {
  const browser = await launchBrowser({ defaultViewport: { width: 1280, height: 720 } });
  const page = await browser.newPage();
  try {
    return await fn(page);
  } finally {
    await closeBrowser(browser);
  }
}

// ---------------------------------------------------------------- ?perf
const perf = await withPage(async (page) => {
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('[pageerror]', e.stack || e.message); });
  await page.goto(withFlag('perf&seed=2468'), { waitUntil: 'networkidle0', timeout: 60000 });
  await page.evaluate(() => {
    window.app.audio.unlock = () => {};
    window.app.state.settings.quality = 'high';
    const T = window.app.teams;
    window.app.startMatch({ home: T[0], away: T[3], userTeam: 0, mode: 'quick', seed: 2468 });
  });
  // Let the real loop produce frames: the overlay reads its own rAF cadence, not a driven burst.
  await new Promise((r) => setTimeout(r, 2500));
  const read = await page.evaluate(() => ({
    text: document.getElementById('perf-hud')?.textContent || '',
    summary: window.__BB_PERF__ ? window.__BB_PERF__.summary() : null,
  }));
  await page.screenshot({ path: `${dir}/perf-overlay.png` });
  return { ...read, pageErrors };
});
check('?perf mounts the overlay and it records real frames',
  perf.text.includes('FRAME') && (perf.summary?.frames || 0) > 5, `${perf.summary?.frames || 0} frames`);
check('?perf reports the tail (p99, max, hitch count) with the hitch threshold',
  perf.text.includes('HITCH') && perf.text.includes('p99') && perf.summary?.hitchMs > 0);
check('?perf reports the whole frame\'s GPU load from a running match',
  (perf.summary?.counters?.calls || 0) > 100 && perf.text.includes('calls'),
  `${perf.summary?.counters?.calls || 0} draw calls, ${perf.summary?.counters?.programs || 0} programs`);

// ---------------------------------------------------------------- ?tune
const tune = await withPage(async (page) => {
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('[pageerror]', e.stack || e.message); });
  await page.goto(withFlag('tune&seed=2468'), { waitUntil: 'networkidle0', timeout: 60000 });
  await page.evaluate(() => { window.app.audio.unlock = () => {}; });
  await page.waitForFunction(() => !!window.__BB_TUNE__, { timeout: 10000 }).catch(() => {});
  const mounted = await page.evaluate(() => ({
    panel: !!document.getElementById('tune-panel'),
    fields: window.__BB_TUNE__ ? window.__BB_TUNE__.fields.length : 0,
  }));
  const edited = await page.evaluate(() => {
    const app = window.app;
    const T = app.teams;
    // A match is already in flight: a tuning change must land in it, not only in the next one.
    app.startMatch({ home: T[0], away: T[3], userTeam: 0, mode: 'quick', seed: 2468 });
    const before = app.match.sim.rules.possessionClock;
    const input = document.getElementById('tune-RULES.possessionClock');
    input.value = String(before + 3);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return {
      before,
      constant: window.__BB_TUNE__.read('RULES.possessionClock'),
      inMatch: app.match.sim.rules.possessionClock,
      diff: window.__BB_TUNE__.panel.diffText(),
    };
  });
  await page.screenshot({ path: `${dir}/tune-panel.png` });
  const reset = await page.evaluate(() => {
    document.querySelectorAll('#tune-panel button')[0].click(); // the panel's first button is RESET
    return { value: window.__BB_TUNE__.read('RULES.possessionClock'), diff: window.__BB_TUNE__.panel.diffText() };
  });
  return { mounted, edited, reset, pageErrors };
});
check('?tune mounts the balance panel with the whole dial surface',
  tune.mounted.panel && tune.mounted.fields > 100, `${tune.mounted.fields} dials`);
check('a dial dragged in the panel edits the constant',
  tune.edited.constant === tune.edited.before + 3, `possessionClock ${tune.edited.before} -> ${tune.edited.constant}`);
check('the match already in flight picks the change up immediately',
  tune.edited.inMatch === tune.edited.before + 3);
check('the diff is copy-paste ready for src/data/constants.js',
  tune.edited.diff.includes('possessionClock:') && tune.edited.diff.includes('// RULES'),
  JSON.stringify(tune.edited.diff.split('\n')[1] || ''));
check('RESET puts every dial back and empties the diff', tune.reset.diff === '',
  `possessionClock back to ${tune.reset.value}`);

const pageErrors = [...perf.pageErrors, ...tune.pageErrors];
console.log(`page errors: ${pageErrors.length}`);
const failed = checks.filter((c) => !c).length;
console.log(failed ? `\nFAIL: ${failed} of ${checks.length} dev-tool checks` : `\nPASS: all ${checks.length} dev-tool checks`);
process.exit(failed || pageErrors.length ? 1 : 0);
