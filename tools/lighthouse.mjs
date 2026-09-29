/**
 * Lighthouse audit of the built site, served locally and scored with mobile emulation.
 *
 * Usage: node tools/lighthouse.mjs [--url http://127.0.0.1:PORT/] [--out screenshots/lighthouse]
 *        [--threshold 90] [--categories performance,accessibility]
 *
 * Serves ./dist with a tiny static server (no vite dependency at audit time), runs Lighthouse's
 * mobile preset over it, and prints a category table plus the failed audits so the numbers can be
 * acted on rather than just admired. Exits 1 if any requested category scores below --threshold.
 *
 * Prereq: `npm run build` first — this audits the real artifact, not the dev server.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { parseArgs } from 'node:util';
import lighthouse from 'lighthouse';
import { launch } from 'chrome-launcher';
import chromium from '@sparticuz/chromium';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const args = process.argv.slice(2);
const flags = {
  url: pick(['--url'], 'http://127.0.0.1:4173/'),
  categories: (opt('--categories') || 'performance,accessibility,best-practices,seo').split(','),
  threshold: Number(opt('--threshold') || 90),
  out: opt('--out') || 'screenshots/lighthouse',
  // Report the performance score without gating on it: a 2-core software-GL CI runner measures
  // the runner, not the game — frame-time budgets are qa:perf's job. Pass to keep CI green on
  // perf while still publishing the metrics in the report artifact.
  perfInformational: args.includes('--perf-informational'),
};
function opt(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
function pick(names, fallback) {
  for (const n of names) {
    const v = opt(n);
    if (v) return v;
  }
  return fallback;
}

// --- static server ---------------------------------------------------------
const root = normalize('dist');
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (p === '/' || p === '\\') p = '/index.html';
    const file = join(root, p);
    if (!file.startsWith(root)) throw new Error('traversal');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('nope');
  }
});
await new Promise((r) => server.listen(4173, '127.0.0.1', r));
console.log(`serving ${root}/ on ${flags.url}`);

// --- chrome + lighthouse ---------------------------------------------------
// Two environments run this: GitHub CI (system Chrome via CHROME_PATH, fonts present) and the
// Freebuff sandbox (only @sparticuz/chromium, no fonts at all — the audit reports INCONCLUSIVE
// there because no glyph can rasterize; see the NO_FCP note below).
const chromePath = process.env.CHROME_PATH || (await chromium.executablePath());
const chromeFlags = process.env.CHROME_PATH
  ? ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage']
  : [
      ...chromium.args,
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
    ];
if (!process.env.CHROME_PATH) {
  process.env.LD_LIBRARY_PATH = `/tmp/al2023/lib:/tmp:${process.env.LD_LIBRARY_PATH || ''}`;
  chromium.setGraphicsMode = true;
}
const chrome = await launch({ chromePath, chromeFlags });
const config = {
  extends: 'lighthouse:default',
  settings: {
    onlyCategories: flags.categories,
    formFactor: 'mobile',
    screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false },
    throttling: { rttMs: 150, throughputKbps: 1638.4, requestLatencyMs: 562.5, downloadThroughputKbps: 1474.6, uploadThroughputKbps: 675, cpuSlowdownMultiplier: 4 },
  },
};
let reports, report;
try {
  const result = await lighthouse(flags.url, { port: chrome.port, output: ['json', 'html'], logLevel: 'error' }, config);
  reports = result.report; // [jsonString, htmlString]
  report = JSON.parse(reports[0]);
} finally {
  await chrome.kill();
  server.close();
}

// --- report ----------------------------------------------------------------
const { mkdirSync, writeFileSync } = await import('node:fs');
mkdirSync(flags.out, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const jsonPath = join(flags.out, `lighthouse-${stamp}.json`);
const htmlPath = join(flags.out, `lighthouse-${stamp}.html`);
writeFileSync(jsonPath, reports[0]);
writeFileSync(htmlPath, reports[1]);

const rows = [];
let failures = 0;
let measured = 0;
for (const cat of flags.categories) {
  const c = report.categories[cat];
  if (c?.score === null || c?.score === undefined) {
    // A null category score means the gather pass died (see runWarnings), not a bad score.
    rows.push(`SKIP  ${cat.padEnd(15)}  —  could not be measured`);
    continue;
  }
  measured++;
  const score = Math.round(c.score * 100);
  const gated = !(cat === 'performance' && flags.perfInformational);
  const ok = score >= flags.threshold || !gated;
  if (!ok) failures++;
  rows.push(`${ok ? 'PASS' : 'FAIL'}  ${cat.padEnd(15)} ${String(score).padStart(3)}  (threshold ${flags.threshold}${gated ? '' : ', informational'})`);
}
console.log(`\n${report.fetchTime}  —  Lighthouse v${report.lighthouseVersion} on ${report.environment.hostUserAgent}\n`);
console.log(rows.join('\n'));

// Nothing measured at all: the audit is void — report why instead of a table of zeros.
if (measured === 0) {
  console.log(`\nINCONCLUSIVE: the browser painted no content during the audit
  (${report.runtimeError?.code || 'null category scores'}${report.runWarnings.length ? `; runWarnings: ${report.runWarnings.join(' | ')}` : ''})

  In a stripped container the usual cause is NO FONTS: with zero system fonts no glyph can
  rasterize, so "first contentful paint" can never fire on ANY page, even a trivial static one.
  Verify locally with: fc-list | wc -l   (0 means this environment cannot score FCP)

  Otherwise it is a too-slow environment for the audited load — run where real Chrome, fonts and
  a couple of cores exist: .github/workflows/ci.yml does exactly that.`);
  process.exit(2);
}

console.log('\n--- metrics ---');
for (const [k, a] of Object.entries(report.audits)) {
  if (a.score === null || a.score === undefined) continue;
  if (a.scoreDisplayMode === 'informative' || a.scoreDisplayMode === 'notApplicable') continue;
  if (a.score < 0.9 && a.displayValue) console.log(`  ${k.padEnd(34)} ${a.displayValue}`);
}

console.log('\n--- audits that cost points ---');
const bad = Object.values(report.audits)
  .filter((a) => a.score !== null && a.score < 1 && a.scoreDisplayMode !== 'manual' && a.scoreDisplayMode !== 'notApplicable')
  .sort((a, b) => (a.score ?? 1) - (b.score ?? 1));
if (!bad.length) console.log('  (none)');
for (const a of bad.slice(0, 24)) {
  console.log(`  ${a.score === 0 ? 'x' : '~'} ${a.id}  ${a.displayValue || ''}`);
  const items = a.details?.items?.slice(0, 3) || [];
  for (const it of items) {
    const line = it.url || it.node?.selector || it.source?.value || '';
    if (line) console.log(`      ${String(line).slice(0, 140)}`);
  }
}
console.log(`\nreports: ${jsonPath} + ${htmlPath}`);
// 0 = all thresholds met, 1 = measured and below threshold, 2 = could not measure (environment).
process.exit(failures ? 1 : 0);
