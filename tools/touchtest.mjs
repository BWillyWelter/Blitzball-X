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
  primary: document.querySelectorAll('.touch-ui .touch-primary .touch-btn').length,
  secondary: document.querySelectorAll('.touch-ui .touch-secondary .touch-btn').length,
  contextLabel: document.querySelector('.touch-ui .touch-btn[data-action="context"] span')?.textContent || '',
  stick: !!document.querySelector('.touch-ui .touch-stick'),
  pauseBtn: !!document.querySelector('.touch-ui .touch-pause'),
  hint: document.querySelector('.hint')?.textContent || '',
}));
ok('overlay present during match', ui.overlay);
ok('4 primary + 5 secondary buttons + stick + pause rendered', ui.buttons === 9 && ui.primary === 4 && ui.secondary === 5 && ui.stick && ui.pauseBtn, `buttons=${ui.buttons} (${ui.primary}/${ui.secondary})`);
ok('contextual button defaults to TRICK', ui.contextLabel === 'TRICK', `label=${ui.contextLabel}`);
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

  // CONTEXT while carrying — the adaptive primary button should fire a trick
  ensureLive();
  const a = fresh(sim.outfield(0)[0]);
  app.match.touchControls.setContext({ onBall: true });
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
ok('CONTEXT button fires a trick while carrying', buttons.trick === true, `${buttons.trickDebug} | label=${buttons.ballLabel}`);
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
  window.app.match.touchControls.setContext({ onBall: true });
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
  const lit = document.querySelector('.touch-ui .touch-btn[data-action="gamebreaker"]').classList.contains('ready');
  sim.gbReady[0] = false;
  window.app.match.touchControls.setGamebreakerReady(false);
  return { lit, unlit: !document.querySelector('.touch-ui .touch-btn[data-action="gamebreaker"]').classList.contains('ready') };
});
ok('GB button lights when the meter is full', gb.lit === true);
ok('GB button dims when spent', gb.unlit === true);

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
  // The expert row reads left-to-right by flex order: `*` marks a prime (hot) slot, `-` an action
  // the sim ignores in this state. The right-most entry is the slot nearest a right thumb.
  const row = () =>
    [...document.querySelectorAll('.touch-secondary .touch-btn')]
      .sort((a, b) => Number(a.style.order) - Number(b.style.order))
      .map((b) => `${b.dataset.action}${b.classList.contains('hot') ? '*' : b.classList.contains('idle') ? '-' : ''}`)
      .join(',');
  tc.setContext({ defending: true });
  const defense = { label: label(), edges: fire(), row: row() };
  tc.setContext({ looseBall: true });
  const loose = { label: label(), edges: fire(), row: row() };
  tc.setContext({ support: true });
  const support = { label: label(), edges: fire(), row: row() };
  tc.setContext({ onBall: true });
  const ball = { label: label(), edges: fire(), row: row() };
  const el = document.querySelector('.touch-ui');
  tc.applySettings({ touchLayout: 'left' });
  const leftLayout = el.dataset.layout;
  const leftRow = row(); // mirrored pad: prime slots move to the near (left) edge for a left thumb
  tc.applySettings({ touchLayout: 'right', touchScale: 9, touchOpacity: 0 });
  const clamped = { scale: el.style.getPropertyValue('--touch-scale'), opacity: el.style.getPropertyValue('--touch-opacity') };
  tc.applySettings({ touchLayout: 'right', touchScale: 1, touchOpacity: 1 });
  return { defense, loose, support, ball, leftLayout, leftRow, clamped, restored: el.dataset.layout };
});
ok('context remaps to TACKLE on defense', adaptive.defense.label === 'TACKLE' && adaptive.defense.edges.join() === 'hit', `label=${adaptive.defense.label} edges=${adaptive.defense.edges}`);
ok('context remaps to JUMP on a loose ball', adaptive.loose.label === 'JUMP' && adaptive.loose.edges.join() === 'breach', `label=${adaptive.loose.label} edges=${adaptive.loose.edges}`);
ok('context remaps to JUMP when supporting off the ball', adaptive.support.label === 'JUMP' && adaptive.support.edges.join() === 'breach', `label=${adaptive.support.label} edges=${adaptive.support.edges}`);
ok('context remaps back to TRICK on the ball', adaptive.ball.label === 'TRICK' && adaptive.ball.edges.join() === 'trick', `label=${adaptive.ball.label} edges=${adaptive.ball.edges}`);
ok(
  'expert row auto-swaps with the play state',
  adaptive.ball.row === 'breach-,ballcam,hit*,switch*,gamebreaker*' &&
    adaptive.defense.row === 'ballcam,gamebreaker-,switch*,breach*,hit*' &&
    adaptive.loose.row === 'ballcam,gamebreaker-,switch*,hit*,breach*' &&
    adaptive.support.row === 'gamebreaker-,ballcam,hit*,breach*,switch*',
  `ball=${adaptive.ball.row} defense=${adaptive.defense.row} loose=${adaptive.loose.row} support=${adaptive.support.row}`,
);
ok('left-handed pad mirrors the row so the prime slot is left-most', adaptive.leftRow === 'gamebreaker*,switch*,hit*,ballcam,breach-', adaptive.leftRow);
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
ok('PASS / TRICK / TURBO ride one arc around the SHOOT anchor', geom.ringDist.length === 3 && ringSpread < 2, `spread=${ringSpread.toFixed(1)}px dists=${geom.ringDist.map((d) => d.toFixed(0)).join('/')}`);
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
