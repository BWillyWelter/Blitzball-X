/**
 * ONLINE DUEL — the room server.
 *
 * A tiny relay: it pairs two players into a four-character room and forwards their input packets
 * to each other. It deliberately does not run the match. The simulation is deterministic and both
 * browsers run it — the server only has to be somewhere both of them can reach.
 *
 * Everything here is in-memory. A room lives while both peers are connected; if the process
 * restarts, rooms are gone and clients see a closed socket. That is the honest contract for a
 * lobby server with no accounts, and it is what the client is built to handle.
 */

import { WebSocketServer } from 'ws';
import {
  MSG,
  PROTOCOL_VERSION,
  randomRoomCode,
  cleanRoomCode,
  validRoomCode,
  seriesSnapshot,
  TICK_RATE,
  SERIES_BEST_OF,
  SERIES_WINS_REQUIRED,
} from '../src/net/protocol.js';
import { getMode, rulesFor } from '../src/game/modes.js';
import { RULES } from '../src/data/constants.js';

const HEARTBEAT_MS = 20000;
/** A room with nobody in it is collected after this long. */
const ROOM_TTL_MS = 60000;
/** How many rooms one process will hold. Cheap guard against an accident. */
const MAX_ROOMS = 500;
/** Input packets accepted per second per peer, with headroom over the tick rate. */
const INPUT_BUDGET = TICK_RATE * 2 + 20;

let nextPeerId = 1;

export function createDuelServer(httpServer, { path = '/ws', log = console } = {}) {
  const wss = new WebSocketServer({ server: httpServer, path, maxPayload: 8192 });
  /** @type {Map<string, Room>} */
  const rooms = new Map();
  /** @type {Set<Peer>} */
  const peers = new Set();

  const now = () => Date.now();

  function send(peer, payload) {
    if (!peer?.socket || peer.socket.readyState !== 1) return;
    try {
      peer.socket.send(JSON.stringify(payload));
    } catch {
      /* a dead socket is cleaned up by its own close handler */
    }
  }

  function fail(peer, code, message) {
    send(peer, { t: MSG.ERROR, code, message });
  }

  function publicPlayers(room) {
    return room.seats.map((peer) => (peer
      ? { name: peer.name, teamId: peer.teamId, ready: peer.ready, seat: peer.seat }
      : null));
  }

  function roomSnapshot(room, peer) {
    return {
      t: MSG.ROOM,
      code: room.code,
      seat: peer.seat,
      ready: peer.ready,
      modeId: room.modeId,
      players: publicPlayers(room),
      series: seriesSnapshot(room.series),
    };
  }

  function broadcastRoom(room) {
    for (const peer of room.seats) {
      if (peer) send(peer, roomSnapshot(room, peer));
    }
  }

  function makeCode() {
    for (let attempt = 0; attempt < 400; attempt++) {
      const code = randomRoomCode();
      if (!rooms.has(code)) return code;
    }
    return null;
  }

  function freshSeries() {
    return {
      bestOf: SERIES_BEST_OF,
      wins: [0, 0],
      round: 1,
      over: false,
      champion: null,
      forfeit: null,
      history: [],
    };
  }

  /** Both peers have to be seated, crewed and ready — and the previous round has to be settled. */
  function readyToStart(room) {
    const [host, guest] = room.seats;
    if (!(host && guest && host.ready && guest.ready && host.teamId && guest.teamId)) return false;
    if (!room.started) return true;
    return !!room.roundResolved;
  }

  function startRoom(room) {
    room.started = true;
    room.roundResolved = false;
    // A new seed per round: replaying one seed three times would turn the series into a memory
    // test rather than a match.
    room.seed = (Math.random() * 0xffffffff) >>> 0;
    const [host, guest] = room.seats;
    // Readies are spent on the round that just started, so both pilots have to ready up again.
    for (const peer of room.seats) if (peer) peer.ready = false;
    const shared = {
      t: MSG.START,
      seed: room.seed,
      home: host.teamId,
      away: guest.teamId,
      modeId: room.modeId,
      difficulty: room.difficulty,
      rules: room.rules,
      tickRate: TICK_RATE,
      round: room.series.round,
      series: seriesSnapshot(room.series),
    };
    send(host, { ...shared, seat: host.seat });
    send(guest, { ...shared, seat: guest.seat });
    broadcastRoom(room);
    log.info?.(`[duel] room ${room.code} round ${room.series.round}: ${host.teamId} vs ${guest.teamId} (seed ${room.seed})`);
  }

  /** Tell both peers where the series stands. */
  function broadcastSeries(room) {
    const payload = { t: MSG.SERIES, series: seriesSnapshot(room.series) };
    for (const peer of room.seats) if (peer) send(peer, payload);
  }

  /**
   * Fold one finished round into the series.
   * A forfeit awards the set outright: the opponent takes the rounds they still needed, so the
   * scoreboard reads 2–0 rather than pretending the abandoned round was played.
   */
  function recordRound(room, winner, forfeitSeat = null) {
    if (room.roundResolved) return false;
    room.roundResolved = true;
    if (winner === 0 || winner === 1) room.series.wins[winner] += 1;
    room.series.history.push({ round: room.series.round, winner: Number.isInteger(winner) ? winner : null });
    const over = room.series.wins.some((wins) => wins >= SERIES_WINS_REQUIRED);
    if (over) {
      room.series.over = true;
      room.series.champion = room.series.wins[0] >= SERIES_WINS_REQUIRED ? 0 : 1;
    }
    if (forfeitSeat === 0 || forfeitSeat === 1) {
      const winnerSeat = 1 - forfeitSeat;
      room.series.forfeit = forfeitSeat;
      room.series.wins[winnerSeat] = Math.max(room.series.wins[winnerSeat], SERIES_WINS_REQUIRED);
      room.series.over = true;
      room.series.champion = winnerSeat;
    }
    broadcastSeries(room);
    broadcastRoom(room);
    return true;
  }

  /**
   * Remove a peer from its room.
   *
   * A room that has started cannot be resumed — there is no rewind, so the honest thing is to
   * tear it down and tell the other pilot. A room still in the lobby keeps the host's seat warm
   * for a new challenger.
   */
  function leaveRoom(peer) {
    const room = peer.room;
    if (!room) return;
    const other = room.seats.find((p) => p && p !== peer);
    const slot = room.seats.indexOf(peer);
    if (slot >= 0) room.seats[slot] = null;
    peer.room = null;
    peer.ready = false;
    if (other) send(other, { t: MSG.LEAVE });
    if (room.started || !room.seats.some(Boolean)) {
      rooms.delete(room.code);
      if (other) {
        other.room = null;
        other.ready = false;
      }
    }
  }

  function handleHello(peer, msg) {
    if (peer.greeted) return;
    if (msg.version !== PROTOCOL_VERSION) {
      fail(peer, 'VERSION', 'Your build speaks a different duel protocol. Reload to update.');
      return;
    }
    peer.greeted = true;
    peer.name = String(msg.name || 'PLAYER').replace(/[<>&]/g, '').slice(0, 18) || 'PLAYER';
    send(peer, { t: MSG.WELCOME, id: peer.id, version: PROTOCOL_VERSION });
  }

  function handleCreate(peer, msg) {
    if (peer.room) return fail(peer, 'IN_ROOM', 'You are already in a room.');
    if (rooms.size >= MAX_ROOMS) return fail(peer, 'BUSY', 'The duel server is full. Try again shortly.');
    const code = makeCode();
    if (!code) return fail(peer, 'BUSY', 'Could not allocate a room code.');
    // The room's mode decides the ruleset both pools will run. The server owns the snapshot so
    // the two clients cannot end up playing different rulebooks under one seed. A mode that is
    // not playable over the network falls back to the canonical online series.
    const requested = getMode(String(msg.modeId || 'series'));
    const modeId = requested.online ? requested.id : 'series';
    const customRules = msg.customRules && typeof msg.customRules === 'object' ? msg.customRules : null;
    const room = {
      code,
      seats: [peer, null],
      seed: (Math.random() * 0xffffffff) >>> 0,
      modeId,
      difficulty: ['easy', 'pro', 'legend'].includes(msg.difficulty) ? msg.difficulty : 'pro',
      rules: rulesFor(modeId, RULES, customRules),
      started: false,
      roundResolved: false,
      series: freshSeries(),
      createdAt: now(),
      closedAt: 0,
    };
    rooms.set(code, room);
    peer.room = room;
    peer.seat = 0;
    peer.ready = false;
    peer.teamId = null;
    peer.name = String(msg.name || peer.name).replace(/[<>&]/g, '').slice(0, 18) || peer.name;
    broadcastRoom(room);
  }

  function handleJoin(peer, msg) {
    if (peer.room) return fail(peer, 'IN_ROOM', 'You are already in a room.');
    const code = cleanRoomCode(msg.code);
    if (!validRoomCode(code)) return fail(peer, 'BAD_CODE', 'Room codes are four letters or digits.');
    const room = rooms.get(code);
    if (!room) return fail(peer, 'NO_ROOM', `No room called ${code}.`);
    if (room.seats[1]) return fail(peer, 'FULL', `Room ${code} already has two players.`);
    if (room.started) return fail(peer, 'FULL', `Room ${code} has already started.`);
    room.seats[1] = peer;
    peer.room = room;
    peer.seat = 1;
    peer.ready = false;
    peer.teamId = null;
    peer.name = String(msg.name || peer.name).replace(/[<>&]/g, '').slice(0, 18) || peer.name;
    broadcastRoom(room);
  }

  function handleTeam(peer, msg) {
    if (!peer.room) return;
    const id = typeof msg.teamId === 'string' ? msg.teamId.slice(0, 24) : null;
    if (!id) return;
    // Two players cannot run the same crew into each other.
    const other = peer.room.seats.find((p) => p && p !== peer);
    if (other && other.teamId === id) return fail(peer, 'TEAM_TAKEN', 'The other pilot already took that crew.');
    peer.teamId = id;
    // Crew changes are a lobby concern only: swapping mid-series would desync the two sims.
    if (peer.room.started) return;
    broadcastRoom(peer.room);
    if (readyToStart(peer.room)) startRoom(peer.room);
  }

  function handleReady(peer, msg) {
    const room = peer.room;
    if (!room) return;
    peer.ready = !!msg.ready;
    if (peer.ready && !peer.teamId) return fail(peer, 'NO_TEAM', 'Pick a crew before you ready up.');
    // A live round cannot be readied through: the result has to land first.
    if (room.started && !room.roundResolved) return;
    broadcastRoom(room);
    if (!readyToStart(room)) return;
    if (room.started) {
      if (room.series.over) {
        room.series = freshSeries();
        room.started = false;
      } else {
        room.series.round += 1;
      }
    }
    startRoom(room);
  }

  function handleResult(peer, msg) {
    const room = peer.room;
    if (!room || !room.started) return;
    // Both clients report the same round; the first report owns it.
    if (room.roundResolved) return;
    const winner = msg.winner === 0 || msg.winner === 1 ? msg.winner : null;
    recordRound(room, winner);
  }

  function handleConcede(peer) {
    const room = peer.room;
    if (!room || !room.started) return;
    // A concession closes the whole series, not just the round.
    recordRound(room, 1 - peer.seat, peer.seat);
  }

  function handleInput(peer, msg) {
    const room = peer.room;
    if (!room || !room.started) return;
    const other = room.seats.find((p) => p && p !== peer);
    if (!other) return;
    // Relay verbatim: the payload is already compact, and both sides run the same decoder.
    if (typeof msg.checksum === 'number') {
      // The tick travels with the fingerprint: the peer compares it against its own state at the
      // same tick, not against whatever it happens to be simulating when the packet lands.
      send(other, { t: MSG.INPUT, tick: Number.isInteger(msg.tick) ? msg.tick : 0, checksum: msg.checksum >>> 0 });
      return;
    }
    if (!Number.isInteger(msg.tick) || msg.tick < 0) return;
    if (!Array.isArray(msg.data) || msg.data.length > 12) return;
    send(other, { t: MSG.INPUT, tick: msg.tick, data: msg.data });
  }

  wss.on('connection', (socket, request) => {
    const peer = {
      id: `peer_${nextPeerId++}`,
      socket,
      room: null,
      seat: null,
      name: 'PLAYER',
      teamId: null,
      ready: false,
      greeted: false,
      alive: true,
      budget: INPUT_BUDGET,
      windowAt: now(),
      remote: request?.socket?.remoteAddress || '',
    };
    peers.add(peer);

    socket.on('pong', () => {
      peer.alive = true;
    });

    socket.on('message', (raw) => {
      // Cheap flood guard: a peer cannot outrun the tick budget by an order of magnitude.
      const t = now();
      if (t - peer.windowAt > 1000) {
        peer.windowAt = t;
        peer.budget = INPUT_BUDGET;
      }
      if (--peer.budget < 0) return;

      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!msg || typeof msg.t !== 'string') return;

      switch (msg.t) {
        case MSG.HELLO: handleHello(peer, msg); break;
        case MSG.CREATE: if (peer.greeted) handleCreate(peer, msg); break;
        case MSG.JOIN: if (peer.greeted) handleJoin(peer, msg); break;
        case MSG.TEAM: handleTeam(peer, msg); break;
        case MSG.READY: handleReady(peer, msg); break;
        case MSG.RESULT: handleResult(peer, msg); break;
        case MSG.CONCEDE: handleConcede(peer); break;
        case MSG.INPUT: handleInput(peer, msg); break;
        case MSG.PING: send(peer, { t: MSG.PONG, at: msg.at }); break;
        case MSG.LEAVE: leaveRoom(peer); break;
        default: break;
      }
    });

    socket.on('close', () => {
      peers.delete(peer);
      leaveRoom(peer);
    });

    socket.on('error', () => {
      /* The close handler owns cleanup; a socket error is never allowed to crash the process. */
    });
  });

  const heartbeat = setInterval(() => {
    for (const peer of peers) {
      if (!peer.alive) {
        try { peer.socket.terminate(); } catch { /* already gone */ }
        continue;
      }
      peer.alive = false;
      try { peer.socket.ping(); } catch { /* ignore */ }
    }
    // Collect rooms whose players vanished without a clean close.
    for (const room of rooms.values()) {
      if (!room.seats.some(Boolean) && now() - (room.closedAt || room.createdAt) > ROOM_TTL_MS) {
        rooms.delete(room.code);
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  function close() {
    clearInterval(heartbeat);
    for (const peer of peers) {
      try { peer.socket.close(1001, 'server shutting down'); } catch { /* ignore */ }
    }
    wss.close();
    rooms.clear();
    peers.clear();
  }

  return {
    wss,
    rooms,
    peers,
    close,
    /** Read-only diagnostics for the health endpoint. */
    stats: () => ({ rooms: rooms.size, peers: peers.size }),
  };
}
