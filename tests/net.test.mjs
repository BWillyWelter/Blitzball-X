/**
 * ONLINE DUEL — protocol, lockstep and room-server tests.
 *
 * Two kinds of check live here. The first is the wire: an input struct survives a round trip, a
 * checksum notices a moved swimmer, and room codes are what the UI says they are. The second is
 * the actual room flow against a real WebSocket server on a real port — create, join, pick crews,
 * ready up, start, relay an input, leave. That flow is the part of online play a unit test can
 * honestly cover, and it is the part most likely to break.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  TICK_SECONDS,
  packInput,
  unpackInput,
  simChecksum,
  randomRoomCode,
  cleanRoomCode,
  validRoomCode,
  duelSocketUrl,
  MSG,
} from '../src/net/protocol.js';
import { OnlineDuel } from '../src/net/online.js';
import { createDuelServer } from '../server/ws.js';
import { MatchSim } from '../src/game/match.js';
import { TEAMS } from '../src/data/teams.js';

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

test('an input struct survives the wire intact', () => {
  const input = {
    moveX: 0.42,
    moveZ: -1,
    moveY: 0.5,
    aimX: -0.25,
    aimZ: 0.75,
    turbo: true,
    shoot: true,
    shootPressed: true,
    shootReleased: false,
    pass: false,
    trick: true,
    hit: false,
    breach: true,
    switchPlayer: false,
    gamebreaker: true,
    cage: false,
    jukeHeld: false,
    jukeDir: null,
    keeperAim: null,
    playcall: 8,
  };
  const back = unpackInput(packInput(input));
  assert.equal(back.moveX, 0.42);
  assert.equal(back.moveZ, -1);
  assert.equal(back.moveY, 0.5);
  assert.equal(back.aimX, -0.25);
  assert.equal(back.playcall, 8);
  for (const key of ['turbo', 'shoot', 'shootPressed', 'trick', 'breach', 'gamebreaker']) {
    assert.equal(back[key], true, `${key} survived`);
  }
  for (const key of ['shootReleased', 'pass', 'hit', 'switchPlayer', 'cage']) {
    assert.equal(back[key], false, `${key} stayed off`);
  }
});

test('the packed packet is small — seven numbers, no objects', () => {
  const packed = packInput({ moveX: 1, shoot: true, playcall: 3 });
  assert.equal(Array.isArray(packed), true);
  assert.equal(packed.length, 7);
  assert.equal(packed.every((n) => typeof n === 'number'), true);
});

test('out-of-range and garbage axes are clamped instead of poisoning the sim', () => {
  const packed = packInput({ moveX: 99, moveZ: -99, moveY: NaN });
  const back = unpackInput(packed);
  assert.equal(back.moveX, 1);
  assert.equal(back.moveZ, -1);
  assert.equal(back.moveY, 0);
  // A malformed packet decodes to a neutral struct rather than throwing.
  const neutral = unpackInput(null);
  assert.equal(neutral.moveX, 0);
  assert.equal(neutral.playcall, 0);
  // An out-of-band playcall is dropped.
  assert.equal(unpackInput([0, 0, 0, 0, 0, 0, 42]).playcall, 0);
});

test('the checksum is stable for a still pool and moves when the pool moves', () => {
  const a = new MatchSim({ home: TEAMS[0], away: TEAMS[1], seed: 5, userTeam: 0 });
  const b = new MatchSim({ home: TEAMS[0], away: TEAMS[1], seed: 5, userTeam: 0 });
  assert.equal(simChecksum(a), simChecksum(b), 'two identical sims fingerprint identically');
  a.players[0].pos.x += 0.05;
  assert.notEqual(simChecksum(a), simChecksum(b), 'a moved swimmer changes the fingerprint');
});

test('room codes are four unambiguous characters', () => {
  for (let i = 0; i < 200; i++) {
    const code = randomRoomCode();
    assert.match(code, /^[A-Z0-9]{4}$/);
    assert.doesNotMatch(code, /[AEIOU01]/, 'no vowels and no I/O lookalikes');
  }
  assert.equal(cleanRoomCode(' ab-cd '), 'ABCD');
  assert.equal(cleanRoomCode('zzzzzz'), 'ZZZZ');
  assert.equal(validRoomCode('AB12'), true);
  assert.equal(validRoomCode('AB1'), false);
  assert.equal(validRoomCode(''), false);
});

test('the socket URL follows the page origin', () => {
  assert.equal(duelSocketUrl({ protocol: 'https:', host: 'pool.example' }), 'wss://pool.example/ws');
  assert.equal(duelSocketUrl({ protocol: 'http:', host: 'localhost:5173' }), 'ws://localhost:5173/ws');
});

// ---------------------------------------------------------------------------
// Lockstep buffer
// ---------------------------------------------------------------------------

/** A session that never opens a socket: the lockstep buffer is all this needs. */
function offlineSession() {
  const duel = new OnlineDuel({ onEvent: () => {} });
  duel.state = 'live';
  duel.seat = 0;
  duel.sim = { time: 0, score: [0, 0], possession: 0, ball: { pos: { x: 0, y: 0, z: 0 } }, players: [] };
  duel.sent = [];
  duel.send = (payload) => {
    duel.sent.push(payload);
    return true;
  };
  return duel;
}

test('the local input runs ahead so the other peer is never the blocker', () => {
  const duel = offlineSession();
  duel.queueInput({ moveX: 1 });
  duel.pump(() => {});
  // Nothing can be stepped yet — no remote input — but our input is already on the wire.
  assert.ok(duel.sent.length > 0);
  assert.equal(duel.sent[0].t, MSG.INPUT);
  assert.equal(duel.sent[0].tick, 0);
  assert.ok(duel.sent.length >= 1);
});

test('ticks only advance when both inputs for that tick are present, in order', () => {
  const duel = offlineSession();
  const stepped = [];
  duel.queueInput({ moveX: 1 });
  duel.pump((mine, theirs) => stepped.push([mine.moveX, theirs.moveX]));

  duel.handle({ t: MSG.INPUT, tick: 0, data: packInput({ moveX: -1 }) });
  duel.pump((mine, theirs) => stepped.push([mine.moveX, theirs.moveX]));
  assert.deepEqual(stepped, [[1, -1]], 'both inputs were paired for tick 0');
  assert.equal(duel.tick, 1);
});

test('a gap in the remote stream holds the clock instead of skipping ahead', () => {
  const duel = offlineSession();
  duel.queueInput({ moveX: 0 });
  duel.pump(() => {});
  duel.handle({ t: MSG.INPUT, tick: 0, data: packInput({ moveZ: 1 }) });
  duel.handle({ t: MSG.INPUT, tick: 2, data: packInput({ moveZ: 1 }) }); // tick 1 missing
  const seen = [];
  duel.pump((mine, theirs) => seen.push(theirs.moveZ));
  assert.deepEqual(seen, [1], 'only tick 0 ran');
  assert.equal(duel.tick, 1, 'and the clock stopped at the gap');
  duel.handle({ t: MSG.INPUT, tick: 1, data: packInput({ moveZ: -1 }) });
  duel.pump((mine, theirs) => seen.push(theirs.moveZ));
  assert.deepEqual(seen, [1, -1, 1], 'backfilling the gap replays it in order');
  assert.equal(duel.tick, 3);
});

test('old ticks are dropped from the ring buffers', () => {
  const duel = offlineSession();
  duel.queueInput({ moveX: 0 });
  duel.pump(() => {});
  for (let tick = 0; tick < 400; tick++) {
    duel.handle({ t: MSG.INPUT, tick, data: packInput({}) });
    duel.pump(() => {});
  }
  assert.equal(duel.tick, 400);
  assert.ok(duel.local.size < 300, 'the local buffer is trimmed');
  assert.ok(duel.remote.size < 300, 'the remote buffer is trimmed');
});

test('a fingerprint is compared against our own state at the same tick', () => {
  const duel = offlineSession();
  const events = [];
  duel.onEvent = (type, payload) => events.push({ type, payload });
  duel.sums.set(0, 777);
  duel.handle({ t: MSG.INPUT, tick: 0, checksum: 777 });
  assert.equal(duel.desync, false, 'matching fingerprints are silent');
  duel.handle({ t: MSG.INPUT, tick: 0, checksum: 1234 });
  assert.equal(duel.desync, true);
  assert.equal(events.at(-1).type, 'desync');
  assert.equal(events.at(-1).payload.tick, 0);
});

test('a fingerprint for a tick we never ran is not treated as a desync', () => {
  const duel = offlineSession();
  duel.sums.set(4, 111);
  duel.handle({ t: MSG.INPUT, tick: 900, checksum: 999 });
  assert.equal(duel.desync, false, 'no comparison is possible, so none is claimed');
});

test('the tick rate is the fixed step the sim expects', () => {
  assert.equal(TICK_SECONDS, 1 / 60);
  // Version 2 is the best-of-three series contract; peers on a different build are refused.
  assert.equal(PROTOCOL_VERSION, 2);
});

// ---------------------------------------------------------------------------
// Room server (real socket, real port)
// ---------------------------------------------------------------------------

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

/** Wait for the next message of a given type, with a timeout so a hang fails the test. */
function nextOf(socket, type, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error(`timed out waiting for ${type}`));
    }, timeout);
    function onMessage(raw) {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.t !== type) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(msg);
    }
    socket.on('message', onMessage);
  });
}

async function openClient(port, name) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const welcome = nextOf(socket, MSG.WELCOME);
  socket.send(JSON.stringify({ t: MSG.HELLO, version: PROTOCOL_VERSION, name }));
  await welcome;
  return socket;
}

test('two peers meet in a room, ready up, start, and relay input', async () => {
  const server = http.createServer();
  const duel = createDuelServer(server, { log: { info() {} } });
  const port = await listen(server);
  const host = await openClient(port, 'HOST');
  const guest = await openClient(port, 'GUEST');

  try {
    host.send(JSON.stringify({ t: MSG.CREATE, name: 'HOST' }));
    const created = await nextOf(host, MSG.ROOM);
    assert.match(created.code, /^[A-Z0-9]{4}$/);
    assert.equal(created.seat, 0, 'the creator is seat one');
    assert.equal(created.players.filter(Boolean).length, 1);

    const joinedRoom = nextOf(host, MSG.ROOM);
    guest.send(JSON.stringify({ t: MSG.JOIN, code: created.code, name: 'GUEST' }));
    const full = await joinedRoom;
    assert.equal(full.players.filter(Boolean).length, 2, 'the host sees both seats');
    const guestRoom = await nextOf(guest, MSG.ROOM);
    assert.equal(guestRoom.seat, 1, 'the joiner is seat two');
    assert.equal(guestRoom.code, created.code);

    // Crew selection, including the guard against both players running the same crew.
    guest.send(JSON.stringify({ t: MSG.TEAM, teamId: TEAMS[0].id }));
    await nextOf(host, MSG.ROOM);
    const sameCrew = nextOf(host, MSG.ERROR);
    host.send(JSON.stringify({ t: MSG.TEAM, teamId: TEAMS[0].id }));
    assert.equal((await sameCrew).code, 'TEAM_TAKEN', 'the second pilot cannot take a taken crew');

    const hostStarted = nextOf(host, MSG.START);
    const guestStarted = nextOf(guest, MSG.START);
    guest.send(JSON.stringify({ t: MSG.TEAM, teamId: TEAMS[1].id }));
    host.send(JSON.stringify({ t: MSG.TEAM, teamId: TEAMS[2].id }));
    host.send(JSON.stringify({ t: MSG.READY, ready: true }));
    guest.send(JSON.stringify({ t: MSG.READY, ready: true }));
    const a = await hostStarted;
    const b = await guestStarted;
    assert.equal(a.seed, b.seed, 'both peers get the same seed');
    assert.equal(a.home, TEAMS[2].id, 'the host runs the crew they picked');
    assert.equal(a.away, TEAMS[1].id);
    assert.equal(a.seat, 0);
    assert.equal(b.seat, 1);
    assert.equal(a.modeId, 'series');
    assert.equal(typeof a.seed, 'number');

    // Input relay, both directions.
    const guestSees = nextOf(guest, MSG.INPUT);
    host.send(JSON.stringify({ t: MSG.INPUT, tick: 7, data: packInput({ moveX: 1, shoot: true }) }));
    const relayed = await guestSees;
    assert.equal(relayed.tick, 7);
    assert.deepEqual(unpackInput(relayed.data).moveX, 1);
    assert.equal(unpackInput(relayed.data).shoot, true);

    const hostSees = nextOf(host, MSG.INPUT);
    guest.send(JSON.stringify({ t: MSG.INPUT, tick: 7, data: packInput({ moveZ: -1 }) }));
    assert.equal(unpackInput((await hostSees).data).moveZ, -1);

    // Fingerprints ride the same channel, tagged with the tick they were taken at.
    const checksumRelay = nextOf(guest, MSG.INPUT);
    host.send(JSON.stringify({ t: MSG.INPUT, tick: 42, checksum: 4242 }));
    const relayedSum = await checksumRelay;
    assert.equal(relayedSum.checksum, 4242);
    assert.equal(relayedSum.tick, 42);

    // Leaving tells the other pilot.
    const leftNotice = nextOf(host, MSG.LEAVE);
    guest.send(JSON.stringify({ t: MSG.LEAVE }));
    await leftNotice;
    assert.equal(duel.stats().rooms, 0, 'an emptied room is collected');
  } finally {
    host.close();
    guest.close();
    duel.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the server refuses a bad join and a version mismatch', async () => {
  const server = http.createServer();
  const duel = createDuelServer(server, { log: { info() {} } });
  const port = await listen(server);

  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  try {
    const mismatch = nextOf(socket, MSG.ERROR);
    socket.send(JSON.stringify({ t: MSG.HELLO, version: 999, name: 'OLD' }));
    assert.equal((await mismatch).code, 'VERSION');

    // A peer that never greeted cannot create rooms.
    socket.send(JSON.stringify({ t: MSG.CREATE }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(duel.stats().rooms, 0);
  } finally {
    socket.close();
    duel.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a series keeps the score across rounds, and a concession closes the set', async () => {
  const server = http.createServer();
  const duel = createDuelServer(server, { log: { info() {} } });
  const port = await listen(server);
  const host = await openClient(port, 'HOST');
  const guest = await openClient(port, 'GUEST');

  try {
    host.send(JSON.stringify({ t: MSG.CREATE, name: 'HOST' }));
    const created = await nextOf(host, MSG.ROOM);

    const hostSeesJoin = nextOf(host, MSG.ROOM);
    guest.send(JSON.stringify({ t: MSG.JOIN, code: created.code, name: 'GUEST' }));
    await hostSeesJoin;
    await nextOf(guest, MSG.ROOM);

    // Crews first, then ready-up: that is the order the lobby enforces.
    const hostStart = nextOf(host, MSG.START);
    const guestStart = nextOf(guest, MSG.START);
    host.send(JSON.stringify({ t: MSG.TEAM, teamId: TEAMS[2].id }));
    guest.send(JSON.stringify({ t: MSG.TEAM, teamId: TEAMS[1].id }));
    host.send(JSON.stringify({ t: MSG.READY, ready: true }));
    guest.send(JSON.stringify({ t: MSG.READY, ready: true }));
    const round1 = await hostStart;
    await guestStart;
    assert.equal(round1.round, 1);
    assert.deepEqual(round1.series.wins, [0, 0]);
    assert.equal(round1.series.over, false);

    // The host takes round one: the server folds it into the series.
    const hostTally = nextOf(host, MSG.SERIES);
    const guestTally = nextOf(guest, MSG.SERIES);
    host.send(JSON.stringify({ t: MSG.RESULT, winner: 0 }));
    const folded = await hostTally;
    await guestTally;
    assert.deepEqual(folded.series.wins, [1, 0]);
    assert.equal(folded.series.round, 1);
    assert.equal(folded.series.over, false);

    // Round two: both pilots ready up again and it starts on a fresh fixture.
    const hostRound2 = nextOf(host, MSG.START);
    const guestRound2 = nextOf(guest, MSG.START);
    host.send(JSON.stringify({ t: MSG.READY, ready: true }));
    guest.send(JSON.stringify({ t: MSG.READY, ready: true }));
    const round2 = await hostRound2;
    await guestRound2;
    assert.equal(round2.round, 2);
    assert.deepEqual(round2.series.wins, [1, 0]);
    assert.notEqual(round2.seed, round1.seed, 'every round is a different fixture');

    // The guest concedes: the set is awarded to the host and the series closes.
    const hostClose = nextOf(host, MSG.SERIES);
    const guestClose = nextOf(guest, MSG.SERIES);
    guest.send(JSON.stringify({ t: MSG.CONCEDE }));
    const closed = await hostClose;
    await guestClose;
    assert.equal(closed.series.over, true);
    assert.equal(closed.series.champion, 0);
    assert.equal(closed.series.forfeit, 1);
    assert.equal(closed.series.wins[0], 2, 'the set is 2–0, not a half-played round');
  } finally {
    host.close();
    guest.close();
    duel.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
