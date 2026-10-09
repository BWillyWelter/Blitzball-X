/**
 * Persistence & Sync Manager for Blitzball-X
 */

const SAVE_KEY = 'blitzball_x_save_data_v1';

export class SaveManager {
  /**
   * @param {Object} [config]
   * @param {string} [config.apiEndpoint]
   */
  constructor(config = {}) {
    this.apiEndpoint = config.apiEndpoint || null;
  }

  /**
   * Loads save data from localStorage or remote cloud backup
   * @returns {Promise<Object>}
   */
  async load() {
    let localData = null;

    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) localData = JSON.parse(raw);
    } catch (err) {
      console.warn('[SaveManager] Failed to read localStorage:', err);
    }

    if (this.apiEndpoint) {
      try {
        const response = await fetch(`${this.apiEndpoint}/user/save`, { method: 'GET' });
        if (response.ok) {
          const cloudData = await response.json();
          if (!localData || (cloudData.updatedAt > (localData.updatedAt || 0))) {
            this.saveLocal(cloudData);
            return cloudData;
          }
        }
      } catch (err) {
        console.warn('[SaveManager] Cloud fetch failed, falling back to local data:', err);
      }
    }

    return localData || this.getDefaultState();
  }

  /**
   * Saves game progress locally and syncs to cloud if endpoint is provided
   * @param {Object} data 
   * @returns {Promise<boolean>}
   */
  async save(data) {
    const payload = {
      ...data,
      updatedAt: Date.now()
    };

    const localSuccess = this.saveLocal(payload);

    if (this.apiEndpoint) {
      try {
        await fetch(`${this.apiEndpoint}/user/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (err) {
        console.warn('[SaveManager] Cloud sync failed:', err);
      }
    }

    return localSuccess;
  }

  saveLocal(data) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      return true;
    } catch (err) {
      console.error('[SaveManager] Failed to save to localStorage:', err);
      return false;
    }
  }

  getDefaultState() {
    return {
      updatedAt: Date.now(),
      career: {
        matchesPlayed: 0,
        wins: 0,
        losses: 0,
        currency: 0
      },
      unlockedCosmetics: ['default_ball', 'default_bat'],
      settings: {
        soundVolume: 0.8,
        musicVolume: 0.6,
        hapticsEnabled: true
      }
    };
  }
}
