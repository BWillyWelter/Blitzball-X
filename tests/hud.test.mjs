import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FFXHUD } from '../src/ui/hud.js';

function makeHud() {
  const actions = {};
  const buttons = new Map();
  const radar = { getContext: () => ({}) };
  const stats = { innerHTML: '' };
  const encounter = {
    style: {},
    querySelector(selector) {
      if (!buttons.has(selector)) {
        buttons.set(selector, {});
        Object.defineProperty(buttons.get(selector), 'onclick', {
          set(handler) { actions[selector] = handler; },
        });
      }
      return buttons.get(selector);
    },
  };
  const container = {
    markup: '',
    child: null,
    appendChild(node) { this.child = node; },
    querySelector(selector) {
      if (selector === '#radar-canvas') return radar;
      if (selector === '#encounter-window') return encounter;
      if (selector === '#carrier-stats') return stats;
      throw new Error(`Unexpected selector: ${selector}`);
    },
  };
  // The HUD builds into its own root element so it never wipes the shared
  // container (the WebGL game canvas lives there). Minimal document stub:
  // createElement hands back an object whose innerHTML lands in container.markup
  // and whose queries hit the same selector map the assertions rely on.
  globalThis.document = {
    createElement() {
      return {
        set innerHTML(value) { container.markup = value; },
        querySelector: (selector) => container.querySelector(selector),
      };
    },
  };
  return { hud: new FFXHUD(container), container, encounter, stats, actions };
}

test('HUD renders only working encounter choices and keeps the canvas radar', () => {
  const { container } = makeHud();
  assert.match(container.markup, /class="hud-scorebar"/);
  assert.match(container.markup, /class="hud-radar"/);
  assert.match(container.markup, /id="radar-canvas"/);
  assert.match(container.markup, /id="btn-breakthrough"/);
  assert.match(container.markup, /id="btn-shoot"/);
  assert.doesNotMatch(container.markup, /id="btn-pass"/);
  assert.equal((container.markup.match(/<button\b/g) || []).length, 2);
});

test('BREAKTHROUGH and SHOOT dismiss the encounter and dispatch their match action', () => {
  const { hud, encounter, stats, actions } = makeHud();
  const selected = [];
  const carrier = { name: 'Tidus', currentHP: 90, en: 12, pas: 8, sh: 15 };
  const defenders = [{ name: 'Dorus', tck: 6 }];
  const onActionSelect = (action, payload) => selected.push({ action, payload });

  hud.showEncounterMenu(carrier, defenders, onActionSelect);
  assert.equal(encounter.style.display, 'block');
  assert.match(stats.innerHTML, /Tidus/);
  assert.match(stats.innerHTML, /Dorus/);
  actions['#btn-breakthrough']();
  assert.equal(encounter.style.display, 'none');
  assert.deepEqual(selected[0], { action: 'BREAKTHROUGH', payload: { chosenDefenders: defenders } });

  hud.showEncounterMenu(carrier, defenders, onActionSelect);
  actions['#btn-shoot']();
  assert.equal(encounter.style.display, 'none');
  assert.deepEqual(selected[1], { action: 'SHOOT', payload: { chosenDefenders: [] } });
});

test('HUD stylesheet constrains the score, radar, and action panel on narrow screens', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.hud-scorebar[\s\S]*?max-width: calc\(100vw - 24px\)/);
  assert.match(css, /\.hud-radar[\s\S]*?width: 108px/);
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*?\.hud-radar[\s\S]*?width: 88px/);
  assert.match(css, /\.encounter-window[\s\S]*?width: min\(320px, calc\(100vw - 28px\)\)/);
});
