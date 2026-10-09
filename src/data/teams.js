/**
 * FFX Blitzball Team Rosters & Base Player Stats
 */

export const TEAMS = {
  besaid_aurochs: {
    id: 'besaid_aurochs',
    name: 'Besaid Aurochs',
    colors: { primary: '#0284c7', secondary: '#facc15' },
    players: [
      { id: 'p_tidus', name: 'Tidus', pos: 'LF', hp: 132, en: 12, pas: 3, sh: 10, tck: 5, blk: 2, cut: 2, cat: 1, techs: ['JECHT_SHOT'] },
      { id: 'p_datto', name: 'Datto', pos: 'RF', hp: 95, en: 9, pas: 2, sh: 8, tck: 4, blk: 1, cut: 3, cat: 1, techs: ['NAP_SHOT_1'] },
      { id: 'p_letty', name: 'Letty', pos: 'MF', hp: 105, en: 8, pas: 9, sh: 4, tck: 5, blk: 3, cut: 6, cat: 1, techs: ['VENOM_PASS_1'] },
      { id: 'p_jassu', name: 'Jassu', pos: 'LD', hp: 110, en: 11, pas: 4, sh: 1, tck: 8, blk: 4, cut: 5, cat: 1, techs: ['VENOM_TACKLE_1'] },
      { id: 'p_bottta', name: 'Bottta', pos: 'RD', hp: 120, en: 10, pas: 3, sh: 1, tck: 9, blk: 3, cut: 4, cat: 1, techs: ['WITHER_TACKLE_1'] },
      { id: 'p_keepa', name: 'Keepa', pos: 'KP', hp: 90, en: 5, pas: 2, sh: 1, tck: 2, blk: 1, cut: 1, cat: 8, techs: [] }
    ]
  },

  luca_goers: {
    id: 'luca_goers',
    name: 'Luca Goers',
    colors: { primary: '#e11d48', secondary: '#38bdf8' },
    players: [
      { id: 'p_bickson', name: 'Bickson', pos: 'LF', hp: 140, en: 14, pas: 5, sh: 12, tck: 7, blk: 3, cut: 3, cat: 1, techs: ['VENOM_SHOT_1'] },
      { id: 'p_abus', name: 'Abus', pos: 'RF', hp: 115, en: 11, pas: 4, sh: 11, tck: 6, blk: 2, cut: 2, cat: 1, techs: [] },
      { id: 'p_graav', name: 'Graav', pos: 'MF', hp: 130, en: 13, pas: 11, sh: 6, tck: 8, blk: 5, cut: 7, cat: 1, techs: ['VENOM_PASS_1'] },
      { id: 'p_doram', name: 'Doram', pos: 'LD', hp: 125, en: 12, pas: 3, sh: 2, tck: 10, blk: 6, cut: 4, cat: 1, techs: ['WITHER_TACKLE_1'] },
      { id: 'p_balgerda', name: 'Balgerda', pos: 'RD', hp: 135, en: 11, pas: 4, sh: 2, tck: 11, blk: 7, cut: 5, cat: 1, techs: [] },
      { id: 'p_raudy', name: 'Raudy', pos: 'KP', hp: 100, en: 6, pas: 3, sh: 1, tck: 2, blk: 1, cut: 1, cat: 11, techs: [] }
    ]
  },

  al_bhed_psyches: {
    id: 'al_bhed_psyches',
    name: 'Al Bhed Psyches',
    colors: { primary: '#f59e0b', secondary: '#10b981' },
    players: [
      { id: 'p_eigaar', name: 'Eigaar', pos: 'LF', hp: 150, en: 15, pas: 6, sh: 14, tck: 8, blk: 4, cut: 4, cat: 1, techs: ['VENOM_SHOT_2'] },
      { id: 'p_berrik', name: 'Berrik', pos: 'RF', hp: 145, en: 14, pas: 10, sh: 8, tck: 9, blk: 5, cut: 6, cat: 1, techs: [] },
      { id: 'p_judda', name: 'Judda', pos: 'MF', hp: 135, en: 12, pas: 8, sh: 3, tck: 11, blk: 8, cut: 8, cat: 1, techs: ['WITHER_TACKLE_2'] },
      { id: 'p_lakkam', name: 'Lakkam', pos: 'LD', hp: 140, en: 13, pas: 7, sh: 2, tck: 12, blk: 9, cut: 7, cat: 1, techs: [] },
      { id: 'p_blappa', name: 'Blappa', pos: 'RD', hp: 130, en: 11, pas: 5, sh: 10, tck: 9, blk: 6, cut: 5, cat: 1, techs: ['SPHERE_SHOT'] },
      { id: 'p_nimrook', name: 'Nimrook', pos: 'KP', hp: 120, en: 8, pas: 4, sh: 1, tck: 3, blk: 2, cut: 2, cat: 18, techs: [] } // FFX's highest base CAT keeper
    ]
  }
};
