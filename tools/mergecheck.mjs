/**
 * Arena structural gate: the built scene must contain the sphere pool, its markings and both
 * ring-goal assemblies, all geometrically sane, with the character rigs still articulated — and it
 * must draw within budget.
 *
 * This used to assert a static-merge refactor of the old stadium (skyline towers, stand rings,
 * floodlights baked into merged meshes with `userData.merged`). That arena is gone: src/render/court.js
 * now builds a translucent water sphere, an equator wall with waypoints and two three-ring goals,
 * and nothing in src/ calls mergeStatic() any more. The invariants worth keeping are the ones that
 * survived the rewrite, so the checks below are written against what the scene actually contains:
 * the arena present and finite, the goal assemblies complete (one 3-point top ring and two 1-point
 * rings per goal), the swimmer rigs articulated, and the frame inside its draw-call budget.
 *
 * A misspelled or collapsed build (a bad bake origin, a NaN radius, a batch that silently fails)
 * shows up here rather than in a screenshot someone has to eyeball.
 *
 * Usage: node tools/mergecheck.mjs [url]
 */
import { launchBrowser } from './lib/browser.mjs';
import { ARENA } from '../src/data/constants.js';

const url = process.argv[2] || 'http://127.0.0.1:5173/';
const browser = await launchBrowser();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.setViewport({ width: 640, height: 360 });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate(() => {
  window.app.audio.unlock = () => {};
  window.app.startMatch({ home: window.app.teams[0], away: window.app.teams[3], userTeam: 0, mode: 'quick', seed: 12345 });
});
const { checks } = await page.evaluate((arena) => {
  // Step the sim/render together first so the camera has settled and frustum culling is in its
  // steady state — measured before any stepping, the draw-call count is not comparable.
  const m = window.app.match;
  for (let i = 0; i < 10; i++) { m.sim.step(1 / 60); m.renderer.update(1 / 60); }
  const R = m.renderer;
  R.scene.updateMatrixWorld(true);
  const out = [];

  // Every mesh in the arena must carry finite vertices: a NaN radius or a collapsed bake poisons
  // the whole buffer, and the failure mode in three is a silently invisible mesh.
  const bad = [];
  R.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const p = o.geometry.attributes.position;
    if (!p) return;
    for (let i = 0; i < p.count * 3; i++) {
      if (!Number.isFinite(p.array[i])) { bad.push(o.name || '(unnamed)'); return; }
    }
  });
  out.push(['all arena geometry is finite', bad.length === 0, bad.slice(0, 3).join(',')]);

  const meshBox = (o) => {
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox.clone();
    bb.applyMatrix4(o.matrixWorld);
    return bb;
  };
  /** World bounds of a mesh or of a group (the wall markers and markings are groups). */
  const bbOf = (o) => {
    if (o.geometry) return meshBox(o);
    let box = null;
    o.traverse((c) => {
      if (!c.isMesh || !c.geometry) return;
      const bb = meshBox(c);
      if (!box) { box = bb; return; }
      box.min.set(Math.min(box.min.x, bb.min.x), Math.min(box.min.y, bb.min.y), Math.min(box.min.z, bb.min.z));
      box.max.set(Math.max(box.max.x, bb.max.x), Math.max(box.max.y, bb.max.y), Math.max(box.max.z, bb.max.z));
    });
    return box;
  };

  // The pool shell: one water sphere at ARENA.sphereRadius, so its world bounding box must span
  // that diameter and sit on the arena origin. A wrong radius or a stale bake collapses this.
  const pool = R.scene.getObjectByName('translucent-sphere-pool');
  out.push(['the sphere pool is present', !!pool]);
  if (pool) {
    const bb = bbOf(pool);
    const span = bb.max.x - bb.min.x;
    const cx = (bb.min.x + bb.max.x) / 2;
    const cz = (bb.min.z + bb.max.z) / 2;
    const want = arena.sphereRadius * 2;
    out.push(['the pool spans the full water sphere', Math.abs(span - want) < 1, `span=${span.toFixed(2)} want=${want}`]);
    out.push(['the pool is centred on the arena', Math.abs(cx) < 1 && Math.abs(cz) < 1, `cx=${cx.toFixed(2)} cz=${cz.toFixed(2)}`]);
  }

  // The wall and the surface markings: present, and not degenerated into a point.
  for (const [name, what] of [
    ['pool-equator', 'the equator wall ring'],
    ['pool-wall-markers', 'the wall waypoints'],
    ['sphere-pool-field-markings', 'the field markings'],
  ]) {
    const o = R.scene.getObjectByName(name);
    const bb = o ? bbOf(o) : null;
    let detail = '';
    let ok = !!bb;
    if (bb) {
      const span = (bb.max.x - bb.min.x) + (bb.max.y - bb.min.y) + (bb.max.z - bb.min.z);
      ok = Number.isFinite(span) && span > 1e-3;
      detail = `span=${span.toFixed(2)}`;
    } else if (o) {
      detail = 'no geometry underneath';
    }
    out.push([`${what} is present and non-degenerate`, ok, detail]);
  }

  // Both goal assemblies, each with its three scoring rings: one 3-point top ring and two 1-point
  // rings, all named for their point value by court.js.
  const goalNames = ['east-ring-goal', 'west-ring-goal'];
  const goals = goalNames.map((n) => R.scene.getObjectByName(n));
  out.push(['both ring-goal assemblies are present', goals.every(Boolean),
    goals.map((g, i) => `${goalNames[i]}=${!!g}`).join(' ')]);
  const hoops = [];
  R.scene.traverse((o) => { if (o.name && o.name.startsWith('goal-ring-')) hoops.push(o.name); });
  out.push(['every goal carries a 3-point ring and two 1-point rings', hoops.length === 6
    && hoops.filter((n) => n.endsWith('-3pt')).length === 2
    && hoops.filter((n) => n.endsWith('-1pt')).length === 4, hoops.join(',')]);
  // The hoops have to hang on the goal plane (|x| = ARENA.goalX), not at the arena origin: a ring
  // left behind by a bad transform is exactly the class of bug this tool exists for. The world
  // matrix's translation lane is the x offset, no THREE.Vector3 needed in the page context.
  const hoopX = [];
  R.scene.traverse((o) => {
    if (o.name && o.name.startsWith('goal-ring-')) hoopX.push(Math.abs(o.matrixWorld.elements[12]));
  });
  out.push([
    'the rings hang on the goal plane',
    hoopX.length === 6 && hoopX.every((x) => Math.abs(x - arena.goalX) < 0.5),
    `x=${hoopX.map((x) => x.toFixed(2)).join(',')} want=${arena.goalX}`,
  ]);

  // Character rigs: each swimmer must still have a full articulated body. The rig animates by
  // rotating joint groups the view holds references to (arms/legs/wrists); if a joint group were
  // collapsed or dropped, the arrays would come up short and the limb would be frozen.
  const bodies = [];
  R.scene.traverse((o) => { if (o.name === 'body') bodies.push(o); });
  out.push(['14 character rigs present', bodies.length === 14, `n=${bodies.length}`]);
  const views = [...(R.playerViews?.values?.() || [])].filter(Boolean);
  const articulated = views.filter((v) => v.arms?.length === 2 && v.legs?.length === 2 && v.wrists?.length === 2).length;
  out.push(['every view keeps 2 arms / 2 legs / 2 wrists', views.length > 0 && articulated === views.length,
    `ok=${articulated}/${views.length}`]);
  const liveJoints = views.filter((v) => v.arms.every((a) => a.elbow?.parent && a.shoulder?.parent)).length;
  out.push(['arm joints still parented in the scene', views.length > 0 && liveJoints === views.length,
    `ok=${liveJoints}/${views.length}`]);

  // Draw calls must stay well under the pre-merge count. Measured at 'low' quality so the number is
  // comparable on the same footing (no shadow or bloom passes). `R` is the scene view; the app's
  // GameRenderer owns the canvas, the quality level and the WebGL info counters.
  const game = window.app.renderer;
  const prevQuality = game.quality;
  game.setQuality('low');
  const three = game.renderer;
  three.info.autoReset = false;
  three.info.reset();
  game.render(window.app.scene, window.app.camera, 1 / 60);
  const calls = three.info.render.calls;
  three.info.autoReset = true;
  game.setQuality(prevQuality);
  out.push(['draw calls under 750 at low quality', calls < 750, `calls=${calls}`]);

  return { checks: out };
}, ARENA);

let failed = 0;
for (const [name, ok, detail] of checks) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
if (errors.length) {
  failed++;
  console.log(`FAIL  no page errors  (${errors.slice(0, 2).join(' | ')})`);
} else {
  console.log('PASS  no page errors');
}
await browser.close();
process.exit(failed ? 1 : 0);
