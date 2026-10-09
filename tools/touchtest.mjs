/**
 * Emulated touch-device playtest: phone viewport, coarse pointer, real pointer events.
 *
 * Verifies the on-screen zones actually drive the simulation:
 *   - the left half moves (read relative to the camera) and never touches the camera
 *   - the right half orbits the camera and never touches movement
 *   - the strike pad winds a shot up, takes its aim from the swipe, and fires on release
 *   - PASS / BURST / BLOCK / HIT / TACKLE each deliver their own edge
 *   - one-shot inputs are not dropped on displays where a rendered frame runs no fixed step
 *
 * The app's own rAF loop is paused for the deterministic sections, otherwise it races this
 * harness by polling input and stepping the sim at the same time.
 * Usage: node tools/touchtest.mjs [url]
 */
import { launchBrowser } from './lib/browser.mjs';

const url = process.argv[2] || 'http://localhost:4173/';

// Deterministic match seed. Normal play is clock-seeded, but this harness must reproduce the same
// match every run or CI becomes a lottery. Override to sweep: QA_SEED=123 npm run qa:touch -- <url>
const QA_SEED = Number(process.env.QA_SEED || 20260902);
const browser = await launchBrowser({ gpu: false, protocolTimeout: 600000 });

const page = await browser.newPage();

let failures = 0;
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
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
const ui = await page.evaluate(() => {
  const zoneRect = (sel) => {
    const el = document.querySelector(sel);
    return el ? el.getBoundingClientRect() : null;
  };
  const buttons = [...document.querySelectorAll('.touch-ui .touch-btn')];
  const actions = [...document.querySelectorAll('.touch-ui [data-action]')];
  return {
    overlay: !!document.querySelector('.match-wrap.touch .touch-ui'),
    buttons: buttons.length,
    actions: actions.length,
    labels: actions.map((b) => `${b.dataset.action}:${b.textContent.trim()}`),
    move: !!document.querySelector('.touch-ui .touch-move'),
    look: !!document.querySelector('.touch-ui .touch-look'),
    strike: !!document.querySelector('.touch-ui .touch-strike'),
    strikeLabel: document.querySelector('.touch-ui .touch-strike-label')?.textContent || '',
    oldRing: !!document.querySelector('.touch-ui .touch-primary, .touch-ui .touch-stick-zone, .touch-ui .touch-defense'),
    leftHalf: zoneRect('.touch-move')?.width,
    rightHalf: zoneRect('.touch-look')?.width,
    viewport: window.innerWidth,
    vertical: document.querySelectorAll('.touch-ui .touch-vertical .touch-btn').length,
    pauseBtn: !!document.querySelector('.touch-ui .touch-pause'),
    manualCam: window.app.match.renderer.gameCam.manual === true,
    hint: document.querySelector('.hint')?.textContent || '',
  };
});
ok('overlay present during match', ui.overlay);
ok(
  'two zones + strike pad + 5 action buttons + depth + tactics + pause rendered',
  ui.move && ui.look && ui.strike && ui.buttons === 7 && ui.actions === 10 && ui.vertical === 2 && ui.pauseBtn,
  `buttons=${ui.buttons} actions=${ui.actions}`,
);
ok(
  'the requested buttons are wired by name',
  ['pass', 'turbo', 'breach', 'hit', 'tackle'].every((a) => ui.labels.some((l) => l.startsWith(`${a}:`))),
  ui.labels.join(' '),
);
ok('the old arc / defense / stick-zone DOM is gone', ui.oldRing === false);
ok('the strike pad is labelled SHOOT', ui.strikeLabel === 'SHOOT', ui.strikeLabel);
ok('left half moves, right half looks', ui.leftHalf === ui.viewport / 2 && ui.rightHalf === ui.viewport / 2, `${ui.leftHalf}/${ui.rightHalf} of ${ui.viewport}`);
ok('touch mode takes the camera off auto-follow', ui.manualCam === true);
ok('hint switched to touch wording', /LEFT half/.test(ui.hint), ui.hint.slice(0, 56));

// ------------------------------------------------------------------- stick
// The stick is read relative to the camera, so the same thumb push must resolve to a different
// world vector for two different camera yaws. Both are checked, then the swimmer is actually
// driven along the world vector.
const stick = await page.evaluate(() => {
  const app = window.app;
  const m = app.match;
  const sim = m.sim;
  const zone = document.querySelector('.touch-move');
  zone.setPointerCapture = () => {};
  const pe = (type, x, y) => zone.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: true }));
  const r = zone.getBoundingClientRect();
  const cx = r.left + 100;
  const cy = r.bottom - 100;

  // Up-and-right at yaw 0 (camera looking +z, right = +x) -> world (+x, +z).
  app.input.touch.camYaw = 0;
  pe('pointerdown', cx, cy);
  pe('pointermove', cx + 70, cy - 70);
  const p0 = app.input.poll();
  const atZero = { x: p0.moveX, z: p0.moveZ };

  // The same push with the camera turned a quarter turn -> world (+x, -z).
  app.input.touch.camYaw = Math.PI / 2;
  const p90 = app.input.poll();
  const atNinety = { x: p90.moveX, z: p90.moveZ };

  // Hold straight up (invisible to the yaw: it is always "away from you") and watch a pinned
  // swimmer travel. A swimmer can only be moved during LIVE play: in reset/dead/tipoff/warmup
  // the sim steps physics with deadBall = true, which forces canMove = false, so the stick reads
  // correctly and still moves nobody. Because the match is seeded from the clock, CI sometimes
  // lands here mid-reset and this check failed at 0.00 m for reasons that had nothing to do with
  // the touch controls. So settle on live play first, and report the state on failure.
  pe('pointermove', cx, cy - 70); // straight up -> camera forward, which at yaw PI/2 is +x
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
  pe('pointerup', cx, cy - 70);
  const after = app.input.poll();
  const lookLeak = app.input.touch.lookX || app.input.touch.lookY;
  return { atZero, atNinety, moved, dx, seen, nub, centre, touch: { x: cx, y: cy }, released: { x: after.moveX, z: after.moveZ }, active: app.input.touch.active, lookLeak };
});
ok('stick up+right at yaw 0 reads +x / +z', stick.atZero.x > 0.5 && stick.atZero.z > 0.5, `(${stick.atZero.x.toFixed(2)}, ${stick.atZero.z.toFixed(2)})`);
ok('the same push with the camera turned reads +x / -z', stick.atNinety.x > 0.5 && stick.atNinety.z < -0.5, `(${stick.atNinety.x.toFixed(2)}, ${stick.atNinety.z.toFixed(2)})`);
ok('stick moves the swimmer', stick.moved > 0.5, `${stick.moved.toFixed(2)} m  state=${stick.seen}`);
ok('holding "forward" travels along the camera forward (+x here)', stick.dx > 0.2, `dx=${stick.dx.toFixed(2)}  state=${stick.seen}`);
const nubNums = (stick.nub.match(/-?\d+(\.\d+)?/g) || []).map(Number);
const nubLen = Math.hypot(nubNums[2] || 0, nubNums[3] || 0);
ok('stick nub follows the thumb (clamped to rim)', nubLen > 50 && nubLen < 60, `offset ${nubLen.toFixed(1)}px`);
ok('stick release returns to neutral', Math.abs(stick.released.x) < 1e-6 && Math.abs(stick.released.z) < 1e-6);
ok('stick inactive after release', stick.active === false);
ok('a stick touch never drives the camera', !stick.lookLeak, `look=${stick.lookLeak}`);
ok(
  'stick ring sits under the thumb (fixed placement)',
  Math.hypot(stick.centre.x - stick.touch.x, stick.centre.y - stick.touch.y) < 6,
  `ring (${stick.centre.x.toFixed(0)},${stick.centre.y.toFixed(0)}) vs touch (${stick.touch.x},${stick.touch.y})`
);

// ---------------------------------------------------------------- camera half
const camera = await page.evaluate(() => {
  const app = window.app;
  const cam = app.match.renderer.gameCam;
  const look = document.querySelector('.touch-look');
  look.setPointerCapture = () => {};
  const r = look.getBoundingClientRect();
  const px = r.left + 120;
  const py = r.top + 120;
  const pe = (type, x, y, id = 9) => look.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: true }));

  const before = { yaw: cam.orbitYaw, pitch: cam.orbitPitch, manual: cam.manual };
  pe('pointerdown', px, py);
  pe('pointermove', px + 150, py - 60);
  pe('pointerup', px + 150, py - 60);
  const drag = app.input.consumeLook();
  const consumed = app.input.consumeLook(); // drained: a second read must be empty
  const moveLeak = app.input.touch.active || app.input.poll().moveX !== 0;

  // Feed the drag through the real path the frame loop uses, then let the boom settle and check
  // it actually moved the lens.
  const sim = app.match.sim;
  cam.update(sim, 1 / 60);
  const yawBeforeOrbit = cam.pYaw;
  cam.orbit(drag.x, drag.y);
  for (let i = 0; i < 8; i++) cam.update(sim, 1 / 60);
  const after = { yaw: cam.pYaw, pos: { x: cam.cam.position.x, y: cam.cam.position.y, z: cam.cam.position.z } };

  // Pitch clamps instead of flipping the boom over the top.
  for (let i = 0; i < 200; i++) cam.orbit(0, -40);
  const high = cam.orbitPitch;
  for (let i = 0; i < 400; i++) cam.orbit(0, 40);
  const low = cam.orbitPitch;
  cam.recentre();
  return {
    before,
    drag,
    consumed,
    moveLeak,
    yawBeforeOrbit,
    after,
    high,
    low,
    recentred: { yaw: cam.orbitYaw, pitch: cam.orbitPitch },
  };
});
ok('dragging the right half publishes a camera delta', camera.drag.x > 100 && camera.drag.y < -40, JSON.stringify(camera.drag));
ok('the delta is consumed exactly once per frame', camera.consumed.x === 0 && camera.consumed.y === 0);
ok('a camera drag never drives movement', camera.moveLeak === false);
ok('the orbit yaw turns the boom', Math.abs(camera.after.yaw - camera.yawBeforeOrbit) > 0.3, `${camera.yawBeforeOrbit.toFixed(2)} -> ${camera.after.yaw.toFixed(2)}`);
ok('the drag also moved the lens', Number.isFinite(camera.after.pos.y) && camera.after.pos.y > 0, `y=${camera.after.pos.y.toFixed(2)}`);
ok('pitch clamps at both ends instead of flipping', camera.high === 4.6 && camera.low === -1.1, `${camera.high} / ${camera.low}`);
ok('recentre puts the boom back on the attack line', camera.recentred.yaw === 0 && camera.recentred.pitch === 0);

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
  const btn = (action) => document.querySelector(`.touch-ui .touch-btn[data-action="${action}"]`);
  const tap = (action) => {
    const b = btn(action);
    b.setPointerCapture = () => {};
    b.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, pointerType: 'touch', bubbles: true, cancelable: true }));
    b.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, pointerType: 'touch', bubbles: true, cancelable: true }));
    return b;
  };
  const press = (action) => {
    const b = btn(action);
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

  // TACKLE while carrying — the permanent button fires a trick (the signature move).
  ensureLive();
  const a = fresh(sim.outfield(0)[0]);
  tap('tackle');
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

  // TACKLE off the ball — the same permanent button is the poke/slide tackle. No relabeling,
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
  tap('tackle');
  out.tackleImmediate = JSON.stringify([...app.input.touch.edges]);
  const bi = step(1);
  out.tackleInp = `trick=${bi.trick} breach=${bi.breach} pass=${bi.pass} shoot=${bi.shootPressed} hit=${bi.hit}`;
  out.tackle = b.state === 'tackle';
  out.tackleDebug = `sim=${sim.state} p=${b.state} air=${b.airborne} ctrl=${sim.controlled === b}`;

  // BLOCK (breach) and HIT each deliver their own edge.
  ensureLive();
  const d = fresh(sim.outfield(0)[1]);
  d.stun = 0;
  tap('breach');
  out.block = step(1).breach === true;
  d.stun = 0;
  for (const k in d.cd) d.cd[k] = 0;
  tap('hit');
  out.hit = step(1).hit === true;

  // STRIKE PAD: hold, swipe to aim, release. Freeze every other swimmer for this window: the AI
  // averages ~2.4 tackle attempts per game second, so on a loaded runner a tackle could land
  // mid-wind-up and convert the released shot to kind='loose' before the harness reads it. With
  // the clock paused (above) and opponents frozen, the counted frames are fully deterministic.
  const strike = document.querySelector('.touch-ui .touch-strike');
  strike.setPointerCapture = () => {};
  const sr = strike.getBoundingClientRect();
  const sx = sr.left + sr.width / 2;
  const sy = sr.top + sr.height / 2;
  const swipe = (type, dx, dy, id = 3) => strike.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: sx + dx, clientY: sy + dy, bubbles: true, cancelable: true, isPrimary: true }));
  const shootOnce = (dx, dy) => {
    const p = fresh(sim.outfield(0)[0]);
    for (const q of sim.players) {
      if (q === p) continue;
      q.stun = 999;
      for (const k in q.cd) q.cd[k] = 999;
    }
    app.input.touch.camYaw = 0; // camera forward = +z, camera right = +x
    swipe('pointerdown', 0, 0);
    const immediate = JSON.stringify([...app.input.touch.edges]);
    const first = step(1);
    swipe('pointermove', dx, dy);
    const aimed = { x: app.input.touch.aimX, z: app.input.touch.aimZ };
    step(34); // ~0.58 s of the 0.75 s wind-up -> u ~ 0.78, inside PERFECT (0.68-0.86)
    const held = app.input.touch.shootHeld;
    swipe('pointerup', dx, dy);
    step(1);
    const f = sim.ball.flight;
    const res = {
      immediate,
      first: `shootPressed=${first.shootPressed} shootHeld=${first.shoot} breach=${first.breach} trick=${first.trick}`,
      windup: p.state === 'shoot' || !!p.shot,
      aimed,
      held,
      kind: f ? f.kind : null,
      quality: f ? f.quality : null,
      aimZ: f ? f.aimZ : null,
      released: p.shot ? p.shot.released : false,
      debug: `sim=${sim.state} p=${p.state} ctrl=${sim.controlled === p} shot=${!!p.shot}`,
    };
    // Thaw the AI — later checks (TURBO, the full match) need live opponents.
    for (const q of sim.players) {
      q.stun = 0;
      for (const k in q.cd) q.cd[k] = 0;
    }
    return res;
  };
  ensureLive();
  out.shoot = shootOnce(70, 0); // swipe right
  ensureLive();
  out.shootLeft = shootOnce(-70, 0); // swipe left
  ensureLive();
  out.shootUp = shootOnce(0, -70); // swipe straight away from the camera

  // TURBO burns the meter while held and swimming somewhere (a stationary swimmer cannot turbo)
  ensureLive();
  const tp = fresh(sim.outfield(0)[0]);
  tp.turbo = 100;
  const zone = document.querySelector('.touch-move');
  zone.setPointerCapture = () => {};
  const zr = zone.getBoundingClientRect();
  const zx = zr.left + 100;
  const zy = zr.bottom - 100;
  const stickEv = (t, x, y) => zone.dispatchEvent(new PointerEvent(t, { pointerId: 1, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: true }));
  app.input.touch.camYaw = Math.PI / 2;
  stickEv('pointerdown', zx, zy);
  stickEv('pointermove', zx, zy - 70);
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
  stickEv('pointerup', zx, zy - 70);
  // Stay paused: the harness has stepped the sim hundreds of frames, so handing the clock back
  // here lets the app loop end the match mid-test-suite. Resume happens just before fullMatch.
  app.match.paused = true;
  return out;
});
ok('TACKLE fires a trick while carrying', buttons.trick === true, `${buttons.trickDebug} | ${buttons.trickInp}`);
ok('PASS button fires a pass', buttons.pass === true, `${buttons.passDebug} | ${buttons.passInp}`);
ok('TACKLE off the ball is the tackle — same button, same edge', buttons.tackle === true, `${buttons.tackleDebug} | immediate=${buttons.tackleImmediate} | ${buttons.tackleInp}`);
ok('BLOCK button fires the breach/block edge', buttons.block === true);
ok('HIT button fires the hit edge', buttons.hit === true);
ok('strike pad starts a wind-up on press', buttons.shoot.windup === true, `${buttons.shoot.debug} | immediate=${buttons.shoot.immediate} | ${buttons.shoot.first}`);
ok('strike pad holds (charge)', buttons.shoot.held === true);
ok('lifting off the strike pad fires a shot', buttons.shoot.kind === 'shot', `kind=${buttons.shoot.kind}`);
ok('hold+swipe+lift lands in the PERFECT window', buttons.shoot.quality === 1, `quality=${buttons.shoot.quality}`);
ok('a right swipe aims the shot to that side', buttons.shoot.aimed.x > 0.9 && Math.abs(buttons.shoot.aimed.z) < 0.1, JSON.stringify(buttons.shoot.aimed));
ok('a left swipe aims the shot the other way', buttons.shootLeft.aimed.x < -0.9, JSON.stringify(buttons.shootLeft.aimed));
ok('a swipe away from the camera aims forward', buttons.shootUp.aimed.z > 0.9 && Math.abs(buttons.shootUp.aimed.x) < 0.1, JSON.stringify(buttons.shootUp.aimed));
// Lateral aim takes the swipe's sign into the shot's ring target. A straight-away swipe means "no
// steer", so that shot falls back to the keeper-derived side and must NOT be pinned to zero.
ok(
  'the swipe direction actually bends the shot in the sim',
  buttons.shoot.aimZ > 0.1 && buttons.shootLeft.aimZ < -0.1 && Math.abs(buttons.shootUp.aimZ) < Math.abs(buttons.shoot.aimZ),
  `right=${buttons.shoot.aimZ.toFixed(2)} left=${buttons.shootLeft.aimZ.toFixed(2)} up=${buttons.shootUp.aimZ.toFixed(2)}`,
);
ok('TURBO engages while held + moving', buttons.turbo === true, buttons.turboDebug);
ok('TURBO releases when let go', buttons.turboOff === true);

// --------------------------------------------------- one-shot latch (120 Hz)
const latch = await page.evaluate(() => {
  const app = window.app;
  const b = document.querySelector('.touch-ui .touch-btn[data-action="tackle"]');
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
  const strike = document.querySelector('.touch-ui .touch-strike');
  const lit = strike.classList.contains('gb-ready');
  const litLabel = strike.querySelector('.touch-strike-label').textContent;
  sim.gbReady[0] = false;
  window.app.match.touchControls.setGamebreakerReady(false);
  return {
    lit,
    litLabel,
    unlit: !strike.classList.contains('gb-ready'),
    unlitLabel: strike.querySelector('.touch-strike-label').textContent,
  };
});
ok('the strike pad glows for the GAME BREAKER but keeps its label', gb.lit === true && gb.litLabel === 'SHOOT', gb.litLabel);
ok('the strike pad dims back down when spent (label still SHOOT)', gb.unlit === true && gb.unlitLabel === 'SHOOT', gb.unlitLabel);

// ------------------------------------------------- permanent buttons + layout
const adaptive = await page.evaluate(() => {
  const tc = window.app.match.touchControls;
  const input = window.app.input;
  const btn = (action) => document.querySelector(`.touch-ui .touch-btn[data-action="${action}"]`);
  // Permanence is the contract: no play state may relabel or reroute a button. Each wears the
  // same name and fires the same edge from kickoff to the final whistle.
  const expect = { pass: 'pass', breach: 'breach', hit: 'hit', tackle: 'trick' };
  const seen = [];
  for (const [action, edge] of Object.entries(expect)) {
    for (let i = 0; i < 3; i++) {
      const el = btn(action);
      el.setPointerCapture = () => {};
      el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 5, pointerType: 'touch', bubbles: true, cancelable: true }));
      const polled = input.poll();
      const edges = [...input.touch.edges];
      el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 5, pointerType: 'touch', bubbles: true, cancelable: true }));
      input.touch.edges.clear();
      seen.push({ action, label: el.textContent.trim(), fired: polled[edge] === true, events: edges.join() });
    }
  }
  const turbo = btn('turbo');
  turbo.setPointerCapture = () => {};
  turbo.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 6, pointerType: 'touch', bubbles: true, cancelable: true }));
  const turboHeld = input.touch.turbo === true && input.poll().turbo === true;
  turbo.dispatchEvent(new PointerEvent('pointerup', { pointerId: 6, pointerType: 'touch', bubbles: true, cancelable: true }));
  const turboOff = input.touch.turbo === false;

  const el = document.querySelector('.touch-ui');
  tc.applySettings({ touchLayout: 'left' });
  const leftLayout = el.dataset.layout;
  tc.applySettings({ touchLayout: 'right', touchScale: 9, touchOpacity: 0 });
  const clamped = { scale: el.style.getPropertyValue('--touch-scale'), opacity: el.style.getPropertyValue('--touch-opacity') };
  tc.applySettings({ touchLayout: 'right', touchScale: 1, touchOpacity: 1 });
  return { seen, turboHeld, turboOff, leftLayout, clamped, restored: el.dataset.layout };
});
ok(
  'PASS / BLOCK / HIT / TACKLE keep their label and their edge through every play state',
  adaptive.seen.every((s) => s.fired),
  JSON.stringify(adaptive.seen.slice(0, 6)),
);
ok('BURST is a hold, not a tap', adaptive.turboHeld && adaptive.turboOff);
ok('left-handed layout applies', adaptive.leftLayout === 'left' && adaptive.restored === 'right');
ok('touch size / opacity settings clamp', adaptive.clamped.scale === '1.3' && adaptive.clamped.opacity === '0.4', JSON.stringify(adaptive.clamped));

// --------------------------------------------------------- layout geometry
// Every tappable thing on the overlay, measured the same way on every viewport. Buttons are
// rounded rectangles that the browser hit-tests as shapes, so compare the rects inset by a hair
// rather than raw boxes: a 2px tolerance flags real overlaps only.
const measureOverlay = () => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const name = (el) => el.dataset.action || (el.classList.contains('touch-strike') ? 'strike' : el.classList.contains('touch-pause') ? 'pause' : 'unknown');
  const boxes = [...document.querySelectorAll('.touch-ui .touch-btn, .touch-ui .touch-strike, .touch-ui .touch-tactics button, .touch-ui .touch-pause, .touch-ui .touch-cage')]
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { action: name(el), x: r.left, y: r.top, w: r.width, h: r.height };
    });
  const overlaps = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const pad = 2;
      const hit = a.x + pad < b.x + b.w - pad && b.x + pad < a.x + a.w - pad
        && a.y + pad < b.y + b.h - pad && b.y + pad < a.y + a.h - pad;
      if (hit) {
        const box = (o) => `${o.action}[${Math.round(o.x)},${Math.round(o.y)} ${Math.round(o.w)}x${Math.round(o.h)}]`;
        overlaps.push(`${box(a)} / ${box(b)}`);
      }
    }
  }
  const outside = boxes.filter((b) => b.x < -1 || b.y < -1 || b.x + b.w > vw + 1 || b.y + b.h > vh + 1).map((b) => b.action);
  const small = [];
  for (const el of document.querySelectorAll('.touch-ui .touch-btn, .touch-ui .touch-strike, .touch-ui .touch-tactics button, .touch-ui .touch-pause, .touch-ui .touch-cage')) {
    const r = el.getBoundingClientRect();
    if (Math.min(r.width, r.height) < 36) {
      const cs = getComputedStyle(el);
      small.push(`${name(el)}:${Math.round(r.width)}x${Math.round(r.height)}(cs ${cs.width}x${cs.height}, minH=${cs.minHeight}, xform=${cs.transform})`);
    }
  }
  return { vw, vh, boxes, overlaps, outside, tooSmall: small };
};
const geom = await page.evaluate(() => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const boxes = [...document.querySelectorAll('.touch-ui .touch-btn, .touch-ui .touch-strike')].map((b) => {
    const r = b.getBoundingClientRect();
    return { action: b.dataset.action || 'strike', x: r.left, y: r.top, w: r.width, h: r.height };
  });
  const overlaps = [];
  const outside = [];
  const strike = boxes.find((b) => b.action === 'strike');
  const largest = boxes.reduce((m, b) => (b.w * b.h > m.w * m.h ? b : m));
  const actions = document.querySelector('.touch-actions').getBoundingClientRect();
  const move = document.querySelector('.touch-move').getBoundingClientRect();
  const look = document.querySelector('.touch-look').getBoundingClientRect();
  const rightHanded = {
    actionsOnRight: actions.left > vw / 2,
    padLeftOfStrike: document.querySelector('.touch-pad').getBoundingClientRect().left < strike.x,
    moveLeft: Math.round(move.left),
    moveWidth: Math.round(move.width),
    lookLeft: Math.round(look.left),
    lookWidth: Math.round(look.width),
  };
  // Guard against the touch buttons picking up HUD rules for the same class name (the HUD turbo
  // meter is `.turbo` and skews/positions anything that shares the class).
  const turbo = document.querySelector('.touch-ui .touch-btn[data-action="turbo"]');
  const turboStyle = getComputedStyle(turbo);
  const hudBleed = { transform: turboStyle.transform, width: turboStyle.width, height: turboStyle.height, labelPosition: getComputedStyle(turbo.querySelector('span')).position };
  const tc = window.app.match.touchControls;
  tc.applySettings({ touchLayout: 'left' });
  const leftActions = document.querySelector('.touch-actions').getBoundingClientRect();
  const leftMove = document.querySelector('.touch-move').getBoundingClientRect();
  const leftLook = document.querySelector('.touch-look').getBoundingClientRect();
  const leftStrike = document.querySelector('.touch-strike').getBoundingClientRect();
  const leftPad = document.querySelector('.touch-pad').getBoundingClientRect();
  const mirrored = {
    actionsOnLeft: leftActions.left < 20,
    strikeOutermost: leftStrike.left < leftPad.left,
    moveRight: Math.round(vw - leftMove.right),
    moveWidth: Math.round(leftMove.width),
    lookLeft: Math.round(leftLook.left),
    lookWidth: Math.round(leftLook.width),
  };
  tc.applySettings({ touchLayout: 'right', touchScale: 1, touchOpacity: 1 });
  return {
    vw,
    vh,
    overlaps,
    outside,
    hudBleed,
    strikeIsLargest: largest.action === 'strike',
    strikeInCorner: !!strike && strike.x + strike.w > vw - 20 && strike.y + strike.h > vh - 20,
    rightHanded,
    mirrored,
  };
});
// Full-overlay measurement (every tappable thing, not just the round buttons).
const overlay = await page.evaluate(measureOverlay);
ok('no interactive touch control overlaps another', overlay.overlaps.length === 0, overlay.overlaps.join(', '));
ok('every touch control stays on screen', overlay.outside.length === 0, overlay.outside.join(', '));
ok('every touch control is a reachable size (>= 36px)', overlay.tooSmall.length === 0, overlay.tooSmall.join(', '));
// The zones are generous and the buttons sit on top of them, so the only thing that proves the pad
// is actually tappable is the browser's own hit test. A stray z-index on a zone would make every
// button below it dead without any geometry complaint.
const hits = await page.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll('.touch-ui .touch-btn, .touch-ui .touch-strike, .touch-ui .touch-tactics button, .touch-ui .touch-pause, .touch-ui .touch-cage')) {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit || !(hit === el || el.contains(hit))) {
      const label = el.dataset.action || el.className;
      bad.push(`${label} -> ${hit ? (hit.dataset?.action || hit.className) : 'nothing'}`);
    }
  }
  return bad;
});
ok('every touch control wins the hit test at its own centre', hits.length === 0, hits.join(', '));
ok(
  'touch buttons pick up no HUD styling',
  geom.hudBleed.transform === 'none' && geom.hudBleed.width === '62px' && geom.hudBleed.height === '46px' && geom.hudBleed.labelPosition === 'static',
  JSON.stringify(geom.hudBleed),
);
ok('all touch controls stay on screen', geom.outside.length === 0, geom.outside.join(', '));
ok('the strike pad is the largest control, anchored bottom-right', geom.strikeIsLargest && geom.strikeInCorner);

// Small phones are the cramped case: re-measure at a shorter, narrower landscape and make sure the
// compact sizes still fit, still do not collide, and never shrink past a usable target.
await page.setViewport({ width: 667, height: 375, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await new Promise((r) => setTimeout(r, 250));
const compact = await page.evaluate(measureOverlay);
ok('compact phone: no interactive touch control overlaps another', compact.overlaps.length === 0, compact.overlaps.join(', '));
ok('compact phone: every control stays on screen', compact.outside.length === 0, compact.outside.join(', '));
ok('compact phone: every control stays usable (>= 36px)', compact.tooSmall.length === 0, compact.tooSmall.join(', '));
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await new Promise((r) => setTimeout(r, 250));
ok(
  'right-handed: move on the left half, camera on the right half, pad in the corner',
  geom.rightHanded.moveLeft === 0 && geom.rightHanded.moveWidth === geom.vw / 2
    && geom.rightHanded.lookLeft === geom.vw / 2 && geom.rightHanded.lookWidth === geom.vw / 2
    && geom.rightHanded.actionsOnRight && geom.rightHanded.padLeftOfStrike,
  JSON.stringify(geom.rightHanded),
);
ok(
  'left-handed: stick, camera half and pad all mirror',
  geom.mirrored.actionsOnLeft && geom.mirrored.strikeOutermost
    && geom.mirrored.moveRight === 0 && geom.mirrored.moveWidth === geom.vw / 2
    && geom.mirrored.lookLeft === 0 && geom.mirrored.lookWidth === geom.vw / 2,
  JSON.stringify(geom.mirrored),
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
  const strike = document.querySelector('.touch-ui .touch-strike');
  const moveZone = document.querySelector('.touch-ui .touch-move');
  const lookZone = document.querySelector('.touch-ui .touch-look');
  for (const el of [strike, moveZone, lookZone]) el.setPointerCapture = () => {};
  const fire = (action, type, id) => {
    const btn = button(action);
    btn.setPointerCapture = () => {};
    btn.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', bubbles: true, cancelable: true }));
  };
  const pe = (el, type, x = 0, y = 0, id = 0) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: true }));
  tc.reset();
  input.flushOneShots();
  fire('turbo', 'pointerdown', 101);
  // The old SHOOT button is gone: shooting lives on the strike pad only.
  const deadShootButton = !document.querySelector('.touch-ui [data-action="shoot"]') && !input.touch.shootHeld;
  pe(strike, 'pointerdown', 100, 100, 103);
  pe(strike, 'pointerup', 100, 100, 999); // someone else's pointer: ignored
  const unrelatedReleaseIgnored = input.touch.shootHeld && input.touch.turbo;
  pe(strike, 'pointerup', 100, 100, 103);
  const independentRelease = !input.touch.shootHeld && input.touch.turbo;
  tc.reset();
  fire('rise', 'pointerdown', 104);
  fire('dive', 'pointerdown', 105);
  const opposingDepth = input.touch.moveY === 0;
  fire('dive', 'pointerup', 105);
  const remainingDepth = input.touch.moveY === 1;
  tc.reset();
  input.flushOneShots();
  fire('cage', 'pointerdown', 106);
  const cage = input.poll().cage;
  fire('cage', 'pointerup', 106);
  input.flushOneShots();
  tc.reset();
  pe(strike, 'pointerdown', 100, 100, 107);
  input.poll();
  pe(strike, 'pointercancel', 100, 100, 107);
  const cancellation = !input.touch.shootHeld && !input.poll().shootReleased && input.pending.size === 0;
  // Zone ownership: one finger on the move zone and another on the look zone must not cross.
  tc.reset();
  pe(moveZone, 'pointerdown', 60, 200, 110);
  pe(moveZone, 'pointermove', 60, 140, 110);
  pe(lookZone, 'pointerdown', 700, 200, 111);
  pe(lookZone, 'pointermove', 780, 200, 111);
  const splitPoll = input.poll();
  const splitLook = input.consumeLook();
  const splitConsent = input.touch.active === true
    && Math.abs(splitPoll.moveX) + Math.abs(splitPoll.moveZ) > 0.9
    && splitLook.x > 70;
  pe(moveZone, 'pointerup', 60, 140, 110);
  pe(lookZone, 'pointerup', 780, 200, 111);
  const bothReleased = !input.touch.active && !input.touch.lookX && !input.touch.lookY;
  fire('turbo', 'pointerdown', 108);
  window.dispatchEvent(new Event('blur'));
  const blur = !input.touch.turbo && !document.querySelector('.touch-ui .down');
  tc.reset();
  const actionEdges = [];
  for (const [action, field] of [['tackle', 'trick'], ['hit', 'hit'], ['breach', 'breach'], ['pass', 'pass']]) {
    tc.reset();
    input.flushOneShots();
    fire(action, 'pointerdown', 120);
    const polled = { ...input.poll() };
    actionEdges.push(polled[field]);
    fire(action, 'pointerup', 120);
  }
  tc.setMatchState(window.app.match.sim);
  tc.reset();
  input.flushOneShots();
  fire('offensePlay', 'pointerdown', 121);
  const offenseCall = input.poll().playcall;
  fire('offensePlay', 'pointerup', 121);
  const tacticSim = window.app.match.sim;
  tacticSim.state = 'live';
  tacticSim.userPlayTimer = 0;
  const tacticPlayer = tacticSim.controlled;
  tacticPlayer.input.playcall = offenseCall;
  tacticSim.processInput(tacticPlayer);
  const offenseTactic = offenseCall >= 1 && offenseCall <= 3 && tacticSim.offPlay[tacticSim.userTeam] === offenseCall - 1;
  input.flushOneShots();
  fire('defensePlay', 'pointerdown', 122);
  const defenseCall = input.poll().playcall;
  fire('defensePlay', 'pointerup', 122);
  tacticSim.userPlayTimer = 0;
  tacticPlayer.input.playcall = defenseCall;
  tacticSim.processInput(tacticPlayer);
  const defenseTactic = defenseCall >= 7 && defenseCall <= 9 && tacticSim.defPlay[tacticSim.userTeam] === defenseCall - 7;
  input.flushOneShots();
  tc.reset();
  fire('turbo', 'pointerdown', 108);
  window.app.match.paused = false;
  window.app.pause();
  const pause = !input.touch.turbo && input.pending.size === 0;
  window.app.resume();
  window.app.match.paused = true;
  return {
    deadShootButton,
    unrelatedReleaseIgnored,
    independentRelease,
    opposingDepth,
    remainingDepth,
    cage,
    cancellation,
    splitConsent,
    bothReleased,
    blur,
    pause,
    explicitActions: actionEdges.every(Boolean),
    offenseTactic,
    defenseTactic,
  };
});
for (const [name, passed] of Object.entries(ownership)) ok(`rebuilt touch lifecycle: ${name}`, passed);

// ----------------------------------------------------- manual keeper control surface
const keeperControls = await page.evaluate(() => {
  const app = window.app;
  const m = app.match;
  const sim = m.sim;
  const input = app.input;
  const tc = m.touchControls;
  app.match.paused = true;
  sim.state = 'live';
  sim.keeperSwitchCd = 0;
  sim.ball.holder = null;
  sim.ball.pos.copy(sim.ownGoalPos(sim.userTeam));
  const fire = (el, type, x, y, id) => el.dispatchEvent(new PointerEvent(type, {
    pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true,
  }));
  const cage = document.querySelector('[data-action="cage"]');
  const strike = tc.strike;
  const move = tc.moveZone;
  for (const el of [cage, strike, move]) el.setPointerCapture = () => {};
  fire(cage, 'pointerdown', 0, 0, 140);
  sim.setUserInput(input.poll());
  sim.step(1 / 60);
  input.flushOneShots();
  input.setKeeperContext(sim.inCage, sim.attackDir(sim.userTeam));
  tc.setCage(false, sim.inCage);
  const enteredViaButton = sim.inCage && sim.controlled.isKeeper;
  const gk = sim.controlled;
  gk.state = 'idle'; gk.stun = 0; gk.cd.dive = 0;
  gk.y = 0; gk.pos.z = 0;
  for (let i = 0; i < 60; i++) m.renderer.gameCam.update(sim, 1 / 60);
  input.touch.camYaw = m.renderer.gameCam.pYaw;
  const r = move.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  fire(move, 'pointerdown', x, y, 141);
  fire(move, 'pointermove', x + 40, y, 141);
  const before = { ...input.poll() };
  fire(strike, 'pointerdown', 700, 240, 142);
  fire(strike, 'pointermove', 740, 200, 142);
  const holding = { ...input.poll() };
  const noPrematureDive = !holding.breach && !holding.shootPressed && !input.touch.shootHeld;
  fire(move, 'pointermove', x + 50, y, 141); // must not use the strike origin
  const steeringIndependent = input.poll().moveZ * before.moveZ > 0;
  fire(strike, 'pointerup', 740, 200, 142);
  const action = { ...input.poll() };
  const pendingAim = { ...input.poll().keeperAim };
  sim.setUserInput(action);
  gk.input = { ...action };
  sim.processInput(gk);
  const aimLocked = gk.diveDir < -0.7 && gk.diveHeight > 0.7 && pendingAim.height > 0.7;
  input.flushOneShots();
  input.onBlur();
  fire(move, 'pointerup', x + 50, y, 141);
  const y0 = gk.y, z0 = gk.pos.z;
  for (let i = 0; i < 6; i++) {
    sim.tickCooldowns(gk, 1 / 60);
    sim.updatePlayerPhysics(gk, 1 / 60, false);
  }
  const lungeWorks = gk.y > y0 + 0.3 && gk.pos.z < z0 - 0.5;
  m.hud.update();
  const readIndicator = !m.hud.els.keeperRead.hidden && m.hud.els.keeperState.textContent.includes('HIGH');
  const diveLabel = strike.querySelector('.touch-strike-label').textContent === 'DIVE';
  // Cancelled gesture must never become a delayed dive.
  fire(strike, 'pointerdown', 700, 240, 143);
  fire(strike, 'pointercancel', 720, 200, 143);
  const cancelSafe = !input.poll().breach && input.pending.size === 0;
  sim.leaveCage();
  input.setKeeperContext(false);
  tc.setCage(true, false);
  m.hud.update();
  const restored = strike.querySelector('.touch-strike-label').textContent === 'SHOOT' && m.hud.els.keeperRead.hidden;
  return { enteredViaButton, noPrematureDive, steeringIndependent, aimLocked, lungeWorks, readIndicator, diveLabel, cancelSafe, restored };
});
for (const [name, passed] of Object.entries(keeperControls)) ok(`keeper control surface: ${name}`, passed);

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
  document.querySelector('.touch-stick').classList.add('engaged');
  document.querySelector('.touch-stick-nub').style.transform = 'translate(-50%, -50%) translate(40px, -40px)';
  document.querySelector('.touch-strike').classList.add('down');
  document.querySelector('.touch-strike-dot').style.transform = 'translate(-50%, -50%) translate(24px, -18px)';
});
await new Promise((r) => setTimeout(r, 250));
await page.screenshot({ path: process.env.SHOT2 || '/tmp/touch-landscape.png' });

console.log(errors.length ? `\n${errors.length} page error(s):` : '\nno page errors');
for (const e of errors.slice(0, 10)) console.log('  ', e.slice(0, 200));
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall touch checks passed');
await browser.close();
process.exit(errors.length || failures ? 1 : 0);
