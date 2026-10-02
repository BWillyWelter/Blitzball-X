/**
 * BLITZBALL X league — original IP.
 * Eight crews, eleven swimmers each: seven starters (1 keeper + 4 fielders + 2 shooters) and
 * four reserves (3 fielders + 1 backup keeper). The two shooters are the team captains and
 * designated scorers. Ratings 40–99.
 *
 * Attribute key (outfield swimmers):
 *  spd  swim speed / acceleration      sht  shooting power + accuracy
 *  hnd  handles (tricks, ball security) pas  passing
 *  tkl  tackles / on-ball defense       pow  strength (big hits, contact finishes)
 *  end  endurance (turbo tank)          gb   how fast the Gamebreaker meter fills
 *
 * Keeper-only attributes:
 *  cat  catching (save reach and save chance)
 *  blk  blocking (shot stopping)
 */

export const ARCHETYPES = {
  FINISHER: 'Finisher',
  SNIPER: 'Sniper',
  HANDLER: 'Handler',
  ENFORCER: 'Enforcer',
  GUARDIAN: 'Guardian',
  ALLROUND: 'All-Around',
};

const P = (id, name, nick, archetype, role, num, skin, hair, stats, sig, move, captain = false) => ({
  id,
  name,
  nick,
  archetype,
  role, // GK | FD | SH
  number: num,
  skin, // 0..3 palette index
  hair, // style index 0..5
  ...stats,
  signature: sig, // signature Gamebreaker flavor text
  move, // signature MOVE key — what the TRICK button plays for this swimmer (game/moves.js)
  captain,
});

// Reserve swimmers are built from a compact tuple so the rosters stay readable:
// [id, name, nick, archetype, num, skin, hair, {stats}, signature, move]
const R = (team, tuple) =>
  P(`${team}_${tuple[0]}`, tuple[1], tuple[2], tuple[3], tuple[4], tuple[5], tuple[6], tuple[7], tuple[8], tuple[9], tuple[10]);

export const TEAMS = [
  {
    id: 'dockside_kraken',
    name: 'Kraken',
    city: 'Dockside',
    abbr: 'DCK',
    primary: '#12b5b0',
    secondary: '#0b1c2c',
    accent: '#f5f0e6',
    arena: 'harbor',
    motto: 'Tides don’t lose.',
    roster: [
      P('kraken_4', 'Ona Kelleher', 'BARNACLE', ARCHETYPES.GUARDIAN, 'GK', 1, 0, 2, { spd: 62, sht: 44, hnd: 56, pas: 62, tkl: 58, pow: 84, end: 76, gb: 62, cat: 86, blk: 88 }, 'Tidal Wall', 'roll'),
      P('kraken_3', 'Sable Reyes', 'SLINGER', ARCHETYPES.SNIPER, 'SH', 11, 1, 5, { spd: 76, sht: 92, hnd: 70, pas: 72, tkl: 62, pow: 51, end: 74, gb: 78, cat: 46, blk: 45 }, 'Harbor Light Three', 'dash', true),
      P('kraken_1', 'Marlo Vance', 'THE TIDE', ARCHETYPES.HANDLER, 'SH', 7, 2, 1, { spd: 88, sht: 71, hnd: 95, pas: 90, tkl: 80, pow: 56, end: 78, gb: 92, cat: 52, blk: 42 }, 'Riptide Crossover', 'feint'),
      P('kraken_2', 'Dez Okoro', 'ANCHOR', ARCHETYPES.ENFORCER, 'FD', 34, 3, 3, { spd: 60, sht: 46, hnd: 52, pas: 58, tkl: 62, pow: 92, end: 88, gb: 70, cat: 58, blk: 94 }, 'Deep Six Slam', 'surge'),
      P('kraken_5', 'Tomas Greer', 'PIER', ARCHETYPES.ALLROUND, 'FD', 22, 0, 2, { spd: 70, sht: 66, hnd: 66, pas: 68, tkl: 66, pow: 66, end: 70, gb: 64, cat: 50, blk: 62 }, 'Undertow Floater', 'spin'),
      P('kraken_6', 'Junie Aldous', 'SEA SPRAY', ARCHETYPES.HANDLER, 'FD', 9, 3, 4, { spd: 82, sht: 64, hnd: 80, pas: 76, tkl: 66, pow: 50, end: 68, gb: 70, cat: 44, blk: 40 }, 'Spray Stepover', 'glance'),
      R('kraken', [7, 'Nell Farrow', 'DRYDOCK', ARCHETYPES.ALLROUND, 'FD', 15, 1, 3, { spd: 74, sht: 62, hnd: 68, pas: 70, tkl: 70, pow: 62, end: 72, gb: 60, cat: 48, blk: 52 }, 'Chained Hull', 'undertow']),
      R('kraken', [8, 'Cobie Marsh', 'FOAM', ARCHETYPES.HANDLER, 'FD', 26, 2, 0, { spd: 80, sht: 56, hnd: 76, pas: 72, tkl: 62, pow: 48, end: 70, gb: 62, cat: 46, blk: 42 }, 'Foam Party', 'glance']),
      R('kraken', [9, 'Ivo Brand', 'KEEL', ARCHETYPES.ENFORCER, 'FD', 41, 0, 1, { spd: 62, sht: 48, hnd: 54, pas: 56, tkl: 72, pow: 84, end: 80, gb: 58, cat: 50, blk: 70 }, 'Keel Haul', 'spear']),
      R('kraken', [11, 'Sela Winn', 'NAUTICA', ARCHETYPES.HANDLER, 'FD', 12, 1, 4, { spd: 86, sht: 58, hnd: 80, pas: 74, tkl: 60, pow: 46, end: 72, gb: 64, cat: 44, blk: 40 }, 'Nautical Twist', 'feint']),
      R('kraken', [10, 'Petra Voss', 'DEPTHCHARGE', ARCHETYPES.GUARDIAN, 'GK', 30, 3, 2, { spd: 58, sht: 42, hnd: 50, pas: 58, tkl: 56, pow: 78, end: 72, gb: 56, cat: 78, blk: 80 }, 'Deep Charge', 'roll']),
    ],
  },
  {
    id: 'ninth_street_saints',
    name: 'Saints',
    city: 'Ninth Street',
    abbr: 'NSS',
    primary: '#f2c230',
    secondary: '#1a1a1a',
    accent: '#ffffff',
    arena: 'chapel',
    motto: 'Every block is holy ground.',
    roster: [
      P('saints_4', 'Ruth Achebe', 'VESPERS', ARCHETYPES.GUARDIAN, 'GK', 1, 3, 1, { spd: 58, sht: 42, hnd: 52, pas: 64, tkl: 56, pow: 78, end: 74, gb: 60, cat: 88, blk: 84 }, 'Evening Prayer Save', 'roll'),
      P('saints_1', 'Andre “Halo” Pike', 'HALO', ARCHETYPES.SNIPER, 'SH', 3, 3, 0, { spd: 78, sht: 96, hnd: 78, pas: 76, tkl: 58, pow: 49, end: 72, gb: 85, cat: 46, blk: 42 }, 'Rooftop Rainmaker', 'vault', true),
      P('saints_6', 'Pia Nakamura', 'CANDLE', ARCHETYPES.SNIPER, 'SH', 21, 2, 5, { spd: 74, sht: 84, hnd: 72, pas: 74, tkl: 60, pow: 48, end: 66, gb: 74, cat: 44, blk: 42 }, 'Vigil Volley', 'spin'),
      P('saints_2', 'Bishop Cole', 'BISHOP', ARCHETYPES.ENFORCER, 'FD', 50, 2, 3, { spd: 64, sht: 54, hnd: 58, pas: 60, tkl: 70, pow: 95, end: 86, gb: 68, cat: 56, blk: 82 }, 'Excommunication Slam', 'surge'),
      P('saints_3', 'Lola Marquez', 'CHOIR', ARCHETYPES.HANDLER, 'FD', 4, 1, 4, { spd: 92, sht: 70, hnd: 90, pas: 88, tkl: 84, pow: 47, end: 80, gb: 88, cat: 50, blk: 40 }, 'Hymn Hesitation', 'feint'),
      P('saints_5', 'Ike Waller', 'DEACON', ARCHETYPES.ALLROUND, 'FD', 14, 0, 1, { spd: 68, sht: 68, hnd: 64, pas: 66, tkl: 64, pow: 68, end: 68, gb: 62, cat: 48, blk: 46 }, 'Sunday Spin', 'dash'),
      R('saints', [7, 'Amos Frey', 'PsALM', ARCHETYPES.ALLROUND, 'FD', 17, 1, 2, { spd: 72, sht: 60, hnd: 66, pas: 70, tkl: 68, pow: 64, end: 70, gb: 60, cat: 48, blk: 50 }, 'Silent Night', 'undertow']),
      R('saints', [8, 'Dez Jackson', 'CENSER', ARCHETYPES.HANDLER, 'FD', 28, 0, 4, { spd: 84, sht: 58, hnd: 78, pas: 76, tkl: 64, pow: 46, end: 72, gb: 64, cat: 44, blk: 40 }, 'Swinging Smoke', 'glance']),
      R('saints', [9, 'Gideon Marsh', 'STEEPLE', ARCHETYPES.ENFORCER, 'FD', 44, 3, 3, { spd: 60, sht: 46, hnd: 52, pas: 54, tkl: 74, pow: 86, end: 82, gb: 58, cat: 50, blk: 72 }, 'Steeple Chase', 'spear']),
      R('saints', [11, 'Tess Auren', 'CHALICE', ARCHETYPES.ALLROUND, 'FD', 13, 0, 2, { spd: 74, sht: 62, hnd: 68, pas: 68, tkl: 66, pow: 62, end: 72, gb: 60, cat: 46, blk: 48 }, 'Chalice Run', 'undertow']),
      R('saints', [10, 'Faith Oduya', 'BENEDICTION', ARCHETYPES.GUARDIAN, 'GK', 35, 2, 0, { spd: 56, sht: 40, hnd: 48, pas: 60, tkl: 54, pow: 76, end: 70, gb: 54, cat: 80, blk: 78 }, 'Benediction Grab', 'roll']),
    ],
  },
  {
    id: 'ironworks_forge',
    name: 'Forge',
    city: 'Ironworks',
    abbr: 'IRN',
    primary: '#ff5a1f',
    secondary: '#2b2b2b',
    accent: '#ffd9c2',
    arena: 'foundry',
    motto: 'Built, not born.',
    roster: [
      P('forge_4', 'Dagny Ruiz', 'CRUCIBLE', ARCHETYPES.GUARDIAN, 'GK', 1, 2, 0, { spd: 60, sht: 40, hnd: 48, pas: 58, tkl: 62, pow: 88, end: 78, gb: 62, cat: 84, blk: 92 }, 'Molten Wall', 'roll'),
      P('forge_5', 'Roy Amadi', 'INGOT', ARCHETYPES.SNIPER, 'SH', 21, 2, 0, { spd: 72, sht: 86, hnd: 66, pas: 70, tkl: 60, pow: 57, end: 70, gb: 70, cat: 44, blk: 40 }, 'Molten Range', 'climb', true),
      P('forge_2', 'Kiana Holt', 'RIVET', ARCHETYPES.HANDLER, 'SH', 9, 3, 4, { spd: 90, sht: 76, hnd: 88, pas: 84, tkl: 78, pow: 53, end: 78, gb: 84, cat: 48, blk: 40 }, 'Rivet Gun Runner', 'glance'),
      P('forge_1', 'Gus Petrov', 'FURNACE', ARCHETYPES.ENFORCER, 'FD', 44, 0, 3, { spd: 58, sht: 48, hnd: 52, pas: 56, tkl: 60, pow: 99, end: 90, gb: 72, cat: 54, blk: 90 }, 'Blast Furnace Slam', 'surge'),
      P('forge_3', 'Emil Strand', 'SMOKESTACK', ARCHETYPES.ALLROUND, 'FD', 55, 1, 2, { spd: 68, sht: 62, hnd: 60, pas: 62, tkl: 64, pow: 74, end: 76, gb: 66, cat: 52, blk: 68 }, 'Smokestack Floater', 'undertow'),
      P('forge_6', 'Bex Lorne', 'SLAG', ARCHETYPES.ENFORCER, 'FD', 33, 1, 1, { spd: 62, sht: 46, hnd: 50, pas: 54, tkl: 72, pow: 88, end: 82, gb: 60, cat: 50, blk: 76 }, 'Slag Heap Shove', 'surge'),
      R('forge', [7, 'Otto Reyes', 'ANVIL', ARCHETYPES.ALLROUND, 'FD', 18, 0, 2, { spd: 70, sht: 60, hnd: 64, pas: 66, tkl: 70, pow: 70, end: 74, gb: 60, cat: 48, blk: 54 }, 'Anvil Drop', 'spin']),
      R('forge', [8, 'Marta Quist', 'BELLOWS', ARCHETYPES.HANDLER, 'FD', 27, 2, 5, { spd: 82, sht: 54, hnd: 74, pas: 72, tkl: 60, pow: 50, end: 72, gb: 60, cat: 46, blk: 42 }, 'Bellows Sweep', 'glance']),
      R('forge', [9, 'Halden Ross', 'PIGSTYLES', ARCHETYPES.ENFORCER, 'FD', 62, 3, 1, { spd: 60, sht: 44, hnd: 50, pas: 52, tkl: 76, pow: 88, end: 84, gb: 58, cat: 50, blk: 74 }, 'Pig Iron Press', 'spear']),
      R('forge', [11, 'Vera Kline', 'TONGS', ARCHETYPES.SNIPER, 'FD', 14, 2, 4, { spd: 76, sht: 80, hnd: 64, pas: 64, tkl: 58, pow: 52, end: 70, gb: 66, cat: 44, blk: 42 }, 'Tongs Pick', 'vault']),
      R('forge', [10, 'Sunniva Dahl', 'QUENCH', ARCHETYPES.GUARDIAN, 'GK', 36, 1, 3, { spd: 56, sht: 40, hnd: 46, pas: 56, tkl: 54, pow: 80, end: 72, gb: 54, cat: 78, blk: 82 }, 'Quench Tank', 'roll']),
    ],
  },
  {
    id: 'neon_district_volt',
    name: 'Volt',
    city: 'Neon District',
    abbr: 'NEO',
    primary: '#c026ff',
    secondary: '#0d0620',
    accent: '#5cf2ff',
    arena: 'neon',
    motto: 'Too fast to film.',
    roster: [
      P('volt_4', 'Suri Vasquez', 'DYNAMO', ARCHETYPES.GUARDIAN, 'GK', 1, 0, 2, { spd: 66, sht: 42, hnd: 54, pas: 60, tkl: 58, pow: 76, end: 80, gb: 58, cat: 85, blk: 83 }, 'Blackout Grab', 'roll'),
      P('volt_2', 'Priya Shah', 'PULSE', ARCHETYPES.SNIPER, 'SH', 23, 2, 4, { spd: 82, sht: 90, hnd: 80, pas: 78, tkl: 66, pow: 47, end: 74, gb: 82, cat: 46, blk: 40 }, 'Neon Pull-Up', 'climb', true),
      P('volt_6', 'Lux Ibarra', 'ARC', ARCHETYPES.FINISHER, 'SH', 7, 2, 5, { spd: 86, sht: 74, hnd: 78, pas: 68, tkl: 62, pow: 60, end: 66, gb: 78, cat: 44, blk: 44 }, 'Arc Flash Finish', 'feint'),
      P('volt_1', 'Jax Kimura', 'LIVEWIRE', ARCHETYPES.HANDLER, 'FD', 0, 1, 5, { spd: 99, sht: 72, hnd: 97, pas: 86, tkl: 82, pow: 45, end: 84, gb: 95, cat: 48, blk: 40 }, 'Short Circuit Shake', 'dash'),
      P('volt_3', 'Big Ray Dunlap', 'BREAKER', ARCHETYPES.ALLROUND, 'FD', 88, 3, 3, { spd: 70, sht: 52, hnd: 54, pas: 58, tkl: 68, pow: 90, end: 86, gb: 68, cat: 54, blk: 88 }, 'Circuit Breaker Jam', 'surge'),
      P('volt_5', 'Nico Alder', 'STATIC', ARCHETYPES.ALLROUND, 'FD', 12, 0, 1, { spd: 74, sht: 66, hnd: 70, pas: 70, tkl: 68, pow: 58, end: 68, gb: 66, cat: 52, blk: 58 }, 'Static Stepback', 'spin'),
      R('volt', [7, 'Rhea Sol', 'WATTLIGHT', ARCHETYPES.ALLROUND, 'FD', 19, 1, 0, { spd: 78, sht: 62, hnd: 68, pas: 70, tkl: 66, pow: 56, end: 72, gb: 62, cat: 46, blk: 48 }, 'Watt a Shot', 'undertow']),
      R('volt', [8, 'Cy Ndiaye', 'FLICKER', ARCHETYPES.HANDLER, 'FD', 29, 3, 4, { spd: 88, sht: 56, hnd: 80, pas: 74, tkl: 62, pow: 44, end: 72, gb: 66, cat: 44, blk: 40 }, 'Flicker Step', 'glance']),
      R('volt', [9, 'Bruno Kohl', 'GRIDLOCK', ARCHETYPES.ENFORCER, 'FD', 63, 0, 3, { spd: 62, sht: 46, hnd: 52, pas: 54, tkl: 74, pow: 86, end: 84, gb: 58, cat: 50, blk: 74 }, 'Grid Slam', 'spear']),
      R('volt', [11, 'Kai Wren', 'OHM', ARCHETYPES.FINISHER, 'FD', 16, 1, 1, { spd: 84, sht: 70, hnd: 72, pas: 64, tkl: 62, pow: 66, end: 70, gb: 72, cat: 44, blk: 42 }, 'Ohm Run', 'dash']),
      R('volt', [10, 'Iris Ono', 'SURGE PROTECTOR', ARCHETYPES.GUARDIAN, 'GK', 37, 2, 2, { spd: 60, sht: 40, hnd: 48, pas: 58, tkl: 54, pow: 74, end: 74, gb: 54, cat: 79, blk: 80 }, 'Surge Protector', 'roll']),
    ],
  },
  {
    id: 'south_yard_kings',
    name: 'Kings',
    city: 'South Yard',
    abbr: 'SYK',
    primary: '#e8232a',
    secondary: '#111111',
    accent: '#f5d76e',
    arena: 'yard',
    motto: 'Crowned in concrete.',
    roster: [
      P('kings_4', 'Ines Duval', 'REGENT', ARCHETYPES.GUARDIAN, 'GK', 1, 1, 4, { spd: 60, sht: 44, hnd: 50, pas: 62, tkl: 60, pow: 80, end: 78, gb: 60, cat: 87, blk: 85 }, 'Crown Jewel Stop', 'roll'),
      P('kings_2', 'Manny Ortiz', 'SCEPTER', ARCHETYPES.SNIPER, 'SH', 5, 1, 0, { spd: 74, sht: 91, hnd: 72, pas: 74, tkl: 60, pow: 51, end: 72, gb: 76, cat: 46, blk: 42 }, 'Royal Rainbow', 'dash', true),
      P('kings_1', 'Terrence “Trey” Moss', 'TREY', ARCHETYPES.ALLROUND, 'SH', 33, 3, 2, { spd: 86, sht: 84, hnd: 86, pas: 80, tkl: 76, pow: 74, end: 80, gb: 90, cat: 50, blk: 60 }, 'Coronation Finish', 'spin'),
      P('kings_3', 'Deshawn Boyd', 'THRONE', ARCHETYPES.ENFORCER, 'FD', 41, 3, 3, { spd: 62, sht: 50, hnd: 54, pas: 58, tkl: 66, pow: 94, end: 88, gb: 70, cat: 52, blk: 86 }, 'Throne Room Slam', 'spear'),
      P('kings_5', 'Alvin Cho', 'PAGE', ARCHETYPES.HANDLER, 'FD', 2, 1, 5, { spd: 84, sht: 66, hnd: 84, pas: 82, tkl: 74, pow: 49, end: 74, gb: 74, cat: 48, blk: 40 }, 'Court Jester Cross', 'glance'),
      P('kings_6', 'Rolo Mbeki', 'CROWN', ARCHETYPES.FINISHER, 'FD', 18, 0, 1, { spd: 78, sht: 76, hnd: 74, pas: 72, tkl: 64, pow: 70, end: 70, gb: 72, cat: 44, blk: 48 }, 'Heavy Headed Finish', 'undertow'),
      R('kings', [7, 'Duke Ellery', 'HERALD', ARCHETYPES.ALLROUND, 'FD', 20, 2, 3, { spd: 74, sht: 62, hnd: 66, pas: 68, tkl: 68, pow: 66, end: 72, gb: 62, cat: 48, blk: 52 }, 'Herald’s Call', 'climb']),
      R('kings', [8, 'Silas Ode', 'JESTER', ARCHETYPES.HANDLER, 'FD', 31, 0, 4, { spd: 82, sht: 58, hnd: 78, pas: 76, tkl: 62, pow: 48, end: 72, gb: 64, cat: 46, blk: 40 }, 'Jester’s Jog', 'glance']),
      R('kings', [9, 'Bram Kota', 'GATE', ARCHETYPES.ENFORCER, 'FD', 64, 1, 1, { spd: 60, sht: 46, hnd: 50, pas: 54, tkl: 76, pow: 88, end: 84, gb: 58, cat: 50, blk: 76 }, 'Gatekeeper Slam', 'spear']),
      R('kings', [11, 'Otis Renn', 'SCRIBE', ARCHETYPES.HANDLER, 'FD', 21, 0, 5, { spd: 82, sht: 60, hnd: 78, pas: 74, tkl: 62, pow: 48, end: 72, gb: 62, cat: 46, blk: 40 }, 'Scribe’s Cut', 'feint']),
      R('kings', [10, 'Vera Lindt', 'MONARCH', ARCHETYPES.GUARDIAN, 'GK', 38, 3, 0, { spd: 58, sht: 40, hnd: 48, pas: 58, tkl: 54, pow: 76, end: 72, gb: 54, cat: 80, blk: 80 }, 'Monarch Wall', 'roll']),
    ],
  },
  {
    id: 'blacktop_phantoms',
    name: 'Phantoms',
    city: 'Blacktop Hollow',
    abbr: 'BTP',
    primary: '#8a8f99',
    secondary: '#0a0a0c',
    accent: '#c8ff3d',
    arena: 'hollow',
    motto: 'You never saw us.',
    roster: [
      P('phantom_4', 'Esme Lark', 'SEANCE', ARCHETYPES.GUARDIAN, 'GK', 1, 3, 2, { spd: 64, sht: 40, hnd: 50, pas: 58, tkl: 56, pow: 74, end: 76, gb: 56, cat: 89, blk: 80 }, 'Séance Snatch', 'roll'),
      P('phantom_2', 'Nadia Ferro', 'WRAITH', ARCHETYPES.SNIPER, 'SH', 31, 2, 4, { spd: 80, sht: 88, hnd: 76, pas: 76, tkl: 72, pow: 47, end: 74, gb: 80, cat: 46, blk: 44 }, 'Cold Spot Jumper', 'vault', true),
      P('phantom_1', 'Silas Wren', 'GHOST', ARCHETYPES.HANDLER, 'SH', 13, 0, 1, { spd: 94, sht: 78, hnd: 93, pas: 84, tkl: 88, pow: 51, end: 80, gb: 88, cat: 50, blk: 42 }, 'Vanishing Act', 'feint'),
      P('phantom_3', 'Otto Brandt', 'POLTERGEIST', ARCHETYPES.ALLROUND, 'FD', 66, 1, 3, { spd: 64, sht: 48, hnd: 52, pas: 58, tkl: 62, pow: 87, end: 86, gb: 66, cat: 54, blk: 91 }, 'Haunted Rejection', 'surge'),
      P('phantom_5', 'Cass Idris', 'ECHO', ARCHETYPES.ALLROUND, 'FD', 8, 3, 2, { spd: 72, sht: 68, hnd: 68, pas: 70, tkl: 70, pow: 70, end: 68, gb: 64, cat: 48, blk: 46 }, 'Echo Chamber Spin', 'spin'),
      P('phantom_6', 'Bo Nakamura', 'SHADE', ARCHETYPES.ENFORCER, 'FD', 27, 0, 0, { spd: 66, sht: 50, hnd: 56, pas: 60, tkl: 74, pow: 86, end: 82, gb: 62, cat: 52, blk: 74 }, 'Shadow Shove', 'spear'),
      R('phantom', [7, 'Wren Kessler', 'MIST', ARCHETYPES.ALLROUND, 'FD', 21, 2, 1, { spd: 76, sht: 60, hnd: 66, pas: 68, tkl: 68, pow: 62, end: 72, gb: 60, cat: 46, blk: 50 }, 'Mist Step', 'undertow']),
      R('phantom', [8, 'Lux Mora', 'FADING', ARCHETYPES.HANDLER, 'FD', 32, 1, 5, { spd: 86, sht: 56, hnd: 78, pas: 74, tkl: 62, pow: 46, end: 72, gb: 64, cat: 44, blk: 40 }, 'Fade Away', 'glance']),
      R('phantom', [9, 'Grim Halden', 'TOMBSTONE', ARCHETYPES.ENFORCER, 'FD', 65, 0, 3, { spd: 60, sht: 44, hnd: 50, pas: 52, tkl: 76, pow: 88, end: 84, gb: 58, cat: 50, blk: 76 }, 'Tombstone Drive', 'spear']),
      R('phantom', [11, 'Iris Vale', 'POLTERGEIST II', ARCHETYPES.ALLROUND, 'FD', 24, 2, 0, { spd: 74, sht: 64, hnd: 66, pas: 66, tkl: 66, pow: 64, end: 72, gb: 62, cat: 46, blk: 50 }, 'Second Sight', 'spin']),
      R('phantom', [10, 'Mora Vane', 'SPIRIT', ARCHETYPES.GUARDIAN, 'GK', 39, 3, 4, { spd: 58, sht: 40, hnd: 46, pas: 56, tkl: 54, pow: 74, end: 72, gb: 54, cat: 80, blk: 78 }, 'Spirit Snare', 'roll']),
    ],
  },
  {
    id: 'sunset_pier_breakers',
    name: 'Breakers',
    city: 'Sunset Pier',
    abbr: 'SSP',
    primary: '#ff8a3d',
    secondary: '#123c5a',
    accent: '#ffe07a',
    arena: 'pier',
    motto: 'Sand in your shoes, L on your record.',
    roster: [
      P('breakers_4', 'Marisol Vega', 'TIDE POOL', ARCHETYPES.GUARDIAN, 'GK', 1, 3, 5, { spd: 62, sht: 44, hnd: 52, pas: 66, tkl: 58, pow: 82, end: 80, gb: 60, cat: 83, blk: 86 }, 'Tide Pool Trap', 'roll'),
      P('breakers_2', 'Rosa Delgado', 'SUNSHINE', ARCHETYPES.SNIPER, 'SH', 4, 1, 4, { spd: 78, sht: 89, hnd: 74, pas: 78, tkl: 64, pow: 49, end: 74, gb: 78, cat: 46, blk: 42 }, 'Golden Hour Three', 'climb', true),
      P('breakers_1', 'Kai Moana', 'BIG WAVE', ARCHETYPES.FINISHER, 'SH', 10, 2, 2, { spd: 84, sht: 78, hnd: 78, pas: 66, tkl: 64, pow: 84, end: 80, gb: 86, cat: 52, blk: 70 }, 'Pipeline Posterizer', 'dash'),
      P('breakers_3', 'Bruno Sato', 'LIFEGUARD', ARCHETYPES.ALLROUND, 'FD', 77, 1, 0, { spd: 70, sht: 50, hnd: 54, pas: 60, tkl: 62, pow: 86, end: 84, gb: 64, cat: 58, blk: 89 }, 'Riptide Rescue Block', 'surge'),
      P('breakers_5', 'Lena Park', 'DRIFT', ARCHETYPES.HANDLER, 'FD', 17, 1, 5, { spd: 88, sht: 70, hnd: 86, pas: 84, tkl: 76, pow: 47, end: 76, gb: 76, cat: 46, blk: 40 }, 'Longboard Cross', 'glance'),
      P('breakers_6', 'Dov Halstrom', 'RIPTIDE', ARCHETYPES.FINISHER, 'FD', 25, 0, 3, { spd: 80, sht: 72, hnd: 72, pas: 70, tkl: 68, pow: 72, end: 72, gb: 70, cat: 44, blk: 52 }, 'Undertow Volley', 'undertow'),
      R('breakers', [7, 'Sol Ortiz', 'HIGH TIDE', ARCHETYPES.ALLROUND, 'FD', 22, 2, 1, { spd: 74, sht: 62, hnd: 66, pas: 68, tkl: 68, pow: 68, end: 72, gb: 62, cat: 48, blk: 52 }, 'High Tide Hit', 'spin']),
      R('breakers', [8, 'Coco Reyes', 'BOOGIE', ARCHETYPES.HANDLER, 'FD', 30, 0, 2, { spd: 84, sht: 58, hnd: 78, pas: 74, tkl: 62, pow: 48, end: 72, gb: 64, cat: 44, blk: 40 }, 'Boogie Board Bash', 'glance']),
      R('breakers', [9, 'Finn Aalto', 'SEA WALL', ARCHETYPES.ENFORCER, 'FD', 66, 3, 3, { spd: 60, sht: 46, hnd: 50, pas: 54, tkl: 76, pow: 88, end: 84, gb: 58, cat: 50, blk: 76 }, 'Sea Wall Slam', 'spear']),
      R('breakers', [11, 'Milo Brand', 'SURFBOARD', ARCHETYPES.SNIPER, 'FD', 28, 1, 2, { spd: 76, sht: 82, hnd: 66, pas: 66, tkl: 58, pow: 50, end: 70, gb: 68, cat: 44, blk: 42 }, 'Surfboard Flick', 'climb']),
      R('breakers', [10, 'Nia Delmar', 'LOW TIDE', ARCHETYPES.GUARDIAN, 'GK', 40, 1, 0, { spd: 58, sht: 40, hnd: 48, pas: 58, tkl: 54, pow: 76, end: 72, gb: 54, cat: 80, blk: 78 }, 'Low Tide Lock', 'roll']),
    ],
  },
  {
    id: 'uptown_royals',
    name: 'Royals',
    city: 'Uptown',
    abbr: 'UPT',
    primary: '#3b5bff',
    secondary: '#f8f8ff',
    accent: '#ffd700',
    arena: 'uptown',
    motto: 'Old money, new game.',
    roster: [
      P('royals_4', 'Ada Fairweather', 'CHATELAINE', ARCHETYPES.GUARDIAN, 'GK', 1, 2, 0, { spd: 58, sht: 42, hnd: 54, pas: 68, tkl: 56, pow: 76, end: 76, gb: 58, cat: 90, blk: 82 }, 'Estate Keeper', 'roll'),
      P('royals_5', 'Wes Trammel', 'HEIR', ARCHETYPES.SNIPER, 'SH', 19, 2, 0, { spd: 74, sht: 87, hnd: 70, pas: 72, tkl: 60, pow: 53, end: 70, gb: 72, cat: 44, blk: 40 }, 'Trust Fund Three', 'vault', true),
      P('royals_1', 'Victor Lang', 'THE BARON', ARCHETYPES.ALLROUND, 'SH', 24, 0, 1, { spd: 82, sht: 86, hnd: 84, pas: 84, tkl: 74, pow: 72, end: 80, gb: 88, cat: 50, blk: 64 }, 'Penthouse Fadeaway', 'spin'),
      P('royals_2', 'Imani Cross', 'DUCHESS', ARCHETYPES.HANDLER, 'FD', 6, 3, 4, { spd: 90, sht: 74, hnd: 92, pas: 90, tkl: 80, pow: 51, end: 78, gb: 86, cat: 48, blk: 40 }, 'Velvet Rope Cross', 'feint'),
      P('royals_3', 'Hank Bauer', 'BUTLER', ARCHETYPES.ENFORCER, 'FD', 45, 0, 3, { spd: 60, sht: 50, hnd: 52, pas: 60, tkl: 62, pow: 93, end: 88, gb: 66, cat: 54, blk: 88 }, 'Service Entrance Shove', 'spear'),
      P('royals_6', 'Kit Amara', 'GALA', ARCHETYPES.HANDLER, 'FD', 8, 1, 2, { spd: 78, sht: 58, hnd: 76, pas: 78, tkl: 78, pow: 56, end: 72, gb: 68, cat: 50, blk: 44 }, 'Masquerade Step', 'undertow'),
      R('royals', [7, 'Sterling Mott', 'VAULT', ARCHETYPES.ALLROUND, 'FD', 23, 2, 2, { spd: 72, sht: 62, hnd: 66, pas: 68, tkl: 68, pow: 66, end: 72, gb: 62, cat: 48, blk: 52 }, 'Vaulted Ceiling', 'climb']),
      R('royals', [8, 'Lux Vander', 'ENTRANCE', ARCHETYPES.HANDLER, 'FD', 34, 1, 5, { spd: 84, sht: 58, hnd: 78, pas: 76, tkl: 64, pow: 48, end: 72, gb: 64, cat: 46, blk: 40 }, 'Grand Entrance', 'glance']),
      R('royals', [9, 'Baron Vine', 'GROUNDSKEEPER', ARCHETYPES.ENFORCER, 'FD', 67, 0, 1, { spd: 60, sht: 46, hnd: 50, pas: 54, tkl: 76, pow: 88, end: 84, gb: 58, cat: 50, blk: 76 }, 'Groundskeeper Slam', 'spear']),
      R('royals', [11, 'Dane Polt', 'ESTATE', ARCHETYPES.ALLROUND, 'FD', 26, 3, 0, { spd: 74, sht: 64, hnd: 68, pas: 68, tkl: 66, pow: 66, end: 72, gb: 62, cat: 46, blk: 50 }, 'Estate Drive', 'undertow']),
      R('royals', [10, 'Isla Crest', 'CROWN JEWEL', ARCHETYPES.GUARDIAN, 'GK', 41, 3, 3, { spd: 56, sht: 40, hnd: 46, pas: 56, tkl: 54, pow: 74, end: 72, gb: 54, cat: 80, blk: 80 }, 'Jewel Case Save', 'roll']),
    ],
  },
];

export const TEAM_BY_ID = Object.fromEntries(TEAMS.map((t) => [t.id, t]));

/** Overall rating for a swimmer. Weights sum to 1, so the result stays on the 40–99 scale. */
export function playerOverall(p) {
  if (p.role === 'GK') {
    return Math.round(p.cat * 0.3 + p.blk * 0.2 + p.pow * 0.15 + p.spd * 0.15 + p.pas * 0.1 + p.end * 0.1);
  }
  return Math.round(
    p.spd * 0.14 + p.sht * 0.16 + p.hnd * 0.15 + p.pas * 0.1 + p.tkl * 0.13 + p.pow * 0.12 + p.end * 0.1 + p.gb * 0.1,
  );
}

/** Strength of the seven swimmers who take the pool: keeper + shooters + fielders. */
export function teamOverall(team) {
  const seven = starters(team);
  return Math.round(seven.reduce((s, p) => s + playerOverall(p), 0) / seven.length);
}

/**
 * A coach-named starting seven, when the crew has one. Career mode picks its own seven out of the
 * eleven, so the sim has to be able to read a lineup instead of assuming "first keeper, first two
 * shooters, first four fielders". Returns null when the crew has no lineup or it is not a legal
 * seven, so a bad or half-written save degrades to the default selection instead of booting a
 * broken match. The roles per slot are fixed because the AI reads them: slot 0 guards the zone,
 * slots 1-2 are the shooters (1 is the primary) and slots 3-6 are the fielders.
 */
export function lineupOf(team) {
  if (!Array.isArray(team.lineup) || team.lineup.length !== 7) return null;
  const byId = new Map(team.roster.map((p) => [p.id, p]));
  const picked = team.lineup.map((id) => byId.get(id));
  if (picked.some((p) => !p)) return null;
  if (new Set(picked.map((p) => p.id)).size !== 7) return null;
  if (picked[0].role !== 'GK') return null;
  if (picked[1].role !== 'SH' || picked[2].role !== 'SH') return null;
  if (picked.slice(3).some((p) => p.role !== 'FD')) return null;
  return picked;
}

/** Best-available seven for a crew: keeper, both shooters, then the four best fielders. */
export function bestLineup(team) {
  return starters({ ...team, lineup: null });
}

/**
 * The seven swimmers who start a match — slot order matters: the sim creates players by index,
 * slot 0 is the keeper, slots 1-2 the shooters (index 1 is the captain), slots 3-6 the fielders.
 */
export function starters(team) {
  const named = lineupOf(team);
  if (named) return named;
  const keeper = team.roster.find((p) => p.role === 'GK');
  const shooters = team.roster.filter((p) => p.role === 'SH').slice(0, 2);
  const fielders = team.roster.filter((p) => p.role === 'FD').slice(0, 4);
  return keeper ? [keeper, ...shooters, ...fielders] : [...shooters, ...fielders];
}

/** The captain takes the tip-off. */
export function captainOf(team) {
  return team.roster.find((p) => p.captain) || starters(team)[1];
}

/**
 * The four swimmers on the touch wall: everyone in the 11 who does not start. A crew can name
 * any of them as a replacement for a same-role starter, so match fitness and injury both have
 * somewhere to go. Ordered best-rating first so the bench panel reads as a ranked list.
 */
export function benchOf(team) {
  const starting = new Set(starters(team).map((p) => p.id));
  return team.roster
    .filter((p) => !starting.has(p.id))
    .sort((a, b) => playerOverall(b) - playerOverall(a));
}

export const PLAYER_BY_ID = Object.fromEntries(TEAMS.flatMap((t) => t.roster.map((p) => [p.id, { ...p, teamId: t.id }])));
