import type { CareerSave } from './models.js';
import { STAT_KEYS } from './models.js';
import { integer, nonnegative } from './math.js';
const MAX_SAVE_BYTES = 2_000_000;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object');
  return value as Record<string, unknown>;
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error('Expected bounded array');
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 200) throw new Error('Invalid string');
  return value;
}
function number(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Invalid numeric save field');
  return value;
}
function whole(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const n = number(value, min, max); integer(n, min, 'save integer'); return n;
}
/** Parse untrusted JSON at the boundary; no unsafe casts until schema/reference checks complete. */
export class CareerSaveCodec {
  static encode(save: CareerSave): string { return JSON.stringify(CareerSaveCodec.decode(JSON.stringify(save))); }
  static decode(json: string): CareerSave {
    if (new TextEncoder().encode(json).byteLength > MAX_SAVE_BYTES) throw new Error('Save exceeds 2 MB');
    const raw: unknown = JSON.parse(json);
    const s = object(raw);
    if (s['version'] !== 1) throw new Error('Unsupported save version; migration required');
    text(s['policyVersion']); text(s['userPlayerId']); whole(s['seedState'], 0, 0xffffffff); whole(s['dayIndex'], 0);
    whole(s['therapyDaysSpent'], 0, 1); const dialogueIds = array(s['dialogueIds'], 10_000).map(text);
    if (new Set(dialogueIds).size !== dialogueIds.length) throw new Error('Duplicate dialogue IDs');
    const teams = array(s['teams'], 6).map(object);
    const players = array(s['players'], 500).map(object);
    const teamIds = new Set(teams.map(t => text(t['id'])));
    const playerIds = new Set(players.map(p => text(p['id'])));
    if (teams.length !== 6 || teamIds.size !== teams.length || playerIds.size !== players.length || !playerIds.has(text(s['userPlayerId']))) throw new Error('Invalid career identities');
    const assigned = new Set<string>();
    for (const t of teams) {
      text(t['name']); if (!['balanced', 'aggressive', 'technical', 'speed', 'physical'].includes(text(t['style']))) throw new Error('Unknown style');
      whole(t['capacity'], 6, 20); number(t['budget'], 0); number(t['chemistry'], 0, 100); number(t['baseAggression'], 0, 1);
      const ids = array(t['playerIds'], 20).map(text);
      if (ids.length > Number(t['capacity']) || new Set(ids).size !== ids.length) throw new Error('Invalid roster capacity');
      for (const id of ids) { if (!playerIds.has(id) || assigned.has(id)) throw new Error('Invalid/duplicate roster member'); assigned.add(id); }
      const demand = object(t['demand']);
      for (const [role, value] of Object.entries(demand)) { if (!['forward', 'midfielder', 'defender', 'keeper'].includes(role)) throw new Error('Unknown role'); number(value, -1, 1); }
    }
    for (const p of players) {
      const id = text(p['id']); text(p['name']); whole(p['age'], 18, 80);
      if (!['forward', 'midfielder', 'defender', 'keeper'].includes(text(p['role']))) throw new Error('Unknown player role');
      const attrs = object(p['attributes']); for (const stat of STAT_KEYS) number(attrs[stat], 1, 99);
      number(p['baseMaxHP'], 1); whole(p['level'], 1, 100); whole(p['totalXP'], 0); whole(p['attributePoints'], 0);
      number(p['reputation'], 0, 100); number(p['money'], 0); number(p['baseMarketValue'], 0); number(p['marketValue'], 0); number(p['performance'], -1, 1);
      const injuries = array(p['injuries'], 100).map(object);
      if (new Set(injuries.map(i => text(i['id']))).size !== injuries.length) throw new Error('Duplicate injuries');
      const skills = array(p['skills'], 1000).map(text); if (new Set(skills).size !== skills.length) throw new Error('Duplicate skills');
      for (const i of array(p['inventory'], 1000).map(object)) { text(i['id']); text(i['name']); whole(i['quantity'], 1); if (!['equipment', 'therapy-voucher'].includes(text(i['kind']))) throw new Error('Unknown item kind'); }
      for (const i of injuries) {
        text(i['id']); if ('acquiredFixtureId' in i) text(i['acquiredFixtureId']); if (!['strain', 'bruise', 'fracture', 'tear'].includes(text(i['kind'])) || !['minor', 'severe'].includes(text(i['severity']))) throw new Error('Invalid injury');
        number(i['remainingMatches'], Number.MIN_VALUE, 8); number(i['statMultiplier'], 0, 1);
        for (const stat of array(i['affectedStats'], 8).map(text)) if (!STAT_KEYS.includes(stat as typeof STAT_KEYS[number])) throw new Error('Unknown affected stat');
      }
      if (p['agent'] !== null) { const a = object(p['agent']); text(a['name']); whole(a['tier'], 1, 3); }
      if (p['contract'] !== null) {
        const c = object(p['contract']); const tid = text(c['teamId']);
        whole(c['remainingMatches'], 1); for (const key of ['salaryPerMatch', 'goalBonus', 'winBonus', 'endorsementPerMatch']) number(c[key], 0);
        if (!teamIds.has(tid) || !array(teams.find(t => t['id'] === tid)!['playerIds'], 20).includes(id)) throw new Error('Contract/roster mismatch');
      } else if (assigned.has(id)) throw new Error('Free agent assigned to a roster');
    }
    const matchIds = new Set<string>();
    for (const m of array(s['matches'], 30_000).map(object)) {
      const id = text(m['id']); if (matchIds.has(id)) throw new Error('Duplicate fixture'); matchIds.add(id);
      whole(m['round'], 1); whole(m['homeScore'], 0); whole(m['awayScore'], 0);
      const home = text(m['homeTeamId']); const away = text(m['awayTeamId']);
      if (home === away || !teamIds.has(home) || !teamIds.has(away)) throw new Error('Invalid match teams');
      for (const [pid, goals] of Object.entries(object(m['goalsByPlayer']))) { if (!playerIds.has(pid)) throw new Error('Unknown scorer'); whole(goals, 0); }
    }
    const rivalryKeys = new Set<string>();
    for (const r of array(s['rivalries'], 15).map(object)) {
      const ids = array(r['teamIds'], 2).map(text);
      if (ids.length !== 2 || ids[0] === ids[1] || ids.some(id => !teamIds.has(id))) throw new Error('Invalid rivals');
      const pairKey = [...ids].sort().join(':');
      if (rivalryKeys.has(pairKey)) throw new Error('Duplicate rivalry pair'); rivalryKeys.add(pairKey);
      const count = whole(r['matches'], 0); whole(r['closeGames'], 0, count); number(r['intensity'], 0, 100);
      const history = array(r['history'], 100).map(object);
      if (history.length > count) throw new Error('Rivalry count mismatch');
      const historyIds = new Set<string>();
      for (const m of history) {
        const id = text(m['id']); const canonical = array(s['matches'], 30_000).map(object).find(record => record['id'] === id);
        if (!canonical || historyIds.has(id) || !ids.includes(text(m['homeTeamId'])) || !ids.includes(text(m['awayTeamId']))) throw new Error('Unknown/duplicate rivalry fixture');
        historyIds.add(id);
        for (const key of ['round', 'homeTeamId', 'awayTeamId', 'homeScore', 'awayScore']) if (m[key] !== canonical[key]) throw new Error('Rivalry result inconsistent with match');
        if (JSON.stringify(m['goalsByPlayer']) !== JSON.stringify(canonical['goalsByPlayer'])) throw new Error('Rivalry scorers inconsistent');
      }
    }
    const ledgerKeys = new Set<string>();
    for (const l of array(s['ledgers'], 10_000).map(object)) {
      const mid = text(l['matchId']); const pid = text(l['playerId']); const key = `${mid}:${pid}`;
      if (!playerIds.has(pid) || ledgerKeys.has(key)) throw new Error('Ledger identity invalid'); ledgerKeys.add(key);
      const ids = array(l['actionIds'], 10_000).map(text); if (new Set(ids).size !== ids.length) throw new Error('Duplicate action XP');
      whole(l['actionXP'], 0); whole(l['awardedXP'], 0); if (typeof l['settled'] !== 'boolean') throw new Error('Invalid ledger flag');
      if (l['settled'] && !matchIds.has(mid)) throw new Error('Settled ledger without fixture');
    }
    return raw as CareerSave;
  }
}
export interface SavePort { load(): Promise<string | null>; commit(snapshot: string): Promise<void> }
/** Test/demo adapter only; production uses an atomic temp-file rename or IndexedDB transaction. */
export class MemorySavePort implements SavePort {
  private value: string | null = null;
  async load(): Promise<string | null> { return this.value; }
  async commit(snapshot: string): Promise<void> { CareerSaveCodec.decode(snapshot); this.value = snapshot; }
}
export class SerializedSaveWriter {
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly port: SavePort) {}
  save(save: CareerSave): Promise<void> {
    nonnegative(save.dayIndex, 'day');
    const snapshot = CareerSaveCodec.encode(save);
    // A failed save rejects its caller, but doesn't permanently block future save attempts.
    const operation = this.queue.then(() => this.port.commit(snapshot));
    this.queue = operation.catch(() => {});
    return operation;
  }
}
