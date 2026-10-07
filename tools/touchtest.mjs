/**
 * Emulated touch-device playtest: phone viewport, coarse pointer, real pointer events.
 *
 * Verifies the on-screen stick/buttons actually drive the simulation, that hold-and-release
 * shooting works, and that one-shot inputs are not dropped on displays where a rendered frame
 * runs no fixed step (120 Hz).
 *
 * The app's own rAF loop is paused for the deterministic sections, otherwise it races this
 * harness by polling input and stepping the sim at the same time.
 * Usage: node tools/touchtest.mjs [url]
 */
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const url = process.argv[2] || 'http://localhost:4173/';

// Deterministic match seed. Normal play is clock-seeded, but this harness must reproduce the same
// match every run or CI becomes a lottery. Override to sweep: QA_SEED=123 npm run qa:touch -- <url>
const QA_SEED = Number(process.env.QA_SEED || 20260902);
process.env.LD_LIBRARY_PATH = `/tmp/al2023/lib:/tmp:${process.env.LD_LIBRARY_PATH || ''}`;

const executablePath = await chromium.executablePath();

const browser = await puppeteer.launch({
  executablePath,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
  protocolTimeout: 600000
});

const page = await browser.newPage();

let failures = 0;
const errors = [];
const ok = (label, condition, details = '') => {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${details ? `  ${details}` : ''}`);
};

// Landscape phone, finger-only input (hasTouch makes (pointer: coarse) match, as on a real phone).
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
await page.evaluate(() => document.fonts.ready);

// ---------------------------------------------------------------- detection
const detected = await page.evaluate(() => ({
  enabled: window.app.touchEnabled(),
  mode: window.app.state.settings.touchControls,
  coarse: window.matchMedia('(pointer: coarse)').matches,
}));
ok('coarse pointer detected', detected.coarse === true);
ok('touch controls auto-enabled on touch device', detected.enabled === true, `mode=${detected.mode}`);
ok('no overlay over menu screens', await page.evaluate(() => !document.querySelector('.touch-ui')));

// ---------------------------------------------------------------- start match
await page.evaluate((seed) => {
  const app = window.app;
  app.audio.unlock = () => {};
  // Pinned seed: matches are clock-seeded in normal play, which made this harness a lottery — a
  // run could begin in a kickoff reset where the controlled swimmer is legally frozen. The seed is
  // passed in from Node (QA_SEED) so a sweep can re-run known-good seeds; the default is fixed so
  // CI is reproducible.
  app.startMatch({ home: app.teams[0], away: app.teams[3], userTeam: 0, mode: 'quick', seed });
  // Take the rAF loop out of the picture so this harness owns the simulation, then skip the
  // pre-match presentation (warm-up laps + captains' tip-off, ~11s) so the play checks below
  // exercise live play rather than a pinned formation.
  app.match.paused = true;
  const m = app.match;
  let guard = 0;
  while (m.sim.state !== 'live' && guard++ < 60 * 20) m.sim.step(1 / 60);
  for (let i = 0; i < 180; i++) m.sim.step(1 / 60);
}, QA_SEED);
const ui = await page.evaluate(() => ({
  overlay: !!document.querySelector('.match-wrap.touch .touch-ui'),
  buttons: document.querySelectorAll('.touch-ui .touch-btn').length,
  primary: document.querySelectorAll('.touch-ui .touch-primary .touch-btn').length,
  secondaryRow: !!document.querySelector('.touch-ui .touch-secondary'),
  contextLabel: document.querySelector('.touch-ui .touch-btn[data-action="context"] span')?.textContent || '',
  stick: !!document.querySelector('.touch-ui .touch-stick'),
  vertical: document.querySelectorAll('.touch-ui .touch-vertical .touch-btn').length,
  pauseBtn: !!document.querySelector('.touch-ui .touch-pause'),
  hint: document.querySelector('.hint')?.textContent || '',
}));
ok('overlay present during match', ui.overlay);
ok('4 primary + 2 depth buttons + stick + pause rendered (expert row removed)', ui.buttons === 6 && ui.primary === 4 && ui.secondaryRow === false && ui.vertical === 2 && ui.stick && ui.pauseBtn, `buttons=${ui.buttons}`);
ok('the SKILL button is labelled SKILL — and stays that way', ui.contextLabel === 'SKILL', `label=${ui.contextLabel}`);
ok('hint switched to touch wording', /STICK/.test(ui.hint), ui.hint.slice(0, 48));

// ------------------------------------------------------------------- stick
const stick = await page.evaluate(() => {
  const app = window.app;
  const m = app.match;
  const sim = m.sim;
  const zone = document.querySelector('.touch-stick-zone');
  zone.setPointerCapture = () => {};
  const pe = (type, x, y) => zone.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: true }));
  const r = zone.getBoundingClientRect();
  const cx = r.left + 100;
  const cy = r.bottom - 100;

  pe('pointerdown', cx, cy);
  pe('pointermove', cx + 70, cy - 70); // full deflection up + right
  const polled = app.input.poll();
  const vec = { x: polled.moveX, z: polled.moveZ };

  // Hold the stick and watch a pinned swimmer travel.
  //
  // A swimmer can only be moved during LIVE play: in reset/dead/tipoff/warmup the sim steps
  // physics with deadBall = true, which forces canMove = false, so the stick reads correctly
  // and still moves nobody. Because the match is seeded from the clock, CI sometimes lands
  // here mid-reset and this check failed at 0.00 m for reasons that had nothing to do with
  // the touch controls. So settle on live play first, and report the state on failure.
  const canSwim = () => {
    const c = sim.controlled;
    return sim.state === 'live' && c && !c.airborne && c.stun <= 0
      && (c.state === 'idle' || c.state === 'swim' || c.state === 'catch');
  };
  for (let settle = 0; settle < 60 * 30 && !canSwim(); settle++) {
    sim.setUserInput(app.input.poll());
    sim.step(1 / 60);
  }

  let moved = 0;
  let dx = 0;
  let seen = sim.state;
  for (let attempt = 0; attempt < 10 && (moved < 0.5 || dx <= 0.2); attempt++) {
    if (!canSwim()) {
      for (let settle = 0; settle < 60 * 10 && !canSwim(); settle++) {
        sim.setUserInput(app.input.poll());
        sim.step(1 / 60);
      }
    }
    const p = sim.controlled;
    const start = p.pos.clone();
    // Only accept a window where this swimmer kept control and was never hit: contact shoves a
    // body off its input vector, so a knocked-down sample says nothing about the touch controls.
    let clean = true;
    for (let i = 0; i < 18; i++) {
      const inp = app.input.poll();
      sim.setUserInput(inp);
      sim.step(1 / 60);
      if (sim.controlled !== p || p.state === 'fallen' || p.state === 'stumble'
          || p.stun > 0 || p.airborne || sim.state !== 'live') { clean = false; break; }
    }
    if (!clean) continue;
    const d = p.pos.distanceToXZ(start);
    if (d > moved) {
      moved = d;
      dx = p.pos.x - start.x;
      seen = sim.state;
    }
  }
  const nub = document.querySelector('.touch-ui .touch-stick-nub').style.transform;
  // The ring must sit under the thumb: it is absolutely positioned inside the zone, so its
  // viewport centre should land on the touch point (the "joystick placement" fix).
  const sr = document.querySelector('.touch-ui .touch-stick').getBoundingClientRect();
  const centre = { x: sr.left + sr.width / 2, y: sr.top + sr.height / 2 };
  pe('pointerup', cx + 70, cy - 70);
  const after = app.input.poll();
  return { vec, moved, dx, seen, nub, centre, touch: { x: cx, y: cy }, released: { x: after.moveX, z: after.moveZ }, active: app.input.touch.active };
});
ok('stick up+right reads as +x / -z', stick.vec.x > 0.5 && stick.vec.z < -0.5, `(${stick.vec.x.toFixed(2)}, ${stick.vec.z.toFixed(2)})`);
ok('stick moves the swimmer', stick.moved > 0.5, `${stick.moved.toFixed(2)} m  state=${stick.seen}`);
ok('swimmer travels toward +x (right)', stick.dx > 0.2, `dx=${stick.dx.toFixed(2)}  state=${stick.seen}`);
const nubNums = (stick.nub.match(/-?\d+(\.\d+)?/g) || []).map(Number);
const nubLen = Math.hypot(nubNums[2] || 0, nubNums[3] || 0);
ok('stick nub follows the thumb (clamped to rim)', nubLen > 50 && nubLen < 60, `offset ${nubLen.toFixed(1)}px`);
ok('stick release returns to neutral', Math.abs(stick.released.x) < 1e-6 && Math.abs(stick.released.z) < 1e-6);
ok('stick inactive after release', stick.active === false);
ok(
  'stick ring sits under the thumb (fixed placement)',
  Math.hypot(stick.centre.x - stick.touch.x, stick.centre.y - stick.touch.y) < 6,
  `ring (${stick.centre.x.toFixed(0)},${stick.centre.y.toFixed(0)}) vs touch (${stick.touch.x},${stick.touch.y})`
);

// ---------------------------------------------------------------- vertical (rise / dive)
// Input-plumbing only here; the depth integration itself is covered deterministically by the
// node suite (tests/sim.test.mjs) so this harness never has to perturb the live match.
const vert = await page.evaluate(() => {
  const app = window.app;
  const rise = document.querySelector('.touch-ui .touch-btn.t-rise');
  const dive = document.querySelector('.touch-ui .touch-btn.t-dive');
  rise.setPointerCapture = () => {};
  dive.setPointerCapture = () => {};
  const pe = (el, type) => el.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', bubbles: true, cancelable: true, isPrimary: true }));
  pe(rise, 'pointerdown');
  const heldY = app.input.poll().moveY;
  pe(rise, 'pointerup');
  const afterRise = app.input.poll().moveY;
  pe(dive, 'pointerdown');
  const heldDive = app.input.poll().moveY;
  pe(dive, 'pointerup');
  const afterDive = app.input.poll().moveY;
  return { heldY, afterRise, heldDive, afterDive };
});
ok('RISE button reads as +moveY', vert.heldY > 0.9, `moveY=${vert.heldY}`);
ok('releasing RISE re-centres depth', Math.abs(vert.afterRise) < 1e-6);
ok('DIVE button reads as -moveY', vert.heldDive < -0.9, `moveY=${vert.heldDive}`);
ok('releasing DIVE re-centres depth', Math.abs(vert.afterDive) < 1e-6);

// ----------------------------------------------------------------- buttons
const buttons = await page.evaluate(() => {
  const app = window.app;
  const m = app.match;
  const sim = m.sim;
  // Pause the app's rAF loop for the deterministic frame work below: with it running, the sim is
  // stepped by BOTH this harness's step() and the app loop, so the SHOOT wind-up lands at a
  // different frame on a loaded CI runner than locally and the release misses the PERFECT window.
  // (finishMatch below re-syncs lastT on resume so it doesn't fire a giant catch-up dt.)
  app.match.paused = true;
  const out = {};
  const tap = (action) => {
    const b = document.querySelector(`.touch-ui .touch-btn[data-action="${action}"]`);
    b.setPointerCapture = () => {};
    b.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, pointerType: 'touch', bubbles: true, cancelable: true }));
    b.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, pointerType: 'touch', bubbles: true, cancelable: true }));
    return b;
  };
  const press = (action) => {
    const b = document.querySelector(`.touch-ui .touch-btn[data-action="${action}"]`);
    b.setPointerCapture = () => {};
    b.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 3, pointerType: 'touch', bubbles: true, cancelable: true }));
    return b;
  };
  const release = (b, id) => b.dispatchEvent(new PointerEvent('pointerup', { pointerId: id, pointerType: 'touch', bubbles: true, cancelable: true }));
  // Give this player the ball, which also makes them the controlled player receiving user input.
  const fresh = (p) => {
    sim.giveBall(p);
    sim.setState(p, 'idle');
    p.trick = null;
    p.shot = null;
    p.stateTime = 0;
    p.airborne = false;
    p.stun = 0;
    for (const k in p.cd) p.cd[k] = 0;
    p.pos.set(0, 0, 0);
    return p;
  };
  // Play out any dead/reset phase so every action is tested from live play.
  const ensureLive = () => {
    let n = 0;
    while (sim.state !== 'live' && n++ < 900) {
      sim.step(1 / 60);
      app.input.flushOneShots();
    }
  };
  // Mirrors App.loop(): poll, step, then release the latched one-shots.
  const step = (n = 1) => {
    let first = null;
    for (let i = 0; i < n; i++) {
      const inp = app.input.poll();
      if (i === 0) first = { ...inp }; // snapshot: the sim consumes one-shots on the live struct
      sim.setUserInput(inp);
      sim.step(1 / 60);
      app.input.flushOneShots();
    }
    return first;
  };

  // SKILL while carrying — the permanent skill button fires a trick (the signature move)
  ensureLive();
  const a = fresh(sim.outfield(0)[0]);
  out.ballLabel = document.querySelector('.touch-ui .touch-btn[data-action="context"] span').textContent;
  tap('context');
  const ti = step(1);
  out.trickInp = `trick=${ti.trick} pass=${ti.pass}`;
  out.trick = a.state === 'trick' || !!a.trick;
  out.trickDebug = `sim=${sim.state} p=${a.state} cd=${a.cd.trick.toFixed(2)}`;

  // PASS — the carrier passes to a teammate (regression: touch pass edges were clobbered)
  ensureLive();
  const pa = fresh(sim.outfield(0)[0]);
  tap('pass');
  const pi = step(1);
  out.passInp = `pass=${pi.pass} flight=${sim.ball.flight ? sim.ball.flight.kind : null}`;
  out.pass = pi.pass === true && sim.ball.holder !== pa;
  out.passDebug = `sim=${sim.state} holder=${sim.ball.holder ? sim.ball.holder.id : 'none'}`;

  // SKILL off the ball — the same permanent button is the poke/slide tackle. No relabeling,
  // no rerouting: the sim decides what the one edge means by possession.
  ensureLive();
  const b = sim.outfield(0)[1];
  fresh(b);
  sim.ball.holder.hasBall = false;
  sim.ball.holder = sim.outfield(0)[2];
  sim.outfield(0)[2].hasBall = true;
  sim.controlled = b;
  b.controlled = true;
  b.state = 'idle';
  tap('context');
  out.skillImmediate = JSON.stringify([...app.input.touch.edges]);
  const bi = step(1);
  out.skillInp = `trick=${bi.trick} breach=${bi.breach} pass=${bi.pass} shoot=${bi.shootPressed} hit=${bi.hit} gb=${bi.gamebreaker} sw=${bi.switchPlayer} rel=${bi.shootReleased}`;
  out.tackle = b.state === 'tackle';
  out.skillDebug = `sim=${sim.state} p=${b.state} air=${b.airborne} ctrl=${sim.controlled === b}`;

  // SHOOT: hold, charge into the PERFECT window, release.
  // Freeze every other swimmer for this window: the AI averages ~2.4 tackle attempts per game
  // second, so on a loaded runner a tackle could land mid-wind-up and convert the released shot
  // to kind='loose' before the harness reads it. With the clock paused (above) and opponents
  // frozen, the 35 counted frames are fully deterministic.
  ensureLive();
  const c = fresh(sim.outfield(0)[0]);
  for (const q of sim.players) {
    if (q === c) continue;
    q.stun = 999;
    for (const k in q.cd) q.cd[k] = 999;
  }
  const shootBtn = press('shoot');
  out.shootImmediate = JSON.stringify([...app.input.touch.edges]);
  const si = step(1);
  out.shootInp = `shootPressed=${si.shootPressed} shootHeld=${si.shoot} breach=${si.breach} trick=${si.trick}`;
  out.windup = c.state === 'shoot' && !!c.shot && !c.shot.released;
  out.shootDebug = `sim=${sim.state} p=${c.state} ctrl=${sim.controlled === c} shot=${!!c.shot}`;
  out.held = app.input.touch.shootHeld;
  step(34); // ~0.58 s of the 0.75 s wind-up -> u ~ 0.78, inside PERFECT (0.68-0.86)
  release(shootBtn, 3);
  step(1);
  const f = sim.ball.flight;
  out.flightKind = f ? f.kind : null;
  out.quality = f ? f.quality : null;
  out.timing = c.shot ? c.shot.released : false;
  // Thaw the AI — later checks (TURBO, the full match) need live opponents.
  for (const q of sim.players) {
    q.stun = 0;
    for (const k in q.cd) q.cd[k] = 0;
  }

  // TURBO burns the meter while held and swimming somewhere (a stationary swimmer cannot turbo)
  ensureLive();
  const tp = fresh(sim.outfield(0)[0]);
  tp.turbo = 100;
  const zone = document.querySelector('.touch-stick-zone');
  zone.setPointerCapture = () => {};
  const zr = zone.getBoundingClientRect();
  const zx = zr.left + 100;
  const zy = zr.bottom - 100;
  const stickEv = (t, x, y) => zone.dispatchEvent(new PointerEvent(t, { pointerId: 1, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: true }));
  stickEv('pointerdown', zx, zy);
  stickEv('pointermove', zx + 70, zy - 70);
  const tb = press('turbo');
  step(1);
  // FLOW makes turbo free (no drain), which would mask this check — clear it for a clean read.
  sim.flow[0] = false;
  sim.flow[1] = false;
  const meter0 = tp.turbo;
  step(6);
  out.turbo = app.input.touch.turbo === true && tp.turboActive === true && tp.turbo < meter0;
  out.turboDebug = `sim=${sim.state} touchTurbo=${app.input.touch.turbo} active=${tp.turboActive} meter=${meter0.toFixed(1)}->${tp.turbo.toFixed(1)}`;
  release(tb, 3);
  step(2);
  out.turboOff = app.input.touch.turbo === false && tp.turboActive === false;
  stickEv('pointerup', zx + 70, zy - 70);
  // Stay paused: the harness has stepped the sim hundreds of frames, so handing the clock back
  // here lets the app loop end the match mid-test-suite. Resume happens just before fullMatch.
  app.match.paused = true;
  return out;
});
ok('CONTEXT button fires a trick while carrying', buttons.trick === true, `${buttons.trickDebug} | label=${buttons.ballLabel}`);
ok('PASS button fires a pass', buttons.pass === true, `${buttons.passDebug} | ${buttons.passInp}`);
ok('SKILL off the ball is the tackle — same button, same edge', buttons.tackle === true, `${buttons.skillDebug} | immediate=${buttons.skillImmediate} | ${buttons.skillInp}`);
ok('SHOOT button starts a wind-up', buttons.windup === true, `${buttons.shootDebug} | immediate=${buttons.shootImmediate} | ${buttons.shootInp}`);
ok('SHOOT button holds (charge)', buttons.held === true);
ok('SHOOT release fires a shot', buttons.flightKind === 'shot', `kind=${buttons.flightKind}`);
ok('hold+release lands in the PERFECT window', buttons.quality === 1, `quality=${buttons.quality}`);
ok('TURBO engages while held + moving', buttons.turbo === true, buttons.turboDebug);
ok('TURBO releases when let go', buttons.turboOff === true);

// --------------------------------------------------- one-shot latch (120 Hz)
const latch = await page.evaluate(() => {
  const app = window.app;
  const b = document.querySelector('.touch-ui .touch-btn[data-action="context"]');
  b.setPointerCapture = () => {};
  b.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 4, pointerType: 'touch', bubbles: true, cancelable: true }));
  b.dispatchEvent(new PointerEvent('pointerup', { pointerId: 4, pointerType: 'touch', bubbles: true, cancelable: true }));
  const first = app.input.poll().trick; // frame A polls...
  const second = app.input.poll().trick; // frame B: still no fixed step ran
  app.input.flushOneShots(); // ...then a step consumes it
  const after = app.input.poll().trick;
  return { first, second, after };
});
ok('tap delivered on the frame it happens', latch.first === true);
ok('tap SURVIVES a frame with no fixed step (120 Hz safe)', latch.second === true);
ok('tap clears once a step consumes it', latch.after === false);

// ------------------------------------------------------------ gamebreaker UI
const gb = await page.evaluate(() => {
  const sim = window.app.match.sim;
  sim.gb[0] = sim.rules.gamebreakerMeterMax;
  sim.gbReady[0] = true;
  window.app.match.touchControls.setGamebreakerReady(!!sim.gbReady[0]);
  const shoot = document.querySelector('.touch-ui .touch-btn[data-action="shoot"]');
  const lit = shoot.classList.contains('gb-ready');
  const litLabel = shoot.querySelector('span').textContent;
  sim.gbReady[0] = false;
  window.app.match.touchControls.setGamebreakerReady(false);
  return {
    lit,
    litLabel,
    unlit: !shoot.classList.contains('gb-ready'),
    unlitLabel: shoot.querySelector('span').textContent,
  };
});
ok('SHOOT anchor glows for the GAME BREAKER but keeps its label', gb.lit === true && gb.litLabel === 'SHOOT', gb.litLabel);
ok('SHOOT anchor dim back down when spent (label still SHOOT)', gb.unlit === true && gb.unlitLabel === 'SHOOT', gb.unlitLabel);

// ------------------------------------------------- contextual remap + layout
const adaptive = await page.evaluate(() => {
  const tc = window.app.match.touchControls;
  const btn = document.querySelector('.touch-ui .touch-btn[data-action="context"]');
  const label = () => btn.querySelector('span').textContent;
  const fire = () => {
    btn.setPointerCapture = () => {};
    btn.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 5, pointerType: 'touch', bubbles: true, cancelable: true }));
    const edges = [...window.app.input.touch.edges];
    btn.dispatchEvent(new PointerEvent('pointerup', { pointerId: 5, pointerType: 'touch', bubbles: true, cancelable: true }));
    window.app.input.touch.edges.clear();
    return edges;
  };
  // Permanence is the contract: no play state may relabel or reroute the SKILL button. It wears
  // the same name and fires the same edge from kickoff to the final whistle.
  const seen = [];
  for (let i = 0; i < 4; i++) seen.push({ label: label(), edges: fire().join() });
  const el = document.querySelector('.touch-ui');
  tc.applySettings({ touchLayout: 'left' });
  const leftLayout = el.dataset.layout;
  tc.applySettings({ touchLayout: 'right', touchScale: 9, touchOpacity: 0 });
  const clamped = { scale: el.style.getPropertyValue('--touch-scale'), opacity: el.style.getPropertyValue('--touch-opacity') };
  tc.applySettings({ touchLayout: 'right', touchScale: 1, touchOpacity: 1 });
  return { seen, leftLayout, clamped, restored: el.dataset.layout };
});
ok('SKILL keeps its label and its edge through every play state', adaptive.seen.every((s) => s.label === 'SKILL' && s.edges === 'trick'), JSON.stringify(adaptive.seen));
ok('left-handed layout applies', adaptive.leftLayout === 'left' && adaptive.restored === 'right');
ok('touch size / opacity settings clamp', adaptive.clamped.scale === '1.3' && adaptive.clamped.opacity === '0.4', JSON.stringify(adaptive.clamped));

// --------------------------------------------------------- layout geometry
const geom = await page.evaluate(() => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const boxes = [...document.querySelectorAll('.touch-ui .touch-btn')].map((b) => {
    const r = b.getBoundingClientRect();
    return { action: b.dataset.action, x: r.left, y: r.top, w: r.width, h: r.height };
  });
  // Every button is a circle (border-radius: 50%) and the browser hit-tests that shape, so compare
  // inscribed circles rather than bounding boxes: diagonal neighbours on the ring have intersecting
  // boxes without their faces ever touching.
  const overlaps = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const pad = 2; // tolerate a hairline touch, flag real overlaps
      const ra = Math.min(a.w, a.h) / 2;
      const rb = Math.min(b.w, b.h) / 2;
      const dist = Math.hypot(a.x + a.w / 2 - (b.x + b.w / 2), a.y + a.h / 2 - (b.y + b.h / 2));
      if (dist < ra + rb - pad) {
        const box = (o) => `${o.action}[${Math.round(o.x)},${Math.round(o.y)} ${Math.round(o.w)}x${Math.round(o.h)}]`;
        overlaps.push(`${box(a)} / ${box(b)} gap ${(dist - ra - rb).toFixed(1)}px`);
      }
    }
  }
  const outside = boxes.filter((b) => b.x < -1 || b.y < -1 || b.x + b.w > vw + 1 || b.y + b.h > vh + 1).map((b) => b.action);
  const shoot = boxes.find((b) => b.action === 'shoot');
  const largest = boxes.reduce((m, b) => (b.w * b.h > m.w * m.h ? b : m));
  const actions = document.querySelector('.touch-actions').getBoundingClientRect();
  const stickZone = document.querySelector('.touch-stick-zone').getBoundingClientRect();
  const rightHanded = { actionsLeftEdge: Math.round(actions.left), stickLeft: Math.round(stickZone.left) };
  // Guard against the touch buttons picking up HUD rules for the same class name (the HUD turbo
  // meter is `.turbo` and skews/positions anything that shares the class).
  const turbo = document.querySelector('.touch-ui .touch-btn[data-action="turbo"]');
  const turboStyle = getComputedStyle(turbo);
  const hudBleed = { transform: turboStyle.transform, width: turboStyle.width, height: turboStyle.height, labelPosition: getComputedStyle(turbo.querySelector('span')).position };
  // Ring geometry: the three support buttons should ride one arc around the SHOOT anchor.
  const middle = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  const ringBoxes = boxes.filter((b) => ['pass', 'turbo', 'context'].includes(b.action));
  const shootCentre = middle(shoot);
  const ringDist = ringBoxes.map((b) => Math.hypot(middle(b).x - shootCentre.x, middle(b).y - shootCentre.y));
  // Horizontal offsets from the anchor: the ring fans to the thumb side (left for a right-hander).
  const ringOffset = ringBoxes.map((b) => middle(b).x - shootCentre.x);
  const tc = window.app.match.touchControls;
  tc.applySettings({ touchLayout: 'left' });
  const leftActions = document.querySelector('.touch-actions').getBoundingClientRect();
  const leftStick = document.querySelector('.touch-stick-zone').getBoundingClientRect();
  const leftShoot = document.querySelector('.touch-ui .touch-btn[data-action="shoot"]').getBoundingClientRect();
  const leftRing = [...document.querySelectorAll('.touch-ui .touch-primary .touch-btn')]
    .filter((b) => b.dataset.action !== 'shoot')
    .map((b) => b.getBoundingClientRect())
    .map((r) => r.left + r.width / 2 - (leftShoot.left + leftShoot.width / 2));
  const mirroredRing = { shootFromLeft: Math.round(leftShoot.left - leftActions.left), ringOffset: leftRing };
  tc.applySettings({ touchLayout: 'right', touchScale: 1, touchOpacity: 1 });
  return {
    vw,
    vh,
    overlaps,
    outside,
    hudBleed,
    shootIsLargest: largest.action === 'shoot',
    shootInCorner: !!shoot && shoot.x + shoot.w > vw - 20 && shoot.y + shoot.h > vh - 20,
    ringDist,
    ringOffset,
    shootR: shoot.w / 2,
    ringR: ringBoxes[0].w / 2,
    rightHanded,
    mirrored: { actionsFromLeft: Math.round(leftActions.left), stickFromRight: Math.round(vw - leftStick.right) },
    mirroredRing,
  };
});
ok('no two touch buttons overlap', geom.overlaps.length === 0, geom.overlaps.join(', '));
ok(
  'touch buttons pick up no HUD styling',
  geom.hudBleed.transform === 'none' && geom.hudBleed.width === '60px' && geom.hudBleed.height === '60px' && geom.hudBleed.labelPosition === 'static',
  JSON.stringify(geom.hudBleed),
);
ok('all touch buttons stay on screen', geom.outside.length === 0, geom.outside.join(', '));
ok('SHOOT is the largest button, anchored bottom-right', geom.shootIsLargest && geom.shootInCorner);
const ringSpread = Math.max(...geom.ringDist) - Math.min(...geom.ringDist);
const ringGap = Math.min(...geom.ringDist) / (geom.shootR + geom.ringR);
ok('PASS / SKILL / BURST ride one arc around the SHOOT anchor', geom.ringDist.length === 3 && ringSpread < 2, `spread=${ringSpread.toFixed(1)}px dists=${geom.ringDist.map((d) => d.toFixed(0)).join(',')}`);
ok('the ring sits a clear thumb-width off the anchor', ringGap > 1 && ringGap < 1.2, `${ringGap.toFixed(2)}x the two radii`);
ok('right-handed: cluster on the right half, stick zone on the left', geom.rightHanded.actionsLeftEdge > geom.vw / 2 && geom.rightHanded.stickLeft === 0, JSON.stringify(geom.rightHanded));
ok('left-handed: cluster and stick swap sides', geom.mirrored.actionsFromLeft < 20 && geom.mirrored.stickFromRight === 0, JSON.stringify(geom.mirrored));
ok(
  'left-handed: anchor mirrors into the left corner with the ring fanning right',
  geom.mirroredRing.shootFromLeft < 6 &&
    geom.ringOffset.every((o) => o <= 1) &&
    geom.mirroredRing.ringOffset.every((o) => o >= -1) &&
    Math.min(...geom.ringOffset) < -40 &&
    Math.max(...geom.mirroredRing.ringOffset) > 40,
  `right=${geom.ringOffset.map((o) => o.toFixed(0)).join('/')} left=${geom.mirroredRing.ringOffset.map((o) => o.toFixed(0)).join('/')}`,
);

// ------------------------------------------- pad presets, mid-match (pause → settings)
// Reads stay on attributes / classes here on purpose: forcing layout (getBoundingClientRect) while
// a full-screen overlay composites over the live WebGL canvas crashes the software-GL renderer in
// headless CI images. The mirrored geometry itself is asserted in the pad section above.
const preset = await page.evaluate(() => {
  const app = window.app;
  const pad = () => document.querySelector('.touch-ui');
  app.openSettingsOverlay();
  const picks = [...document.querySelectorAll('.overlay-screen .set-row[data-key="touchLayout"] .pick-btn')];
  const scale = document.querySelector('.overlay-screen .set-row[data-key="touchScale"] input');
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const before = pad().dataset.layout;
  click(picks[1]); // LEFT-HAND
  const mirrored = pad().dataset.layout;
  const opacity = pad().style.getPropertyValue('--touch-opacity');
  scale.value = '1.2';
  scale.dispatchEvent(new Event('input', { bubbles: true }));
  const scaled = pad().style.getPropertyValue('--touch-scale');
  click(picks[0]); // back to RIGHT-HAND
  const restored = pad().dataset.layout;
  document.querySelector('.overlay-screen .back-btn').click();
  return {
    picks: picks.length,
    before,
    mirrored,
    restored,
    opacity,
    scaled,
    overlayClosed: !document.querySelector('.overlay-screen'),
    matchKept: !!app.match && app.match.paused && !!document.querySelector('.touch-ui'),
    saved: app.state.settings,
  };
});
ok(
  'pause → settings re-hands the live pad',
  preset.picks === 2 && preset.before === 'right' && preset.mirrored === 'left' && preset.restored === 'right' && preset.overlayClosed,
  `picks=${preset.picks} ${preset.before}->${preset.mirrored}->${preset.restored} closed=${preset.overlayClosed}`,
);
ok('BACK from in-match settings returns to the paused match', preset.matchKept === true);
ok(
  'pause → settings sliders re-scale the live pad',
  preset.scaled === '1.2' && preset.opacity === '1' && preset.saved.touchScale === 1.2 && preset.saved.touchLayout === 'right',
  `scale=${preset.scaled} opacity=${preset.opacity} saved=${JSON.stringify(preset.saved.touchScale)}`,
);
// Put the size back so the screenshots further down use the tuned default.
await page.evaluate(() => {
  const app = window.app;
  app.state.settings.touchScale = 1;
  app.match.touchControls.applySettings(app.state.settings);
});

// ----------------------------------------------- pointer ownership / interruption regressions
const ownership = await page.evaluate(() => {
  const input = window.app.input;
  const tc = window.app.match.touchControls;
  const button = (action) => document.querySelector(`.touch-ui [data-action="${action}"]`);
  const fire = (action, type, id) => {
    const btn = button(action);
    btn.setPointerCapture = () => {};
    btn.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', bubbles: true, cancelable: true }));
  };
  tc.reset();
  input.flushOneShots();
  fire('turbo', 'pointerdown', 101);
  fire('shoot', 'pointerdown', 102);
  fire('shoot', 'pointerup', 999);
  const unrelatedReleaseIgnored = input.touch.shootHeld && input.touch.turbo;
  fire('shoot', 'pointerup', 102);
  const independentRelease = !input.touch.shootHeld && input.touch.turbo;
  tc.reset();
  fire('rise', 'pointerdown', 103);
  fire('dive', 'pointerdown', 104);
  const opposingDepth = input.touch.moveY === 0;
  fire('dive', 'pointerup', 104);
  const remainingDepth = input.touch.moveY === 1;
  tc.reset();
  input.flushOneShots();
  fire('cage', 'pointerdown', 105);
  const cage = input.poll().cage;
  fire('cage', 'pointerup', 105);
  input.flushOneShots();
  tc.reset();
  fire('shoot', 'pointerdown', 106);
  input.poll();
  fire('shoot', 'pointercancel', 106);
  const cancellation = !input.touch.shootHeld && !input.poll().shootReleased && input.pending.size === 0;
  fire('turbo', 'pointerdown', 107);
  window.dispatchEvent(new Event('blur'));
  const blur = !input.touch.turbo && !document.querySelector('.touch-ui .down');
  tc.reset();
  fire('turbo', 'pointerdown', 108);
  window.app.match.paused = false;
  window.app.pause();
  const pause = !input.touch.turbo && input.pending.size === 0;
  window.app.resume();
  window.app.match.paused = true;
  return { unrelatedReleaseIgnored, independentRelease, opposingDepth, remainingDepth, cage, cancellation, blur, pause };
});
for (const [name, passed] of Object.entries(ownership)) ok(`rebuilt touch lifecycle: ${name}`, passed);

// ----------------------------------------------------- full match on touch
// Hand the clock back to the app loop for the real thing: un-pause, then re-base its timers so
// the first resumed frame can't treat the whole deterministic block as one giant dt.
await page.evaluate(() => {
  const app = window.app;
  app.match.paused = false;
  app.lastT = performance.now();
  app.accum = 0;
});
const finish = await page.evaluate(() => {
  const app = window.app;
  const m = app.match;
  let n = 0;
  while (m.sim.state !== 'over' && n++ < 60 * 60 * 30) {
    const inp = app.input.poll();
    m.sim.setUserInput(inp);
    m.sim.step(1 / 60);
  }
  m.renderer.update(0.05);
  m.hud.update();
  m.renderer.render();
  return { state: m.sim.state, score: m.sim.score, t: Math.round(m.sim.time), shots: m.sim.stats.shots, saves: m.sim.stats.saves };
});
ok('full touch-controlled match finishes', finish.state === 'over', `${finish.score.join('-')} in ${finish.t}s, ${finish.shots} shots / ${finish.saves} saves`);

// ----------------------------------------------------------------- teardown
await page.evaluate(() => window.app.go('title'));
await new Promise((r) => setTimeout(r, 300));
const afterQuit = await page.evaluate(() => ({ touch: !!document.querySelector('.touch-ui'), canvas: !!document.querySelector('canvas'), webgl: !!document.querySelector('canvas') }));
ok('overlay + canvas removed on quit', !afterQuit.touch && !afterQuit.canvas);

// Regression: a match torn down while the in-match SETTINGS overlay is open (quit to menu, or the
// final whistle while settings are up) used to leave a stale overlay reference behind, so the NEXT
// match's pause menu swallowed its first ESC — it "closed" the detached element and returned
// instead of resuming. Both teardown paths now clear the references.
const staleOverlay = await page.evaluate(() => {
  const app = window.app;
  const open = () => {
    app.startMatch({ home: app.teams[0], away: app.teams[1], userTeam: 0, mode: 'quick' });
  };
  open();
  app.pause();
  app.openSettingsOverlay();
  app.go('title'); // quit with the settings overlay still open
  open();
  const pausedByFirst = app.input.onPause() === true && app.match.paused === true;
  const resumedBySecond = app.input.onPause() === true && app.match.paused === false;
  const overlayCleared = app.settingsOverlay === null && app.overlay === null;
  app.go('title');
  return { pausedByFirst, resumedBySecond, overlayCleared };
});
ok('a match torn down with settings open leaves no stale overlay', staleOverlay.overlayCleared === true);
ok('the next match pause menu still closes on its first ESC', staleOverlay.pausedByFirst && staleOverlay.resumedBySecond, JSON.stringify(staleOverlay));

// ---------------------------------------------------- settings: touch layout
const settings = await page.evaluate(() => {
  window.app.go('settings', { back: 'title' });
  const keys = [...document.querySelectorAll('.set-row')].map((r) => r.dataset.key);
  const sc = document.querySelector('.set-row[data-key="touchScale"] input');
  const op = document.querySelector('.set-row[data-key="touchOpacity"] input');
  const picks = [...document.querySelectorAll('.set-row[data-key="touchLayout"] .pick-btn')];
  const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  click(picks[1]); // LEFT-HAND preset
  const layoutSaved = window.app.state.settings.touchLayout;
  const presetOn = picks[1].classList.contains('on') && !picks[0].classList.contains('on');
  click(picks[0]); // back to RIGHT-HAND
  const presetBack = window.app.state.settings.touchLayout === 'right' && picks[0].classList.contains('on');
  set(sc, '1.2');
  const scaleSaved = window.app.state.settings.touchScale;
  const scalePct = document.querySelector('.set-row[data-key="touchScale"] .set-val').textContent;
  set(op, '0.5');
  const opacityPct = document.querySelector('.set-row[data-key="touchOpacity"] .set-val').textContent;
  set(sc, '1'); set(op, '1');
  window.app.go('title');
  return {
    hasRows: ['touchControls', 'touchLayout', 'touchScale', 'touchOpacity'].every((k) => keys.includes(k)),
    scaleRange: `${sc.min}-${sc.max}`,
    opacityRange: `${op.min}-${op.max}`,
    presetCount: picks.length,
    presetOn,
    presetBack,
    layoutSaved,
    scaleSaved,
    scalePct,
    opacityPct,
  };
});
ok('settings exposes the touch pad rows', settings.hasRows, `scale=${settings.scaleRange} opacity=${settings.opacityRange}`);
ok('settings offers both hand presets and latches the pick', settings.presetCount === 2 && settings.presetOn && settings.presetBack, `picks=${settings.presetCount}`);
ok('settings touch layout persists', settings.layoutSaved === 'left');
ok('settings touch sliders persist with correct labels', settings.scaleSaved === 1.2 && settings.scalePct === '80%' && settings.opacityPct === '17%', `${settings.scalePct} / ${settings.opacityPct}`);

// ------------------------------------------------------------------ portrait
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.evaluate(() => {
  const app = window.app;
  app.startMatch({ home: app.teams[1], away: app.teams[4], userTeam: 0, mode: 'quick' });
  app.match.paused = true;
  for (let i = 0; i < 240; i++) app.match.sim.step(1 / 60);
  app.match.renderer.update(0.05);
  app.match.hud.update();
  app.match.renderer.render();
});
await new Promise((r) => setTimeout(r, 400));
const portrait = await page.evaluate(() => {
  const el = document.querySelector('.touch-rotate');
  return el ? getComputedStyle(el).display : 'missing';
});
ok('portrait shows the "rotate device" hint', portrait === 'flex', `display=${portrait}`);
await page.screenshot({ path: process.env.SHOT || '/tmp/touch-portrait.png' });

// ---------------------------------------------------------------- landscape
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await new Promise((r) => setTimeout(r, 500));
await page.evaluate(() => {
  const m = window.app.match;
  for (let i = 0; i < 240; i++) m.sim.step(1 / 60);
  m.renderer.update(0.05);
  m.hud.update();
  m.renderer.render();
  const el = document.querySelector('.touch-stick');
  el.classList.add('engaged');
  document.querySelector('.touch-stick-nub').style.transform = 'translate(-50%, -50%) translate(40px, -40px)';
});
await new Promise((r) => setTimeout(r, 250));
await page.screenshot({ path: process.env.SHOT2 || '/tmp/touch-landscape.png' });

console.log(errors.length ? `\n${errors.length} page error(s):` : '\nno page errors');
for (const e of errors.slice(0, 10)) console.log('  ', e.slice(0, 200));
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall touch checks passed');
await browser.close();
process.exit(errors.length || failures ? 1 : 0);
