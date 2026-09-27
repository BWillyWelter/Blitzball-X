/**
 * BLITZBALL X — procedural swim locomotion (upgraded).
 *
 * Continuous-state poses: the swim cycle and treading water. These stay procedural (not
 * pose-track data) because they need an unbroken phase that never syncs to a sim state
 * duration. Discrete states live in animtracks.js.
 *
 * What changed vs. the old applySwimCycle/applyTreadWater:
 *   - Asymmetric stroke: fast pull (~35% of the cycle), slower recovery arc over the top.
 *     The old symmetric sine made arms "windmill"; this reads as swimming.
 *   - Hip-led body roll across hips/spine/torso instead of a single torso wobble.
 *   - Wrist joints flick through the pull — hands are the most visible extremity.
 *   - Tread water: sculling wrists, wider eggbeater-style kick, calmer arms.
 *
 * Both functions write joint targets into the view exactly like the old methods did;
 * CharacterView.update's blend pass smooths transitions. No allocation.
 */

function strokePose(s, out) {
  // s: arm cycle phase in [0, 2PI). out: {shX, elX, wrX} shoulder/elbow/wrist targets.
  const u = s / (Math.PI * 2);
  if (u < 0.35) {
    // PULL: accelerating sweep from catch to hip, elbow high, wrist flicks at the end.
    const f = 1 - Math.pow(1 - u / 0.35, 2); // ease-out: power early
    out.shX = -Math.PI + 1.3 - f * 2.7;
    out.elX = -0.3 - Math.sin(f * Math.PI) * 1.15;
    out.wrX = -0.2 - Math.sin(f * Math.PI) * 0.5;
  } else {
    // RECOVERY: slower return arc over the top, elbow leads, hand relaxed.
    const v = (u - 0.35) / 0.65;
    const g = v * v * (3 - 2 * v); // smoothstep
    out.shX = -Math.PI - 1.4 + g * 2.7;
    out.elX = -1.45 + g * 1.15;
    out.wrX = -0.7 + g * 0.5;
  }
}

// Reused per call — no allocation in the frame loop.
const poseA = { shX: 0, elX: 0, wrX: 0 };
const poseB = { shX: 0, elX: 0, wrX: 0 };

export function swimCycle(view, time, amplitude, frequency, pitch) {
  const arms = view.arms;
  const legs = view.legs;

  const phase = time * frequency;
  const sine = Math.sin(phase);
  const cosine = Math.cos(phase);

  view.body.rotation.x = pitch;
  view.body.position.y = -pitch * 0.35;
  view.body.position.z = pitch * 0.25;

  // Flutter kick: smaller, hip-led; knees bend only on the downbeat.
  const kick = amplitude * 0.38;
  legs[0].hip.rotation.x = sine * kick;
  legs[1].hip.rotation.x = -sine * kick;
  legs[0].knee.rotation.x =
    Math.max(0, -cosine) * kick * 0.9 + 0.1;
  legs[1].knee.rotation.x =
    Math.max(0, cosine) * kick * 0.9 + 0.1;

  // Alternating strokes with an asymmetric waveform per arm.
  const leftStroke = phase * 0.5;
  const rightStroke = leftStroke + Math.PI;
  strokePose(leftStroke, poseA);
  strokePose(rightStroke, poseB);

  arms[0].shoulder.rotation.x = poseA.shX;
  arms[0].elbow.rotation.x = poseA.elX;
  arms[1].shoulder.rotation.x = poseB.shX;
  arms[1].elbow.rotation.x = poseB.elX;

  if (view.wrists) {
    view.wrists[0].rotation.x = poseA.wrX;
    view.wrists[1].rotation.x = poseB.wrX;
  } else {
    // Pre-rig-upgrade fallback: no wrist joints yet — fold the flick into the elbow.
    arms[0].elbow.rotation.x += poseA.wrX * 0.4;
    arms[1].elbow.rotation.x += poseB.wrX * 0.4;
  }

  // Hip-led roll: hips counter-rotate, spine and torso follow through. This is the
  // single biggest "lifelike" cue — real swimmers rotate around the spine, not in place.
  const roll = Math.sin(leftStroke);
  view.hips.rotation.y = sine * 0.12 * amplitude;
  if (view.spine) view.spine.rotation.y = roll * 0.22;
  view.torso.rotation.z = roll * 0.16;
  view.torso.rotation.x = -pitch * 0.15;

  view.neck.rotation.x = -pitch * 0.8;
}

export function treadWater(view, time) {
  const arms = view.arms;
  const legs = view.legs;

  const bob = Math.sin(time * 2.2);
  const kickL = Math.sin(time * 4);
  const kickR = Math.sin(time * 4 + Math.PI * 0.5);
  const scull = Math.sin(time * 5.2);

  view.body.rotation.x = 0.12;

  // Eggbeater-ish: legs circle out of phase, knees soft.
  legs[0].hip.rotation.x = 0.25 + kickL * 0.18;
  legs[1].hip.rotation.x = 0.25 + kickR * 0.18;
  legs[0].hip.rotation.z = 0.14 + kickR * 0.08;
  legs[1].hip.rotation.z = -0.14 - kickL * 0.08;
  legs[0].knee.rotation.x = 0.55;
  legs[1].knee.rotation.x = 0.55;

  // Arms scull wide and low — calmer than the old "hands up" tread.
  const stroke = Math.sin(time * 2.6);
  arms[0].shoulder.rotation.z = -0.9 + stroke * 0.18;
  arms[1].shoulder.rotation.z = 0.9 - stroke * 0.18;
  arms[0].shoulder.rotation.x = -0.5;
  arms[1].shoulder.rotation.x = -0.5;
  arms[0].elbow.rotation.x = -0.7;
  arms[1].elbow.rotation.x = -0.7;

  if (view.wrists) {
    view.wrists[0].rotation.z = -0.4 + scull * 0.25;
    view.wrists[1].rotation.z = 0.4 - scull * 0.25;
  }

  return 1.0 + bob * 0.03;
}
