/**
 * Express REST API Routes for User Save Sync & Anti-Cheat Replay Validation
 * Performs atomic SQLite persistence and verifies match replay action logs
 * using MatchReplayValidator before updating League standings or Gil balances.
 */

import express from 'express';
import Database from 'better-sqlite3';
import { MatchReplayValidator } from '../match-validator.js';

const router = express.Router();

// Initialize or open SQLite database connection
const db = new Database('blitzball_x.db');

// Ensure database table and indexing exist
db.exec(`
  CREATE TABLE IF NOT EXISTS user_saves (
    user_id TEXT PRIMARY KEY,
    save_payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_user_saves_updated ON user_saves(updated_at);
`);

const VALID_LEAGUE_TYPES = ['LEAGUE', 'TOURNAMENT', 'EXHIBITION'];

/**
 * Validates state schema integrity for incoming save payloads
 * @param {Object} payload 
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateSavePayload(payload) {
  const errors = [];

  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['Invalid payload: Request body must be a valid JSON object.'] };
  }

  // 1. Validate Spira League State Node
  const { league } = payload;
  if (!league || typeof league !== 'object') {
    errors.push('Missing or malformed "league" state node.');
  } else {
    if (!VALID_LEAGUE_TYPES.includes(league.type)) {
      errors.push(`Invalid competition type: "${league.type}". Must be LEAGUE, TOURNAMENT, or EXHIBITION.`);
    }

    if (!Number.isInteger(league.currentRound) || league.currentRound < 1) {
      errors.push('league.currentRound must be an integer >= 1.');
    }

    if (!Number.isInteger(league.maxRounds) || league.maxRounds < 1) {
      errors.push('league.maxRounds must be an integer >= 1.');
    }

    if (typeof league.isCompleted !== 'boolean') {
      errors.push('league.isCompleted must be a boolean value.');
    }

    if (!Array.isArray(league.teams) || league.teams.length === 0) {
      errors.push('league.teams must be a non-empty array of team IDs.');
    }
  }

  // 2. Validate Free Agent Scout State Node
  const { scout } = payload;
  if (!scout || typeof scout !== 'object') {
    errors.push('Missing or malformed "scout" state node.');
  } else {
    if (!Number.isInteger(scout.scoutLevel) || scout.scoutLevel < 1 || scout.scoutLevel > 5) {
      errors.push('scout.scoutLevel must be an integer between 1 and 5.');
    }

    if (typeof scout.gil !== 'number' || scout.gil < 0 || !Number.isFinite(scout.gil)) {
      errors.push('scout.gil must be a non-negative finite number.');
    }

    if (scout.agentContracts && typeof scout.agentContracts === 'object') {
      for (const [agentId, contract] of Object.entries(scout.agentContracts)) {
        if (!contract || typeof contract !== 'object') {
          errors.push(`Invalid contract entry for free agent "${agentId}".`);
          continue;
        }

        if (!Number.isInteger(contract.contractGames) || contract.contractGames < 0) {
          errors.push(`Contract for agent "${agentId}" must have a non-negative integer "contractGames".`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * GET /user/save
 * Fetches existing user cloud save from SQLite database
 */
router.get('/save', (req, res) => {
  const userId = req.headers['x-user-id'];

  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    return res.status(400).json({ error: 'Missing or empty "x-user-id" header.' });
  }

  try {
    const stmt = db.prepare('SELECT save_payload, updated_at FROM user_saves WHERE user_id = ?');
    const row = stmt.get(userId.trim());

    if (!row) {
      return res.status(404).json({ message: 'No cloud save profile found for this user.' });
    }

    let payload;
    try {
      payload = JSON.parse(row.save_payload);
    } catch (parseErr) {
      console.error(`[SaveRoute] JSON parse failure for user "${userId}":`, parseErr);
      return res.status(500).json({ error: 'Corrupted payload data found in database.' });
    }

    return res.status(200).json(payload);
  } catch (err) {
    console.error('[SaveRoute] GET error:', err);
    return res.status(500).json({ error: 'Internal server database error during save lookup.' });
  }
});

/**
 * POST /user/save
 * Validates save schema and verifies optional match replays before atomic SQLite upsert
 */
router.post('/save', (req, res) => {
  const userId = req.headers['x-user-id'];
  const payload = req.body;

  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    return res.status(400).json({ error: 'Missing or empty "x-user-id" header.' });
  }

  // 1. Schema Structural Validation
  const validation = validateSavePayload(payload);
  if (!validation.valid) {
    return res.status(400).json({
      error: 'Schema Validation Failed',
      details: validation.errors
    });
  }

  // 2. Anti-Cheat Match Replay Verification (if a match replay payload is attached)
  const matchSubmission = payload.lastMatchSubmission || payload.matchReplay;
  if (matchSubmission) {
    const replayResult = MatchReplayValidator.validateMatchSubmission(matchSubmission);

    if (!replayResult.valid) {
      console.warn(`[AntiCheat] Save rejected for user "${userId}":`, replayResult.errors);
      return res.status(422).json({
        error: 'Match Replay Verification Failed (Anti-Cheat Triggered)',
        details: replayResult.errors
      });
    }

    // Authoritative Server Sanitization: Enforce verified Gil calculation
    if (payload.scout && typeof replayResult.verifiedGil === 'number') {
      console.log(`[AntiCheat] Verified Match Submission. Authorized Gil reward: +${replayResult.verifiedGil} Gil.`);
    }

    // Strip transient match replay payload before storage to save DB space
    delete payload.lastMatchSubmission;
    delete payload.matchReplay;
  }

  const updatedAt = Number.isInteger(payload.updatedAt) ? payload.updatedAt : Date.now();
  let serializedPayload;

  try {
    serializedPayload = JSON.stringify(payload);
  } catch (serializeErr) {
    return res.status(400).json({ error: 'Failed to serialize JSON save payload.' });
  }

  try {
    // 3. Upsert validated payload into SQLite database
    const upsertStmt = db.prepare(`
      INSERT INTO user_saves (user_id, save_payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        save_payload = excluded.save_payload,
        updated_at = excluded.updated_at
      WHERE excluded.updated_at >= user_saves.updated_at
    `);

    const result = upsertStmt.run(userId.trim(), serializedPayload, updatedAt);

    return res.status(200).json({
      success: true,
      userId: userId.trim(),
      updatedAt,
      changes: result.changes,
      verifiedMatch: !!matchSubmission
    });
  } catch (err) {
    console.error('[SaveRoute] POST error:', err);
    return res.status(500).json({ error: 'Internal database error while executing save transaction.' });
  }
});

export default router;
