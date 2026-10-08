import { TEAMS, TEAM_BY_ID, teamOverall, playerOverall } from '../data/teams.js';
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
    role: 'SH', // the player is one of the team's two designated scorers (a captain)
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
 * "Run The Pools" career: pick a crew, name your own starting seven, and beat every other crew in
 * their home sphere in a ladder ordered by strength, earning Rep and unlocking the Legend
 * difficulty at the end. Venues alternate, injuries carry between fixtures, and form swings the
 * crew's ratings a little either way.
 * Serialisable to JSON for localStorage.
 */
export function createCareer(teamId, difficulty = 'pro', player = {}) {
  const ladder = TEAMS.filter((t) => t.id !== teamId)
    .sort((a, b) => teamOverall(a) - teamOverall(b))
    .map((t) => t.id);
  const career = {
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
    // Season state. All of it is optional on old saves — every reader below tolerates its
    // absence, so a career created before the squad screen still loads and plays.
    squad: null, // seven swimmer ids, slot order (keeper, two shooters, four fielders)
    injuries: {}, // swimmer id -> fixtures still out
    form: [], // most recent results first, 'W' | 'L'
    meetings: {}, // opponent team id -> { met, won, lost } (the rivalry book)
    lastInjuries: [], // [{ name, nick, matches }] from the last fixture, for the results screen
  };
  career.squad = defaultSquad(career);
  return career;
}

// ---------------------------------------------------------------------------
// Squad
// ---------------------------------------------------------------------------

/**
 * The squad the player actually manages: the crew's full eleven plus the swimmer they created, who
 * swims as a third shooter (12 in all, so a bad week never leaves the bench empty). Every entry is
 * a shallow clone so morale tweaks can never write back into the shared TEAMS data.
 */
export function careerRoster(career) {
  const base = TEAM_BY_ID[career.teamId];
  if (!base) return null;
  return [career.player, ...base.roster].map((p) => ({ ...p }));
}

/** Morale swings the whole crew a couple of points either way — form you can feel in the water. */
function moraleMods(morale) {
  if (morale >= 2) return { spd: 2, hnd: 2, end: -1 };
  if (morale === 1) return { spd: 1, hnd: 1 };
  if (morale <= -2) return { spd: -2, hnd: -1, end: 1 };
  if (morale === -1) return { spd: -1 };
  return {};
}

/**
 * -2 … +2 from the last three results. Purely a rating nudge (plus a label on the career screen),
 * not a difficulty slider: the ladder is still beaten on the same terms every time.
 */
export function moraleOf(career) {
  const f = Array.isArray(career.form) ? career.form.slice(0, 3) : [];
  if (!f.length) return 0;
  let n = 0;
  for (const r of f) n += r === 'W' ? 1 : -1;
  return Math.max(-2, Math.min(2, n));
}

export const MORALE_LABELS = {
  '-2': 'SHAKEN',
  '-1': 'RAGGED',
  0: 'STEADY',
  1: 'BUOYANT',
  2: 'UNSTOPPABLE',
};

/** The crew as the sim will see it, morale applied. */
export function careerTeam(career) {
  const base = TEAM_BY_ID[career.teamId];
  const roster = careerRoster(career);
  if (!base || !roster) return null;
  const mods = moraleMods(moraleOf(career));
  const tuned = roster.map((p) => {
    if (!mods.spd) return p;
    const out = { ...p };
    for (const k of Object.keys(mods)) out[k] = Math.max(40, Math.min(99, (p[k] || 60) + mods[k]));
    return out;
  });
  return { ...base, roster: tuned, lineup: squadFor(career) };
}

/** Is this swimmer carrying an injury into the current fixture? */
export function isInjured(career, id) {
  return !!(career.injuries && career.injuries[id] > 0);
}

/**
 * The seven the coach would name by default: the best keeper, your own swimmer plus the crew's
 * strongest other shooter, then the four best fielders. Slot order is the order the sim reads
 * (keeper, two shooters, four fielders).
 */
export function defaultSquad(career) {
  const roster = careerRoster(career);
  if (!roster) return null;
  const me = roster[0];
  const keeper = roster.filter((p) => p.role === 'GK').sort((a, b) => playerOverall(b) - playerOverall(a))[0];
  const fielders = roster.filter((p) => p.role === 'FD').sort((a, b) => playerOverall(b) - playerOverall(a)).slice(0, 4);
  const partner = roster
    .filter((p) => p.role === 'SH' && p.id !== me.id)
    .sort((a, b) => playerOverall(b) - playerOverall(a))[0];
  return [keeper, me, partner || me, ...fielders].filter(Boolean).map((p) => p.id);
}

/**
 * The seven that actually take the pool. An injury or a mid-edit save can leave the named squad
 * short-handed, so every named swimmer is re-checked here and the best fit replacement is dropped
 * in by slot role. The player's own swimmer is always in the seven — it's their career.
 */
export function squadFor(career) {
  const roster = careerRoster(career) || [];
  const byId = new Map(roster.map((p) => [p.id, p]));
  const me = career.player.id;
  const want = Array.isArray(career.squad) && career.squad.length === 7 ? career.squad : defaultSquad(career) || [];
  const roles = ['GK', 'SH', 'SH', 'FD', 'FD', 'FD', 'FD'];
  const out = [];
  const used = new Set();
  roles.forEach((role, i) => {
    let pick = want[i] ? byId.get(want[i]) : null;
    if (!pick || pick.role !== role || isInjured(career, pick.id) || used.has(pick.id)) {
      const pool = roster
        .filter((p) => p.role === role && !used.has(p.id) && !isInjured(career, p.id) && p.id !== me)
        .sort((a, b) => playerOverall(b) - playerOverall(a));
      pick = pool[0] || roster.find((p) => p.role === role && !used.has(p.id)) || null;
    }
    if (!pick) return;
    used.add(pick.id);
    out.push(pick.id);
  });
  // The player's own swimmer always swims: if a slot could not be filled legally, take the weakest
  // slot their own role owns and give it to them.
  if (!used.has(me)) {
    const slot = out.findIndex((id, i) => roles[i] === career.player.role && id !== me);
    if (slot >= 0) out[slot] = me;
    else out.push(me);
  }
  return out.length === 7 ? out : defaultSquad(career);
}

/** Squad as player cards, for the squad screen. `slot` is -1 for the bench. */
export function squadCards(career) {
  const roster = careerRoster(career) || [];
  const seven = squadFor(career);
  return roster.map((p) => ({
    data: p,
    slot: seven.indexOf(p.id),
    injured: isInjured(career, p.id),
    you: p.id === career.player.id,
  }));
}

/** Average overall of the named seven — the number the squad screen shows as the crew rating. */
export function squadOverall(career) {
  const roster = careerRoster(career) || [];
  const byId = new Map(roster.map((p) => [p.id, p]));
  const seven = squadFor(career).map((id) => byId.get(id)).filter(Boolean);
  if (!seven.length) return 0;
  return Math.round(seven.reduce((s, p) => s + playerOverall(p), 0) / seven.length);
}

// ---------------------------------------------------------------------------
// Venues, rivals, progression
// ---------------------------------------------------------------------------

/**
 * Fixtures alternate: even ladders are played at your crew's sphere, odd ones in theirs. Returns
 * the two teams in home/away order plus the index the player's crew plays at.
 */
export function fixtureFor(career) {
  const base = careerTeam(career);
  const opp = currentOpponent(career);
  if (!base || !opp) return null;
  const home = career.stage % 2 === 0;
  return {
    home: home ? base : opp,
    away: home ? opp : base,
    userTeam: home ? 0 : 1,
    atHome: home,
    opponent: opp,
  };
}

/** Rivalry book for one crew: how many times you have met them and the record. */
export function rivalryOf(career, teamId) {
  const r = (career.meetings && career.meetings[teamId]) || { met: 0, won: 0, lost: 0 };
  return { ...r, repeat: r.met >= 2 };
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

/**
 * Who is too banged up to swim next week. The hardest hit of the match always costs something, and
 * a swimmer who spent the whole match on the floor can be ruled out too; the player's own swimmer
 * is never ruled out (you do not get to skip your fixtures). Everyone else out is bumped back a week.
 */
export function rollInjuries(career, sim, userTeam = 1) {
  const rng = new RNG((career.seed ^ (career.history.length * 2654435761)) >>> 0);
  const roster = careerRoster(career) || [];
  const byId = new Map(roster.map((p) => [p.id, p]));
  const prev = career.injuries && typeof career.injuries === 'object' ? career.injuries : {};
  const next = {};
  for (const [id, n] of Object.entries(prev)) {
    if (n > 1) next[id] = n - 1;
    else if (n === 1 && rng.chance(0.35)) next[id] = 1; // a knock lingers
  }
  const mine = new Set(sim.teamPlayers(userTeam).map((p) => p.id));
  const candidates = [];
  const hit = sim.biggestHit;
  if (hit && mine.has(hit.victimId)) candidates.push({ id: hit.victimId, matches: hit.severity >= 1.1 ? 2 : 1, why: 'badly shaken' });
  for (const p of sim.teamPlayers(userTeam)) {
    if (next[p.id]) continue;
    const beat = p.stats.washed * 6 + p.stats.tkl * 2 + (p.cards || 0) * 8;
    if (beat >= 26 && rng.chance(0.4)) candidates.push({ id: p.id, matches: 1, why: 'battered' });
  }
  let added = [];
  for (const c of candidates) {
    if (added.length >= 2 || next[c.id] || c.id === career.player.id) continue;
    if (!byId.has(c.id)) continue;
    next[c.id] = c.matches;
    added.push({ ...c, name: byId.get(c.id).name, nick: byId.get(c.id).nick });
  }
  career.injuries = next;
  career.lastInjuries = added;
  return added;
}

export function recordResult(career, result) {
  const { won, score, style, margin } = result;
  const opponent = career.ladder[career.stage];
  career.history.push({ opponent, won, score, style });
  if (!Array.isArray(career.form)) career.form = [];
  career.form.unshift(won ? 'W' : 'L');
  career.form.length = Math.min(career.form.length, 5);
  if (!career.meetings || typeof career.meetings !== 'object') career.meetings = {};
  const r = career.meetings[opponent] || { met: 0, won: 0, lost: 0 };
  career.meetings[opponent] = { met: r.met + 1, won: r.won + (won ? 1 : 0), lost: r.lost + (won ? 0 : 1) };
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