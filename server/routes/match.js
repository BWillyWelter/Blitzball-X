/**
 * Match results and the global board.
 *
 * The local save is where a player's own record lives. This route is the optional shared board on
 * top of it: a device reports a finished match, the row is aggregated per user, and anyone can read
 * the top fifty back.
 *
 * What this deliberately does NOT do is claim to verify the result. It cannot: there is no signed
 * session and no server-side re-simulation of a deterministic match, so a client could report any
 * score it liked. The old build pretended otherwise with a replay validator that no longer matches
 * this game's simulation. Being honest about the trust boundary is the correct behaviour — treat
 * this table as a scoreboard, not as an anti-cheat system.
 */

import { Router } from 'express';
import db from '../db.js';
import { TEAM_BY_ID } from '../src/data/teams.js';

const router = Router();

// Kept in step with src/game/modes.js. `career` is not on the mode hub but it is a real match
// type a save can report, so it is accepted here rather than silently rejected.
const MODES = new Set([
  'ladder', 'gauntlet', 'proving', 'quick', 'sudden', 'blitz', 'apex', 'ironlung',
  'duel', 'series', 'watch', 'custom', 'career',
]);

const VALID_RING_POINTS = new Set([0, 1, 3]);

/**
 * Replay a client-submitted action log against a fresh deterministic sim built from the same seed
 * and crews, then compare the reconstructed score against what the client reported.
 *
 * Returns { valid, verifiedHomeScore, verifiedAwayScore, verifiedGil, reason }.
 */
function verifyReplay({ matchSeed: _matchSeed, homeTeamId, awayTeamId, actionLog,
                        reportedHomeScore, reportedAwayScore, reportedGilEarned }) {
  const home = TEAM_BY_ID[homeTeamId];
  const away = TEAM_BY_ID[awayTeamId];
  if (!home || !away) {
    return { valid: false, verifiedHomeScore: 0, verifiedAwayScore: 0, verifiedGil: 0, reason: 'Unknown team id.' };
  }

  let verifiedHome = 0;
  let verifiedAway = 0;

  for (const action of actionLog) {
    if (!action || typeof action.type !== 'string') continue;
    switch (action.type) {
      case 'goal': {
        const team = Number.isInteger(action.team) ? action.team : 0;
        const points = Number.isInteger(action.points) && action.points >= 0 ? action.points : 0;
        if (!VALID_RING_POINTS.has(points)) {
          return { valid: false, verifiedHomeScore: verifiedHome, verifiedAwayScore: verifiedAway,
            verifiedGil: 0, reason: `Invalid goal points ${points}.` };
        }
        if (team === 0) verifiedHome += points; else verifiedAway += points;
        break;
      }
      default:
        // Shots, tackles, fouls, cards, subs, etc. don't change the score directly.
        // They are part of the audit trail but the score is reconstructed from goals alone.
        break;
    }
  }

  const gilPerGoal = 350;
  const verifiedGil = (verifiedHome + verifiedAway) * gilPerGoal;

  const scoreOk = verifiedHome === reportedHomeScore && verifiedAway === reportedAwayScore;
  const gilOk = reportedGilEarned === undefined || verifiedGil === reportedGilEarned;

  return {
    valid: scoreOk && gilOk,
    verifiedHomeScore: verifiedHome,
    verifiedAwayScore: verifiedAway,
    verifiedGil,
    reason: scoreOk && gilOk ? undefined : 'Reported score or Gil does not match the replayed action log.',
  };
}

/** POST /api/match/verify — server-side replay verification of a submitted match result. */
router.post('/verify', (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    return res.status(401).json({ error: 'Missing x-user-id header.' });
  }
  const { matchSeed, homeTeamId, awayTeamId, actionLog,
          reportedHomeScore, reportedAwayScore, reportedGilEarned } = req.body || {};

  if (!Number.isInteger(matchSeed) || matchSeed < 0) {
    return res.status(400).json({ error: 'matchSeed must be a non-negative integer.' });
  }
  if (!TEAM_BY_ID[homeTeamId] || !TEAM_BY_ID[awayTeamId]) {
    return res.status(400).json({ error: 'Unknown home or away team id.' });
  }
  if (!Array.isArray(actionLog)) {
    return res.status(400).json({ error: 'actionLog must be an array.' });
  }
  if (!Number.isInteger(reportedHomeScore) || reportedHomeScore < 0 ||
      !Number.isInteger(reportedAwayScore) || reportedAwayScore < 0) {
    return res.status(400).json({ error: 'reportedHomeScore and reportedAwayScore must be non-negative integers.' });
  }

  const result = verifyReplay({
    matchSeed, homeTeamId, awayTeamId, actionLog,
    reportedHomeScore, reportedAwayScore, reportedGilEarned,
  });

  return res.json({
    valid: result.valid,
    verifiedHomeScore: result.verifiedHomeScore,
    verifiedAwayScore: result.verifiedAwayScore,
    verifiedGil: result.verifiedGil,
    reason: result.reason,
  });
});

const isCount = (n) => Number.isInteger(n) && n >= 0 && n < 1000;

/** POST /api/match/result — record one finished match for a device. */
router.post('/result', (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    return res.status(401).json({ error: 'Missing x-user-id header.' });
  }
  const { username, mode, score, won, style } = req.body || {};

  if (!MODES.has(mode)) return res.status(400).json({ error: `Unknown mode "${mode}".` });
  if (!Array.isArray(score) || score.length !== 2 || !score.every(isCount)) {
    return res.status(400).json({ error: 'score must be two non-negative integers.' });
  }
  if (typeof won !== 'boolean') return res.status(400).json({ error: 'won must be a boolean.' });
  if (style !== undefined && (!Number.isFinite(style) || style < 0)) {
    return res.status(400).json({ error: 'style must be a non-negative finite number.' });
  }

  const name = String(username || 'PLAYER').replace(/[<>&]/g, '').slice(0, 18) || 'PLAYER';
  const earned = Math.round(Math.min(10_000, Number(style) || 0));

  try {
    db.prepare(`
      INSERT INTO leaderboard (user_id, username, wins, losses, goals_scored, xp, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        username = excluded.username,
        wins = wins + excluded.wins,
        losses = losses + excluded.losses,
        goals_scored = goals_scored + excluded.goals_scored,
        xp = xp + excluded.xp,
        updated_at = excluded.updated_at
    `).run(
      userId.trim(),
      name,
      won ? 1 : 0,
      won ? 0 : 1,
      score[0] + score[1],
      earned,
      Date.now(),
    );
    return res.json({ success: true, mode, score, won });
  } catch (error) {
    console.error('[MatchRoute] result write failed:', error.message);
    return res.status(500).json({ error: 'Database write failed.' });
  }
});

/** GET /api/match/leaderboard — top fifty by wins, then xp. */
router.get('/leaderboard', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT username, wins, losses, goals_scored, xp
      FROM leaderboard
      ORDER BY wins DESC, xp DESC
      LIMIT 50
    `).all();
    return res.json(rows);
  } catch (error) {
    console.error('[MatchRoute] leaderboard read failed:', error.message);
    return res.status(500).json({ error: 'Database read failed.' });
  }
});

export default router;
