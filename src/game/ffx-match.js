import { MatchSim } from './match.js';
import { emptyInput } from './entities.js';
import { TEAMS as LEGACY_TEAMS } from '../data/teams.js';
import { TEAMS as FFX_TEAMS } from '../data/ffx-teams.js';

export const MATCH_STATES = Object.freeze({
  FREE_SWIM: 'FREE_SWIM',
  ENCOUNTER_MENU: 'ENCOUNTER_MENU',
  ENCOUNTER_RESOLVING: 'ENCOUNTER_RESOLVING',
  SHOT_IN_FLIGHT: 'SHOT_IN_FLIGHT',
  GOAL_SCORED: 'GOAL_SCORED',
  MATCH_OVER: 'MATCH_OVER'
});

/** Adapts MatchSim's deterministic 7-a-side engine to the browser app's FFXMatch contract. */
export class FFXMatch {
  constructor(homeTeam, awayTeam, seed = Date.now()) {
    const home = LEGACY_TEAMS.find((team) => team.id === homeTeam.id) || this.adaptTeam(homeTeam);
    const away = LEGACY_TEAMS.find((team) => team.id === awayTeam.id) || this.adaptTeam(awayTeam);
    const activeHome = this.prepareActiveTeam(home, homeTeam);
    const activeAway = this.prepareActiveTeam(away, awayTeam);
    this.sim = new MatchSim({ home: activeHome, away: activeAway, difficulty: 'pro', seed, userTeam: 0 });
    this.homeTeam = this.makeTeamView(activeHome, 0, homeTeam);
    this.awayTeam = this.makeTeamView(activeAway, 1, awayTeam);
    this.syncToSim();
    this.matchSeed = seed;
    this.state = MATCH_STATES.FREE_SWIM;
    this.timeRemaining = this.sim.rules.halfLength * 2;
    this.nearbyDefenders = [];
    this.onTechniqueExecuted = null;
    this.techcopyEngine = null;
    this.syncFromSim();

    this.sim.events.on('goal', () => {
      this.syncFromSim();
      this.state = MATCH_STATES.GOAL_SCORED;
    });
    this.sim.events.on('live', () => {
      if (this.state === MATCH_STATES.GOAL_SCORED) this.state = MATCH_STATES.FREE_SWIM;
      this.syncFromSim();
    });
    this.sim.events.on('reset', ({ reason }) => {
      if (reason === 'goal') this.state = MATCH_STATES.GOAL_SCORED;
    });
    this.sim.events.on('gameover', () => {
      this.state = MATCH_STATES.MATCH_OVER;
      this.syncFromSim();
    });
  }

  adaptTeam(team) {
    const roster = (team.players || []).map((player) => {
      const role = player.pos === 'KP' || player.pos === 'GK'
        ? 'GK'
        : ['LF', 'RF', 'SH'].includes(player.pos) ? 'SH' : 'FD';
      return {
        ...player,
        role,
        spd: player.spd || 60,
        sht: player.sh || 50,
        hnd: player.hnd || player.hp || 50,
        pas: player.pas || 50,
        tkl: player.tck || 50,
        pow: player.pow || player.hp || 50,
        end: player.end || 70,
        gb: player.gb || 50,
        cat: player.cat || 50,
        blk: player.blk || 50,
        move: 'spin'
      };
    });
    return { ...team, roster };
  }

  prepareActiveTeam(team, presentationTeam) {
    const ffxRoster = presentationTeam?.players || FFX_TEAMS[team.id]?.players;
    if (!ffxRoster) return team;

    const positions = { KP: 'GK', GK: 'GK', LF: 'SH', RF: 'SH', SH: 'SH', MF: 'FD', LD: 'FD', RD: 'FD' };
    const roster = ffxRoster.map((player) => {
      const legacy = team.roster.find((candidate) => candidate.id === player.id) || {};
      return {
        ...player,
        ...legacy,
        role: positions[player.pos] || legacy.role || 'FD',
        spd: player.spd || legacy.spd || 60,
        sht: player.sht || player.sh || legacy.sht || 50,
        hnd: player.hnd || player.hp || legacy.hnd || 50,
        pas: player.pas || legacy.pas || 50,
        tkl: player.tkl || player.tck || legacy.tkl || 50,
        pow: player.pow || player.hp || legacy.pow || 50,
        end: player.end || player.en || legacy.end || 70,
        gb: player.gb || legacy.gb || 50,
        cat: player.cat || legacy.cat || 50,
        blk: player.blk || legacy.blk || 50,
        move: legacy.move || 'spin'
      };
    });
    return { ...team, ...presentationTeam, roster };
  }

  makeTeamView(team, index, presentationTeam) {
    const presentationRoster = presentationTeam?.players || FFX_TEAMS[team.id]?.players || [];
    const players = team.roster.map((player) => {
      const presentationPlayer = presentationRoster.find((candidate) => candidate.id === player.id);
      return {
        ...player,
        ...presentationPlayer,
        pos: presentationPlayer?.pos || (player.role === 'GK' ? 'KP' : player.role),
        hp: player.pow,
        currentHP: player.pow,
        sh: player.sht,
        en: player.end,
        pas: player.pas,
        tck: player.tkl,
        blk: player.blk,
        cat: player.cat,
        teamId: team.id,
        teamIndex: index,
        position: { x: 0, y: 0, z: 0 },
        techs: presentationPlayer?.techs ? [...presentationPlayer.techs] : []
      };
    });
    return { ...team, ...presentationTeam, id: team.id, players };
  }

  syncFromSim() {
    const playersByTeam = [this.sim.teamPlayers(0), this.sim.teamPlayers(1)];
    for (const [teamIndex, view] of [[0, this.homeTeam], [1, this.awayTeam]]) {
      for (const player of view.players) {
        const state = playersByTeam[teamIndex].find((candidate) => candidate.id === player.id);
        if (!state) continue;
        player.position = { x: state.pos.x, y: state.y, z: state.pos.z };
        player.currentHP = state.stamina;
        player.isKeeper = state.isKeeper;
      }
    }

    const halfElapsed = this.sim.rules.halfLength - this.sim.clock;
    this.timeRemaining = Math.max(0, this.sim.half === 1
      ? this.sim.clock + this.sim.rules.halfLength
      : this.sim.clock);
    const holder = this.sim.ball.holder;
    const carrierTeam = holder?.team === 0 ? this.homeTeam : this.awayTeam;
    this.ballCarrier = holder ? carrierTeam.players.find((player) => player.id === holder.id) || null : null;
    this.nearbyDefenders = this.ballCarrier
      ? (holder.team === 0 ? this.awayTeam : this.homeTeam).players.filter((player) => {
        const dx = player.position.x - this.ballCarrier.position.x;
        const dy = player.position.y - this.ballCarrier.position.y;
        const dz = player.position.z - this.ballCarrier.position.z;
        return Math.hypot(dx, dy, dz) <= 3.5;
      })
      : [];

    if (this.sim.state === 'over') this.state = MATCH_STATES.MATCH_OVER;
    else if (this.state === MATCH_STATES.GOAL_SCORED && this.sim.state !== 'live') { /* retain goal state through stoppage */ }
    else if (this.sim.state === 'live' && this.ballCarrier?.teamIndex === 0 && this.nearbyDefenders.length) this.state = MATCH_STATES.ENCOUNTER_MENU;
    else if (this.sim.ball.flight) this.state = MATCH_STATES.SHOT_IN_FLIGHT;
    else this.state = MATCH_STATES.FREE_SWIM;

    this.ball = {
      position: { x: this.sim.ball.pos.x, y: this.sim.ball.pos.y, z: this.sim.ball.pos.z },
      isMoving: Boolean(this.sim.ball.flight),
      carrier: this.ballCarrier
    };
    this.elapsedTime = this.sim.time + (this.sim.half - 1) * this.sim.rules.halfLength + halfElapsed;
  }

  syncToSim() {
    for (const [teamIndex, view] of [[0, this.homeTeam], [1, this.awayTeam]]) {
      for (const player of view.players) {
        const target = this.sim.players.find((candidate) => candidate.team === teamIndex && candidate.id === player.id);
        if (!target) continue;
        target.pos.set(player.position.x, player.position.y, player.position.z);
        target.y = player.position.y;
      }
    }
  }

  setPosition(player, next) {
    player.position = { x: next.x, y: next.y, z: next.z };
    const target = this.sim.players.find((candidate) => candidate.team === player.teamIndex && candidate.id === player.id);
    if (target) target.pos.set(next.x, next.y, next.z);
  }

  step(delta) {
    if (!Number.isFinite(delta) || delta <= 0 || this.state === MATCH_STATES.MATCH_OVER) return;
    this.syncToSim();
    this.sim.step(Math.min(delta, 0.1));
    this.syncFromSim();
  }

  executeEncounterAction(action, payload = {}) {
    if (this.state !== MATCH_STATES.ENCOUNTER_MENU || !this.sim.ball.holder) return null;
    const carrier = this.sim.ball.holder;
    if (!['SHOOT', 'BREAKTHROUGH', 'PASS'].includes(action)) return null;

    const chosen = new Set((payload.chosenDefenders || []).map((player) => typeof player === 'string' ? player : player.id));
    if (action !== 'PASS') {
      const bypassed = action === 'SHOOT' ? new Set() : chosen;
      const challenges = this.nearbyDefenders.filter((defender) => !bypassed.has(defender.id));
      for (const defenderView of challenges) {
        const defender = this.sim.opponentsOf(carrier).find((player) => player.id === defenderView.id);
        if (defender) this.sim.tryTackle(defender);
        if (this.sim.ball.holder !== carrier) {
          this.syncFromSim();
          return { success: false, turnover: true };
        }
      }
    }

    if (action === 'SHOOT') {
      this.sim.tryShoot(carrier);
      if (carrier.shot && !carrier.shot.released) {
        carrier.stateTime = carrier.shot.wind * 0.8;
        this.sim.releaseShot(carrier);
      }
    } else if (action === 'BREAKTHROUGH') {
      carrier.input = emptyInput();
      carrier.input.trick = true;
      this.sim.processInput(carrier);
    } else {
      carrier.input = emptyInput();
      carrier.input.pass = true;
      this.sim.processInput(carrier);
    }
    this.syncFromSim();
    return { success: true };
  }

  get homeScore() { return this.sim.score[0]; }
  get awayScore() { return this.sim.score[1]; }
}
