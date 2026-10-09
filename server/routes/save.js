/**
 * Express REST API Routes for User Save Sync & Validation
 * Validates schema integrity for Career, League/Tournament, and Scout progress payloads.
 */

import express from 'express';
import Database from 'better-sqlite3';

const router = express.Router();

// Initialize or connect to SQLite database
const db = new Database('blitzball_x.db');

// Ensure database schema table exists with indexing on user_id
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
 * Validates League and Scout payload structure and data types
 * @param {Object} payload 
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateSavePayload(payload) {
  const errors = [];

  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['Invalid save payload: Payload must be a non-null object.'] };
  }

  // 1. Validate League State Node
  const { league } = payload;
  if (!league || typeof league !== 'object') {
    errors.push('Missing or malformed "league" state node.');
  } else {
    if (!VALID_LEAGUE_TYPES.includes(league.type)) {
      errors.push(`Invalid league type: "${league.type}". Must be LEAGUE, TOURNAMENT, or EXHIBITION.`);
    }

    if (!Number.isInteger(league.currentRound) || league.currentRound < 1) {
      errors.push('league.currentRound must be an integer >= 1.');
    }

    if (!Number.isInteger(league.maxRounds) || league.maxRounds < 1) {
      errors.push('league.maxRounds must be an integer >= 1.');
    }

    if (typeof league.isCompleted !== 'boolean') {
      errors.push('league.isCompleted must be a boolean.');
    }

    if (!Array.isArray(league.teams) || league.teams.length === 0) {
      errors.push('league.teams must be a non-empty array of team identifiers.');
    }
  }

  // 2. Validate Scout State Node
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
          errors.push(`Invalid contract node for agent "${agentId}".`);
          continue;
        }

        if (!Number.isInteger(contract.contractGames) || contract.contractGames < 0) {
          errors.push(`Agent contract for "${agentId}" must have a non-negative integer "contractGames".`);
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
 * Retrieves the latest persisted save payload for a given user ID
 */
router.get('/save', (req, res) => {
  const userId = req.headers['x-user-id'];

  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    return res.status(400).json({ error: 'Missing required "x-user-id" header.' });
  }

  try {
    const stmt = db.prepare('SELECT save_payload, updated_at FROM user_saves WHERE user_id = ?');
    const row = stmt.get(userId.trim());

    if (!row) {
      return res.status(404).json({ message: 'No cloud save found for this user ID.' });
    }

    let payload;
    try {
      payload = JSON.parse(row.save_payload);
    } catch (parseErr) {
      console.error(`[SaveRoute] Malformed JSON payload for user "${userId}":`, parseErr);
      return res.status(500).json({ error: 'Corrupted save data found in database.' });
    }

    return res.status(200).json(payload);
  } catch (err) {
    console.error('[SaveRoute] GET error:', err);
    return res.status(500).json({ error: 'Internal database error while retrieving save payload.' });
  }
});

/**
 * POST /user/save
 * Validates schema and upserts League and Scout save data into SQLite
 */
router.post('/save', (req, res) => {
  const userId = req.headers['x-user-id'];
  const payload = req.body;

  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    return res.status(400).json({ error: 'Missing required "x-user-id" header.' });
  }

  // Schema Validation
  const validation = validateSavePayload(payload);
  if (!validation.valid) {
    return res.status(400).json({
      error: 'Validation Failed',
      details: validation.errors
    });
  }

  const updatedAt = Number.isInteger(payload.updatedAt) ? payload.updatedAt : Date.now();
  let serializedPayload;

  try {
    serializedPayload = JSON.stringify(payload);
  } catch (serializeErr) {
    return res.status(400).json({ error: 'Failed to serialize payload to valid JSON string.' });
  }

  try {
    const upsertStmt = db.prepare(`
      INSERT INTO user_saves (user_id, save_payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        save_payload = excluded.save_payload,
        updated_at = excluded.updated_at
      WHERE excluded.updated_at >= user_saves.updated_at
    `);

    const info = upsertStmt.run(userId.trim(), serializedPayload, updatedAt);

    return res.status(200).json({
      success: true,
      userId: userId.trim(),
      updatedAt,
      rowsAffected: info.changes
    });
  } catch (err) {
    console.error('[SaveRoute] POST error:', err);
    return res.status(500).json({ error: 'Internal database error while persisting save payload.' });
  }
});

export default router;
