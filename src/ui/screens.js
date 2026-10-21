import { TEAMS, TEAM_BY_ID, playerOverall, teamOverall, starters } from '../data/teams.js';
import { moveFor } from '../game/moves.js';
import { DIFFICULTY } from '../data/constants.js';
import { DEFAULT_MODE, getMode } from '../game/modes.js';
import { starMarkup } from '../game/trials.js';
import {
  currentOpponent,
  careerTitle,
  careerTeam,
  fixtureFor,
  squadCards,
  squadFor,
  squadOverall,
  moraleOf,
  MORALE_LABELS,
  rivalryOf,
} from '../game/career.js';
import { RecapPanel } from './recap.js';
// Single source of truth for the build number: the release workflow already refuses to publish a
// tag that disagrees with this file, and the title screen used to advertise a hardcoded "v1.0"
// that silently drifted every release.
import { version } from '../../package.json';

/**
 * DOM screens. Each screen is a function(app) → { el, onNav(navInput), destroy }.
 * Menus support mouse and keyboard/gamepad navigation.
 */

export const h = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

export function teamCard(team, opts = {}) {
  const ovr = teamOverall(team);
  const stars = team.roster.slice(0, 3).map((p) => `<li><span class="nick">${p.nick}</span><span class="pname">${p.name}</span><span class="ovr">${playerOverall(p)}</span></li>`).join('');
  return `
    <div class="team-card ${opts.cls || ''}" style="--c1:${team.primary};--c2:${team.secondary};--c3:${team.accent}" data-id="${team.id}">
      <div class="tc-head">
        <div class="tc-abbr">${team.abbr}</div>
        <div class="tc-names"><div class="tc-city">${team.city}</div><div class="tc-name">${team.name}</div></div>
        <div class="tc-ovr"><span>OVR</span>${ovr}</div>
      </div>
      <div class="tc-motto">“${team.motto}”</div>
      <ul class="tc-roster">${stars}</ul>
    </div>`;
}

export function menuList(items) {
  return `<div class="menu" role="group">${items.map((it, i) => `<button type="button" class="menu-item ${i === 0 ? 'sel' : ''}" data-action="${it.action}" ${it.disabled ? 'data-disabled="1" disabled aria-disabled="true"' : ''} aria-current="${i === 0 ? 'true' : 'false'}"><span class="mi-label">${it.label}</span>${it.sub ? `<span class="mi-sub">${it.sub}</span>` : ''}</button>`).join('')}</div>`;
}

export function wireMenu(root, onSelect, app) {
  const items = Array.from(root.querySelectorAll('.menu-item'));
  let idx = items.findIndex((i) => i.classList.contains('sel'));
  if (idx < 0) idx = 0;
  const setSel = (n) => {
    items[idx]?.classList.remove('sel');
    items[idx]?.setAttribute('aria-current', 'false');
    idx = (n + items.length) % items.length;
    items[idx].classList.add('sel');
    items[idx].setAttribute('aria-current', 'true');
    items[idx].focus({ preventScroll: true });
    app.audio.uiMove();
  };
  items.forEach((el, i) => {
    el.addEventListener('mouseenter', () => {
      if (i !== idx) {
        items[idx]?.classList.remove('sel');
        items[idx]?.setAttribute('aria-current', 'false');
        idx = i;
        el.classList.add('sel');
        el.setAttribute('aria-current', 'true');
      }
    });
    el.addEventListener('click', () => {
      if (el.dataset.disabled) return;
      app.audio.uiConfirm();
      onSelect(el.dataset.action, el);
    });
  });
  return {
    nav(n) {
      if (n.up) setSel(idx - 1);
      if (n.down) setSel(idx + 1);
      if (n.confirm) {
        const el = items[idx];
        if (el && !el.dataset.disabled) {
          app.audio.uiConfirm();
          onSelect(el.dataset.action, el);
        }
      }
    },
    get index() {
      return idx;
    },
  };
}

// ---------------------------------------------------------------------------
// Title
// ---------------------------------------------------------------------------

export function TitleScreen(app) {
  const hasCareer = !!app.state.career;
  const el = h(`
    <section class="screen title-screen">
      <div class="title-bg"></div>
      <div class="title-graffiti">
        <div class="logo-wrap">
          <div class="logo-blitz">BLITZBALL</div>
          <div class="logo-x">X</div>
        </div>
        <div class="tagline">UNDERWATER 3-ON-3 · TWO HALVES · NO REFS</div>
      </div>
      <div class="title-menu">
        ${menuList([
          { action: 'play', label: 'PLAY', sub: 'Twelve modes · ranked ladder · gauntlet runs · online series' },
          { action: 'career', label: hasCareer ? 'CONTINUE RUNNING THE POOLS' : 'RUN THE POOLS', sub: hasCareer ? `${careerTitle(app.state.career)} · ${app.state.career.wins}W ${app.state.career.losses}L` : 'Career ladder · 7 crews' },
          { action: 'howto', label: 'HOW TO PLAY' },
          { action: 'settings', label: 'SETTINGS' },
          { action: 'quit', label: 'QUIT', sub: 'Exit Blitzball-X' },
        ])}
      </div>
      <div class="title-foot"><span>${app.state.records.wins}W – ${app.state.records.losses}L</span><span>BEST STYLE ${app.state.records.styleBest}</span><span>v${version}</span></div>
    </section>`);
  const menu = wireMenu(el, (action) => {
    if (action === 'play') app.go('modes');
    else if (action === 'career') app.go(hasCareer ? 'career' : 'teamselect', { modeId: 'career' });
    else if (action === 'howto') app.go('howto');
    else if (action === 'settings') app.go('settings');
    else if (action === 'quit') app.requestQuit();
  }, app);
  return { el, onNav: (n) => menu.nav(n) };
}

// ---------------------------------------------------------------------------
// Team select
// ---------------------------------------------------------------------------

export function TeamSelectScreen(app, params) {
  const modeId = params.modeId || (params.mode === 'career' ? 'career' : DEFAULT_MODE);
  const mode = getMode(modeId);
  const career = modeId === 'career';
  const duel = mode.seats >= 2;
  let side = 0; // 0 = left card (P1 / you), 1 = right card (P2 / CPU)
  let picks = [0, 1];
  const headline = career ? 'PICK YOUR CREW' : duel ? 'PICK BOTH CREWS' : 'PICK YOUR CREW';
  const sub = career
    ? 'You run with them all the way to the top.'
    : `${mode.label} · ${mode.tagline}`;
  const el = h(`
    <section class="screen teamselect">
      <header class="screen-head"><h1>${headline}</h1><div class="head-sub">${sub}</div></header>
      <div class="ts-body">
        <div class="ts-side ts-left"><div class="ts-label">${duel ? 'PLAYER 1' : 'YOU'}</div><div class="ts-card"></div></div>
        <div class="ts-vs">VS</div>
        <div class="ts-side ts-right"><div class="ts-label">${duel ? 'PLAYER 2' : career ? 'FIRST OPPONENT' : 'CPU'}</div><div class="ts-card"></div></div>
      </div>
      ${career ? `<div class="player-build"><label>PLAYER NAME <input class="player-name" maxlength="18" value="Rookie" /></label><label>STYLE <select class="player-style"><option value="ALLROUND">ALL-AROUND</option><option value="FINISHER">FINISHER</option><option value="SNIPER">SNIPER</option><option value="HANDLER">HANDLER</option><option value="ENFORCER">ENFORCER</option></select></label><span>BUILD ONE SWIMMER · LEVEL UP · UNLOCK GEAR</span></div>` : ''}
      <div class="ts-grid">${TEAMS.map((t, i) => `<button class="ts-chip" data-i="${i}" style="--c1:${t.primary};--c3:${t.accent}">${t.abbr}</button>`).join('')}</div>
      <footer class="screen-foot">
        <div class="foot-left"><span class="key">◀ ▶</span> browse <span class="key">▲ ▼</span> switch side <span class="key">ENTER</span> ${duel ? 'start the duel' : 'lock in'} <span class="key">ESC</span> back</div>
        <div class="foot-right">
          ${duel ? '<span class="ts-duel-note">NO DIFFICULTY · BOTH SIDES ARE HUMAN</span>' : `<label>DIFFICULTY <select class="diff-sel">${Object.entries(DIFFICULTY).map(([k, v]) => `<option value="${k}" ${app.state.settings.difficulty === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>`}
          <button class="btn primary start-btn">${career ? 'START THE RUN' : duel ? 'START THE DUEL' : 'DIVE IN'}</button>
        </div>
      </footer>
    </section>`);
  const cards = [el.querySelector('.ts-left .ts-card'), el.querySelector('.ts-right .ts-card')];
  const sides = [el.querySelector('.ts-left'), el.querySelector('.ts-right')];
  const chips = Array.from(el.querySelectorAll('.ts-chip'));
  const render = () => {
    if (career) {
      const oppLadder = TEAMS.filter((t) => t.id !== TEAMS[picks[0]].id).sort((a, b) => teamOverall(a) - teamOverall(b));
      picks[1] = TEAMS.indexOf(oppLadder[0]);
    }
    cards[0].innerHTML = teamCard(TEAMS[picks[0]]);
    cards[1].innerHTML = teamCard(TEAMS[picks[1]], { cls: 'cpu' });
    sides.forEach((s, i) => s.classList.toggle('active', i === side));
    chips.forEach((c, i) => {
      c.classList.toggle('sel-a', i === picks[0]);
      c.classList.toggle('sel-b', i === picks[1]);
    });
  };
  const cycle = (dir) => {
    let n = picks[side];
    do n = (n + dir + TEAMS.length) % TEAMS.length;
    while (n === picks[1 - side]);
    picks[side] = n;
    app.audio.uiMove();
    render();
  };
  chips.forEach((c) =>
    c.addEventListener('click', () => {
      const i = parseInt(c.dataset.i, 10);
      if (i === picks[1 - side]) return;
      picks[side] = i;
      app.audio.uiMove();
      render();
    }),
  );
  sides.forEach((s, i) =>
    s.addEventListener('click', () => {
      if (career && i === 1) return;
      side = i;
      render();
    }),
  );
  const back = () => {
    app.audio.uiBack();
    app.go(career ? 'title' : 'modes');
  };
  const start = () => {
    app.audio.uiConfirm();
    const diffSel = el.querySelector('.diff-sel');
    if (diffSel) {
      app.state.settings.difficulty = diffSel.value;
      app.save();
    }
    const home = TEAMS[picks[0]];
    const away = TEAMS[picks[1]];
    if (career) {
      app.startCareer(home.id, { name: el.querySelector('.player-name').value, archetype: el.querySelector('.player-style').value });
      return;
    }
    app.startMatch({
      home,
      away,
      modeId,
      seats: duel ? [0, 1] : mode.seats <= 0 ? [] : [0],
      rules: modeId === 'custom' ? app.state.customRules : null,
    });
  };
  el.querySelector('.start-btn').addEventListener('click', start);
  el.querySelector('.diff-sel')?.addEventListener('change', (e) => {
    app.state.settings.difficulty = e.target.value;
    app.save();
  });
  render();
  return {
    el,
    onNav(n) {
      if (n.left) cycle(-1);
      if (n.right) cycle(1);
      if ((n.up || n.down) && !career) {
        side = 1 - side;
        app.audio.uiMove();
        render();
      }
      if (n.confirm) start();
      if (n.back) back();
    },
  };
}

// ---------------------------------------------------------------------------
// Career hub
// ---------------------------------------------------------------------------

export function CareerScreen(app) {
  const c = app.state.career;
  const team = TEAM_BY_ID[c.teamId];
  const opp = currentOpponent(c);
  const fx = fixtureFor(c);
  const morale = moraleOf(c);
  const cards = squadCards(c);
  const fit = cards.filter((x) => x.slot >= 0);
  const out = cards.filter((x) => x.injured);
  const rivals = opp ? rivalryOf(c, opp.id) : null;
  const ladder = c.ladder
    .map((id, i) => {
      const t = TEAM_BY_ID[id];
      const st = i < c.stage ? 'done' : i === c.stage ? 'now' : 'locked';
      const rv = rivalryOf(c, id);
      const tag = rv.met ? `<span class="li-rival">${rv.met > 1 ? `RIVAL ${rv.won}-${rv.lost}` : `${rv.won ? 'BEAT' : 'LOST TO'}`}</span>` : '';
      return `<li class="ladder-item ${st}" style="--c1:${t.primary};--c3:${t.accent}"><span class="li-n">${i + 1}</span><span class="li-abbr">${t.abbr}</span><span class="li-name">${t.city} ${t.name}</span>${tag}<span class="li-ovr">OVR ${teamOverall(t)}</span><span class="li-state">${st === 'done' ? 'BEAT' : st === 'now' ? 'NEXT' : ''}</span></li>`;
    })
    .join('');
  const seven = fit
    .sort((a, b) => a.slot - b.slot)
    .map((x) => `<span class="sq-chip ${x.you ? 'you' : ''}" style="--c1:${team.primary};--c3:${team.accent}"><b>${x.data.nick}</b><i>${x.data.role}</i></span>`)
    .join('');
  // Whoever is carrying a knock is not in the seven, so name them rather than let them vanish.
  const hurt = out
    .map((x) => `<span class="sq-chip hurt"><b>${x.data.nick}</b><i>OUT ${c.injuries[x.data.id]}</i></span>`)
    .join('');
  const el = h(`
    <section class="screen career" style="--c1:${team.primary};--c2:${team.secondary};--c3:${team.accent}">
      <header class="screen-head"><h1>${c.player.name.toUpperCase()}</h1><div class="head-sub">LV ${c.player.level} · ${c.player.archetype} · ${team.city} ${team.name} · ${careerTitle(c)} · XP ${c.player.xp} · ${c.wins}W ${c.losses}L · FORM <b class="form-${morale > 0 ? 'up' : morale < 0 ? 'down' : 'flat'}">${MORALE_LABELS[String(morale)]}</b></div></header>
      <div class="career-body">
        <div class="career-left">
          <div class="career-next">
            <div class="cn-title">${c.player.gear.length ? `GEAR: ${c.player.gear.join(' · ')}` : 'NO GEAR UNLOCKED'}</div>
            <div class="cn-sub">${c.player.items.length ? `SPECIAL ITEMS: ${c.player.items.join(' · ')}` : 'SPECIAL ITEMS: LOCKED'}</div>
            ${c.complete ? `<div class="cn-title">YOU RUN THIS CITY</div><div class="cn-sub">Every crew beaten. Legend difficulty unlocked.</div>` : `<div class="cn-title">NEXT UP · ${fx && fx.atHome ? 'HOME WATER' : 'AWAY TRIP'}</div>${teamCard(opp, { cls: 'cpu' })}<div class="cn-court">${fx && fx.atHome ? `${team.city.toUpperCase()} SPHERE · YOUR CAGE` : `@ ${opp.city.toUpperCase()} · THEIR SPHERE`}</div>${rivals && rivals.repeat ? `<div class="cn-rival">RIVALRY · ${rivals.won}–${rivals.lost} OVER ${rivals.met} MEETINGS</div>` : ''}`}
          </div>
          <div class="squad-strip">
            <div class="ss-head">STARTING SEVEN · CREW OVR <b>${squadOverall(c)}</b>${out.length ? ` · <b class="ss-out">${out.length} INJURED</b>` : ''}</div>
            <div class="ss-chips">${seven}${hurt}</div>
          </div>
          ${menuList([
            ...(c.complete ? [] : [{ action: 'play', label: 'PLAY NEXT GAME', sub: `${DIFFICULTY[c.difficulty].label} · ${fx && fx.atHome ? 'home' : 'away'}` }]),
            { action: 'squad', label: 'PICK THE SEVEN', sub: 'Starters, keeper and injuries' },
            { action: 'roster', label: 'FULL ROSTER' },
            { action: 'abandon', label: 'ABANDON RUN', sub: 'Deletes career progress' },
            { action: 'back', label: 'BACK' },
          ])}
        </div>
        <div class="career-right"><div class="ladder-title">THE LADDER</div><ol class="ladder">${ladder}</ol></div>
      </div>
    </section>`);
  const menu = wireMenu(el, (action) => {
    if (action === 'play') app.startMatch({ mode: 'career' });
    else if (action === 'squad') app.go('squad');
    else if (action === 'roster') app.go('roster', { teamId: team.id, back: 'career' });
    else if (action === 'abandon') {
      if (confirm('Abandon this run? Progress will be deleted.')) {
        app.state.career = null;
        app.save();
        app.go('title');
      }
    } else if (action === 'back') app.go('title');
  }, app);
  return {
    el,
    onNav(n) {
      menu.nav(n);
      if (n.back) app.go('title');
    },
  };
}

// ---------------------------------------------------------------------------
// Squad selection (career)
// ---------------------------------------------------------------------------

const SLOT_ROLES = ['GK', 'SH', 'SH', 'FD', 'FD', 'FD', 'FD'];

/**
 * Name the seven. The slot roles are fixed (keeper, two shooters, four fielders) because the sim
 * reads them, so picking is a swap inside a role: tap a swimmer and he takes the weakest slot his
 * role owns. Injured swimmers are shown out and cannot be named — that is what the week off is for.
 */
export function SquadScreen(app) {
  const c = app.state.career;
  const team = careerTeam(c) || TEAM_BY_ID[c.teamId];
  const cards = squadCards(c);
  const byId = new Map(cards.map((x) => [x.data.id, x]));
  let squad = squadFor(c).slice();
  let idx = 0;

  const cardHtml = (x, i) => {
    const p = x.data;
    const slot = squad.indexOf(p.id);
    const cls = ['squad-card'];
    if (slot >= 0) cls.push('in');
    if (x.injured) cls.push('hurt');
    if (x.you) cls.push('you');
    if (i === idx) cls.push('sel');
    return `<button type="button" class="${cls.join(' ')}" data-id="${p.id}"${x.injured ? ' disabled' : ''}>
      <span class="sc-slot">${slot >= 0 ? SLOT_ROLES[slot] : 'BENCH'}</span>
      <span class="sc-nick">${p.nick}</span>
      <span class="sc-name">${p.name}</span>
      <span class="sc-meta">${p.archetype} · OVR ${playerOverall(p)}</span>
      ${x.you ? '<span class="sc-tag you-tag">YOU</span>' : ''}
      ${x.injured ? `<span class="sc-tag hurt-tag">OUT ${c.injuries[p.id]}</span>` : ''}
    </button>`;
  };

  const el = h(`
    <section class="screen squad" style="--c1:${team.primary};--c2:${team.secondary};--c3:${team.accent}">
      <header class="screen-head"><h1>PICK THE SEVEN</h1><div class="head-sub">${team.city} ${team.name} · CREW OVR <b class="sq-ovr">0</b> · TAP A SWIMMER TO NAME HIM IN HIS SLOT</div></header>
      <div class="sq-slots"></div>
      <div class="squad-grid"></div>
      <footer class="screen-foot">
        <div class="foot-left"><span class="key">◀ ▶</span> browse <span class="key">ENTER</span> name him <span class="key">ESC</span> back</div>
        <div class="foot-right"><button class="btn auto-btn">BEST AVAILABLE</button><button class="btn primary play-btn">PLAY NEXT GAME</button></div>
      </footer>
    </section>`);
  const grid = el.querySelector('.squad-grid');
  const slotsEl = el.querySelector('.sq-slots');

  /** Name `id`: he takes the weakest slot his role owns. False when he cannot be named. */
  const name = (id) => {
    const x = byId.get(id);
    if (!x || x.injured) return false;
    const role = x.data.role;
    if (squad.includes(id)) return false;
    const slots = SLOT_ROLES.map((r, i) => (r === role ? i : -1)).filter((i) => i >= 0);
    if (!slots.length) return false;
    // Weakest incumbent of that role — your own swimmer is never the weakest, so he always swims.
    let target = slots[0];
    for (const i of slots) {
      const inc = byId.get(squad[i]);
      if (inc && inc.you) continue;
      if (inc && playerOverall(inc.data) > playerOverall(byId.get(squad[target]).data)) continue;
      target = i;
    }
    squad[target] = id;
    c.squad = squad.slice();
    app.save();
    return true;
  };

  const render = () => {
    grid.innerHTML = cards.map((x, i) => cardHtml(x, i)).join('');
    el.querySelector('.sq-ovr').textContent = String(squadOverall({ ...c, squad }));
    slotsEl.innerHTML = SLOT_ROLES.map((role, i) => {
      const x = byId.get(squad[i]);
      if (!x) return `<div class="sq-slot empty"><b>${role}</b><span>—</span></div>`;
      return `<div class="sq-slot ${x.you ? 'you' : ''}"><b>${role}</b><span>${x.data.nick}</span><i>${playerOverall(x.data)}</i></div>`;
    }).join('');
  };

  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.squad-card');
    if (!btn || btn.disabled) return;
    app.audio[name(btn.dataset.id) ? 'uiConfirm' : 'uiBack']();
    render();
  });
  el.querySelector('.auto-btn').addEventListener('click', () => {
    squad = squadFor({ ...c, squad: null });
    c.squad = squad.slice();
    app.audio.uiConfirm();
    app.save();
    render();
  });
  el.querySelector('.play-btn').addEventListener('click', () => {
    app.audio.uiConfirm();
    app.startMatch({ mode: 'career' });
  });

  render();
  return {
    el,
    onNav(n) {
      if (n.left) idx = (idx - 1 + cards.length) % cards.length;
      if (n.right) idx = (idx + 1) % cards.length;
      if (n.up) idx = Math.max(0, idx - 4);
      if (n.down) idx = Math.min(cards.length - 1, idx + 4);
      if (n.confirm) {
        app.audio[name(cards[idx].data.id) ? 'uiConfirm' : 'uiBack']();
        render();
      }
      if (n.back) app.go('career');
      else render();
    },
  };
}

// ---------------------------------------------------------------------------
// Roster viewer
// ---------------------------------------------------------------------------

export function RosterScreen(app, params) {
  const team = TEAM_BY_ID[params.teamId];
  const KEYS = { spd: 'SPD', sht: 'SHT', hnd: 'HND', pas: 'PAS', tkl: 'TKL', pow: 'POW', end: 'END', cat: 'CAT', blk: 'BLK' };
  const bars = (p) => (p.role === 'GK' ? ['spd', 'cat', 'blk', 'pow', 'pas', 'end'] : ['spd', 'sht', 'hnd', 'pas', 'tkl', 'pow', 'end']).map((k) => `<div class="stat"><span class="stat-k">${KEYS[k]}</span><div class="stat-bar"><div style="width:${p[k]}%"></div></div><span class="stat-v">${p[k]}</span></div>`).join('');
  const el = h(`
    <section class="screen roster" style="--c1:${team.primary};--c2:${team.secondary};--c3:${team.accent}">
      <header class="screen-head"><h1>${team.city.toUpperCase()} ${team.name.toUpperCase()}</h1><div class="head-sub">“${team.motto}” · OVR ${teamOverall(team)}</div></header>
      <div class="roster-grid">
        ${[...starters(team), ...team.roster.filter((p) => !starters(team).includes(p))].map((p, i) => `<div class="pcard-big ${i < 7 ? 'starter' : 'sub'}"><div class="pb-num">#${p.number}</div><div class="pb-nick">${p.nick}</div><div class="pb-name">${p.name}</div><div class="pb-arch">${p.archetype} · OVR ${playerOverall(p)}</div><div class="pb-sig">MOVE: ${moveFor(p).name}<br>GB: ${p.signature}</div><div class="pb-stats">${bars(p)}</div></div>`).join('')}
      </div>
      <footer class="screen-foot"><button class="btn back-btn">BACK</button></footer>
    </section>`);
  el.querySelector('.back-btn').addEventListener('click', () => app.go(params.back || 'title'));
  return { el, onNav: (n) => (n.back || n.confirm) && app.go(params.back || 'title') };
}

// ---------------------------------------------------------------------------
// How to play
// ---------------------------------------------------------------------------

export function HowToScreen(app) {
  const el = h(`
    <section class="screen howto">
      <header class="screen-head"><h1>HOW TO PLAY</h1><div class="head-sub">Pool rules. Style wins matches.</div></header>
      <div class="howto-cols">
        <div class="howto-col">
          <h2>RULES</h2>
          <ul>
            <li><b>7-a-side underwater rugby</b> (11-swimmer crews) inside a sphere of water: <b>1 keeper</b> guards the zone, <b>4 fielders</b> move the ball, <b>2 shooters</b> — the <b>captains</b> — score it. On defense, fielders mirror the enemy shooters as stoppers. Two halves of 2:30; level at full time = <b>golden-goal overtime</b>.</li>
            <li>Every match opens with <b>warm-up laps</b>, then the ref brings both captains to centre for the <b>TIP-OFF</b> — first swimmer to the dropped ball takes possession.</li>
            <li><b>The touchdown zone is three rings in a triangle.</b> Through the <b>orange TOP RING = 3 points</b>; the <b>blue</b> and <b>white</b> low rings are <b>1 point</b> each. Rise as you release to go top-ring hunting.</li>
            <li><b>20-second possession clock.</b> Shoot before it runs out or the ball goes over.</li>
            <li><b>Keepers</b> guard the zone and must release the ball within 4 seconds.</li>
            <li><b>Mercy rule.</b> Go up by 12 in the second half and it's over.</li>
          </ul>
          <h2>SIGNATURE MOVES</h2>
          <ul>
            <li>Every swimmer owns a move — check the roster screen. With the ball, <b>L</b> plays it.</li>
            <li>They are not interchangeable. <b>TEMPEST SPIN</b> only beats a defender staring at you, <b>GHOST FEINT</b> punishes one who has already committed, <b>TSUNAMI SLAM</b> knocks anyone in front of you down, and <b>TIDAL KICK</b> or <b>SINKER</b> goes over/under the challenge entirely — you are untackleable while you're off the plane.</li>
            <li><b>Moves change the match.</b> A move that beats its man drops that defender's stats for a few seconds (TKL, SPD or HND), and some moves also boost your own swimmer. The bigger commitments (<b>DEEP SPIRAL</b>, <b>UNDERCURRENT</b>, <b>TSUNAMI SLAM</b>) leave you wide open if they miss.</li>
          </ul>
          <h2>STYLE &amp; FLOW</h2>
          <ul>
            <li>Dribble past tacklers, land slide tackles, big hits and perfect shots to earn <b>Style</b>.</li>
            <li>Chain moves for a <b>combo multiplier</b>. Turnovers drain it.</li>
            <li>Combo <b>×3</b> while attacking and your striker enters <b>FLOW</b>: ~10 seconds of faster swimming, unpokeable dribbling and far sharper shooting. This is your hero window — use it.</li>
            <li>Fill the meter and press <b>E</b> (or SHOOT — the button lights up) with the ball to unleash a <b>GAMEBREAKER</b>: an unstoppable signature shot through the <b>top ring</b> worth <b>4 points that also takes 2 off their score</b>.</li>
            <li>Two straight goals and your crew is <b>ON FIRE</b>: sharper shooting, harder to tackle.</li>
          </ul>
          <h2>REMATCH-STYLE CONTROL</h2>
          <ul>
            <li>You always pilot <b>one swimmer</b>. The ball stays in their hand — shield it, spin off pressure, drive the lane.</li>
            <li><b>Aim shots</b> by holding a direction as you release: steer toward the far post or the keeper's weak side.</li>
            <li><b>K</b> passes to whoever you steer toward; off the ball, <b>K calls for the pass</b> — a teammate flags open and the carrier finds you.</li>
            <li><b>L</b> is now a committed <b>slide tackle</b>: bigger lunge, real chance to win the ball, real punishment if you whiff.</li>
            <li><b>Q</b> switches swimmers even while your team carries — take control of the support runner.</li>
          </ul>
        </div>
        <div class="howto-col">
          <h2>CONTROLS</h2>
          <table class="ctrl">
            <tr><th></th><th>KEYBOARD</th><th>GAMEPAD</th><th>TOUCH</th></tr>
            <tr><td>Swim</td><td>WASD / Arrows</td><td>Left stick</td><td>Left half: drag a stick</td></tr>
            <tr><td>Swing the camera</td><td>—</td><td>—</td><td>Right half: drag to look</td></tr>
            <tr><td>Rise / dive (free swim)</td><td>R / F</td><td>Right stick ↑ ↓</td><td>▲ / ▼</td></tr>
            <tr><td>Burst (short underwater sprint)</td><td>SHIFT</td><td>RT / RB</td><td>BURST (hold)</td></tr>
            <tr><td>Shoot (hold to charge, release on PERFECT)</td><td>J / SPACE</td><td>A / ✕</td><td>Strike pad: hold, swipe, lift</td></tr>
            <tr><td>Pass · Lob for a volley (hold turbo)</td><td>K</td><td>X / ▢</td><td>PASS</td></tr>
            <tr><td>Juke / signature move (with the ball)</td><td>L</td><td>B / ○</td><td>TACKLE</td></tr>
            <tr><td>Slide / poke tackle (off-ball)</td><td>L</td><td>B / ○</td><td>TACKLE</td></tr>
            <tr><td>Call for the pass (off-ball)</td><td>K</td><td>X / ▢</td><td>PASS</td></tr>
            <tr><td>Big hit</td><td>I</td><td>Y / △</td><td>HIT</td></tr>
            <tr><td>Breach (leap) / Block / Volley a loose ball</td><td>U or J on defense</td><td>A / ✕ on defense</td><td>BLOCK</td></tr>
            <tr><td>Switch swimmer</td><td>Q / TAB</td><td>LB</td><td>automatic (you take the carrier)</td></tr>
            <tr><td>Gamebreaker</td><td>E</td><td>LT + RT</td><td>Strike pad while it glows cyan</td></tr>
            <tr><td>Keeper dive (in cage)</td><td>U / J / L + A/D side + R/F height</td><td>A / B + left stick side + right stick height</td><td>DIVE pad: swipe side/height, lift to commit</td></tr>
            <tr><td>Take / leave the cage</td><td>V</td><td>L3</td><td>GK (press again to come back out)</td></tr>
            <tr><td>Call play (offense / defense)</td><td>1 2 3 / 7 8 9</td><td>—</td><td>ATTACK / DEFEND</td></tr>
            <tr><td>Pause</td><td>ESC</td><td>START</td><td>II</td></tr>
          </table>
          <h2>PLAYCALLING</h2>
          <ul>
            <li><b>1 / 2 / 3</b> set your offense: <b>Drive &amp; Kick</b> (balanced), <b>Spread Floor</b> (safe lanes, crisp passing), <b>Isolation</b> (clear out your star — faster carry, sharper shots, riskier passes).</li>
            <li><b>7 / 8 / 9</b> set your defense: <b>Tight Man</b> (balanced), <b>Drop Zone</b> (pack the crease, swat passes), <b>Full Press</b> (hunt turnovers — burns turbo fast).</li>
            <li>The active play glows on the chip bottom-left. The CPU runs its own playbook — watch the ticker.</li>
            <li>Plays apply only while you're on that side of the ball; your offense play is live when your chip is lit.</li>
          </ul>
          <h2>TIPS</h2>
          <ul>
            <li>On touch the <b>left half</b> is your stick — push it forward, back, left or right and your swimmer goes that way <b>relative to the camera</b>. <b>Drag the right half</b> to swing the camera, and use <b>RISE / DIVE</b> for depth.</li>
            <li>The <b>STRIKE pad</b> (bottom right) is the shot: hold to wind up, <b>swipe</b> to bend the shot to that side and to pick your ring tier, lift to fire. Release in the <b>PERFECT</b> window for the cleanest strike. When the meter is full the pad turns cyan and the same swipe launches a <b>Gamebreaker</b>.</li>
            <li>Around the pad: <b>PASS</b>, <b>BURST</b> (hold to sprint), <b>BLOCK</b> (leap/block off the ball), <b>HIT</b> (big hit) and <b>TACKLE</b> — a slide tackle without the ball, your signature move with it. In the cage, the strike pad changes to <b>DIVE</b>: swipe to choose direction and height, then release to commit. The cage camera stays fixed, and <b>GK</b> takes you into or out of the cage. Keyboard players can call offense plays with <b>1 / 2 / 3</b> and defense plays with <b>7 / 8 / 9</b>.</li>
            <li>Hold a direction + trick with <b>turbo</b> for a bigger move and a better chance of <b>washing</b> the defender.</li>
            <li>Release the shot when the charge hits the <b>PERFECT</b> window — timing beats ratings.</li>
            <li>Shift+K lobs to a teammate near the ring: they breach and <b>volley</b> it first time. Volley goals are worth big style.</li>
            <li>Watch the <b>holographic ring</b> on the water — it marks where an incoming pass will land.</li>
            <li>Trailing late? <b>Full Press</b> on defense + <b>Isolation</b> on offense. Protecting a lead? <b>Drop Zone</b>.</li>
            <li>Defenders tackle. Strikers shoot. Keepers save. Play your crew.</li>
          </ul>
        </div>
      </div>
      <footer class="screen-foot"><button class="btn back-btn">BACK</button></footer>
    </section>`);
  el.querySelector('.back-btn').addEventListener('click', () => app.go('title'));
  return { el, onNav: (n) => (n.back || n.confirm) && app.go('title') };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function SettingsScreen(app, params = {}) {
  const s = app.state.settings;
  const row = (key, label, kind, opts) => {
    if (kind === 'range') {
      const min = opts?.min ?? 0;
      const max = opts?.max ?? 1;
      const step = opts?.step ?? 0.05;
      const pct = Math.round(((s[key] - min) / (max - min)) * 100);
      return `<div class="set-row" data-key="${key}" data-min="${min}" data-max="${max}"><span class="set-label">${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${s[key]}"><span class="set-val">${pct}%</span></div>`;
    }
    if (kind === 'select') return `<div class="set-row" data-key="${key}"><span class="set-label">${label}</span><select>${opts.map((o) => `<option value="${o[0]}" ${s[key] === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></div>`;
    if (kind === 'pick') return `<div class="set-row" data-key="${key}"><span class="set-label">${label}</span><div class="set-pick">${opts.map((o) => `<button type="button" class="pick-btn ${s[key] === o[0] ? 'on' : ''}" data-value="${o[0]}">${o[1]}</button>`).join('')}</div></div>`;
    if (kind === 'toggle') return `<div class="set-row" data-key="${key}"><span class="set-label">${label}</span><input type="checkbox" ${s[key] ? 'checked' : ''}></div>`;
    return '';
  };
  const el = h(`
    <section class="screen settings">
      <header class="screen-head"><h1>SETTINGS</h1><div class="head-sub">Changes save automatically · BACK returns to the previous menu</div></header>
      <div class="set-list">
        <div class="set-group">VIDEO / GRAPHICS</div>
        ${row('resolution', 'RENDER RESOLUTION', 'select', [['auto', 'AUTO · MATCH DISPLAY'], ['720p', '720P · PERFORMANCE'], ['1080p', '1080P · BALANCED'], ['1440p', '1440P · HIGH DETAIL']])}
        ${row('fullscreen', 'DISPLAY MODE', 'select', [[false, 'WINDOWED'], [true, 'FULLSCREEN']])}
        ${row('quality', 'QUALITY PRESET', 'select', [['low', 'LOW · PERFORMANCE'], ['medium', 'MEDIUM'], ['high', 'HIGH · DETAIL']])}
        <div class="set-note">Render resolution sets the internal WebGL buffer height and preserves your screen’s aspect ratio; it does not change your operating system’s display resolution. Fullscreen is available only where the browser permits it.</div>
        <div class="set-group">AUDIO</div>
        ${row('masterVolume', 'MASTER VOLUME', 'range')}
        ${row('musicVolume', 'MUSIC / AMBIENCE', 'range')}
        ${row('sfxVolume', 'SOUND EFFECTS', 'range')}
        <div class="set-group">GAMEPLAY</div>
        ${row('difficulty', 'DEFAULT DIFFICULTY', 'select', Object.entries(DIFFICULTY).map(([k, v]) => [k, v.label]))}
        ${row('screenShake', 'SCREEN SHAKE', 'toggle')}
        ${row('reducedMotion', 'REDUCED MOTION', 'toggle')}
        ${row('touchControls', 'TOUCH CONTROLS', 'select', [['auto', 'AUTO · TOUCH DEVICES'], ['on', 'ON'], ['off', 'OFF']])}
        ${row('touchLayout', 'PAD PRESET', 'pick', [['right', 'RIGHT-HAND'], ['left', 'LEFT-HAND']])}
        ${row('touchScale', 'PAD SIZE', 'range', { min: 0.8, max: 1.3, step: 0.05 })}
        ${row('touchOpacity', 'PAD OPACITY', 'range', { min: 0.4, max: 1, step: 0.05 })}
        <div class="set-note">PAD PRESET mirrors the whole scheme (stick, camera half, action pad, pause) for either hand; SIZE and OPACITY scale the action pad. The left half is always movement, the right half always the camera, and the strike pad is always the shot: hold, swipe, lift.</div>
      </div>
      <div class="set-actions"><button class="btn danger reset-btn">RESET ALL DATA</button><button class="btn back-btn">BACK</button></div>
    </section>`);
  el.querySelectorAll('.set-row').forEach((r) => {
    const key = r.dataset.key;
    // Preset rows are a pair of buttons, not a form control — wire them and move on.
    const pick = r.querySelector('.set-pick');
    if (pick) {
      pick.querySelectorAll('.pick-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          s[key] = btn.dataset.value;
          for (const b of pick.querySelectorAll('.pick-btn')) b.classList.toggle('on', b === btn);
          app.audio.uiConfirm();
          app.match?.touchControls?.applySettings(s);
          app.save();
        });
      });
      return;
    }
    const input = r.querySelector('input,select');
    const updateSetting = async () => {
      if (key === 'fullscreen') {
        const requested = input.value === 'true';
        const applied = await app.setFullscreen(requested);
        s.fullscreen = !!document.fullscreenElement;
        input.value = s.fullscreen ? 'true' : 'false';
        if (!applied) app.showNotice?.('Fullscreen is unavailable or was blocked by the browser.');
        app.save();
        return;
      }

      if (input.type === 'range') {
        s[key] = parseFloat(input.value);
        const min = parseFloat(r.dataset.min || '0');
        const max = parseFloat(r.dataset.max || '1');
        r.querySelector('.set-val').textContent = `${Math.round(((s[key] - min) / (max - min)) * 100)}%`;
        if (['masterVolume', 'musicVolume', 'sfxVolume'].includes(key)) {
          app.audio.applyVolumes(s);
          app.audio.uiMove();
        }
      } else if (input.type === 'checkbox') {
        s[key] = input.checked;
        if (key === 'screenShake' && app.match?.renderer?.gameCam) app.match.renderer.gameCam.shakeEnabled = input.checked;
        if (key === 'reducedMotion' && app.match?.renderer?.gameCam) app.match.renderer.gameCam.reducedMotion = input.checked;
      } else if (input.tagName === 'SELECT') {
        s[key] = input.value;
      }

      if (key === 'quality' || key === 'resolution') app.applyQuality?.(s.quality);
      // Layout changes are felt immediately, even from the in-match settings overlay.
      if (key.startsWith('touch')) app.match?.touchControls?.applySettings(s);
      app.save();
    };
    input.addEventListener(input.type === 'range' ? 'input' : 'change', updateSetting);
  });
  // `onBack` lets the in-match overlay close itself instead of navigating away from a live match.
  const back = () => {
    app.save();
    return params.onBack ? params.onBack() : app.go(params.back || 'title');
  };
  el.querySelector('.back-btn').addEventListener('click', back);
  el.querySelector('.reset-btn').addEventListener('click', () => {
    if (confirm('Delete all saved data (career, records, settings)?')) app.resetAll();
  });
  return { el, onNav: (n) => n.back && back() };
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** The series tally, drawn from the seat's point of view. */
function seriesMarkup(series, mySeat = 0) {
  if (!series) return '';
  const wins = series.wins || [0, 0];
  const mine = wins[mySeat] || 0;
  const theirs = wins[1 - mySeat] || 0;
  const over = !!series.over;
  const conceded = series.forfeit !== null && series.forfeit !== undefined;
  const label = over
    ? (series.champion === mySeat ? 'SERIES WON' : 'SERIES LOST')
    : `ROUND ${series.round || 1} COMPLETE`;
  const note = conceded
    ? (series.forfeit === mySeat ? 'YOU CONCEDED' : 'OPPONENT CONCEDED')
    : over ? `BEST OF ${series.bestOf || 3}` : 'READY UP FOR THE NEXT ROUND';
  return `<div class="res-series ${over ? (series.champion === mySeat ? 'won' : 'lost') : ''}">
    <span class="rs-label">${label}</span>
    <span class="rs-tally">${mine}<i>–</i>${theirs}</span>
    <span class="rs-note">${note}</span>
  </div>`;
}

/** How the run stands after a Gauntlet match. */
function gauntletMarkup(gauntlet) {
  if (!gauntlet) return '';
  const progress = gauntlet.progress || {};
  return `<div class="res-gauntlet ${progress.cleared ? 'won' : progress.over ? 'lost' : ''}">
    <span class="rg-label">GAUNTLET</span>
    <span class="rg-summary">${gauntlet.summary}</span>
    <span class="rg-progress">${progress.stage || 0}/${progress.total || 3} RUNGS · ${progress.lives ?? 0} LIVES LEFT</span>
  </div>`;
}

export function ResultsScreen(app, params) {
  const { sim, mode, userTeam, careerResult, rankedResult = '', trial = null, duel = null, gauntlet = null, series = null, mySeat = 0 } = params;
  const [h0, a0] = sim.teams;
  const winnerTeam = Number.isInteger(sim.winner) ? sim.winner : 0;
  const verdict = duel
    ? duel.forfeitSeat === duel.me ? 'YOU CONCEDED'
      : duel.forfeitSeat !== null && duel.forfeitSeat !== undefined ? 'OPPONENT CONCEDED'
        : duel.online
          ? duel.winnerSeat === duel.me ? 'YOU TAKE THE ROUND' : duel.winnerSeat < 0 ? 'DEAD HEAT' : 'YOU LOSE THE ROUND'
          : duel.winnerSeat < 0 ? 'DEAD HEAT' : `PLAYER ${duel.winnerSeat + 1} TAKES IT`
    : userTeam === null ? 'FULL TIME' : sim.winner === userTeam ? 'YOU RUN THE POOL' : 'RUN IT BACK';
  const seriesOver = !!series?.over;
  const rows = (team) =>
    sim
      .teamPlayers(team)
      .map((p) => `<tr><td class="r-name"><b>${p.data.nick}</b> ${p.data.name}${p.isKeeper ? ' <i>GK</i>' : ''}</td><td>${p.stats.goals}</td><td>${p.stats.sog}/${p.stats.shots}</td><td>${p.stats.ast}</td><td>${p.stats.tkl}</td><td>${p.stats.hits}</td><td>${p.stats.blk}</td><td>${p.stats.saves}</td><td>${p.stats.washed}</td><td class="r-style">${p.stats.style}</td></tr>`)
      .join('');
  const mvp = [...sim.players].sort((a, b) => b.stats.style + b.stats.goals * 120 + b.stats.saves * 40 - (a.stats.style + a.stats.goals * 120 + a.stats.saves * 40))[0];
  const el = h(`
    <section class="screen results" style="--c1:${sim.teams[winnerTeam].primary};--c3:${sim.teams[winnerTeam].accent}">
      <div class="res-head">
        <div class="res-verdict">${verdict}</div>
        <div class="res-score"><span class="rs-team" style="--c1:${h0.primary}">${h0.abbr}</span><span class="rs-num">${sim.score[0]}</span><span class="rs-dash">–</span><span class="rs-num">${sim.score[1]}</span><span class="rs-team" style="--c1:${a0.primary}">${a0.abbr}</span></div>
        <div class="res-sub">${sim.teams[winnerTeam].city.toUpperCase()} ${sim.teams[winnerTeam].name.toUpperCase()} WIN${sim.overtime ? ' IN OVERTIME' : ''} · MATCH MVP: ${mvp.data.nick} (${mvp.stats.goals} G · ${mvp.stats.style} STYLE)</div>
        ${careerResult ? `<div class="res-career">${careerResult}</div>` : ''}
        ${rankedResult ? `<div class="res-ranked">${rankedResult}</div>` : ''}
        ${trial ? `<div class="res-trial">
          <div class="rt-stars">${starMarkup(trial.stars)}</div>
          <div class="rt-verdict">${trial.verdict}</div>
          <div class="rt-score">${trial.score} PTS${trial.nextAt ? ` · ${Math.max(0, trial.nextAt - trial.score)} TO THE NEXT STAR` : ' · PERFECT SCORE'}</div>
          <div class="rt-notes">${trial.notes.join(' · ')}</div>
        </div>` : ''}
        <span class="res-series-wrap">${seriesMarkup(series, mySeat)}</span>
        ${gauntletMarkup(gauntlet)}
      </div>
      ${RecapPanel(sim)}
      <div class="res-tables">
        ${[0, 1].map((t) => `<table class="box" style="--c1:${sim.teams[t].primary};--c3:${sim.teams[t].accent}"><thead><tr><th class="r-name">${sim.teams[t].city.toUpperCase()} ${sim.teams[t].name.toUpperCase()}</th><th>G</th><th>SOG/SH</th><th>AST</th><th>TKL</th><th>HIT</th><th>BLK</th><th>SAV</th><th>WSH</th><th>STYLE</th></tr></thead><tbody>${rows(t)}</tbody></table>`).join('')}
      </div>
      ${menuList([
        ...(mode === 'career' ? [{ action: 'career', label: 'BACK TO THE LADDER' }] : []),
        ...(mode === 'ladder' ? [{ action: 'ranked', label: 'BACK TO THE LADDER', sub: 'Your rating is saved' }] : []),
        ...(duel?.online
          ? [{ action: 'lobby', label: seriesOver ? 'BACK TO THE LOBBY' : 'NEXT ROUND', sub: seriesOver ? 'Ready up for a new series' : 'The set is still live' }]
          : []),
        ...(mode === 'gauntlet'
          ? (gauntlet && !gauntlet.over
            ? [{ action: 'gauntlet-next', label: 'NEXT RUNG', sub: gauntlet.summary }]
            : [{ action: 'gauntlet', label: 'GAUNTLET HUB', sub: 'Start a new run' }])
          : []),
        ...(!duel?.online && mode !== 'gauntlet'
          ? (duel || mode === 'ladder' || mode === 'watch' || mode === 'proving'
            ? [{ action: 'modes', label: 'CHOOSE A MODE' }]
            : [{ action: 'rematch', label: 'RUN IT BACK', sub: 'Same matchup' }, { action: 'teamselect', label: 'NEW MATCHUP' }])
          : []),
        { action: 'title', label: 'MAIN MENU' },
      ])}
    </section>`);
  const menu = wireMenu(el, (action) => {
    if (action === 'rematch') app.startMatch({ home: h0, away: a0, modeId: mode });
    else if (action === 'teamselect') app.go('teamselect', { modeId: mode });
    else if (action === 'career') app.go('career');
    else if (action === 'ranked') app.go('ranked');
    else if (action === 'lobby') app.go('lobby', { modeId: mode });
    else if (action === 'gauntlet-next') app.startGauntletMatch();
    else if (action === 'gauntlet') app.go('gauntlet');
    else if (action === 'modes') app.go('modes');
    else app.go('title');
  }, app);
  return {
    el,
    onNav: (n) => menu.nav(n),
    // The server tallies the round while this screen is already up; repaint the series box when
    // the message lands instead of making the player reload to see where the set stands.
    onSeries(next) {
      if (!next) return;
      const wrap = el.querySelector('.res-series-wrap');
      if (wrap) wrap.innerHTML = seriesMarkup(next, mySeat);
    },
  };
}

// ---------------------------------------------------------------------------
// Pause overlay (rendered above the match)
// ---------------------------------------------------------------------------

export function PauseOverlay(app, { onResume, onQuit, onRestart, onForfeit = null }) {
  const el = h(`
    <div class="pause">
      <div class="pause-box">
        <div class="pause-title">PAUSED</div>
        ${menuList([
          { action: 'resume', label: 'RESUME' },
          { action: 'bench', label: 'BENCH', sub: 'Substitutions' },
          { action: 'controls', label: 'CONTROLS' },
          { action: 'settings', label: 'SETTINGS' },
          ...(onRestart ? [{ action: 'restart', label: 'RESTART MATCH' }] : []),
          ...(onForfeit ? [{ action: 'forfeit', label: 'FORFEIT SERIES', sub: 'Concede the set to the other pilot' }] : []),
          { action: 'quit', label: 'MAIN MENU' },
        ])}
        <div class="pause-controls hidden">
          <div><b>WASD</b> swim · <b>SHIFT</b> turbo · <b>J/SPACE</b> shoot (hold, release on PERFECT) · <b>K</b> pass (<b>+SHIFT</b> lob for a volley)</div>
          <div><b>L</b> trick / tackle · <b>I</b> big hit · <b>U</b> breach / block · <b>Q</b> switch · <b>E</b> Gamebreaker</div>
        </div>
      </div>
    </div>`);
  const menu = wireMenu(el, (action) => {
    if (action === 'resume') onResume();
    else if (action === 'quit') onQuit();
    else if (action === 'restart') onRestart?.();
    else if (action === 'forfeit') {
      if (confirm('Forfeit the series? It is awarded to the other pilot.')) onForfeit?.();
    }
    else if (action === 'bench') app.match?.bench?.toggle();
    else if (action === 'controls') el.querySelector('.pause-controls').classList.toggle('hidden');
    else if (action === 'settings') app.openSettingsOverlay();
  }, app);
  return { el, onNav: (n) => menu.nav(n) };
}
