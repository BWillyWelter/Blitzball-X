/**
 * Complete Persistence & State Sync Manager for Blitzball-X
 * Handles local offline storage (localStorage) and remote cloud REST synchronization
 * for Career progress, League/Tournament brackets, and Spira Scout contracts.
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
   * Automatically resolves local vs. remote timestamps
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
          // Use whichever save payload has the more recent timestamp
          if (!localData || (cloudData.updatedAt > (localData.updatedAt || 0))) {
            this.saveLocal(cloudData);
            return this.normalizeState(cloudData);
          }
        }
      } catch (err) {
        console.warn('[SaveManager] Cloud fetch failed, using local fallback:', err);
      }
    }

    return this.normalizeState(localData || this.getDefaultState());
  }

  /**
   * Saves game progress locally and syncs to cloud backend
   * @param {Object} data Master save payload
   * @returns {Promise<boolean>}
   */
  async save(data) {
    const payload = {
      ...this.normalizeState(data),
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
        console.warn('[SaveManager] Cloud REST sync failed:', err);
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
      console.error('[SaveManager] Failed writing to localStorage:', err);
      return false;
    }
  }

  /**
   * Serializes a LeagueManager instance into a clean JSON save node
   * @param {Object} leagueManager Instance of LeagueManager
   * @returns {Object}
   */
  serializeLeague(leagueManager) {
    if (!leagueManager) return this.getDefaultState().league;

    return {
      type: leagueManager.type,
      currentRound: leagueManager.currentRound,
      maxRounds: leagueManager.maxRounds,
      isCompleted: leagueManager.isCompleted,
      teams: leagueManager.teams,
      standings: leagueManager.standings,
      bracket: leagueManager.bracket,
      prizes: leagueManager.prizes
    };
  }

  /**
   * Serializes a ScoutManager instance into a clean JSON save node
   * @param {Object} scoutManager Instance of ScoutManager
   * @returns {Object}
   */
  serializeScout(scoutManager) {
    if (!scoutManager) return this.getDefaultState().scout;

    return {
      scoutLevel: scoutManager.scoutLevel,
      gil: scoutManager.gil,
      agentContracts: scoutManager.agentContracts
    };
  }

  /**
   * Ensures missing fields in legacy saves are backfilled with default defaults
   * @param {Object} rawData 
   * @returns {Object}
   */
  normalizeState(rawData = {}) {
    const defaultState = this.getDefaultState();

    return {
      updatedAt: rawData.updatedAt || defaultState.updatedAt,
      career: {
        ...defaultState.career,
        ...(rawData.career || {})
      },
      league: {
        ...defaultState.league,
        ...(rawData.league || {})
      },
      scout: {
        ...defaultState.scout,
        ...(rawData.scout || {})
      },
      settings: {
        ...defaultState.settings,
        ...(rawData.settings || {})
      }
    };
  }

  /**
   * Default state schema for new players or fresh resets
   * @returns {Object}
   */
  getDefaultState() {
    return {
      updatedAt: Date.now(),
      career: {
        matchesPlayed: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        goalsScored: 0,
        goalsConceded: 0,
        coins: 0,
        xp: 0,
        level: 1,
        unlockedCosmetics: ['ball_standard', 'court_sphere_pool'],
        equipped: {
          ball: 'ball_standard',
          court: 'court_sphere_pool'
        }
      },
      league: {
        type: 'LEAGUE',
        currentRound: 1,
        maxRounds: 10,
        isCompleted: false,
        teams: ['besaid_aurochs', 'luca_goers', 'al_bhed_psyches'],
        standings: null,
        bracket: null,
        prizes: null
      },
      scout: {
        scoutLevel: 1,
        gil: 5000,
        agentContracts: null
      },
      settings: {
        soundVolume: 0.8,
        musicVolume: 0.6,
        hapticsEnabled: true,
        autoSave: true
      }
    };
  }
}
