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
process.env.LD_LIBRARY_PATH = `/tmp/al2023/lib:/tmp:${process.env.LD_LIBRARY_PATH || ''}`;
chromium.setGraphicsMode = true;
const browser = await puppeteer.launch({
  args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  executablePath: await chromium.executablePath(),
  headless: 'shell',
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.stack || e.message));

let failures = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

// Landscape phone, finger-only input (hasTouch makes (pointer: coarse) match, as on a real phone).
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
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
await page.evaluate(() => {
  const app = window.app;
  app.audio.unlock = () => {};
  app.startMatch({ home: app.teams[0], away: app.teams[3], userTeam: 0, mode: 'quick' });
  // Take the rAF loop out of the picture so this harness owns the simulation.
  app.match.paused = true;
  const m = app.match;
  for (let i = 0; i < 180; i++) m.sim.step(1 / 60);
});
const ui = await page.evaluate(() => ({
  overlay: !!document.querySelector('.match-wrap.touch .touch-ui'),
  buttons: document.querySelectorAll('.touch-ui .touch-btn').length,
  stick: !!document.querySelector('.touch-ui .touch-stick'),
  pauseBtn: !!document.querySelector('.touch-ui .touch-pause'),
  hint: document.querySelector('.hint')?.textContent || '',
}));
ok('overlay present during match', ui.overlay);
ok('9 action buttons + stick + pause rendered', ui.buttons === 9 && ui.stick && ui.pauseBtn, `buttons=${ui.buttons}`);
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
  let moved = 0;
  let dx = 0;
  for (let attempt = 0; attempt < 6 && moved < 0.5; attempt++) {
    const p = sim.controlled;
    const start = p.pos.clone();
    for (let i = 0; i < 24; i++) {
      const inp = app.input.poll();
      sim.setUserInput(inp);
      sim.step(1 / 60);
    }
    if (sim.controlled === p) {
      moved = p.pos.distanceToXZ(start);
      dx = p.pos.x - start.x;
    }
  }
  const nub = document.querySelector('.touch-ui .touch-stick-nub').style.transform;
  pe('pointerup', cx + 70, cy - 70);
  const after = app.input.poll();
  return { vec, moved, dx, nub, released: { x: after.moveX, z: after.moveZ }, active: app.input.touch.active };
});
ok('stick up+right reads as +x / -z', stick.vec.x > 0.5 && stick.vec.z < -0.5, `(${stick.vec.x.toFixed(2)}, ${stick.vec.z.toFixed(2)})`);
ok('stick moves the swimmer', stick.moved > 0.5, `${stick.moved.toFixed(2)} m`);
ok('swimmer travels toward +x (right)', stick.dx > 0.2, `dx=${stick.dx.toFixed(2)}`);
const nubNums = (stick.nub.match(/-?\d+(\.\d+)?/g) || []).map(Number);
const nubLen = Math.hypot(nubNums[2] || 0, nubNums[3] || 0);
ok('stick nub follows the thumb (clamped to rim)', nubLen > 50 && nubLen < 60, `offset ${nubLen.toFixed(1)}px`);
ok('stick release returns to neutral', Math.abs(stick.released.x) < 1e-6 && Math.abs(stick.released.z) < 1e-6);
ok('stick inactive after release', stick.active === false);

// ----------------------------------------------------------------- buttons
const buttons = await page.evaluate(() => {
  const app = window.app;
  const m = app.match;
  const sim = m.sim;
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

  // TRICK
  ensureLive();
  const a = fresh(sim.outfield(0)[0]);
  tap('trick');
  const ti = step(1);
  out.trickInp = `edges=${JSON.stringify([...app.input.touch.edges])} trick=${ti.trick} pass=${ti.pass}`;
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

  // SWAP — off the ball, the switch button hands control to another swimmer
  ensureLive();
  const beforeSwap = sim.controlled ? sim.controlled.id : null;
  tap('switch');
  const wi = step(1);
  out.swap = wi.switchPlayer === true && sim.controlled && sim.controlled.id !== beforeSwap;
  out.swapDebug = `before=${beforeSwap} after=${sim.controlled ? sim.controlled.id : null} sw=${wi.switchPlayer}`;

  // CAM — the ball-cam toggle edge must survive the poll (routes to the game camera)
  ensureLive();
  tap('ballcam');
  const ci = step(1);
  out.cam = ci.ballCamToggle === true;
  out.camDebug = `ballCamToggle=${ci.ballCamToggle}`;

  // JUMP (breach) — off the ball, so give possession to a team-mate but keep control on `b`.
  ensureLive();
  const b = sim.outfield(0)[1];
  fresh(b);
  sim.ball.holder.hasBall = false;
  sim.ball.holder = sim.outfield(0)[2];
  sim.outfield(0)[2].hasBall = true;
  sim.controlled = b;
  b.controlled = true;
  b.state = 'idle';
  tap('breach');
  out.breachImmediate = JSON.stringify([...app.input.touch.edges]);
  const bi = step(1);
  out.breachInp = `breach=${bi.breach} trick=${bi.trick} pass=${bi.pass} shoot=${bi.shootPressed} hit=${bi.hit} gb=${bi.gamebreaker} sw=${bi.switchPlayer} rel=${bi.shootReleased}`;
  out.breach = b.airborne || b.state === 'breach';
  out.breachDebug = `sim=${sim.state} p=${b.state} air=${b.airborne} ctrl=${sim.controlled === b}`;

  // SHOOT: hold, charge into the PERFECT window, release
  ensureLive();
  const c = fresh(sim.outfield(0)[0]);
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
  const meter0 = tp.turbo;
  step(6);
  out.turbo = app.input.touch.turbo === true && tp.turboActive === true && tp.turbo < meter0;
  out.turboDebug = `sim=${sim.state} touchTurbo=${app.input.touch.turbo} active=${tp.turboActive} meter=${meter0.toFixed(1)}->${tp.turbo.toFixed(1)}`;
  release(tb, 3);
  step(2);
  out.turboOff = app.input.touch.turbo === false && tp.turboActive === false;
  stickEv('pointerup', zx + 70, zy - 70);
  return out;
});
ok('TRICK button triggers a trick', buttons.trick === true, buttons.trickDebug);
ok('PASS button fires a pass', buttons.pass === true, `${buttons.passDebug} | ${buttons.passInp}`);
ok('SWAP button switches swimmer', buttons.swap === true, buttons.swapDebug);
ok('CAM button toggles ball cam edge', buttons.cam === true, buttons.camDebug);
ok('JUMP button breaches', buttons.breach === true, `${buttons.breachDebug} | immediate=${buttons.breachImmediate} | ${buttons.breachInp}`);
ok('SHOOT button starts a wind-up', buttons.windup === true, `${buttons.shootDebug} | immediate=${buttons.shootImmediate} | ${buttons.shootInp}`);
ok('SHOOT button holds (charge)', buttons.held === true);
ok('SHOOT release fires a shot', buttons.flightKind === 'shot', `kind=${buttons.flightKind}`);
ok('hold+release lands in the PERFECT window', buttons.quality === 1, `quality=${buttons.quality}`);
ok('TURBO engages while held + moving', buttons.turbo === true, buttons.turboDebug);
ok('TURBO releases when let go', buttons.turboOff === true);

// --------------------------------------------------- one-shot latch (120 Hz)
const latch = await page.evaluate(() => {
  const app = window.app;
  const b = document.querySelector('.touch-ui .touch-btn[data-action="trick"]');
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
  const lit = document.querySelector('.touch-ui .touch-btn.gb').classList.contains('ready');
  sim.gbReady[0] = false;
  window.app.match.touchControls.setGamebreakerReady(false);
  return { lit, unlit: !document.querySelector('.touch-ui .touch-btn.gb').classList.contains('ready') };
});
ok('GB button lights when the meter is full', gb.lit === true);
ok('GB button dims when spent', gb.unlit === true);

// ----------------------------------------------------- full match on touch
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
