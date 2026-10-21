/**
 * GAUNTLET — the run lobby.
 *
 * A run is not a match, so it gets its own screen: the three rungs, the lives left, the fixture
 * waiting at the end of the current rung, and the rules that rung adds. The screen is a pure view
 * of `src/game/gauntlet.js`; every number it prints comes from the run object that is saved.
 */

import {
  GAUNTLET_LIVES,
  GAUNTLET_RUNGS,
  createGauntletRun,
  gauntletMatch,
  gauntletProgress,
} from '../game/gauntlet.js';
import { TEAMS, TEAM_BY_ID, teamOverall } from '../data/teams.js';
import { h, teamCard } from './screens.js';

/** Rung state for the ladder drawing. */
function rungState(run, index) {
  if (!run) return index === 0 ? 'current' : 'locked';
  if (run.cleared || index < run.stage) return 'cleared';
  if (run.over) return 'lost';
  return index === run.stage ? 'current' : 'locked';
}

export function GauntletScreen(app) {
  const saved = app.state.gauntlet || null;
  const picked = saved?.teamId || app.state.gauntletTeamId || TEAMS[0].id;
  const run = saved && !saved.over ? saved : null;
  // A finished run still has something to say (what you cleared), so preview it too.
  const shown = saved;
  const progress = gauntletProgress(shown);
  const preview = gauntletMatch(run || createGauntletRun(picked), TEAMS);
  const stage = shown && shown.over ? Math.max(0, (shown.results?.length || 1) - 1) : shown?.stage || 0;
  const rung = GAUNTLET_RUNGS[Math.min(GAUNTLET_RUNGS.length - 1, stage)];
  const best = app.state.gauntletBest || null;

  const lives = run ? run.lives : GAUNTLET_LIVES;
  const lifeMarkup = Array.from({ length: GAUNTLET_LIVES }, (_, i) => `<span class="gt-life ${i < lives ? 'on' : 'off'}">◆</span>`).join('');

  const rungs = GAUNTLET_RUNGS.map((r, i) => {
    const state = rungState(shown, i);
    return `
      <li class="gt-rung ${state}">
        <span class="gt-rung-n">${r.n}</span>
        <span class="gt-rung-main"><b>${r.label.split('· ')[1] || r.label}</b><i>${r.tagline}</i></span>
        <span class="gt-rung-state">${state === 'cleared' ? 'CLEARED' : state === 'current' ? 'NEXT' : state === 'lost' ? 'LOST' : '—'}</span>
      </li>`;
  }).join('');

  const rules = Object.entries(rung.rules).map(([key, value]) => {
    const label = key === 'halfLength' ? `${value}s HALVES`
      : key === 'halves' ? `${value} PERIOD${value === 1 ? '' : 'S'}`
        : key === 'possessionClock' ? `${value}s SHOT CLOCK`
          : key === 'targetGoals' ? `FIRST TO ${value}`
            : key === 'goalWindows' ? 'TOP RING ONLY'
              : key === 'gamebreakerMeterMax' ? 'NO GAMEBREAKERS'
                : key === 'gbPoints' ? `GAMEBREAKERS ${value} PTS`
                  : key === 'foulCallChance' ? 'TIGHT WHISTLE'
                    : key === 'subsPerTeam' ? `${value} SUBS`
                      : null;
    return label ? `<span>${label}</span>` : '';
  }).join('');

  const el = h(`
    <section class="screen gauntlet-screen">
      <header class="screen-head">
        <h1>GAUNTLET</h1>
        <div class="head-sub">Three rungs · two lives · the rules tighten every round</div>
      </header>
      <div class="gt-body">
        <div class="gt-left">
          <div class="gt-run-head">THIS RUN</div>
          <div class="gt-lives" aria-label="${lives} of ${GAUNTLET_LIVES} lives left">${lifeMarkup}</div>
          <ol class="gt-rungs">${rungs}</ol>
          <div class="gt-record">
            ${progress ? `<span>${progress.wins} CLEARED · ${progress.losses} LOST</span><span>${progress.label}</span>` : '<span>NO RUN YET</span><span>THREE RUNGS</span>'}
            ${best ? `<span class="gt-best">BEST ${best.cleared ? 'CLEARED' : `RUNG ${best.stage}`}</span>` : ''}
          </div>
        </div>
        <div class="gt-right">
          <div class="gt-next-head">${run ? `NEXT: ${rung.label}` : 'RUNG 1 · SURGE'}</div>
          <div class="gt-fixture">
            <div class="gt-side">${teamCard(TEAM_BY_ID[picked], { cls: 'you' })}</div>
            <div class="gt-vs">VS</div>
            <div class="gt-side">${teamCard(preview ? preview.away : TEAMS[1], { cls: 'cpu' })}</div>
          </div>
          <div class="gt-rules">${rules}</div>
          <div class="gt-note">${rung.detail}</div>
          <div class="gt-opp">OPPONENT OVR ${preview ? teamOverall(preview.away) : '—'} · DIFFICULTY ${(preview?.difficulty || 'pro').toUpperCase()}</div>
        </div>
      </div>
      <div class="ts-grid gt-chips">${TEAMS.map((t) => `<button class="ts-chip ${t.id === picked ? 'sel-a' : ''}" data-id="${t.id}" style="--c1:${t.primary};--c3:${t.accent}" ${run ? 'disabled' : ''}>${t.abbr}</button>`).join('')}</div>
      <footer class="screen-foot">
        <div class="foot-left"><span class="key">◀ ▶</span> crew <span class="key">ENTER</span> ${run ? 'next rung' : 'start the run'} <span class="key">ESC</span> back</div>
        <div class="foot-right">
          <button class="btn back-btn">BACK</button>
          ${run || shown ? '<button class="btn reset-btn">NEW RUN</button>' : ''}
          <button class="btn primary start-btn">${run ? `PLAY ${rung.label.split('· ')[1] || 'RUNG'}` : 'START THE RUN'}</button>
        </div>
      </footer>
    </section>`);

  const start = () => {
    app.audio.uiConfirm();
    if (run) app.startGauntletMatch();
    else app.beginGauntlet(picked);
  };

  el.querySelectorAll('.ts-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (run) return;
      app.state.gauntletTeamId = chip.dataset.id;
      app.save();
      app.audio.uiConfirm();
      app.go('gauntlet');
    });
  });
  el.querySelector('.back-btn').addEventListener('click', () => {
    app.audio.uiBack();
    app.go('modes');
  });
  el.querySelector('.reset-btn')?.addEventListener('click', () => {
    app.audio.uiConfirm();
    app.state.gauntlet = null;
    app.save();
    app.go('gauntlet');
  });
  el.querySelector('.start-btn').addEventListener('click', start);

  return {
    el,
    onNav(n) {
      if (n.confirm) start();
      else if (n.back) {
        app.audio.uiBack();
        app.go('modes');
      }
    },
  };
}
