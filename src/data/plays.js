/**
 * Team playbook: callable offensive / defensive "plays". A play is a bundle of mechanical
 * modifiers applied while that side is on offense or defense. The first entry of each list is
 * the neutral default — zero modifiers — so calling nothing plays exactly like the base game.
 *
 * Offense mods:
 *   shotBoost — multiplies shot accuracy (tighter aim error)
 *   passAcc   — passes through lanes are harder to intercept (divides interception odds)
 *   speed     — ball-carrier move-speed multiplier
 *   spacing   — off-ball spacing scale for AI positioning
 * Defense mods:
 *   tackle    — tackle success multiplier
 *   block     — block / pass-lane swat success multiplier
 *   lane      — AI pass-lane jump willingness multiplier
 *   cushion   — how tight the presser plays (lower = tighter)
 *   fatigue   — turbo regen divisor while defending
 */
export const OFFENSE_PLAYS = [
  {
    id: 'drive',
    name: 'DRIVE & KICK',
    icon: '▶',
    desc: 'Attack the ring, kick to open shooters.',
  },
  {
    id: 'spread',
    name: 'SPREAD FLOOR',
    icon: '⋯',
    desc: 'Widen out. Crisp passes, safe lanes.',
    passAcc: 1.25,
    shotBoost: 0.95,
    spacing: 1.5,
  },
  {
    id: 'iso',
    name: 'ISOLATION',
    icon: '★',
    desc: 'Clear a lane for your star to cook.',
    shotBoost: 1.3,
    speed: 1.07,
    passAcc: 0.8,
  },
];

export const DEFENSE_PLAYS = [
  {
    id: 'man',
    name: 'TIGHT MAN',
    icon: '⇄',
    desc: 'Stick to your marks, protect the crease.',
  },
  {
    id: 'zone',
    name: 'DROP ZONE',
    icon: '⊞',
    desc: 'Pack the crease, swat the passing lanes.',
    block: 1.3,
    tackle: 0.9,
    lane: 1.2,
  },
  {
    id: 'press',
    name: 'FULL PRESS',
    icon: '⚡',
    desc: 'Hunt turnovers — burns turbo fast.',
    tackle: 1.3,
    lane: 1.15,
    cushion: 0.55,
    fatigue: 1.45,
  },
];

export function offensePlayByIndex(i) {
  return OFFENSE_PLAYS[i] || OFFENSE_PLAYS[0];
}

export function defensePlayByIndex(i) {
  return DEFENSE_PLAYS[i] || DEFENSE_PLAYS[0];
}
