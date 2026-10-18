import { Router } from 'express';
import { MatchReplayValidator } from '../match-validator.js';
import db from '../db.js';

const router = Router();

// Submit & Validate Completed Match
router.post('/submit', (req, res) => {
  const userId = req.headers['x-user-id'];
  const {
    matchSeed, homeTeamId, awayTeamId, actionLog,
    reportedHomeScore, reportedAwayScore, reportedGilEarned, username
  } = req.body;

  if (!userId) {
    return res.status(401).json({ error: 'Missing x-user-id header' });
  }

  // 1. Run headless replay validation: the server re-simulates the encounter
  //    log from the original seed and compares it with the claimed result.
  const validation = MatchReplayValidator.validateMatchSubmission({
    matchSeed,
    homeTeamId,
    awayTeamId,
    actionLog: actionLog || [],
    reportedHomeScore,
    reportedAwayScore,
    reportedGilEarned
  });

  if (!validation.valid) {
    console.warn(`[Anti-Cheat Triggered] User ${userId} failed match validation: ${validation.errors.join(' | ')}`);
    return res.status(400).json({
      success: false,
      error: 'Match verification failed. Result rejected.',
      details: validation.errors
    });
  }

  // 2. Update leaderboard stats with the server-verified result and Gil reward.
  const isWin = validation.verifiedHomeScore > validation.verifiedAwayScore;
  const stmt = db.prepare(`
    INSERT INTO leaderboard (user_id, username, wins, losses, goals_scored, xp, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      username = excluded.username,
      wins = wins + excluded.wins,
      losses = losses + excluded.losses,
      goals_scored = goals_scored + excluded.goals_scored,
      xp = xp + excluded.xp,
      updated_at = excluded.updated_at
  `);

  stmt.run(
    userId,
    username || 'Player',
    isWin ? 1 : 0,
    isWin ? 0 : 1,
    validation.verifiedHomeScore,
    isWin ? 150 : 50,
    Date.now()
  );

  return res.json({
    success: true,
    verifiedScore: { home: validation.verifiedHomeScore, away: validation.verifiedAwayScore },
    verifiedGil: validation.verifiedGil
  });
});

// Get Global Leaderboard Rankings
router.get('/leaderboard', (req, res) => {
  const rows = db.prepare(`
    SELECT username, wins, losses, goals_scored, xp
    FROM leaderboard
    ORDER BY wins DESC, xp DESC
    LIMIT 50
  `).all();

  return res.json(rows);
});

export default router;
