/**
 * CLOUD SAVE + GLOBAL BOARD — the optional server side of the game.
 *
 * The local save in localStorage is the source of truth and always will be: the game is playable
 * with no backend at all. This module is the *extra* — a device id, a copy of the save on the
 * server so a second machine can pick the run up, a results feed for the global board, and the
 * duel server's room count.
 *
 * Two rules shape the whole file:
 *
 *  1. **Never fatal.** The backend may be down, on another origin, or not exist at all. Every
 *     call resolves to a value or to null, never throws, and never rejects: a game that cannot
 *     reach its server still has to be a game.
 *  2. **Newest wins.** The save is reconciled by timestamp in both directions — the cloud copy is
 *     adopted only when it is newer than the local one, and a local save is pushed only when it
 *     is the newer of the two. The server applies the same rule, so two devices can race without
 *     either one corrupting the other.
 */

const DEVICE_KEY = 'blitzball_x_device_v1';
/** How long a burst of local saves is batched before it is pushed. */
const PUSH_DEBOUNCE_MS = 1500;
/** A request that takes longer than this is treated as a failure, not a hang. */
const REQUEST_TIMEOUT_MS = 8000;

/**
 * @typedef {Object} CloudDevice
 * @property {string} userId
 * @property {string} username
 */

export class CloudApi {
  /**
   * @param {{ base?: string, fetchImpl?: Function, storage?: Storage, now?: () => number }} options
   */
  constructor({ base = '', fetchImpl = null, storage = null, now = () => Date.now() } = {}) {
    this.base = String(base || '').replace(/\/$/, '');
    this.now = now;
    this.fetchImpl = fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    this.storage = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    /** @type {CloudDevice|null} */
    this.device = null;
    /** Has the backend answered at least once? Drives the "server offline" hints. */
    this.online = false;
    /** The last error message, for the UI to show instead of a silent failure. */
    this.lastError = '';
    this.pushTimer = null;
    this.pendingPush = null;
    this.pushes = 0;
  }

  /** The stored device id, if this browser has one. */
  readDevice() {
    if (this.device) return this.device;
    try {
      const raw = JSON.parse(this.storage?.getItem(DEVICE_KEY) || 'null');
      if (raw && typeof raw.userId === 'string' && raw.userId) {
        this.device = { userId: raw.userId, username: String(raw.username || 'PLAYER').slice(0, 18) };
        return this.device;
      }
    } catch {
      /* a corrupt device id is not worth failing over */
    }
    return null;
  }

  writeDevice(device) {
    this.device = device;
    try {
      this.storage?.setItem(DEVICE_KEY, JSON.stringify(device));
    } catch {
      /* private browsing may block storage; the device still works for this session */
    }
    return device;
  }

  /**
   * The device this browser plays as, creating one on first use.
   * @returns {Promise<CloudDevice|null>}
   */
  async ensureDevice() {
    const existing = this.readDevice();
    if (existing) return existing;
    if (!this.fetchImpl) return null;
    const result = await this.request('/api/auth/anonymous', { method: 'POST', body: {} });
    if (!result.ok || !result.data?.userId) return null;
    return this.writeDevice({
      userId: String(result.data.userId),
      username: String(result.data.username || 'PLAYER').slice(0, 18),
    });
  }

  /**
   * One request, never throwing.
   * @param {string} path
   * @param {{ method?: string, body?: any }} options
   * @returns {Promise<{ ok: boolean, status: number, data: any }>}
   */
  async request(path, { method = 'GET', body = null } = {}) {
    if (!this.fetchImpl) return { ok: false, status: 0, data: null };
    const headers = { Accept: 'application/json' };
    const device = this.readDevice();
    if (device?.userId) headers['x-user-id'] = device.userId;
    if (body !== null) headers['Content-Type'] = 'application/json';
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
    try {
      const response = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers,
        body: body === null ? undefined : JSON.stringify(body),
        signal: controller?.signal,
      });
      let data = null;
      const text = await response.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      this.online = true;
      this.lastError = '';
      return { ok: response.ok, status: response.status, data };
    } catch (error) {
      this.online = false;
      this.lastError = error?.message || 'The server did not answer.';
      return { ok: false, status: 0, data: null };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Push the local save. The server keeps whichever copy is newer.
   * @param {Object} payload the state blob the game saves locally
   */
  async pushSave(payload) {
    if (!payload) return false;
    const result = await this.request('/api/user/save', { method: 'PUT', body: payload });
    if (result.ok) this.pushes += 1;
    return !!result.ok;
  }

  /**
   * Read the cloud copy of the save.
   * @returns {Promise<Object|null>} null when there is no cloud save or the server is unreachable
   */
  async pullSave() {
    const result = await this.request('/api/user/save');
    if (!result.ok || !result.data || typeof result.data !== 'object') return null;
    return result.data;
  }

  /**
   * Report a finished match to the global board.
   * @param {{ mode: string, score: number[], won: boolean, style?: number, username?: string }} result
   */
  async reportMatch({ mode, score, won, style = 0, username = '' } = {}) {
    if (!Array.isArray(score) || score.length !== 2) return false;
    const result = await this.request('/api/match/result', {
      method: 'POST',
      body: { mode, score, won: !!won, style: Math.max(0, Math.round(Number(style) || 0)), username },
    });
    return !!result.ok;
  }

  /**
   * The global board, best first.
   * @returns {Promise<Array<{username: string, wins: number, losses: number, goals_scored: number, xp: number}>>}
   */
  async leaderboard() {
    const result = await this.request('/api/match/leaderboard');
    if (!result.ok || !Array.isArray(result.data)) return [];
    return result.data;
  }

  /** The duel server's room count, for the lobby. */
  async duelStats() {
    const result = await this.request('/api/duel/stats');
    return result.ok && result.data ? result.data : null;
  }

  /**
   * Batch local saves into one push. A match writes the save several times in a second; the
   * server only needs the last one.
   * @param {Object} payload
   */
  schedulePush(payload) {
    this.pendingPush = payload;
    if (this.pushTimer) return;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      const next = this.pendingPush;
      this.pendingPush = null;
      if (next) this.pushSave(next);
    }, PUSH_DEBOUNCE_MS);
    this.pushTimer?.unref?.();
  }

  /** Push anything that is still waiting, right now. */
  flushPush() {
    if (this.pushTimer) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
    const next = this.pendingPush;
    this.pendingPush = null;
    if (next) this.pushSave(next);
    return !!next;
  }
}

export { DEVICE_KEY, PUSH_DEBOUNCE_MS };
