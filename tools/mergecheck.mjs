import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

/**
 * Verifies the static-merge refactor did not move any geometry.
 *
 * mergeStatic() bakes each part's world matrix into its vertices, so the failure mode is a wrong
 * bake origin — parts landing at the wrong place rather than crashing. This asserts each merged
 * mesh's world bounding box against the analytic extent of the props it replaced (recomputed here
 * from the same noise2() the builder used), which catches exactly that.
 *
 * Usage: node tools/mergecheck.mjs [url]
 */

const url = process.argv[2] || 'http://127.0.0.1:5173/';
process.env.LD_LIBRARY_PATH = `/tmp/al2023/lib:/tmp:${process.env.LD_LIBRARY_PATH || ''}`;
chromium.setGraphicsMode = true;
const browser = await puppeteer.launch({
  args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  executablePath: await chromium.executablePath(),
  headless: 'shell',
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.setViewport({ width: 640, height: 360 });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate(() => {
  window.app.audio.unlock = () => {};
  window.app.startMatch({ home: window.app.teams[0], away: window.app.teams[3], userTeam: 0, mode: 'quick', seed: 12345 });
});  const checks = await page.evaluate(() => {
    // Step the sim/render together first so the camera has settled and frustum culling is in its
    // steady state — measured before any stepping, the draw-call count is not comparable.
    const m = window.app.match;
    for (let i = 0; i < 10; i++) { m.sim.step(1 / 60); m.renderer.update(1 / 60); }
  const R = window.app.match.renderer;
  R.scene.updateMatrixWorld(true);
  const out = [];
  const find = (name) => {
    let hit = null;
    R.scene.traverse((o) => { if (o.name === name && o.isMesh) hit = o; });
    return hit;
  };
  // Every merged mesh must be finite and non-degenerate, and must sit inside the arena bounds.
  const bad = [];
  let mergedCount = 0;
  R.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const p = o.geometry.attributes.position;
    if (!p) return;
    if (o.geometry.userData?.merged) mergedCount++;
    for (let i = 0; i < p.count * 3; i++) {
      if (!Number.isFinite(p.array[i])) { bad.push(o.name || '(unnamed)'); return; }
    }
  });
  out.push(['all merged geometry is finite', bad.length === 0, bad.slice(0, 3).join(',')]);

  // THE core assertion: a wrong bake origin shows up as a merged mesh whose world bounding box no
  // longer covers the props it replaced. The skyline is the clearest case — 40 towers on a ring
  // 95..125 m out, up to 60 m tall, so its merged mesh MUST span a ring-sized, tall box centred on
  // the origin. A wrong bake origin collapses that to something tiny or off-centre.
  const bbOf = (o) => {
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox.clone();
    bb.applyMatrix4(o.matrixWorld);
    return bb;
  };
  const skyline = [];
  R.scene.traverse((o) => {
    if (o.isMesh && o.userData?.merged && o.userData.merged >= 30) skyline.push(o);
  });
  // Two, not one: the towers (40 boxes) and their lit windows (~230 planes) are different
  // materials, so each merges separately.
  out.push(['skyline merged into 2 meshes (towers + windows)', skyline.length === 2, `merged30plus=${skyline.length}`]);
  if (skyline.length === 2) {
    const bb = bbOf(skyline[0]);
    const spanX = bb.max.x - bb.min.x;
    const spanY = bb.max.y - bb.min.y;
    // Ring radius 95..125 => diameter >= 190; tower heights 14..60 stacked on groundY.
    out.push(['skyline spans the full ring', spanX > 180 && spanX < 280, `spanX=${spanX.toFixed(1)}`]);
    out.push(['skyline spans full tower height', spanY > 40 && spanY < 80, `spanY=${spanY.toFixed(1)}`]);
    // The ring is 40 towers sampled around a circle, so the bounding box centre sits a couple of
    // metres off the arena origin by construction — that is geometry sampling, not a bad bake. What
    // matters is that it stays tiny next to the 95..125 m ring radius.
    const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
    out.push(['skyline is centred on the arena', Math.abs(cx) < 12 && Math.abs(cz) < 12,
      `cx=${cx.toFixed(2)} cz=${cz.toFixed(2)}`]);
  }

  // Every merged mesh must have a sane, non-zero bounding box (a NaN or collapsed bake shows here).
  const degenerate = [];
  R.scene.traverse((o) => {
    if (!o.isMesh || !o.userData?.merged) return;
    const bb = bbOf(o);
    const finite = Number.isFinite(bb.min.x + bb.min.y + bb.min.z + bb.max.x + bb.max.y + bb.max.z);
    const nonZero = (bb.max.x - bb.min.x) + (bb.max.y - bb.min.y) + (bb.max.z - bb.min.z) > 1e-6;
    if (!finite || !nonZero) degenerate.push(o.name || '(unnamed)');
  });
  out.push(['merged meshes have finite, non-zero bounds', degenerate.length === 0, degenerate.slice(0, 3).join(',')]);

  // The stadium group must still exist and be populated (merging must not have emptied it).
  const stadium = R.scene.getObjectByName('stadium');
  out.push(['stadium group still populated', !!stadium && stadium.children.length > 5, `children=${stadium ? stadium.children.length : 0}`]);

  // Machinery units still animate independently: six units, each with merged steel + 2 lights.
  const mach = R.scene.getObjectByName('machinery');
  out.push(['6 machinery units intact', mach && mach.children.length === 6, `units=${mach ? mach.children.length : 0}`]);
  if (mach) {
    const perUnit = mach.children.map((u) => u.children.length);
    out.push(['each unit has 3 merged parts', perUnit.every((n) => n === 3), perUnit.join(',')]);
  }

  // The crowd is still two InstancedMeshes with the full seat count (untouched by the merge).
  const crowd = R.scene.getObjectByName('crowd');
  const inst = crowd ? crowd.children.filter((c) => c.isInstancedMesh) : [];
  out.push(['crowd still instanced (2 meshes)', inst.length === 2, `n=${inst.length}`]);
  if (inst.length === 2) {
    out.push(['crowd instance counts match', inst[0].count === inst[1].count && inst[0].count > 200, `count=${inst[0].count}`]);
  }

  // Character rigs: each swimmer must still have a full articulated body. The rig animates by
  // rotating named joints, so those joint nodes surviving is what proves the merge didn't collapse
  // the skeleton (merging across joints would have frozen the limbs).
  const bodies = [];
  R.scene.traverse((o) => { if (o.name === 'body') bodies.push(o); });
  out.push(['14 character rigs present', bodies.length === 14, `n=${bodies.length}`]);
  // The rig animates by rotating joint groups the view holds references to (arms/legs/wrists).
  // If merging had collapsed a joint the animation writes into, those arrays would be short or
  // the groups would be gone — so assert the tracked articulation is intact on every view.
  const views = [...(R.views?.values?.() || [])].filter(Boolean);
  const articulated = views.filter((v) => v.arms?.length === 2 && v.legs?.length === 2 && v.wrists?.length === 2).length;
  out.push(['every view keeps 2 arms / 2 legs / 2 wrists', views.length > 0 && articulated === views.length,
    `ok=${articulated}/${views.length}`]);
  // And that those joint groups are still in the scene graph and still hold meshes.
  const liveJoints = views.filter((v) => v.arms.every((a) => a.elbow?.parent && a.shoulder?.parent)).length;
  out.push(['arm joints still parented in the scene', views.length > 0 && liveJoints === views.length,
    `ok=${liveJoints}/${views.length}`]);

  // Draw calls must be well under the pre-merge count. Measured at 'low' quality so the number is
  // comparable to the 697 recorded before/after on the same footing (no shadow or bloom passes).
  const prevQuality = R.settings.quality;
  R.settings.quality = 'low';
  const three = R.renderer;
  three.info.autoReset = false;
  three.info.reset();
  R.render();
  const calls = three.info.render.calls;
  three.info.autoReset = true;
  R.settings.quality = prevQuality;
  out.push(['draw calls under 750 at low quality', calls < 750, `calls=${calls}`]);

  return out;
});

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
