import { TEAMS, teamOverall } from '../data/teams.js';
import { RNG } from '../core/rng.js';

const ARCHETYPE_STATS = {
  FINISHER: { spd: 72, sht: 82, hnd: 68, pas: 58, tkl: 52, pow: 78, end: 70, gb: 72 },
  SNIPER: { spd: 68, sht: 88, hnd: 70, pas: 64, tkl: 48, pow: 48, end: 68, gb: 78 },
  HANDLER: { spd: 82, sht: 62, hnd: 88, pas: 82, tkl: 62, pow: 44, end: 76, gb: 82 },
  ENFORCER: { spd: 58, sht: 48, hnd: 52, pas: 54, tkl: 74, pow: 88, end: 82, gb: 66 },
  ALLROUND: { spd: 70, sht: 68, hnd: 68, pas: 68, tkl: 64, pow: 64, end: 70, gb: 68 },
};

export function createPlayerProfile({ name = 'Rookie', archetype = 'ALLROUND', skin = 0, hair = 0 } = {}) {
  const stats = ARCHETYPE_STATS[archetype] || ARCHETYPE_STATS.ALLROUND;
  return {
    id: `career_${Date.now()}_${Math.floor(Math.random() * 1e5)}`,
    name: name.trim().slice(0, 18) || 'Rookie',
    nick: name.trim().split(/\s+/)[0].slice(0, 12).toUpperCase() || 'ROOKIE',
    archetype,
    role: 'FW',
    number: 10,
    skin: Number(skin) || 0,
    hair: Number(hair) || 0,
    ...stats,
    cat: 45,
    blk: 42,
    signature: 'UNLOCK YOUR SIGNATURE',
    level: 1,
    xp: 0,
    gear: [],
    items: [],
  };
}

/**
 * "Run The Pools" career: pick a crew, beat every other crew in their home sphere
 * in a ladder ordered by strength, earn Rep, unlock the Legend difficulty at the end.
 * Serialisable to JSON for localStorage.
 */
export function createCareer(teamId, difficulty = 'pro', player = {}) {
  const ladder = TEAMS.filter((t) => t.id !== teamId)
    .sort((a, b) => teamOverall(a) - teamOverall(b))
    .map((t) => t.id);
  return {
    teamId,
    player: createPlayerProfile(player),
    difficulty,
    ladder,
    stage: 0,
    rep: 0,
    wins: 0,
    losses: 0,
    history: [],
    complete: false,
    seed: Math.floor(Math.random() * 1e9),
  };
}

export function xpToNext(level) {
  return 100 + (level - 1) * 75;
}

export function awardPlayerProgress(career, result) {
  const p = career.player;
  const earned = 35 + Math.round((result.style || 0) / 25) + (result.won ? 100 : 35) + Math.max(0, result.margin || 0) * 8;
  p.xp += earned;
  const unlocked = [];
  while (p.xp >= xpToNext(p.level)) {
    p.xp -= xpToNext(p.level);
    p.level++;
    const gear = p.level === 2 ? 'TURBO FINS' : p.level === 3 ? 'AQUA VISOR' : p.level === 4 ? 'POWER GAUNTLET' : p.level === 5 ? 'SIGNATURE SHOT' : null;
    if (gear && !p.gear.includes(gear)) {
      p.gear.push(gear);
      unlocked.push(gear);
      if (gear === 'TURBO FINS') p.spd = Math.min(99, p.spd + 2);
      if (gear === 'POWER GAUNTLET') p.pow = Math.min(99, p.pow + 2);
    }
    const item = p.level === 6 ? 'RIPTIDE CHARM' : p.level === 8 ? 'GAMEBREAKER CORE' : null;
    if (item && !p.items.includes(item)) {
      p.items.push(item);
      unlocked.push(item);
    }
  }
  if (p.gear.includes('SIGNATURE SHOT')) p.signature = 'LEVEL BREAKER';
  return { earned, unlocked };
}

export function currentOpponent(career) {
  if (career.complete) return null;
  return TEAMS.find((t) => t.id === career.ladder[career.stage]) || null;
}

export function recordResult(career, result) {
  const { won, score, style, margin } = result;
  career.history.push({ opponent: career.ladder[career.stage], won, score, style });
  if (won) {
    career.wins++;
    career.rep += 100 + Math.max(0, margin) * 10 + Math.round(style / 20);
    career.stage++;
    if (career.stage >= career.ladder.length) career.complete = true;
  } else {
    career.losses++;
    career.rep += Math.round(style / 40);
  }
  return career;
}

export function careerTitle(career) {
  const r = career.rep;
  if (career.complete) return 'BLITZ LEGEND';
  if (r >= 1200) return 'KING OF THE POOL';
  if (r >= 800) return 'PROBLEM';
  if (r >= 450) return 'BLITZER';
  if (r >= 200) return 'REGULAR';
  return 'ROOKIE';
}

/** Quick AI-vs-AI result for simulated ladder games (not used by the player path). */
export function simQuick(homeId, awayId, seed) {
  const rng = new RNG(seed);
  const h = teamOverall(TEAMS.find((t) => t.id === homeId));
  const a = teamOverall(TEAMS.find((t) => t.id === awayId));
  let hs = 0;
  let as = 0;
  // ~12 goals a match on average, split by rating gap; no draws.
  const goals = rng.int(8, 16);
  for (let i = 0; i < goals; i++) {
    const pH = 0.5 + (h - a) / 200;
    if (rng.chance(pH)) hs += 1;
    else as += 1;
  }
  if (hs === as) {
    if (rng.chance(0.5 + (h - a) / 200)) hs++;
    else as++;
  }
  return [hs, as];
}
