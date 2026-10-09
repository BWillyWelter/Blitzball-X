/**
 * Persistence & Sync Manager for Blitzball-X
 * Handles local offline storage (localStorage) and remote cloud synchronization.
 */

import { CONFIG } from '../config.js';

const SAVE_KEY = 'blitzball_x_save_data_v1';
const USER_ID_KEY = 'blitzball_x_user_id';

export class SaveManager {
  /**
   * @param {Object} [config]
   * @param {string} [config.apiEndpoint]
   */
  constructor(config = {}) {
    this.apiEndpoint = config.apiEndpoint || CONFIG.API_BASE_URL;
    this.userId = this.getOrCreateUserId();
  }

  /**
   * Generates or retrieves a persistent anonymous client user ID
   * @returns {string}
   */
  getOrCreateUserId() {
    if (typeof window === 'undefined') return 'server_session';
    let id = localStorage.getItem(USER_ID_KEY);
    if (!id) {
      id = `usr_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`;
      localStorage.setItem(USER_ID_KEY, id);
    }
    return id;
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
        const response = await fetch(`${this.apiEndpoint}/user/save`, {
          method: 'GET',
          headers: {
            'x-user-id': this.userId
          }
        });

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
   * Saves game progress locally and syncs to cloud if endpoint is available
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
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': this.userId
          },
          body: JSON.stringify(payload)
        });
      } catch (err) {
        console.warn('[SaveManager] Cloud sync failed:', err);
      }
    }

    return localSuccess;
  }

  /**
   * Writes payload directly to localStorage
   * @param {Object} data 
   * @returns {boolean}
   */
  saveLocal(data) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      return true;
    } catch (err) {
      console.error('[SaveManager] Failed to save to localStorage:', err);
      return false;
    }
  }

  /**
   * Default state schema
   * @returns {Object}
   */
  getDefaultState() {
    return {
      updatedAt: Date.now(),
      career: {
        matchesPlayed: 0,
        wins: 0,
        losses: 0,
        goalsScored: 0,
        goalsConceded: 0,
        coins: 0,
        xp: 0,
        level: 1,
        unlockedCosmetics: ['ball_standard', 'bat_standard', 'court_backyard'],
        equipped: {
          ball: 'ball_standard',
          bat: 'bat_standard',
          court: 'court_backyard'
        }
      },
      settings: {
        soundVolume: 0.8,
        musicVolume: 0.6,
        hapticsEnabled: true
      }
    };
  }
}
