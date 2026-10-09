import { Router } from 'express';
import { MatchValidator } from '../match-validator.js';
import db from '../db.js';

const router = Router();

// Submit & Validate Completed Match
router.post('/submit', (req, res) => {
  const userId = req.headers['x-user-id'];
  const { seed, homeTeamId, awayTeamId, inputLog, claimedHomeScore, claimedAwayScore, username } = req.body;

  if (!userId) {
    return res.status(401).json({ error: 'Missing x-user-id header' });
  }

  // 1. Run Headless Replay Validation Engine
  const validation = MatchValidator.validateMatch({
    seed,
    homeTeamId,
    awayTeamId,
    inputLog: inputLog || [],
    claimedHomeScore,
    claimedAwayScore
  });

  if (!validation.valid) {
    console.warn(`[Anti-Cheat Triggered] User ${userId} failed match validation: ${validation.reason}`);
    return res.status(400).json({
      success: false,
      error: 'Match verification failed. Result rejected.',
      details: validation.reason
    });
  }

  // 2. Update Leaderboard Stats on Verified Match
  const isWin = claimedHomeScore > claimedAwayScore;
  const userScore = claimedHomeScore;

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
    userScore,
    isWin ? 150 : 50,
    Date.now()
  );

  return res.json({
    success: true,
    verifiedScore: { home: validation.serverHomeScore, away: validation.serverAwayScore },
    checksum: validation.checksum
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
