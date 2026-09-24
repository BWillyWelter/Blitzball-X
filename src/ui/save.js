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
  touchControls: 'auto', // auto | on | off — on-screen stick + buttons
  camera: 'broadcast', // broadcast | firstPerson — career no longer forces first-person
  cameraAngle: 'corner', // corner (3D three-quarter) | side (classic side-on)
  playerCam: true, // Rematch-style player-lock third-person camera (broadcast when off)
  ballCam: true, // player cam mode: true = hard-lock the ball, false = look where you swim
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
