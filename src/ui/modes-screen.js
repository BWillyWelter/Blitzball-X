/**
 * THE MODES HUB — every way to play, in one place.
 *
 * This screen is generated from the mode registry (src/game/modes.js), so a mode is described once
 * and the menu, the rule snapshot, the lobby and the tests all read the same definition. A mode
 * owns its entry point via `launch`: the hub never carries a switch of its own, so a new mode
 * cannot ship with a card that does nothing.
 */

import { MODE_GROUPS, getMode, modesInGroup, modeFacts } from '../game/modes.js';
import { TEAMS, TEAM_BY_ID, teamOverall } from '../data/teams.js';
import {
  divisionFor,
  nextRungRating,
  rankedOpponent,
  profileSummary,
  PROMOTION_POINTS,
  applyRankedResult,
  createRankedProfile,
  rollSeason,
  seasonComplete,
} from '../game/ranked.js';
import { h, teamCard } from './screens.js';
import { OnlineDuel } from '../net/online.js';

/**
 * Where a mode goes when it is chosen. Data, not a switch: anything not named here is a normal
 * crew-pick match, which is what most modes are.
 */
const SPECIAL_ENTRY = {
  ladder: (app) => app.go('ranked'),
  gauntlet: (app) => app.go('gauntlet'),
  custom: (app) => app.go('custom'),
  watch: (app) => {
    // A watch party needs no crew choice: two house sides, both on the computer.
    const pool = app.teams?.length ? app.teams : TEAMS;
    const home = pool[Math.floor(Math.random() * pool.length)];
    const rivals = pool.filter((t) => t.id !== home.id);
    const away = rivals[Math.floor(Math.random() * rivals.length)] || pool[0];
    app.startMatch({ home, away, modeId: 'watch' });
  },
};

function launch(app, modeId) {
  const special = SPECIAL_ENTRY[modeId];
  if (special) return special(app);
  // A mode that can be played over the network opens the room lobby instead of the crew picker:
  // the lobby is where the other pilot, the room code and the series score live.
  const mode = getMode(modeId);
  if (mode.online) return app.go('lobby', { modeId });
  return app.go('teamselect', { modeId });
}

/** Escape text that came from the server before it is put into the DOM. */
function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function modeBadges(mode) {
  const out = [];
  if (mode.seats >= 2) out.push('<span class="badge duo">2 PLAYERS</span>');
  if (mode.online) out.push('<span class="badge net">ONLINE</span>');
  if (mode.ranked) out.push('<span class="badge rated">RATED</span>');
  if (mode.seats === 0) out.push('<span class="badge watch">WATCH</span>');
  if (mode.id === 'gauntlet') out.push('<span class="badge run">RUN</span>');
  return out.join('');
}

function modeCardHtml(mode) {
  const facts = modeFacts(mode.id);
  return `
    <button type="button" class="mode-card" data-mode="${mode.id}" aria-current="false">
      <div class="mc-top"><span class="mc-label">${mode.label}</span><span class="mc-badges">${modeBadges(mode)}</span></div>
      <div class="mc-tagline">${mode.tagline}</div>
      <div class="mc-blurb">${mode.blurb}</div>
      <div class="mc-facts">${facts.map((f) => `<span>${f}</span>`).join('')}</div>
    </button>`;
}

function ladderStrip(app) {
  const profile = app.state.ranked;
  if (!profile) {
    return '<div class="ladder-strip empty"><span class="ls-div">UNRATED</span><span class="ls-next">Play a Ranked Ladder match to enter the ladder</span></div>';
  }
  const summary = profileSummary(profile);
  return `<div class="ladder-strip" style="--c1:${summary.division.css}">
    <span class="ls-div">${summary.division.label}</span>
    <span class="ls-rating">${summary.rating} RR</span>
    <span class="ls-record">${summary.record}</span>
    <span class="ls-streak">${summary.streak > 0 ? `${summary.streak} WIN STREAK` : summary.streak < 0 ? `${Math.abs(summary.streak)} LOSS STREAK` : 'NO STREAK'}</span>
    <span class="ls-next">${summary.toNext} RR TO ${divisionFor(summary.nextRung).label}</span>
  </div>`;
}

export function ModesScreen(app) {
  const shelves = MODE_GROUPS.map((group) => {
    const modes = modesInGroup(group.id);
    if (!modes.length) return '';
    return `
      <section class="shelf" aria-label="${group.label}">
        <div class="shelf-head"><span class="shelf-label">${group.label}</span><span class="shelf-sub">${group.sub}</span></div>
        <div class="mode-grid">${modes.map(modeCardHtml).join('')}</div>
      </section>`;
  }).join('');

  const el = h(`
    <section class="screen modes-screen">
      <header class="screen-head">
        <h1>CHOOSE YOUR MATCH</h1>
        <div class="head-sub">Twelve ways into the pool · competitive ladder, gauntlet runs, local duels and online series</div>
      </header>
      ${ladderStrip(app)}
      <div class="mode-shelves">${shelves}</div>
      <footer class="screen-foot">
        <div class="foot-left"><span class="key">◀ ▶ ▲ ▼</span> browse <span class="key">ENTER</span> play <span class="key">ESC</span> back</div>
        <div class="foot-right"><button class="btn back-btn">BACK</button></div>
      </footer>
    </section>`);

  const cards = Array.from(el.querySelectorAll('.mode-card'));
  const scrollBox = el.querySelector('.mode-shelves');
  let idx = 0;

  const select = (n, { quiet = false } = {}) => {
    if (!cards.length) return;
    cards[idx]?.classList.remove('sel');
    cards[idx]?.setAttribute('aria-current', 'false');
    idx = Math.max(0, Math.min(cards.length - 1, n));
    cards[idx].classList.add('sel');
    cards[idx].setAttribute('aria-current', 'true');
    cards[idx].scrollIntoView?.({ block: 'nearest' });
    if (!quiet) app.audio.uiMove();
  };

  /**
   * Spatial navigation: the hub is a set of shelves whose column counts change with the viewport,
   * so "the card below this one" is a question about geometry, not about an index. Pick the
   * nearest card in the pressed direction, preferring alignment on the other axis.
   */
  const move = (dir) => {
    const current = cards[idx].getBoundingClientRect();
    const cx = current.left + current.width / 2;
    const cy = current.top + current.height / 2;
    let best = null;
    let bestScore = Infinity;
    cards.forEach((card, i) => {
      if (i === idx) return;
      const box = card.getBoundingClientRect();
      const dx = box.left + box.width / 2 - cx;
      const dy = box.top + box.height / 2 - cy;
      const forward = dir === 'left' ? dx < -8 : dir === 'right' ? dx > 8 : dir === 'up' ? dy < -8 : dy > 8;
      if (!forward) return;
      const horizontal = dir === 'left' || dir === 'right';
      const score = (horizontal ? Math.abs(dx) : Math.abs(dy)) + (horizontal ? Math.abs(dy) : Math.abs(dx)) * 2.6;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best !== null) select(best);
  };

  cards.forEach((card, i) => {
    card.addEventListener('mouseenter', () => {
      if (i !== idx) select(i);
    });
    card.addEventListener('click', () => {
      app.audio.uiConfirm();
      launch(app, card.dataset.mode);
    });
  });
  el.querySelector('.back-btn').addEventListener('click', () => app.go('title'));

  select(0, { quiet: true });
  scrollBox?.scrollTo?.({ top: 0 });

  return {
    el,
    onNav(n) {
      if (n.left) move('left');
      if (n.right) move('right');
      if (n.up) move('up');
      if (n.down) move('down');
      if (n.confirm) {
        app.audio.uiConfirm();
        launch(app, cards[idx].dataset.mode);
      }
      if (n.back) {
        app.audio.uiBack();
        app.go('title');
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Ranked ladder
// ---------------------------------------------------------------------------

export function RankedScreen(app) {
  if (!app.state.ranked) {
    app.state.ranked = createRankedProfile();
    app.save();
  }
  const profile = app.state.ranked;
  // A finished season rolls over the moment the player walks back into the ladder.
  if (seasonComplete(profile)) {
    rollSeason(profile);
    app.save();
  }
  const teamId = app.state.rankedTeamId || TEAMS[0].id;
  const opponent = rankedOpponent(profile, TEAMS, () => 0.5);
  const div = divisionFor(profile.rating);
  const next = nextRungRating(profile.rating);
  const toNext = Math.max(0, next - Math.round(profile.rating));
  const history = (profile.history || []).slice(0, 6);
  const el = h(`
    <section class="screen ranked-screen" style="--c1:${div.css}">
      <header class="screen-head">
        <h1>RANKED LADDER</h1>
        <div class="head-sub">Every match is rated · your rating moves with the result, never with the clock</div>
      </header>
      <div class="rk-body">
        <div class="rk-left">
          <div class="rk-badge">
            <span class="rk-tier">${div.label}</span>
            <span class="rk-rating">${Math.round(profile.rating)}<small>RR</small></span>
            <span class="rk-peak">PEAK ${Math.round(profile.peak || profile.rating)}</span>
          </div>
          <div class="rk-bar"><i style="width:${Math.round(div.progress * 100)}%"></i></div>
          <div class="rk-bar-label">${toNext ? `${toNext} RR to ${divisionFor(next).label}` : 'TOP OF THE LADDER'}</div>
          <div class="rk-stats">
            <div><b>${profile.wins || 0}</b><span>WINS</span></div>
            <div><b>${profile.losses || 0}</b><span>LOSSES</span></div>
            <div><b>${profile.draws || 0}</b><span>DRAWS</span></div>
            <div><b>${profile.streak || 0}</b><span>STREAK</span></div>
            <div><b>${profile.seasonPoints || 0}/${PROMOTION_POINTS}</b><span>PLACEMENT</span></div>
            <div><b>${profile.season || 1}</b><span>SEASON</span></div>
          </div>
          <div class="rk-crew">
            <div class="rk-crew-head">YOUR CREW</div>
            <div class="rk-chips">${TEAMS.map((t) => `<button type="button" class="ts-chip ${t.id === teamId ? 'sel-a' : ''}" data-id="${t.id}" style="--c1:${t.primary};--c3:${t.accent}">${t.abbr}</button>`).join('')}</div>
          </div>
        </div>
        <div class="rk-right">
          <div class="rk-next-head">NEXT CHALLENGE</div>
          ${teamCard(opponent, { cls: 'cpu' })}
          <div class="rk-vs">${(TEAM_BY_ID[teamId]?.abbr || 'YOU')} <span>vs</span> ${opponent.abbr} · OVR ${teamOverall(opponent)}</div>
          <div class="rk-history">
            <div class="rk-hist-head">RECENT</div>
            ${history.length ? history.map((m) => `<div class="rk-hist ${m.won ? 'w' : m.draw ? 'd' : 'l'}"><span>${m.won ? 'W' : m.draw ? 'D' : 'L'}</span><span>${m.opponentId || 'CPU'}</span><span>${m.delta > 0 ? '+' : ''}${m.delta}</span></div>`).join('') : '<div class="rk-hist empty">NO RATED MATCHES YET</div>'}
          </div>
          <div class="rk-board">
            <div class="rk-board-head"><span>GLOBAL BOARD</span><button type="button" class="rk-board-refresh">REFRESH</button></div>
            <ol class="rk-board-list"></ol>
            <div class="rk-board-note">LOADING…</div>
          </div>
        </div>
      </div>
      <footer class="screen-foot">
        <div class="foot-left"><span class="key">ESC</span> back</div>
        <div class="foot-right">
          <button class="btn back-btn">BACK</button>
          <button class="btn primary play-btn">PLAY RATED MATCH</button>
        </div>
      </footer>
    </section>`);

  const play = () => {
    app.audio.uiConfirm();
    app.startMatch({ home: TEAM_BY_ID[teamId], away: opponent, modeId: 'ladder' });
  };

  el.querySelectorAll('.ts-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      app.state.rankedTeamId = chip.dataset.id;
      app.save();
      app.audio.uiConfirm();
      app.go('ranked');
    });
  });
  el.querySelector('.back-btn').addEventListener('click', () => app.go('modes'));
  el.querySelector('.play-btn').addEventListener('click', play);

  // The global board: every device that finished a match reports it, so the ladder screen can
  // show where this pilot sits among all of them. It is optional — with no backend the box says
  // so instead of pretending to be empty.
  const boardList = el.querySelector('.rk-board-list');
  const boardNote = el.querySelector('.rk-board-note');
  const loadBoard = async () => {
    const api = app.cloud;
    if (!api) {
      boardNote.textContent = 'THE BOARD IS OFFLINE';
      return;
    }
    boardNote.textContent = 'LOADING…';
    const rows = await api.leaderboard();
    if (!rows.length) {
      boardList.innerHTML = '';
      boardNote.textContent = api.online ? 'NO RESULTS REPORTED YET' : 'THE BOARD IS OFFLINE';
      return;
    }
    const me = api.readDevice()?.username || '';
    boardList.innerHTML = rows.slice(0, 8).map((row, i) => `
      <li class="${row.username === me ? 'me' : ''}">
        <span class="rk-b-rank">${i + 1}</span>
        <span class="rk-b-name">${escapeText(row.username)}</span>
        <span class="rk-b-w">${row.wins || 0}W</span>
        <span class="rk-b-xp">${row.xp || 0} XP</span>
      </li>`).join('');
    boardNote.textContent = `${rows.length} PILOT${rows.length === 1 ? '' : 'S'} ON THE BOARD`;
  };
  el.querySelector('.rk-board-refresh').addEventListener('click', () => {
    app.audio.uiMove();
    loadBoard();
  });
  loadBoard();

  return {
    el,
    onNav(n) {
      if (n.confirm) play();
      else if (n.back) {
        app.audio.uiBack();
        app.go('modes');
      }
    },
  };
}

/** Apply a ranked result to the saved profile and return the human-readable swing. */
export function recordRankedResult(app, sim, userTeam) {
  if (!app.state.ranked) app.state.ranked = createRankedProfile();
  const profile = app.state.ranked;
  const before = Math.round(profile.rating);
  const beforeDiv = divisionFor(profile.rating).label;
  const draw = sim.winner === null;
  const won = sim.winner === userTeam;
  const opponent = sim.teams[1 - userTeam];
  applyRankedResult(profile, {
    won,
    draw,
    opponentId: opponent.abbr,
    opponentRating: Math.round(profile.rating + (before % 7) - 3),
    score: userTeam === 0 ? [...sim.score] : [sim.score[1], sim.score[0]],
  });
  const after = Math.round(profile.rating);
  const afterDiv = divisionFor(profile.rating).label;
  app.save();
  const delta = after - before;
  const swing = delta === 0 ? '±0' : delta > 0 ? `+${delta}` : `${delta}`;
  if (afterDiv !== beforeDiv) {
    return `${draw ? 'DRAW' : won ? 'WIN' : 'LOSS'} · ${swing} RR · PROMOTED TO ${afterDiv}`;
  }
  return `${draw ? 'DRAW' : won ? 'WIN' : 'LOSS'} · ${swing} RR · ${afterDiv}`;
}

// ---------------------------------------------------------------------------
// Custom rules
// ---------------------------------------------------------------------------

const CUSTOM_ROWS = [
  { key: 'halfLength', label: 'HALF LENGTH', options: [[45, '45s'], [90, '90s'], [150, '2:30'], [240, '4:00']] },
  { key: 'halves', label: 'PERIODS', options: [[1, 'ONE'], [2, 'TWO']] },
  { key: 'possessionClock', label: 'SHOT CLOCK', options: [[10, '10s'], [16, '16s'], [24, '24s'], [30, '30s']] },
  { key: 'targetGoals', label: 'WIN CONDITION', options: [[0, 'CLOCK'], [2, 'FIRST TO 2'], [4, 'FIRST TO 4'], [6, 'FIRST TO 6']] },
  { key: 'mercyLead', label: 'MERCY RULE', options: [[6, 'AT 6'], [9, 'AT 9'], [12, 'AT 12'], [99, 'OFF']] },
  { key: 'goalPoints', label: 'LOW RING VALUE', options: [[1, '1 PT'], [2, '2 PT']] },
  { key: 'gbPoints', label: 'GAMEBREAKER', options: [[3, '3 PT'], [4, '4 PT'], [5, '5 PT']] },
  { key: 'subsPerTeam', label: 'SUBSTITUTIONS', options: [[2, '2'], [4, '4'], [6, '6']] },
];

const DEFAULT_CUSTOM = {
  halfLength: 150,
  halves: 2,
  possessionClock: 24,
  targetGoals: 0,
  mercyLead: 12,
  goalPoints: 1,
  gbPoints: 4,
  subsPerTeam: 4,
};

export function CustomScreen(app) {
  const rules = { ...DEFAULT_CUSTOM, ...(app.state.customRules || {}) };
  const rowHtml = (row) => `
    <div class="set-row" data-key="${row.key}">
      <span class="set-label">${row.label}</span>
      <div class="set-pick">${row.options.map(([value, label]) => `<button type="button" class="pick-btn" data-value="${value}">${label}</button>`).join('')}</div>
    </div>`;
  const el = h(`
    <section class="screen custom-screen">
      <header class="screen-head"><h1>CUSTOM MATCH</h1><div class="head-sub">Set the rules, then pick the crews · everything here is enforced by the simulation</div></header>
      <div class="set-list">
        ${CUSTOM_ROWS.map(rowHtml).join('')}
        <div class="set-row" data-key="rings"><span class="set-label">SCORING RINGS</span>
          <div class="set-pick">
            <button type="button" class="pick-btn" data-value="all">ALL THREE</button>
            <button type="button" class="pick-btn" data-value="top">TOP RING ONLY</button>
            <button type="button" class="pick-btn" data-value="low">LOW RINGS ONLY</button>
          </div>
        </div>
        <div class="set-note">"First to N" counts goals, not points, so a top-ring goal and a low-ring goal both count once. A one-period match with no target can end level — there is no overtime.</div>
      </div>
      <footer class="screen-foot">
        <div class="foot-left"><span class="key">ESC</span> back</div>
        <div class="foot-right">
          <button class="btn back-btn">BACK</button>
          <button class="btn online-btn">PLAY ONLINE</button>
          <button class="btn primary play-btn">PICK CREWS</button>
        </div>
      </footer>
    </section>`);

  const paint = () => {
    el.querySelectorAll('.set-row[data-key]').forEach((row) => {
      const key = row.dataset.key;
      row.querySelectorAll('.pick-btn').forEach((btn) => {
        let on = false;
        if (key === 'rings') {
          const ids = rules.goalWindows || [0, 1, 2];
          on = btn.dataset.value === 'all' ? ids.length === 3
            : btn.dataset.value === 'top' ? ids.length === 1 && ids[0] === 0
              : ids.length === 2 && !ids.includes(0);
        } else {
          on = Number(btn.dataset.value) === Number(rules[key] ?? DEFAULT_CUSTOM[key]);
        }
        btn.classList.toggle('on', on);
      });
    });
  };
  el.querySelectorAll('.pick-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.set-row');
      const key = row.dataset.key;
      if (key === 'rings') {
        const value = btn.dataset.value;
        rules.goalWindows = value === 'top' ? [0] : value === 'low' ? [1, 2] : [0, 1, 2];
      } else {
        rules[key] = Number(btn.dataset.value);
      }
      app.audio.uiConfirm();
      paint();
    });
  });
  el.querySelector('.back-btn').addEventListener('click', () => app.go('modes'));
  el.querySelector('.play-btn').addEventListener('click', () => {
    app.state.customRules = { ...rules };
    app.save();
    app.audio.uiConfirm();
    app.go('teamselect', { modeId: 'custom' });
  });
  // The same rulebook can be played across the network: the lobby opens a room that runs it.
  el.querySelector('.online-btn').addEventListener('click', () => {
    app.state.customRules = { ...rules };
    app.save();
    app.audio.uiConfirm();
    app.go('lobby', { modeId: 'custom', customRules: { ...rules } });
  });
  paint();
  return {
    el,
    onNav(n) {
      if (n.back) {
        app.audio.uiBack();
        app.go('modes');
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Online series lobby
// ---------------------------------------------------------------------------

/**
 * The lobby doubles as the series scoreboard: after each round both pilots land back here,
 * see where the set stands, and ready up for the next one. Keeping it in one screen means the
 * room never has to be re-created between rounds.
 */
export function LobbyScreen(app, params = {}) {
  let session = app.online;
  // The room is played under a mode: the server owns the rule snapshot, so the two pools cannot
  // drift onto different rulebooks. The lobby shows which one it is hosting. Coming back from a
  // round, the session already knows the room's mode — that beats guessing "series" again.
  const known = (params.modeId || session?.modeId) && getMode(params.modeId || session?.modeId).online ? (params.modeId || session?.modeId) : null;
  const mode = getMode(params.modeId || known || 'series');
  let modeId = mode.online ? mode.id : 'series';
  const customRules = params.customRules && typeof params.customRules === 'object' ? params.customRules : null;
  const facts = modeFacts(modeId);
  const el = h(`
    <section class="screen lobby-screen">
      <header class="screen-head"><h1>${modeId === 'series' ? 'ONLINE SERIES' : `ONLINE · ${mode.label}`}</h1><div class="head-sub">Best of three · both pools run the same deterministic match · only your inputs cross the network${facts.length ? ` · ${facts.join(' · ')}` : ''}</div></header>
      <div class="lobby-body">
        <div class="lobby-left">
          <div class="lobby-status" role="status">Connecting to the duel server…</div>
          <div class="lobby-series" aria-label="Series score">
            <div class="lsb-side mine"><span class="lsb-tag">YOU</span><span class="lsb-wins you-wins">0</span></div>
            <div class="lsb-mid"><span class="lsb-round">ROUND 1</span><span class="lsb-best">BEST OF ${3}</span></div>
            <div class="lsb-side theirs"><span class="lsb-tag">THEM</span><span class="lsb-wins them-wins">0</span></div>
          </div>
          <div class="lobby-code-wrap">
            <div class="lobby-code-label">ROOM CODE</div>
            <div class="lobby-code">----</div>
            <div class="lobby-code-hint">Share this code with the other pilot</div>
          </div>
          <div class="lobby-actions">
            <button type="button" class="btn primary host-btn">OPEN A ROOM</button>
            <div class="lobby-join">
              <input class="join-input" maxlength="4" inputmode="latin" autocomplete="off" spellcheck="false" placeholder="CODE" />
              <button type="button" class="btn join-btn">JOIN</button>
            </div>
          </div>
        </div>
        <div class="lobby-right">
          <div class="lobby-seat-head">SEATS</div>
          <div class="lobby-seats">
            <div class="lobby-seat p1"><span class="ls-name">WAITING</span><span class="ls-state">—</span></div>
            <div class="lobby-seat p2"><span class="ls-name">WAITING</span><span class="ls-state">—</span></div>
          </div>
          <div class="lobby-seat-head">YOUR CREW</div>
          <div class="ts-grid lobby-chips">${TEAMS.map((t) => `<button class="ts-chip" data-id="${t.id}" style="--c1:${t.primary};--c3:${t.accent}">${t.abbr}</button>`).join('')}</div>
          <button type="button" class="btn ready-btn" disabled>READY UP</button>
          <div class="lobby-note">The host is seat one. Ready up once you have picked a crew — the first round starts as soon as both pilots are ready, and every round after it needs a fresh ready.</div>
        </div>
      </div>
      <footer class="screen-foot"><div class="foot-left"><span class="key">ESC</span> leave</div><div class="foot-right"><button class="btn back-btn">BACK</button></div></footer>
    </section>`);

  const statusEl = el.querySelector('.lobby-status');
  const titleEl = el.querySelector('.screen-head h1');
  const codeEl = el.querySelector('.lobby-code');
  const joinInput = el.querySelector('.join-input');
  const readyBtn = el.querySelector('.ready-btn');
  const hostBtn = el.querySelector('.host-btn');
  const seatEls = [el.querySelector('.lobby-seat.p1'), el.querySelector('.lobby-seat.p2')];
  const chips = Array.from(el.querySelectorAll('.ts-chip'));
  const winsEls = [el.querySelector('.you-wins'), el.querySelector('.them-wins')];
  const roundEl = el.querySelector('.lsb-round');
  const bestEl = el.querySelector('.lsb-best');

  const setStatus = (text, kind = '') => {
    statusEl.textContent = text;
    statusEl.className = `lobby-status ${kind}`.trim();
  };

  /** Paint the series from the server's tally, from this pilot's point of view. */
  const paintSeries = (series) => {
    const mySeat = session?.seat ?? 0;
    const wins = series?.wins || [0, 0];
    winsEls[0].textContent = String(wins[mySeat] || 0);
    winsEls[1].textContent = String(wins[1 - mySeat] || 0);
    roundEl.textContent = series?.over ? 'SERIES OVER' : `ROUND ${series?.round || 1}`;
    bestEl.textContent = `BEST OF ${series?.bestOf || 3}`;
    el.querySelector('.lobby-series').classList.toggle('over', !!series?.over);
    el.querySelector('.lobby-series').classList.toggle('won', !!series?.over && series.champion === mySeat);
  };

  // Whether both seats are filled decides whether the ready button can be pressed at all. It is
  // tracked here rather than read off the DOM so a repaint cannot lock the button by accident.
  let bothSeated = false;

  const paintPlayers = (players = []) => {
    seatEls.forEach((seatEl, i) => {
      const p = players[i];
      seatEl.classList.toggle('taken', !!p);
      seatEl.classList.toggle('mine', !!p && p.seat === (session?.seat ?? -1));
      seatEl.querySelector('.ls-name').textContent = p ? `${p.name || 'PILOT'}${p.seat === 0 ? ' (HOST)' : ''}` : 'WAITING';
      seatEl.querySelector('.ls-state').textContent = p ? (p.ready ? 'READY' : p.teamId ? TEAM_BY_ID[p.teamId]?.abbr || 'CREW' : 'PICKING CREW') : '—';
    });
    bothSeated = players.filter(Boolean).length === 2;
    readyBtn.disabled = !bothSeated && !session?.ready;
  };

  const paintReady = (ready) => {
    readyBtn.textContent = ready ? 'CANCEL READY' : 'READY UP';
    readyBtn.classList.toggle('on', !!ready);
    readyBtn.disabled = !bothSeated && !ready;
  };

  const paint = (payload = {}) => {
    if (payload.code) {
      codeEl.textContent = payload.code;
      codeEl.classList.add('live');
    }
    if (payload.players) paintPlayers(payload.players);
    if (payload.series) paintSeries(payload.series);
    if (session) {
      for (const chip of chips) chip.classList.toggle('sel-a', chip.dataset.id === session.myTeam);
    }
    paintReady(!!payload.ready);
  };

  const wireSession = () => {
    if (!session) return;
    session.onEvent = (type, payload = {}) => {
      if (app.online !== session) return;
      switch (type) {
        case 'open':
          setStatus('Connected. Open a room or join one.', 'ok');
          hostBtn.disabled = false;
          break;
        case 'room': {
          const both = (payload.players || []).filter(Boolean).length === 2;
          const round = payload.series?.round || 1;
          // A guest learns the room's mode from the server; the header has to follow it.
          if (payload.modeId && payload.modeId !== modeId) {
            modeId = payload.modeId;
            const roomMode = getMode(modeId);
            titleEl.textContent = modeId === 'series' ? 'ONLINE SERIES' : `ONLINE · ${roomMode.label}`;
          }
          if (payload.series?.over) setStatus('Series complete. Ready up to run it back.', 'ok');
          else setStatus(both ? `Both pilots in. Ready up for round ${round}.` : 'Room open. Waiting for the other pilot…', 'ok');
          paint(payload);
          break;
        }
        case 'start':
          app.startOnlineMatch(payload);
          break;
        case 'series': {
          paintSeries(payload.series);
          const series = payload.series;
          if (series?.over) {
            const mine = series.champion === (session.seat ?? 0);
            setStatus(series.forfeit === (session.seat ?? 0)
              ? 'You conceded the series.'
              : series.forfeit !== null && series.forfeit !== undefined
                ? 'The other pilot conceded. Series won.'
                : mine ? 'Series won. Ready up to defend it.' : 'Series lost. Ready up for a rematch.', mine ? 'ok' : 'bad');
          } else {
            setStatus(`Round ${series?.round || 1} complete · ready up for the next one.`, 'ok');
          }
          paint({ series });
          break;
        }
        case 'opponent-left':
          setStatus('The other pilot left the room.', 'bad');
          paint({ players: [], ready: false });
          break;
        case 'stall':
          setStatus('Waiting for the other pilot’s inputs…', 'warn');
          break;
        case 'desync':
          setStatus('The two pools have drifted apart — the series will be abandoned.', 'bad');
          break;
        case 'error':
          setStatus(payload.message || 'Duel server error.', 'bad');
          break;
        case 'close':
          setStatus('Disconnected from the duel server.', 'bad');
          break;
        default:
          break;
      }
    };
  };

  const ensureSession = async () => {
    if (session && (session.state === 'idle' || session.state === 'room' || session.state === 'live')) return true;
    session = new OnlineDuel({ name: app.state.playerName || 'PILOT' });
    app.online = session;
    wireSession();
    const ok = await session.connect();
    if (!ok) setStatus(session.error || 'Could not reach the duel server.', 'bad');
    return ok;
  };

  hostBtn.disabled = true;
  hostBtn.addEventListener('click', async () => {
    if (!(await ensureSession())) return;
    app.audio.uiConfirm();
    session.createRoom({ modeId, customRules, difficulty: app.state.settings.difficulty });
  });

  el.querySelector('.join-btn').addEventListener('click', async () => {
    if (!(await ensureSession())) return;
    const code = joinInput.value.trim().toUpperCase();
    if (code.length !== 4) {
      setStatus('Room codes are four letters or digits.', 'bad');
      return;
    }
    app.audio.uiConfirm();
    session.joinRoom(code);
  });
  joinInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') el.querySelector('.join-btn').click();
  });

  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      if (!session) return;
      app.audio.uiConfirm();
      session.myTeam = chip.dataset.id;
      session.pickTeam(chip.dataset.id);
      session.setReady(false);
      for (const other of chips) other.classList.toggle('sel-a', other === chip);
      paintReady(false);
    });
  });

  readyBtn.addEventListener('click', () => {
    if (!session) return;
    app.audio.uiConfirm();
    session.ready = !session.ready;
    session.setReady(session.ready);
    paintReady(session.ready);
    if (session.ready) setStatus('Ready. Waiting for the other pilot…', 'ok');
  });

  const leave = () => {
    session?.leave();
    app.online = null;
    app.go('modes');
  };
  el.querySelector('.back-btn').addEventListener('click', leave);

  // A session that survived a results screen reconnects to this screen instead of going stale.
  if (session && session.state === 'room') {
    paint({ code: session.code, players: session.players, ready: session.ready, series: session.series });
    setStatus(session.series?.over
      ? 'Series complete. Ready up to run it back.'
      : session.series?.round > 1
        ? `Round ${session.series.round} next. Ready up when you are.`
        : 'Still in a room. Waiting for the other pilot…', 'ok');
    wireSession();
  } else {
    ensureSession();
    paintSeries(session?.series || { wins: [0, 0], round: 1, bestOf: 3 });
  }

  return { el, onNav: (n) => n.back && leave() };
}
