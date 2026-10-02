/**
 * Persistent state: settings, career progress, records. localStorage with a versioned schema.
 */
const KEY = 'blitzball-x:v2';

export const DEFAULT_SETTINGS = {
  masterVolume: 0.8,
  musicVolume: 0.55,
  sfxVolume: 0.9,
  quality: 'high', // low | medium | high
  difficulty: 'pro', // rookie | pro | legend
  commentary: true,
  screenShake: true,
  reducedMotion: false,
  touchLayout: 'right', // right (stick left, actions right) | left (left-handed mirror)
  touchScale: 1, // 0.8 – 1.3 on-screen button size
  touchOpacity: 1, // 0.4 – 1 on-screen button opacity
  replay: 'on', // on | off — goal replay cinematic
  // Legacy camera keys — the game now uses the Rematch-style shoulder cam only; these are kept
  // so old saves merge cleanly and are otherwise unused.
  camera: 'broadcast',
  playerCam: true,
  ballCam: true,
};

export function defaultState() {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    career: null,
    records: { wins: 0, losses: 0, styleBest: 0, gamebreakers: 0, goals: 0, saves: 0, washed: 0, bestMargin: 0 },
    unlocked: { legendMode: false },
    seenTutorial: false,
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const base = defaultState();
    return {
      ...base,
      ...parsed,
      settings: { ...base.settings, ...(parsed.settings || {}) },
      records: { ...base.records, ...(parsed.records || {}) },
      unlocked: { ...base.unlocked, ...(parsed.unlocked || {}) },
    };
  } catch (e) {
    console.warn('Save corrupted, resetting', e);
    return defaultState();
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.warn('Could not save', e);
    return false;
  }
}

export function clearState() {
  localStorage.removeItem(KEY);
}
