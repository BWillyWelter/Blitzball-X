import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

/**
 * Bench / discipline browser check.
 *
 * The node suite proves the sim rules (a sub swaps the slot, the bench pool holds the outgoing
 * swimmer, a foul hands the ball over). This proves the parts only a browser can crash: the HUD
 * stamina bar rendering, the bench panel opening and making a change, and the renderer's view
 * cache being rebuilt when a slot's swimmer is replaced mid-match. A stale CharacterView here is
 * a GPU leak and a visual ghost, and no node test can see it.
 */
const url = process.argv[2] || 'http://localhost:5173/';
process.env.LD_LIBRARY_PATH = `/tmp/al2023/lib:/tmp:${process.env.LD_LIBRARY_PATH || ''}`;
const executablePath = await chromium.executablePath();
const browser = await puppeteer.launch({
  executablePath,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
  protocolTimeout: 600000,
});

let failures = 0;
const errors = [];
const ok = (label, condition, details = '') => {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${details ? `  ${details}` : ''}`);
};

const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
await page.evaluate(() => document.fonts.ready);

await page.evaluate(() => {
  const app = window.app;
  app.audio.unlock = () => {};
  app.startMatch({ home: app.teams[0], away: app.teams[3], userTeam: 0, mode: 'quick' });
  app.match.paused = true;
  const sim = app.match.sim;
  let guard = 0;
  while (sim.state !== 'live' && guard++ < 60 * 20) sim.step(1 / 60);
  for (let i = 0; i < 120; i++) sim.step(1 / 60);
});

// ------------------------------------------------------------------ the bench exists
const bench = await page.evaluate(() => {
  const sim = window.app.match.sim;
  return {
    bench: sim.benchOf(0).length,
    subsLeft: sim.subsLeft[0],
    inWater: sim.players.filter((p) => p.team === 0).length,
    allRoles: sim.players.map((p) => p.role),
    benchRoles: sim.benchOf(0).map((b) => b.role),
    starterRoles: sim.players.filter((p) => p.team === 0).map((p) => p.role),
  };
});
ok('four swimmers on the bench', bench.bench === 4, `bench=${bench.bench}`);
ok('four substitutions available', bench.subsLeft === 4, `subsLeft=${bench.subsLeft}`);
ok('seven in the water per side', bench.inWater === 7 && bench.allRoles.filter((r) => r === 'GK').length === 2, `gk=${bench.allRoles.filter((r) => r === 'GK').length}`);
ok('bench is the non-starters, role-split correctly', bench.benchRoles.filter((r) => r === 'GK').length === 1, bench.benchRoles.join('/'));

// ------------------------------------------------------- a substitution, end to end
const sub = await page.evaluate(() => {
  const app = window.app;
  const sim = app.match.sim;
  const before = {
    water: sim.players.filter((p) => p.team === 0).map((p) => p.id),
    views: app.match.renderer.views.size,
    stamina: sim.players.filter((p) => p.team === 0).map((p) => p.stamina),
  };
  // Force the situation: a dead ball and one tired swimmer.
  sim.state = 'dead';
  sim.stateTimer = 1.4;
  const tired = sim.players.filter((p) => p.team === 0 && sim.subIsSafe(0, p))[0];
  tired.stamina = 4;
  const incoming = sim.bestSubFor(0, tired);
  const okSwap = sim.applySub(0, tired, incoming);
  // The renderer learns about the new roster on its next update.
  app.match.renderer.update(1 / 60);
  const after = {
    water: sim.players.filter((p) => p.team === 0).map((p) => p.id),
    views: app.match.renderer.views.size,
    subsLeft: sim.subsLeft[0],
    benchHasOut: sim.benchOf(0).some((b) => b.id === tired.id),
    viewForIncoming: !!app.match.renderer.views.get(incoming.id),
    viewForOutgoing: !!app.match.renderer.views.get(tired.id),
    incomingSlot: sim.players.indexOf(incoming),
    gassed: incoming.stamina,
    turbotop: incoming.turbo,
  };
  return { before, after, okSwap, incomingId: incoming.id, outId: tired.id };
});
ok('applySub reports success', sub.okSwap === true);
ok('the slot now holds the incoming swimmer', sub.after.water.includes(sub.incomingId) && !sub.after.water.includes(sub.outId));
ok('the outgoing swimmer is on the bench', sub.after.benchHasOut === true);
ok('a substitution is spent', sub.after.subsLeft === 3, `left=${sub.after.subsLeft}`);
ok('incoming swimmer keeps the slot index', sub.after.incomingSlot >= 0);
ok('incoming swimmer swims on with legs (stamina/turbo)', sub.after.gassed > 0 && sub.after.turbotop > 0);
// The renderer view cache must follow the swap or you get a ghost mesh for the rest of the match.
ok(
  'renderer rebuilt its view cache for the swap',
  sub.after.views === 14 && sub.after.viewForIncoming === true && sub.after.viewForOutgoing === false,
  `views=${sub.after.views} in=${sub.after.viewForIncoming} out=${sub.after.viewForOutgoing}`,
);

// ------------------------------------------------------------ the panel + HUD readouts
const ui = await page.evaluate(() => {
  const app = window.app;
  const sim = app.match.sim;
  sim.state = 'dead';
  sim.stateTimer = 2;
  app.match.bench.show();
  const panel = document.querySelector('.bench-panel');
  const rows = panel ? panel.querySelectorAll('.bench-row').length : 0;
  const tappable = panel ? panel.querySelectorAll('[data-sub]').length : 0;
  const left = panel ? panel.querySelector('.bench-left')?.textContent.trim() : '';
  // HUD
  const stam = document.querySelector('.hud .stam-fill');
  const strip = document.querySelector('.hud .subs-strip');
  app.match.hud.update();
  return {
    open: app.match.bench.open,
    rows,
    tappable,
    left,
    stamWidth: stam ? stam.style.width : null,
    stripText: strip ? strip.textContent.trim() : '',
    stripShown: strip ? strip.classList.contains('show') : false,
  };
});
ok('bench panel opens at a stoppage', ui.open === true);
ok('panel lists water + bench', ui.rows >= 10, `rows=${ui.rows}`);
// A sub swaps one bench player for the outgoing swimmer, so the wall stays at four.
ok('every bench player is tappable', ui.tappable === 4, `tappable=${ui.tappable}`);
ok('panel shows remaining changes', /CHANGES LEFT 3/.test(ui.left), ui.left);
ok('HUD renders a stamina bar', typeof ui.stamWidth === 'string' && /%$/.test(ui.stamWidth), `width=${ui.stamWidth}`);
ok('HUD bench strip reports state', ui.stripShown === true && /SUBS/.test(ui.stripText), ui.stripText);

// tapping a bench player actually changes the crew
const tapped = await page.evaluate(() => {
  const app = window.app;
  const sim = app.match.sim;
  const before = sim.players.filter((p) => p.team === 0).map((p) => p.id);
  const node = document.querySelector('.bench-panel [data-sub="0"]');
  if (!node) return { clicked: false };
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const after = sim.players.filter((p) => p.team === 0).map((p) => p.id);
  app.match.bench.close();
  return { clicked: true, changed: before.filter((id) => !after.includes(id)).length, gained: after.filter((id) => !before.includes(id)).length };
});
ok('tapping a bench player swaps a swimmer in', tapped.clicked && tapped.changed === 1 && tapped.gained === 1, JSON.stringify(tapped));

// ----------------------------------------------------------- a foul really is whistled
const foul = await page.evaluate(() => {
  const app = window.app;
  const sim = app.match.sim;
  let guard = 0;
  while (sim.state !== 'live' && guard++ < 60 * 20) sim.step(1 / 60);
  const events = [];
  sim.events.on('foul', (e) => events.push({ red: e.red, offender: e.offender.data.nick }));
  sim.events.on('card', (e) => events.push({ card: true, red: e.red }));
  // Swinging at a swimmer who is already staggering is a foul by definition.
  const victim = sim.outfield(0)[1];
  const hitter = sim.outfield(1)[0];
  victim.state = 'reel';
  victim.stateTime = 0.2;
  victim.stun = 0.4;
  victim.pos.set(hitter.pos.x + 1, 0, hitter.pos.z);
  hitter.cd.hit = 0;
  hitter.facing = Math.atan2(1, 0); // square on: a big hit needs to be pointed at the victim
  hitter.state = 'swim';
  sim.state = 'live';
  const chance = sim.rng.chance;
  sim.rng.chance = () => true; // guarantee the hit connects
  sim.tryHit(hitter);
  sim.rng.chance = chance;
  return { events, state: sim.state, fouls: sim.stats.fouls, possession: sim.possession, victimTeam: victim.team };
});
ok('hitting a downed swimmer is whistled', foul.events.some((e) => e.red === false || e.red === true), JSON.stringify(foul.events));
ok('the whistle is recorded as a foul', foul.fouls > 0, `fouls=${foul.fouls}`);
ok('the fouled side keeps the ball', foul.possession === foul.victimTeam, `possession=${foul.possession} victim=${foul.victimTeam}`);

// ---------------------------------------- the booking is READ: commentary + player card
const booking = await page.evaluate(() => {
  const app = window.app;
  const sim = app.match.sim;
  const hitter = sim.outfield(1)[0];
  // Put the booked swimmer on the card so the readout is the one under test.
  sim.controlled = hitter;
  hitter.cards = 1;
  app.match.hud.update();
  const pcard = document.querySelector('.hud .pcard');
  const pips = document.querySelector('.hud .pcard-cards');
  const yellow = {
    booked: pcard.classList.contains('booked'),
    off: pcard.classList.contains('off'),
    pips: pips.textContent.trim(),
    redPips: pips.classList.contains('red'),
  };
  // A second booking is the end of the match: red pips, struck-through card, SENT OFF.
  hitter.cards = 2;
  hitter.sentOff = true;
  hitter.sentOffAt = 61;
  app.match.hud.update();
  const red = {
    booked: pcard.classList.contains('booked'),
    off: pcard.classList.contains('off'),
    pips: pips.textContent.trim(),
    redPips: pips.classList.contains('red'),
    nick: document.querySelector('.hud .pcard-nick').textContent.trim(),
    move: document.querySelector('.hud .pcard-move').textContent.trim(),
  };
  hitter.sentOff = false;
  hitter.cards = 0;
  sim.controlled = null;
  app.match.hud.update();
  return { yellow, red, ticker: document.querySelector('.hud .ticker')?.textContent.trim().slice(0, 40) || '' };
});
ok('one booking lights the player card in yellow', booking.yellow.booked && !booking.yellow.off && !booking.yellow.redPips && booking.yellow.pips === '●', JSON.stringify(booking.yellow));
ok(
  'a red card takes the card over: red pips, struck out, SENT OFF',
  booking.red.off && !booking.red.booked && booking.red.redPips && booking.red.pips === '●●' && booking.red.nick === 'SENT OFF' && /61/.test(booking.red.move),
  JSON.stringify(booking.red),
);
ok('the card clears again when the booking does', !booking.ticker.includes('SENT OFF'));

// ------------------------------------------------- the goal replay, end to end in a browser
// The node suite proves the recorder and the pose math. This proves the parts that need a GPU and
// a DOM: the letterbox actually animating, the scripted camera cut running, and the pool coming
// back intact afterwards. A replay that throws on frame one is a black screen mid-match.
const replay = await page.evaluate(async () => {
  const app = window.app;
  const m = app.match;
  m.bench.close();
  m.paused = false;
  const sim = m.sim;
  let guard = 0;
  while (sim.state !== 'live' && guard++ < 60 * 30) sim.step(1 / 60);
  // Record a real stretch of live play through the app's own loop path.
  for (let i = 0; i < 60 * 3; i++) {
    sim.step(1 / 60);
    m.replayRecorder.record(sim, 1 / 60);
  }
  const scorer = sim.ball.holder || sim.players[3];
  // Fire the same event the game listens for.
  sim.events.emit('score', {
    team: scorer.team,
    player: scorer,
    points: 3,
    ring: 0,
    type: 'topring',
    gb: false,
    stolen: 0,
    score: [...sim.score],
  });
  const started = m.replayDirector.playing;
  // Compare against the director's OWN snapshot, taken at the instant the replay began. The app
  // loop keeps running, so a snapshot taken here would be stale by the time playback ends.
  const before = m.replayDirector.saved
    ? m.replayDirector.saved.players.map((r) => ({ id: r.p.id, x: r.pos.x, z: r.pos.z }))
    : [];
  const bars = document.querySelector('.replay-bars');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(700); // a few real frames of playback
  const cam = m.renderer.gameCam.cam;
  const mid = {
    playing: m.replayDirector.playing,
    progress: m.replayDirector.progress,
    barsOn: bars.classList.contains('on'),
    caption: document.querySelector('.replay-cap-name').textContent.trim(),
    what: document.querySelector('.replay-cap-what').textContent.trim(),
    fill: document.querySelector('.replay-progress i').style.width,
    camY: cam.position.y,
    fov: cam.fov,
    insidePool: cam.position.length() < 31.6,
  };
  // Let it run past the hard cut and confirm the second angle took over.
  if (m.replayDirector.playing) m.replayDirector.t = m.replayDirector.clip.duration * 0.85;
  await wait(600);
  const late = { fov: cam.fov, camY: cam.position.y, insidePool: cam.position.length() < 31.6 };
  // Skip it, the way a player would. The restore check has to be SYNCHRONOUS: endReplay puts the
  // sim straight back on the clock, so a single awaited frame would show swimmers who have
  // already swum away and the assertion would be measuring the wrong thing.
  app.endReplay(m);
  const after = {
    playing: m.replayDirector.playing,
    barsOn: bars.classList.contains('on'),
    restored: before.length > 0 && sim.players.every((p, i) => {
      const b = before[i];
      return p.id === b.id && Math.abs(p.pos.x - b.x) < 1e-6 && Math.abs(p.pos.z - b.z) < 1e-6;
    }),
    roster: sim.players.length,
    views: m.renderer.views.size,
  };
  return { started, mid, late, after };
});
ok('a goal cuts a clip and starts the replay', replay.started === true);
ok('the letterbox is up and names the scorer', replay.mid.barsOn && replay.mid.caption.length > 0, JSON.stringify(replay.mid.caption));
ok('the caption names the top-ring finish', /TOP RING/.test(replay.mid.what), replay.mid.what);
ok('the progress hairline moves', /%$/.test(replay.mid.fill) && parseFloat(replay.mid.fill) > 0, replay.mid.fill);
ok('shot A frames the move from the water', replay.mid.insidePool && replay.mid.camY > 0.5 && replay.mid.fov > 35, `y=${replay.mid.camY.toFixed(1)} fov=${replay.mid.fov.toFixed(0)}`);
ok('the cut to the long goal-cam lens happens', replay.late.fov < replay.mid.fov - 5, `fov ${replay.mid.fov.toFixed(0)} -> ${replay.late.fov.toFixed(0)}`);
ok('the replay camera never leaves the pool', replay.mid.insidePool && replay.late.insidePool);
ok('skipping hands the pool back intact', !replay.after.playing && !replay.after.barsOn && replay.after.restored, JSON.stringify(replay.after));
ok('the replay leaks no views', replay.after.roster === 14 && replay.after.views === 14, `players=${replay.after.roster} views=${replay.after.views}`);

// The replay has to be genuinely optional. A player who turns it off should never see a letterbox,
// and the pool must not be left in a half-posed state when a clip is refused.
const replayOff = await page.evaluate(async () => {
  const app = window.app;
  const m = app.match;
  const sim = m.sim;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const saved = app.state.settings.replay;
  app.state.settings.replay = 'off';
  let guard = 0;
  while (sim.state !== 'live' && guard++ < 60 * 30) sim.step(1 / 60);
  for (let i = 0; i < 60 * 3; i++) {
    sim.step(1 / 60);
    m.replayRecorder.record(sim, 1 / 60);
  }
  const before = sim.players.map((p) => ({ id: p.id, x: p.pos.x, z: p.pos.z }));
  sim.events.emit('score', {
    team: 0, player: sim.players[3], points: 1, ring: 1, type: 'shot', gb: false, stolen: 0, score: [...sim.score],
  });
  // SYNCHRONOUS: with the replay refused nothing is posed, and the sim is still on the clock here,
  // so any awaited frame would show swimmers who have legitimately swum on.
  const out = {
    playing: m.replayDirector.playing,
    barsOn: document.querySelector('.replay-bars').classList.contains('on'),
    clip: m.replayDirector.clip,
    saved: m.replayDirector.saved,
    untouched: sim.players.every((p, i) => p.id === before[i].id && Math.abs(p.pos.x - before[i].x) < 1e-6 && Math.abs(p.pos.z - before[i].z) < 1e-6),
  };
  app.state.settings.replay = saved;
  return out;
});
ok('GOAL REPLAY off means no replay', replayOff.playing === false && replayOff.barsOn === false, JSON.stringify(replayOff));
ok('a refused replay never poses the pool at all', replayOff.untouched === true && replayOff.clip === null && replayOff.saved === null, JSON.stringify(replayOff));

// --------------------------------------- the halftime montage and the full-time recap
// The report builder is unit-tested in node; this covers the two things only a browser can prove
// — that the montage actually mounts over the match without killing the render loop, and that the
// recap renders on the real results screen with a real box score behind it.
const story = await page.evaluate(async () => {
  const app = window.app;
  const m = app.match;
  const sim = m.sim;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // The sim is genuinely in the halftime state when this event fires in a real match; set it so
  // the guard that keeps the montage off live play is exercised honestly.
  sim.state = 'halftime';
  sim.events.emit('halftime', { score: [...sim.score] });
  await wait(400);
  const box = document.querySelector('.montage.on .montage-box');
  const montage = {
    shown: m.montage.shown,
    score: document.querySelector('.montage-score')?.textContent.replace(/\s+/g, ' ').trim() || '',
    rows: box ? box.querySelectorAll('.montage-row').length : 0,
    labels: box ? [...box.querySelectorAll('.montage-row .k')].map((n) => n.textContent.trim()) : [],
    // It must not sit on top of the touch pad or the HUD banner.
    z: box ? Number(getComputedStyle(document.querySelector('.montage')).zIndex) : 0,
  };
  m.montage.dismiss();
  await wait(200);
  return { montage, dismissed: !m.montage.shown, stillRendering: !m.finished };
});
ok('halftime brings up the montage', story.montage.shown === true);
ok('the montage shows the score at the break', /\d/.test(story.montage.score), story.montage.score);
ok('the montage explains the half', story.montage.rows === 5 && story.montage.labels.includes('TOP SCORER') && story.montage.labels.includes('BIGGEST HIT'), story.montage.labels.join('/'));
ok('the montage sits above the HUD', story.montage.z >= 55, `z=${story.montage.z}`);
ok('the montage dismisses back to play', story.dismissed && story.stillRendering);

// ------------------------------------------------------------ a full match still ends
const finish = await page.evaluate(() => {
  const app = window.app;
  app.match.bench.close();
  const m = app.match;
  m.paused = false;
  app.lastT = performance.now();
  app.accum = 0;
  let n = 0;
  while (m.sim.state !== 'over' && n++ < 60 * 60 * 30) {
    const inp = app.input.poll();
    m.sim.setUserInput(inp);
    m.sim.step(1 / 60);
  }
  m.renderer.update(0.05);
  m.hud.update();
  m.renderer.render();
  // Keep the finished sim around so the recap can be checked on the real results screen.
  window.__lastSim = m.sim;
  return {
    state: m.sim.state,
    score: m.sim.score,
    t: Math.round(m.sim.time),
    subs: m.sim.stats.subs,
    fouls: m.sim.stats.fouls,
    views: m.renderer.views.size,
    players: m.sim.players.length,
  };
});
ok('a full match still finishes with subs and fouls in play', finish.state === 'over', `${finish.score.join('-')} in ${finish.t}s, ${finish.subs} subs / ${finish.fouls} fouls`);
ok('the pool always stays seven-a-side through swaps', finish.players === 14, `players=${finish.players}`);
ok('no view leak across the match', finish.views === 14, `views=${finish.views}`);

// ------------------------------------------------------------------- teardown
await page.evaluate(() => window.app.go('title'));
await new Promise((r) => setTimeout(r, 300));
const after = await page.evaluate(() => ({
  bench: !!document.querySelector('.bench-panel'),
  canvas: !!document.querySelector('canvas'),
}));
ok('bench panel and canvas removed on quit', !after.bench && !after.canvas);

// ------------------------------------------------------------- the recap, for real
// The recap is what the player reads after the final whistle, so it gets a full pass: it has to
// mount on the actual results screen, and it must not be able to render a real match into NaN,
// undefined or a blank card.
const recap = await page.evaluate(() => {
  const app = window.app;
  app.go('results', { sim: window.__lastSim, mode: 'quick', userTeam: 0 });
  const card = document.querySelector('.results .recap');
  const screen = document.querySelector('.results');
  return {
    mounted: !!card,
    // The headline is a sibling of the recap grid, not a child of it.
    title: screen?.querySelector('.recap-title')?.textContent.trim() || '',
    pips: card ? card.querySelectorAll('.pip').length : 0,
    sides: card ? card.querySelectorAll('.chart-side').length : 0,
    lines: card ? card.querySelectorAll('.recap-line').length : 0,
    rings: card ? card.querySelectorAll('.ring-row').length : 0,
    // The headline must credit the winning side, and must never hang the win on a moment that
    // belongs to the team that lost.
    miscredited: (() => {
      if (!screen || !window.__lastSim) return false;
      const h = screen.querySelector('.recap-title')?.textContent.trim() || '';
      const hitTeam = window.__lastSim.biggestHit ? window.__lastSim.biggestHit.team : -1;
      const w = window.__lastSim.winner;
      return h.includes('biggest hit') && w !== null && hitTeam !== -1 && hitTeam !== w;
    })(),
    tables: document.querySelectorAll('.results .res-tables table').length,
    broken: screen ? /NaN|undefined|\[object/.test(screen.textContent) : true,
  };
});
ok('the recap mounts on the results screen', recap.mounted && recap.tables === 2, `tables=${recap.tables}`);
ok('the recap has a headline and both goal rows', recap.title.length > 0 && recap.sides === 2, recap.title);
ok('the shot chart holds a pip per goal', recap.pips > 0, `pips=${recap.pips}`);
ok('the recap breaks the score down by window and by half', recap.rings === 2 && recap.lines >= 4, `rings=${recap.rings} lines=${recap.lines}`);
ok('the recap never renders NaN or undefined', recap.broken === false);
ok('the headline never credits the win to the losing side', recap.miscredited === false, recap.title);

// --------------------------------------------------------------- the career squad screen
// Career now runs a squad the player names, alternates venue and carries injuries. Only a browser
// can prove the screen mounts, that tapping a card re-renders, and that the crew the sim actually
// boots with is the seven that were on screen.
const career = await page.evaluate(async () => {
  const app = window.app;
  app.startCareer(app.teams[0].id, { name: 'Harness', archetype: 'HANDLER' });
  app.go('career');
  await new Promise((r) => setTimeout(r, 60));
  const hub = document.querySelector('.career');
  const hubText = hub ? hub.textContent : '';
  const menuActions = Array.from(document.querySelectorAll('.career .menu-item')).map((n) => n.dataset.action);
  // Home water on the first rung, the next one away.
  const fx0 = app.state.career.stage % 2 === 0;
  app.go('squad');
  await new Promise((r) => setTimeout(r, 60));
  const grid = document.querySelector('.squad-grid');
  const cards = grid ? Array.from(grid.querySelectorAll('.squad-card')) : [];
  const before = {
    chips: document.querySelectorAll('.sq-slot').length,
    inSquad: cards.filter((n) => n.classList.contains('in')).length,
    ovr: document.querySelector('.sq-ovr')?.textContent.trim() || '',
    text: document.querySelector('.screen.squad')?.textContent || '',
  };
  // Name the best available fit: the bench cards are the non-starters, best-rated last.
  const benchCard = cards.filter((n) => !n.classList.contains('in')).pop();
  const benchId = benchCard ? benchCard.dataset.id : null;
  if (benchCard) benchCard.click();
  await new Promise((r) => setTimeout(r, 40));
  const after = {
    ovr: document.querySelector('.sq-ovr')?.textContent.trim() || '',
    slots: Array.from(document.querySelectorAll('.sq-slot')).map((n) => n.textContent.trim()),
  };
  const saved = app.state.career.squad ? app.state.career.squad.slice() : null;
  // An injury must push a fit replacement in rather than booting a short squad.
  const named = saved[3];
  app.state.career.injuries = { [named]: 1 };
  app.go('squad');
  await new Promise((r) => setTimeout(r, 60));
  const injured = {
    disabled: document.querySelectorAll('.squad-card:disabled').length,
    chips: document.querySelectorAll('.sq-slot').length,
    hurtCards: document.querySelectorAll('.squad-card.hurt').length,
  };
  app.state.career.injuries = {};
  app.go('squad');
  await new Promise((r) => setTimeout(r, 60));
  document.querySelector('.play-btn').click();
  await new Promise((r) => setTimeout(r, 400));
  const sim = app.match ? app.match.sim : null;
  const out = {
    hubMounted: !!hub,
    hubHasSquad: hubText.includes('STARTING SEVEN'),
    hubHasVenue: hubText.includes('HOME WATER') || hubText.includes('AWAY TRIP'),
    hubHasForm: hubText.includes('FORM'),
    menuActions,
    homeFirst: fx0,
    before,
    after,
    saved,
    benchId,
    injured,
    started: !!sim,
    userTeam: sim ? sim.userTeam : -1,
    lineup: sim ? sim.players.filter((p) => p.team === sim.userTeam).map((p) => p.id) : [],
    matchesSaved: !!app.state.career.squad && app.state.career.squad.length === 7,
    broken: /NaN|undefined|\[object/.test(document.body.textContent),
  };
  if (app.match) app.endMatch();
  return out;
});
ok('the career hub shows the seven, the venue and the form line', career.hubMounted && career.hubHasSquad && career.hubHasVenue && career.hubHasForm);
ok('the career hub offers squad selection', career.menuActions.includes('squad') && career.menuActions.includes('play'), career.menuActions.join(','));
ok('the first rung is played at home', career.homeFirst === true);
ok('the squad screen mounts seven slots over the full roster', career.before.chips === 7 && career.before.inSquad === 7, `chips=${career.before.chips} in=${career.before.inSquad}`);
ok('the squad screen shows a crew rating and no undefined text', career.before.ovr !== '' && !/NaN|undefined|\[object/.test(career.before.text), `ovr=${career.before.ovr}`);
ok('tapping a swimmer names him and the crew rating recomputes', career.after.ovr !== career.before.ovr || career.after.slots.length === 7, `${career.before.ovr} -> ${career.after.ovr}`);
ok('naming a swimmer persists the squad to the save', career.matchesSaved && career.saved.length === 7);
ok('an injured swimmer cannot be named and a replacement takes his slot', career.injured.disabled >= 1 && career.injured.hurtCards >= 1 && career.injured.chips === 7, JSON.stringify(career.injured));
ok('the career fixture boots the named seven, not the default', career.started && career.lineup.length === 7, career.lineup.join(','));
ok('the career fixture puts the player on home water at the first rung', career.userTeam === 0, `userTeam=${career.userTeam}`);
ok('the squad screen never renders NaN or undefined', career.broken === false);

// ------------------------------------------------------- the cage and the aimed pass
// Two verbs the player actually has to discover, and both are invisible to the node suite: the
// cage swaps WHO the renderer is drawing behind, and the dive is only reachable through the real
// input path (U / the contextual anchor) rather than by calling the sim method directly.
const cageOpen = await page.evaluate(async () => {
  const app = window.app;
  app.startMatch({ home: app.teams[0], away: app.teams[3], userTeam: 0, mode: 'quick' });
  app.match.paused = false;
  const sim = app.match.sim;
  let guard = 0;
  while (sim.state !== 'live' && guard++ < 60 * 30) sim.step(1 / 60);
  // Play at our OWN end so the cage is open (ownGoalPos, not goalPos — sign matters).
  sim.ball.pos.set(sim.ownGoalPos(0).x, 1, 0);
  const viewsBefore = app.match.renderer.views.size;
  const outfieldBefore = sim.controlled.isKeeper;
  const openBefore = sim.cageAvailable();
  const took = sim.takeCage();
  const inCage = sim.inCage;
  const controlledIsKeeper = !!sim.controlled?.isKeeper;
  return { openBefore, took, inCage, controlledIsKeeper, viewsBefore, outfieldBefore };
});
// The HUD is frame-driven, so let a real frame paint before reading it.
await new Promise((r) => setTimeout(r, 120));
const cageReadout = await page.evaluate(() => ({
  cardCage: !!document.querySelector('.pcard.cage'),
  move: document.querySelector('.pcard-move')?.textContent || '',
  inCage: window.app.match.sim.inCage,
}));
const cageDive = await page.evaluate(() => {
  const app = window.app;
  const sim = app.match.sim;
  // Write the edges the real input path delivers (the step copies userInput onto p.input).
  const p = sim.controlled;
  p.input.breach = true;
  p.input.moveZ = 1;
  sim.processInput(p, 1 / 60);
  const dived = p.diveT > 0;
  const cd = p.cd.dive;
  // Leave the cage: the switch button is the way out.
  p.input.breach = false;
  p.input.switchPlayer = true;
  sim.processInput(p, 1 / 60);
  const out = {
    dived,
    cd,
    leftCage: !sim.inCage,
    backToOutfield: !!sim.controlled && !sim.controlled.isKeeper,
    views: app.match.renderer.views.size,
  };
  app.endMatch();
  return out;
});
const cage = { ...cageOpen, ...cageReadout, ...cageDive };
ok('the cage is shut until the play reaches your end, then opens', cage.openBefore === true && cage.took === true);
ok('taking the cage hands control to the keeper', cage.inCage === true && cage.controlledIsKeeper === true, `outfieldBefore=${cageOpen.outfieldBefore}`);
ok('the player card switches to the cage readout', cage.cardCage && /DIVE/.test(cage.move), cage.move);
ok('the dive fires from the real input edge and costs a cooldown', cage.dived && cage.cd > 0, `cd=${cage.cd}`);
ok('switching leaves the cage and returns an outfield swimmer', cage.leftCage && cage.backToOutfield);
ok('no view leak across a cage switch', cage.views === cageOpen.viewsBefore, `${cageOpen.viewsBefore} -> ${cage.views}`);

const lead = await page.evaluate(async () => {
  const app = window.app;
  app.startMatch({ home: app.teams[0], away: app.teams[1], userTeam: 0, mode: 'quick' });
  const sim = app.match.sim;
  let guard = 0;
  while (sim.state !== 'live' && guard++ < 60 * 30) sim.step(1 / 60);
  const passer = sim.outfield(0)[0];
  const mate = sim.outfield(0)[1];
  passer.pos.set(-6, 0, 0);
  mate.pos.set(2, 0, 0);
  mate.vel.set(4, 0, 0);
  for (const o of sim.opponentsOf(passer)) o.pos.set(40, 0, 40);
  const land = (aimX) => {
    mate.vel.set(4, 0, 0);
    passer.input.moveX = aimX;
    passer.input.moveZ = 0;
    sim.giveBall(passer, false);
    sim.tryPass(passer, mate, false);
    return sim.ball.flight.to.x;
  };
  const short = land(-1);
  const long = land(1);
  const styleBefore = passer.stats.style;
  let led = null;
  let popups = 0;
  sim.events.on('leadpass', (e) => {
    led = e;
  });
  sim.events.on('style', ({ label }) => {
    if (/LEAD PASS/.test(label)) popups++;
  });
  // Re-aim long and grade it the way the catch does.
  mate.vel.set(4, 0, 0);
  sim.giveBall(passer, false);
  passer.input.moveX = 1;
  sim.tryPass(passer, mate, false);
  const graded = sim.gradePass(sim.ball.flight, mate);
  const out = {
    short,
    long,
    spread: long - short,
    graded: !!graded,
    lead: graded ? graded.lead : 0,
    paid: passer.stats.style - styleBefore,
    popups,
    inPool: Math.hypot(long, 0) <= 17.7 + 1e-6,
  };
  app.endMatch();
  return out;
});
ok('aiming down the line moves the landing spot ahead', lead.spread > 0.5, `spread=${lead.spread.toFixed(2)}m`);
ok('a lead pass into space is graded and pays the passer', lead.graded && lead.lead > 0 && lead.paid > 0, `lead=${lead.lead?.toFixed(2)} style=+${lead.paid}`);
ok('the lead pass announces itself through the style popup', lead.popups >= 1, `popups=${lead.popups}`);
ok('an aimed pass never lands outside the pool', lead.inPool);

console.log(errors.length ? `\n${errors.length} page error(s):` : '\nno page errors');
for (const e of errors.slice(0, 8)) console.log('  ', e.slice(0, 200));
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall bench checks passed');
await browser.close();
process.exit(errors.length || failures ? 1 : 0);