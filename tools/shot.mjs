/**
 * Headless screenshot / smoke-test harness.
 * Usage: node tools/shot.mjs <url> <outfile> [script]
 *   script: a JS snippet evaluated in the page after load (async allowed), e.g. "await window.__test.play()"
 */
import { launchBrowser } from './lib/browser.mjs';

const [,, url, out, script] = process.argv;
const width = parseInt(process.env.W || '1280', 10);
const height = parseInt(process.env.H || '720', 10);

const browser = await launchBrowser({
  args: ['--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width, height },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  const t = m.type();
  if (t === 'error' || t === 'warning') console.log(`[page:${t}]`, m.text());
  else if (process.env.VERBOSE) console.log('[page]', m.text());
});
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.stack || e.message); });
page.on('requestfailed', (r) => console.log('[reqfail]', r.url(), r.failure()?.errorText));
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
if (script) {
  try {
    await page.evaluate(`(async () => { ${script} })()`);
  } catch (e) {
    console.log('[script error]', e.message);
    errors.push(e.message);
  }
}
await new Promise((r) => setTimeout(r, parseInt(process.env.WAIT || '300', 10)));
await page.screenshot({ path: out });
console.log('saved', out, errors.length ? `with ${errors.length} error(s)` : 'clean');
await browser.close();
process.exit(errors.length ? 1 : 0);
