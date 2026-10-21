/**
 * Screenshot every screen and every mode for visual QA.
 * Usage: node tools/screens.mjs [url] [dir]
 *
 * This is the broadest automated check the project has: it loads the real build in Chromium, walks
 * the real screens through the real app object, and fails on any uncaught page error.
 *
 * The pass is split into groups, and each group gets a fresh browser. The bundled headless shell
 * runs WebGL on SwiftShader, and in a container the browser process dies after a handful of large
 * readbacks — the *app* survives (eight screen changes and a live duel run fine), but
 * `Page.captureScreenshot` starts returning "Target closed" and then the whole browser goes with
 * it. A fresh launch costs ~150 ms, which is far cheaper than a pass that dies on screen four.
 */
import fs from 'node:fs';
import { launchBrowser, closeBrowser } from './lib/browser.mjs';

const url = process.argv[2] || 'http://localhost:3000/';
const dir = process.argv[3] || 'screenshots/screens';
const viewport = { width: parseInt(process.env.W || '1280', 10), height: parseInt(process.env.H || '720', 10) };
fs.mkdirSync(dir, { recursive: true });

const errors = [];
let browser = null;
let page = null;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function openPage() {
  if (browser) await closeBrowser(browser);
  browser = await launchBrowser({ defaultViewport: viewport });
  page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('[page:error]', m.text()); });
  page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.stack || e.message); });
  // `networkidle0` never fires against a dev server: Vite keeps its HMR socket open, so the idle
  // window never closes and the pass sits on the first navigation.
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await wait(1000);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => { window.app.audio.unlock = () => {}; });
  return page;
}

async function shot(name, ms = 400) {
  await wait(ms);
  try {
    await page.screenshot({ path: `${dir}/${name}.png` });
    console.log('shot', name);
  } catch (error) {
    console.log('shot', name, 'FAILED:', error.message);
    errors.push(`screenshot ${name}: ${error.message}`);
  }
}
const go = (name, params) => page.evaluate((n, p) => window.app.go(n, p), name, params || {});
const press = async (code, times = 1) => {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(code);
    await wait(120);
  }
};
const startMatch = (modeId, seats) => page.evaluate((m, s) => {
  const T = window.app.teams;
  window.app.startMatch({ home: T[0], away: T[1], modeId: m, seats: s || null });
}, modeId, seats || null);
/** Play the attached sim out to full time. */
const toFinalWhistle = () => page.evaluate(() => {
  const sim = window.app.match.sim;
  let n = 0;
  while (sim.state !== 'over' && n++ < 60 * 60 * 25) sim.step(1 / 60);
});

// --- Group 1: menus --------------------------------------------------------
await openPage();
await shot('01-title');
await press('ArrowDown', 2);
await shot('02-title-nav', 200);
await go('modes');
await shot('03-modes');
await press('ArrowRight', 4);
await shot('04-modes-nav', 200);

// --- Group 2: ranked, custom, lobby ---------------------------------------
await openPage();
await go('ranked');
await shot('05-ranked', 300);
await go('custom');
await shot('06-custom', 300);
await go('gauntlet');
await shot('06b-gauntlet', 300);
await go('lobby');
await shot('07-lobby', 1500);

// --- Group 3: team selects and how-to -------------------------------------
await openPage();
await go('teamselect', { modeId: 'duel' });
await shot('08-teamselect-duel', 300);
await go('teamselect', { modeId: 'blitz' });
await shot('09-teamselect-blitz', 300);
await go('howto');
await shot('10-howto', 300);

// --- Group 4: career hub and roster ---------------------------------------
await openPage();
await page.evaluate(() => window.app.startCareer('dockside_kraken'));
await shot('11-career', 700);
await go('roster', { teamId: 'dockside_kraken', back: 'career' });
await shot('12-roster', 300);

// --- Group 5: a live match, pause, and a goal replay ----------------------
await openPage();
await startMatch('quick');
await shot('13-match-warmup', 900);
await page.evaluate(() => {
  const sim = window.app.match.sim;
  let n = 0;
  while (sim.state !== 'live' && n++ < 60 * 30) sim.step(1 / 60);
  for (let i = 0; i < 400; i++) sim.step(1 / 60);
});
await shot('14-match-live', 600);
await press('Escape');
await shot('15-pause', 300);
await press('Escape');
// Record live play, then score so the director cuts a clip over the same entities.
await page.evaluate(() => {
  const sim = window.app.match.sim;
  for (let i = 0; i < 260; i++) {
    sim.step(1 / 60);
    window.app.recorder.record(sim, 1 / 60);
  }
  const scorer = sim.outfield(sim.possession)[0];
  scorer.pos.x = 0;
  scorer.pos.z = 0;
  sim.ball.holder = scorer;
  sim.scoreGoal(scorer, null, false);
});
await shot('16-goal-replay', 500);
const replayState = await page.evaluate(() => ({
  replaying: !!window.app.match.replaying,
  overlay: !!window.app.replayOverlay?.shown,
  clipFrames: window.app.director?.clip?.frames?.length || 0,
  cameraCut: window.app.sceneView.replayActive,
}));
console.log('replay', JSON.stringify(replayState));

// --- Group 6: results after a replay -------------------------------------
await openPage();
await startMatch('quick');
await page.evaluate(() => { window.app.match.sim.state = 'over'; window.app.match.sim.winner = 0; });
await wait(500);
await shot('17-results', 700);

// --- Group 7: local duel (split screen) and spectate ----------------------
await openPage();
await startMatch('duel', [0, 1]);
await page.evaluate(() => {
  const sim = window.app.match.sim;
  let n = 0;
  while (sim.state !== 'live' && n++ < 60 * 30) sim.step(1 / 60);
  for (let i = 0; i < 500; i++) sim.step(1 / 60);
});
await shot('18-local-duel', 700);
const duelState = await page.evaluate(() => ({
  split: window.app.match.split,
  seats: window.app.match.sim.seats.map((s) => ({ team: s.team, pilot: s.controlled?.data?.nick || null })),
  cam2: !!window.app.sceneView.gameCam2,
  card2: !!document.querySelector('.hud .pcard-2'),
}));
console.log('local duel', JSON.stringify(duelState));
await startMatch('watch');
await page.evaluate(() => {
  const sim = window.app.match.sim;
  let n = 0;
  while (sim.state !== 'live' && n++ < 60 * 30) sim.step(1 / 60);
  for (let i = 0; i < 300; i++) sim.step(1 / 60);
});
await shot('19-spectate', 600);

// --- Group 8: the rules each mode actually installs ----------------------
await openPage();
await startMatch('blitz');
const blitzRules = await page.evaluate(() => {
  const r = window.app.match.sim.rules;
  return { halfLength: r.halfLength, targetGoals: r.targetGoals, clock: r.possessionClock, halves: r.halves };
});
console.log('blitz rules', JSON.stringify(blitzRules));
await startMatch('apex');
const apexRules = await page.evaluate(() => ({
  windows: window.app.match.sim.rules.goalWindows,
  lowRingValue: window.app.match.sim.rules.goalPoints,
  target: window.app.match.sim.rules.targetGoals,
}));
console.log('apex rules', JSON.stringify(apexRules));

// --- Group 9: trials grade -------------------------------------------------
await openPage();
await startMatch('proving');
await page.evaluate(() => {
  const sim = window.app.match.sim;
  let n = 0;
  while (sim.state !== 'live' && n++ < 60 * 30) sim.step(1 / 60);
  sim.ringGoals[0][0] = 2;
  sim.ringGoals[0][1] = 1;
  sim.teamPlayers(0)[0].stats.goals = 2;
  sim.teamPlayers(0)[1].stats.goals = 1;
  while (sim.state !== 'over' && n++ < 60 * 60 * 20) sim.step(1 / 60);
});
await shot('20-trials-results', 900);
const trial = await page.evaluate(() => ({
  stars: document.querySelector('.rt-stars')?.textContent || '',
  verdict: document.querySelector('.rt-verdict')?.textContent || '',
  half: window.app.match.sim.half,
}));
console.log('trials', JSON.stringify(trial));

// --- Group 10: ranked result moves the ladder ----------------------------
await openPage();
await startMatch('ladder');
await toFinalWhistle();
await shot('21-ranked-results', 900);
const rankedSave = await page.evaluate(() => ({
  rating: Math.round(window.app.state.ranked?.rating),
  matches: window.app.state.ranked?.matches,
  history: window.app.state.ranked?.history?.length,
  shown: document.querySelector('.res-ranked')?.textContent || '',
}));
console.log('ranked after a match', JSON.stringify(rankedSave));
await go('modes');
await shot('22-modes-ranked', 400);

// --- Group 11: career result still routes back to the ladder ------------
await openPage();
await page.evaluate(() => window.app.startCareer('dockside_kraken'));
await toFinalWhistle();
await shot('23-career-results', 900);
await press('Enter');
await shot('24-back-to-career', 500);
const summary = await page.evaluate(() => ({
  teams: window.app.teams.length,
  screen: window.app.currentScreen,
  careerWins: window.app.state.career?.wins ?? null,
}));
console.log('summary', JSON.stringify(summary), errors.length ? `${errors.length} problem(s)` : 'clean');

if (browser) await closeBrowser(browser);
process.exit(errors.length ? 1 : 0);
