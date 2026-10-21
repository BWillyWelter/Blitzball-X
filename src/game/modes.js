/**
 * MODE REGISTRY — every way to play a Blitzball-X match, in one table.
 *
 * A mode is not a label: it decides how many seats take part, whether it can be played over the
 * network, and exactly which rules the simulation runs under. The sim itself stays generic — it
 * takes a rule snapshot and a list of seats — so adding a mode never means touching the physics.
 *
 * Rule keys are the ones in `RULES` (src/data/constants.js). Anything not listed here keeps the
 * base value, so a mode only states the rules it actually changes. Every number here was tuned
 * against headless CPU-vs-CPU runs (`npm run modes:balance`), because a clock that produces 0.5
 * goals or a "first to 8" that nobody can reach is a mode in name only.
 */

/**
 * @typedef {Object} ModeDef
 * @property {string} id            stable id used by saves, URLs and the network protocol
 * @property {string} label         menu label
 * @property {string} tagline       one-line hook shown under the label
 * @property {string} blurb         longer description shown on the mode card
 * @property {string} group         which shelf of the hub it sits on
 * @property {number} seats         how many human seats take part (0 = pure spectator)
 * @property {boolean} online       can the mode be played over the network
 * @property {boolean} ranked       results feed the competitive ladder
 * @property {boolean} pickTeam     the player chooses their crew before the match
 * @property {Object} rules         rule overrides merged over RULES
 */

/** @type {Record<string, ModeDef>} */
export const MODES = {
  // -------------------------------------------------------------------------
  // Competitive — the rated shelf
  // -------------------------------------------------------------------------

  ladder: {
    id: 'ladder',
    label: 'RANKED LADDER',
    tagline: 'Eighteen rungs. Every match rated.',
    blurb: 'A rated fixture against a crew matched to your rating. Win and the ladder moves under you; lose and the rung below gets a shot at your seat.',
    group: 'competitive',
    seats: 1,
    online: false,
    ranked: true,
    pickTeam: false,
    rules: {},
  },

  gauntlet: {
    id: 'gauntlet',
    label: 'GAUNTLET',
    tagline: 'Three rungs. One run.',
    blurb: 'A single run of three escalating fixtures: a fast-clock opener, a top-ring middle, then a legend crew with the Gamebreaker meter switched off. Lose twice and the run is over.',
    group: 'competitive',
    seats: 1,
    online: false,
    ranked: false,
    pickTeam: true,
    rules: {},
  },

  proving: {
    id: 'proving',
    label: 'PROVING GROUND',
    tagline: 'No opponent. Just the grade.',
    blurb: 'One short period scored on a five-star sheet: ring goals, top-window finishes and style. The only mode where the scoreboard does not decide whether you were good.',
    group: 'competitive',
    seats: 1,
    online: false,
    ranked: false,
    pickTeam: true,
    rules: {
      halves: 1,
      halfLength: 90,
      possessionClock: 14,
      mercyLead: 99,
      warmupDuration: 3,
      halftimeDuration: 1.5,
      subsPerTeam: 2,
    },
  },

  // -------------------------------------------------------------------------
  // Arcade — the rulebook shelf
  // -------------------------------------------------------------------------

  quick: {
    id: 'quick',
    label: 'QUICK MATCH',
    tagline: 'Pick a crew. Play a match.',
    blurb: 'The full rulebook: two halves, every ring live, substitutions, cards and Gamebreakers. Nothing on the line but the result.',
    group: 'arcade',
    seats: 1,
    online: false,
    ranked: false,
    pickTeam: true,
    rules: {},
  },

  sudden: {
    id: 'sudden',
    label: 'SUDDEN DEATH',
    tagline: 'First goal wins.',
    blurb: 'One goal ends it. Nobody can afford a patient possession, so the pool opens up immediately — and a 0–0 drags both crews into golden-goal overtime.',
    group: 'arcade',
    seats: 1,
    online: true,
    ranked: false,
    pickTeam: true,
    rules: {
      halves: 2,
      halfLength: 120,
      targetGoals: 1,
      mercyLead: 99,
      possessionClock: 20,
      warmupDuration: 4,
      resetDuration: 1.3,
      goalDeadTime: 2.0,
      halftimeDuration: 2.0,
      subsPerTeam: 2,
      overtimeFatigueAfter: 60,
    },
  },

  blitz: {
    id: 'blitz',
    label: 'BLITZ',
    tagline: 'Sixty seconds a half. Breathe later.',
    blurb: 'A ten-second shot clock, six substitutions, cheap Gamebreakers and FLOW at a two-touch combo. First crew to three takes it before the buzzer.',
    group: 'arcade',
    seats: 1,
    online: true,
    ranked: false,
    pickTeam: true,
    rules: {
      halfLength: 60,
      possessionClock: 10,
      targetGoals: 3,
      mercyLead: 99,
      subsPerTeam: 6,
      gbPoints: 3,
      gbSteal: 1,
      gamebreakerMeterMax: 4200,
      onFireGoals: 2,
      flowCombo: 2,
      flowDuration: 8,
      warmupDuration: 4,
      resetDuration: 1.1,
      goalDeadTime: 1.8,
      halftimeDuration: 2.0,
      keeperHold: 3,
      subWindow: 2,
    },
  },

  apex: {
    id: 'apex',
    label: 'APEX',
    tagline: 'Only the orange ring counts.',
    blurb: 'The two low rings are dead. The only way through is the top window — worth three, and a Gamebreaker through it is worth six. First crew to two top-ring goals wins.',
    group: 'arcade',
    seats: 1,
    online: true,
    ranked: false,
    pickTeam: true,
    rules: {
      goalWindows: [0],
      halves: 2,
      halfLength: 165,
      targetGoals: 2,
      mercyLead: 99,
      possessionClock: 18,
      gbPoints: 6,
      gbSteal: 3,
      gamebreakerMeterMax: 5200,
      warmupDuration: 5,
    },
  },

  ironlung: {
    id: 'ironlung',
    label: 'IRON LUNG',
    tagline: 'No Gamebreakers. No free hits.',
    blurb: 'The style meter never fills and the referee calls almost everything: an eight-second clock, a whistle on every big hit and a card for the first one. Half-court defence decides this one.',
    group: 'arcade',
    seats: 1,
    online: true,
    ranked: false,
    pickTeam: true,
    rules: {
      halves: 2,
      halfLength: 150,
      possessionClock: 8,
      mercyLead: 99,
      gamebreakerMeterMax: 1000000,
      foulThreshold: 0.55,
      foulCallChance: 1,
      cardThreshold: 1,
      redMinSeverity: 1.0,
      subsPerTeam: 6,
      subWindow: 3,
      flowCombo: 4,
      keeperHold: 3,
    },
  },

  // -------------------------------------------------------------------------
  // Multiplayer — seats, rooms and spectators
  // -------------------------------------------------------------------------

  duel: {
    id: 'duel',
    label: 'LOCAL DUEL',
    tagline: 'Two pilots. One keyboard.',
    blurb: 'Split-screen 1v1 on the same machine: player one swims WASD and J, player two swims the arrows and Numpad 0. Short halves, first to three.',
    group: 'multiplayer',
    seats: 2,
    online: false,
    ranked: false,
    pickTeam: true,
    rules: {
      halves: 2,
      halfLength: 120,
      targetGoals: 3,
      mercyLead: 99,
      possessionClock: 16,
      warmupDuration: 4,
      halftimeDuration: 2,
    },
  },

  series: {
    id: 'series',
    label: 'ONLINE SERIES',
    tagline: 'Best of three. Rooms in seconds.',
    blurb: 'Open a room, share the four-letter code, and settle it over three rounds. The server keeps the series score, each round is a fresh seed, and either pilot can concede the set.',
    group: 'multiplayer',
    seats: 2,
    online: true,
    ranked: false,
    pickTeam: true,
    rules: {
      halves: 2,
      halfLength: 120,
      targetGoals: 3,
      mercyLead: 99,
      possessionClock: 16,
      warmupDuration: 4,
      resetDuration: 1.2,
      goalDeadTime: 2.2,
      halftimeDuration: 2.2,
    },
  },

  watch: {
    id: 'watch',
    label: 'WATCH PARTY',
    tagline: 'Two crews. No pilot.',
    blurb: 'Two house crews, both on the computer, full half length. Sit back and watch the pool work — with the announcer on.',
    group: 'multiplayer',
    seats: 0,
    online: false,
    ranked: false,
    pickTeam: false,
    rules: {
      warmupDuration: 3,
    },
  },

  custom: {
    id: 'custom',
    label: 'CUSTOM',
    tagline: 'Write the rulebook.',
    blurb: 'Half length, shot clock, mercy rule, substitutions, ring values and the scoring window — all yours to set before the whistle.',
    group: 'lab',
    seats: 1,
    online: true,
    ranked: false,
    pickTeam: true,
    rules: {},
  },
};

/** Menu order. Also the tab order of the hub. */
export const MODE_ORDER = [
  'ladder',
  'gauntlet',
  'proving',
  'quick',
  'sudden',
  'blitz',
  'apex',
  'ironlung',
  'duel',
  'series',
  'watch',
  'custom',
];

/** The shelf headings, in hub order. */
export const MODE_GROUPS = [
  { id: 'competitive', label: 'COMPETITIVE', sub: 'Rated and run-based · the ladder lives here' },
  { id: 'arcade', label: 'ARCADE', sub: 'One match, one rulebook · every dial earns its keep' },
  { id: 'multiplayer', label: 'MULTIPLAYER', sub: 'Same keyboard or across the world' },
  { id: 'lab', label: 'LAB', sub: 'Break the rulebook on purpose' },
];

export const MODE_LIST = MODE_ORDER.map((id) => MODES[id]);

/** The mode an unknown id falls back to: the plainest way to play. */
export const DEFAULT_MODE = 'quick';

export function getMode(id) {
  return MODES[id] || MODES[DEFAULT_MODE];
}

/** Modes on one shelf of the hub, in menu order. */
export function modesInGroup(group) {
  return MODE_ORDER.filter((id) => MODES[id].group === group).map((id) => MODES[id]);
}

/**
 * Merge a mode's rule overrides over the base rule set.
 * @param {string} id mode id
 * @param {Object} base the base rule snapshot (usually RULES)
 * @param {Object} extra extra overrides from the player (custom rules, gauntlet rungs)
 */
export function rulesFor(id, base, extra = null) {
  const mode = getMode(id);
  const out = { ...base, ...mode.rules };
  if (extra && typeof extra === 'object') {
    for (const [key, value] of Object.entries(extra)) {
      if (value === null || value === undefined) continue;
      out[key] = value;
    }
  }
  return out;
}

/** The seat teams a mode puts in the water: [0] for one player, [0, 1] for a duel, [] for a watch. */
export function seatsFor(id) {
  const mode = getMode(id);
  if (mode.seats <= 0) return [];
  if (mode.seats === 1) return [0];
  return [0, 1];
}

/**
 * Trials grade thresholds, lowest star first. Kept here (not in trials.js) so the mode table owns
 * every number the player can read, and a test can assert the scale is monotonic.
 */
export const TRIAL_THRESHOLDS = Object.freeze([120, 260, 420, 620, 880]);

/** Fresh copy of the star thresholds. */
export function trialThresholds() {
  return TRIAL_THRESHOLDS.slice();
}

/** mm:ss for a rule value in seconds. */
export function clockLabel(seconds) {
  const whole = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * A short, human-readable summary of what makes a mode different. Every entry is derived from the
 * rule overrides, never hand-written, so a card can never claim something the sim does not enforce.
 */
export function modeFacts(id) {
  const mode = getMode(id);
  const r = { ...mode.rules };
  const facts = [];
  const noGamebreaker = Number(r.gamebreakerMeterMax) >= 100000;
  if (r.halves === 1 && r.halfLength) facts.push(`single ${clockLabel(r.halfLength)} period`);
  else if (r.halfLength) facts.push(`${r.halves || 2} × ${clockLabel(r.halfLength)}`);
  if (r.targetGoals) facts.push(`first to ${r.targetGoals}`);
  if (r.goalWindows && r.goalWindows.length === 1) facts.push('top ring only');
  if (r.goalWindows && r.goalWindows.length === 2) facts.push('low rings only');
  if (noGamebreaker) facts.push('no gamebreakers');
  else if (Number(r.gbPoints) > 4) facts.push(`gamebreakers ${r.gbPoints} pts`);
  if (Number(r.possessionClock) && Number(r.possessionClock) < 20) facts.push(`${r.possessionClock}s shot clock`);
  if (Number(r.subsPerTeam) >= 6) facts.push(`${r.subsPerTeam} subs`);
  if (Number(r.foulCallChance) >= 0.85) facts.push('tight whistle');
  if (Number(r.flowCombo) && Number(r.flowCombo) <= 2) facts.push('fast FLOW');
  if (r.mercyLead && r.mercyLead < 90) facts.push(`mercy at ${r.mercyLead}`);
  return facts;
}

/** Everything the rulebook changes, for the mode detail panel. */
export function modeRuleLines(id) {
  const mode = getMode(id);
  return Object.entries(mode.rules).map(([key, value]) => ({
    key,
    label: RULE_LABELS[key] || key,
    value: formatRuleValue(key, value),
  }));
}

const RULE_LABELS = {
  halfLength: 'HALF LENGTH',
  halves: 'PERIODS',
  targetGoals: 'WIN CONDITION',
  goalWindows: 'SCORING RINGS',
  possessionClock: 'SHOT CLOCK',
  keeperHold: 'KEEPER HOLD',
  goalPoints: 'LOW RING VALUE',
  topRingPoints: 'TOP RING VALUE',
  gbPoints: 'GAMEBREAKER VALUE',
  gbSteal: 'GAMEBREAKER STEAL',
  gamebreakerMeterMax: 'GAME BREAKER METER',
  onFireGoals: 'ON FIRE',
  flowCombo: 'FLOW COMBO',
  flowDuration: 'FLOW DURATION',
  foulThreshold: 'FOUL THRESHOLD',
  foulCallChance: 'WHISTLE RATE',
  cardThreshold: 'CARDS BEFORE RED',
  redMinSeverity: 'INSTANT RED',
  subsPerTeam: 'SUBSTITUTIONS',
  subWindow: 'SUB WINDOW',
  mercyLead: 'MERCY LEAD',
  warmupDuration: 'WARM-UP',
  halftimeDuration: 'HALF TIME',
  resetDuration: 'RESET',
  goalDeadTime: 'GOAL CELEBRATION',
  overtimeFatigueAfter: 'OVERTIME FATIGUE',
};

function formatRuleValue(key, value) {
  if (Array.isArray(value)) return value.length === 1 && value[0] === 0 ? 'TOP ONLY' : value.length === 3 ? 'ALL THREE' : value.map((v) => (v === 0 ? 'TOP' : v === 1 ? 'BLUE' : 'WHITE')).join(' + ');
  if (typeof value === 'boolean') return value ? 'ON' : 'OFF';
  if (key === 'gamebreakerMeterMax') return Number(value) >= 100000 ? 'DISABLED' : `${Math.round(Number(value) / 100) / 10}k`;
  if (key.endsWith('Duration') || key === 'halfLength' || key === 'possessionClock' || key === 'keeperHold' || key === 'subWindow') return `${value}s`;
  if (key === 'foulCallChance' || key === 'foulThreshold' || key === 'redMinSeverity') return `${Math.round(Number(value) * 100)}%`;
  return String(value);
}
