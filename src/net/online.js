/**
 * ONLINE DUEL — the browser half of the lockstep connection.
 *
 * Owns the socket, the room handshake and the input ring buffer. It does not own the simulation:
 * the app builds a MatchSim from the `start` message (same seed, same crews, same rules on both
 * machines) and hands it over, so the only thing that crosses the wire is input.
 *
 * Lockstep in one paragraph: every simulation tick needs both players' input for that tick. Each
 * peer sends its own input a few ticks ahead, then advances the shared clock one tick at a time,
 * only when the other peer's input for that tick has arrived. Both machines therefore run the same
 * deterministic step with the same two inputs, in the same order, forever.
 */

import {
  MSG,
  PROTOCOL_VERSION,
  TICK_SECONDS,
  INPUT_LOOKAHEAD,
  STALL_MS,
  packInput,
  unpackInput,
  simChecksum,
  cleanRoomCode,
  duelSocketUrl,
} from './protocol.js';

/** How often a peer reports its checksum so a divergence is caught instead of played through. */
const CHECKSUM_INTERVAL_MS = 1500;

export class OnlineDuel {
  /**
   * @param {{ url?: string, name?: string, onEvent?: (type: string, payload: any) => void }} options
   */
  constructor({ url = duelSocketUrl(), name = 'PLAYER', onEvent = null } = {}) {
    this.url = url;
    this.name = String(name || 'PLAYER').slice(0, 18);
    this.onEvent = onEvent;
    this.socket = null;
    this.state = 'offline'; // offline | connecting | idle | room | live | closed
    this.seat = null; // 0 | 1 once the room is running
    this.code = null;
    this.players = [null, null];
    this.seed = null;
    this.startedAt = 0;
    this.sim = null;
    this.error = '';
    // Lobby-side choices the UI owns but the session has to remember across rerenders.
    this.myTeam = null;
    this.ready = false;
    // The mode the room is played under. The server confirms it when the room is created.
    this.modeId = null;
    // Best-of-three bookkeeping, mirrored from the server. `round` is the round the current sim
    // belongs to; `series` is the tally both peers read (wins, champion, forfeit).
    this.round = 1;
    this.series = null;
    this.reportedRound = 0;
    // Lockstep ring buffers.
    this.tick = 0;
    this.sentThrough = -1;
    this.local = new Map();
    this.remote = new Map();
    this.waitingSince = 0;
    this.stalled = false;
    this.lastRemoteTick = -1;
    this.lastChecksumAt = 0;
    this.lastRemoteChecksum = null;
    // Our own fingerprint per tick, so a peer's report can be compared against the state we
    // actually had at that tick — comparing "now" against "their now" would only measure latency.
    this.sums = new Map();
    this.desync = false;
    this.openPromise = null;
  }

  emit(type, payload = {}) {
    this.onEvent?.(type, payload);
  }

  get live() {
    return this.state === 'live' && !!this.sim;
  }

  /** Open the socket and say hello. Resolves once the server has welcomed us. */
  connect() {
    if (this.state === 'idle' || this.state === 'room' || this.state === 'live') return Promise.resolve(true);
    if (this.openPromise) return this.openPromise;
    if (typeof WebSocket === 'undefined') {
      this.error = 'This browser has no WebSocket support.';
      return Promise.resolve(false);
    }

    this.openPromise = new Promise((resolve) => {
      let settled = false;
      const finish = (ok, message = '') => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.openPromise = null;
        if (!ok) {
          this.state = 'closed';
          this.error = message || 'Could not reach the duel server.';
          this.emit('error', { message: this.error });
        }
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false, 'The duel server did not answer.'), 9000);

      this.state = 'connecting';
      let socket;
      try {
        socket = new WebSocket(this.url);
      } catch (error) {
        finish(false, `Bad duel server address: ${error.message}`);
        return;
      }
      this.socket = socket;

      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ t: MSG.HELLO, version: PROTOCOL_VERSION, name: this.name }));
      });
      socket.addEventListener('message', (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (msg?.t === MSG.WELCOME || msg?.t === MSG.ROOM || msg?.t === MSG.START) finish(true);
        this.handle(msg);
      });
      socket.addEventListener('error', () => finish(false, 'Duel server connection failed.'));
      socket.addEventListener('close', () => {
        const wasLive = this.state === 'live';
        this.state = 'closed';
        this.sim = null;
        this.emit('close', { wasLive });
        finish(false, this.error || 'The duel server closed the connection.');
      });
    });
    return this.openPromise;
  }

  handle(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case MSG.WELCOME: {
        if (this.state === 'connecting' || this.state === 'offline') this.state = 'idle';
        this.emit('open', { id: msg.id || '', version: msg.version });
        break;
      }
      case MSG.ROOM: {
        this.state = 'room';
        this.code = msg.code || this.code;
        this.seat = Number.isInteger(msg.seat) ? msg.seat : this.seat;
        this.players = Array.isArray(msg.players) ? msg.players : this.players;
        if (msg.series) this.series = msg.series;
        // The room's mode is the server's decision: a guest that joined a BLITZ room has to be
        // told, or the lobby would advertise the wrong rulebook.
        if (msg.modeId) this.modeId = msg.modeId;
        this.emit('room', {
          code: this.code,
          seat: this.seat,
          players: this.players,
          ready: !!msg.ready,
          series: this.series,
          modeId: this.modeId,
        });
        break;
      }
      case MSG.START: {
        this.state = 'live';
        this.seat = Number.isInteger(msg.seat) ? msg.seat : this.seat;
        this.seed = msg.seed;
        this.tick = 0;
        this.sentThrough = -1;
        this.local.clear();
        this.remote.clear();
        this.lastRemoteTick = -1;
        this.waitingSince = 0;
        this.stalled = false;
        this.desync = false;
        this.lastRemoteChecksum = null;
        this.startedAt = Date.now();
        this.round = Number.isInteger(msg.round) ? msg.round : this.round;
        if (msg.series) this.series = msg.series;
        this.reportedRound = 0;
        this.ready = false;
        this.emit('start', {
          seat: this.seat,
          seed: msg.seed,
          home: msg.home,
          away: msg.away,
          modeId: msg.modeId,
          difficulty: msg.difficulty,
          rules: msg.rules || null,
          round: this.round,
          series: this.series,
        });
        break;
      }
      case MSG.SERIES: {
        this.series = msg.series || this.series;
        this.ready = false;
        this.emit('series', { series: this.series });
        break;
      }
      case MSG.INPUT: {
        // Two kinds of traffic share the input channel: a tick's input, and the periodic state
        // fingerprint (which carries `checksum` and no tick data).
        if (typeof msg.checksum === 'number') {
          this.lastRemoteChecksum = msg.checksum >>> 0;
          const at = Number.isInteger(msg.tick) ? msg.tick : this.tick;
          const mine = this.sums.get(at);
          if (mine !== undefined && mine !== this.lastRemoteChecksum && !this.desync) {
            this.desync = true;
            this.emit('desync', { tick: at, local: mine, remote: this.lastRemoteChecksum });
          }
          break;
        }
        if (Array.isArray(msg.data) && Number.isInteger(msg.tick) && msg.tick >= 0) {
          this.remote.set(msg.tick, msg.data);
          this.lastRemoteTick = Math.max(this.lastRemoteTick, msg.tick);
          this.waitingSince = 0;
          this.stalled = false;
        }
        break;
      }
      case MSG.PING:
        this.send({ t: MSG.PONG, at: msg.at });
        break;
      case MSG.LEAVE:
        this.emit('opponent-left', {});
        break;
      case MSG.ERROR:
        this.error = msg.message || 'Duel server error.';
        this.emit('error', { message: this.error, code: msg.code || '' });
        break;
      default:
        break;
    }
  }

  send(payload) {
    if (!this.socket || this.socket.readyState !== 1) return false;
    try {
      this.socket.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Open a room.
   * @param {{ modeId?: string, difficulty?: string, customRules?: Object }} options
   */
  createRoom(options = {}) {
    const payload = { t: MSG.CREATE, name: this.name };
    if (options.modeId) payload.modeId = options.modeId;
    if (options.difficulty) payload.difficulty = options.difficulty;
    if (options.customRules && typeof options.customRules === 'object') payload.customRules = options.customRules;
    return this.send(payload);
  }

  joinRoom(rawCode) {
    const code = cleanRoomCode(rawCode);
    return this.send({ t: MSG.JOIN, code, name: this.name });
  }

  pickTeam(teamId) {
    return this.send({ t: MSG.TEAM, teamId });
  }

  setReady(ready = true) {
    return this.send({ t: MSG.READY, ready: !!ready });
  }

  /** Report the finished round. Safe to call twice: the server keeps the first report. */
  reportResult(winnerSeat) {
    if (this.reportedRound === this.round) return false;
    this.reportedRound = this.round;
    return this.send({ t: MSG.RESULT, winner: winnerSeat === 0 || winnerSeat === 1 ? winnerSeat : null });
  }

  /** Walk away from the series. The server awards it to the other pilot. */
  concede() {
    return this.send({ t: MSG.CONCEDE });
  }

  leave() {
    this.send({ t: MSG.LEAVE });
    this.detach();
    this.state = 'idle';
  }

  /** Drop the simulation but stay in the room — a results screen keeps the series alive. */
  detach() {
    this.sim = null;
    this.pendingInput = null;
    this.tick = 0;
    this.sentThrough = -1;
    this.local.clear();
    this.remote.clear();
    this.sums.clear();
  }

  /** Hand over the simulation built from the start message. */
  attachSim(sim) {
    this.sim = sim;
    this.reportedRound = 0;
    this.tick = 0;
    this.sentThrough = -1;
    this.local.clear();
    this.remote.clear();
  }

  /** Input for the local seat, sampled once per rendered frame. */
  queueInput(input) {
    this.pendingInput = packInput(input);
  }

  /**
   * Advance the shared clock as far as the buffers allow.
   * @param {(localInput: Object, remoteInput: Object) => void} stepOnce advances the sim one tick
   * @returns {number} how many ticks were stepped this call
   */
  pump(stepOnce) {
    if (!this.live || typeof stepOnce !== 'function') return 0;
    // Send ahead first: the remote cannot step tick T until our input for T exists, so sitting on
    // it would stall both machines forever.
    if (this.pendingInput) {
      while (this.sentThrough < this.tick + INPUT_LOOKAHEAD) {
        this.sentThrough += 1;
        this.local.set(this.sentThrough, this.pendingInput);
        this.send({ t: MSG.INPUT, tick: this.sentThrough, data: this.pendingInput });
      }
    }

    let stepped = 0;
    while (this.local.has(this.tick) && this.remote.has(this.tick)) {
      const mine = this.local.get(this.tick);
      const theirs = this.remote.get(this.tick);
      stepOnce(unpackInput(mine), unpackInput(theirs));
      stepped += 1;
      this.tick += 1;
      // Fingerprint every tick we run: a peer's report names the tick it measured.
      this.sums.set(this.tick, simChecksum(this.sim));
      // Keep a short history only: 4 seconds of ticks is more than any recovery needs.
      const cutoff = this.tick - 240;
      for (const key of this.local.keys()) if (key < cutoff) this.local.delete(key);
      for (const key of this.remote.keys()) if (key < cutoff) this.remote.delete(key);
      for (const key of this.sums.keys()) if (key < cutoff) this.sums.delete(key);
    }

    if (stepped === 0 && this.tick > 0) {
      if (!this.waitingSince) this.waitingSince = performance.now();
      else if (performance.now() - this.waitingSince > STALL_MS && !this.stalled) {
        this.stalled = true;
        this.emit('stall', { tick: this.tick, lastRemoteTick: this.lastRemoteTick });
      }
    }

    this.reportChecksum();
    return stepped;
  }

  /**
   * Send our fingerprint for the current tick, periodically. The comparison happens on receipt,
   * against the fingerprint this client stored for that same tick — which is why the tick travels
   * with the checksum.
   */
  reportChecksum() {
    if (!this.sim) return;
    const now = performance.now();
    if (now - this.lastChecksumAt < CHECKSUM_INTERVAL_MS) return;
    this.lastChecksumAt = now;
    const sum = this.sums.get(this.tick) ?? simChecksum(this.sim);
    this.send({ t: MSG.INPUT, tick: this.tick, checksum: sum });
  }

  close() {
    try {
      this.socket?.close();
    } catch {
      /* already gone */
    }
    this.socket = null;
    this.sim = null;
    this.state = 'offline';
    this.tick = 0;
    this.local.clear();
    this.remote.clear();
  }

  /** Fixed step the app must feed the sim for every tick. */
  get tickSeconds() {
    return TICK_SECONDS;
  }
}
