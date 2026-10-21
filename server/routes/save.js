/**
 * Cloud save endpoints.
 *
 * The game saves to localStorage and always will — that is the source of truth for a browser
 * build. This route is the optional sync target for a device that wants its career, ladder and
 * records on another machine: same JSON blob the client writes locally, keyed by the anonymous
 * device id from POST /api/auth/anonymous.
 *
 * Validation is structural, not authoritative. It refuses payloads the client could not have
 * produced (wrong types, impossible ratings, a career without a crew), which keeps a corrupt save
 * from poisoning the table, and it makes no claim to have verified a match.
 */

import express from 'express';
import db from '../db.js';

const router = express.Router();

const RATING_FLOOR = 700;
const RATING_CEILING = 4000;

/** Structural validation of the payload the client saves. */
export function validateSavePayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, errors: ['Request body must be a JSON object.'] };
  }

  // Career: either absent/null (no run yet) or a run with a known crew and a ladder.
  const { career } = payload;
  if (career !== null && career !== undefined) {
    if (typeof career !== 'object') errors.push('career must be an object or null.');
    else {
      if (typeof career.teamId !== 'string' || !career.teamId) errors.push('career.teamId must be a non-empty string.');
      if (!Array.isArray(career.ladder)) errors.push('career.ladder must be an array of crew ids.');
      if (!Number.isInteger(career.stage) || career.stage < 0) errors.push('career.stage must be a non-negative integer.');
      for (const key of ['wins', 'losses']) {
        if (career[key] !== undefined && (!Number.isInteger(career[key]) || career[key] < 0)) {
          errors.push(`career.${key} must be a non-negative integer.`);
        }
      }
    }
  }

  // Records are plain counters.
  if (payload.records !== undefined) {
    if (!payload.records || typeof payload.records !== 'object') errors.push('records must be an object.');
    else {
      for (const [key, value] of Object.entries(payload.records)) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
          errors.push(`records.${key} must be a non-negative finite number.`);
        }
      }
    }
  }

  // Ladder profile: the numbers the ranked screen and the rating maths depend on.
  if (payload.ranked !== null && payload.ranked !== undefined) {
    const r = payload.ranked;
    if (typeof r !== 'object' || Array.isArray(r)) errors.push('ranked must be an object or null.');
    else {
      if (!Number.isFinite(r.rating) || r.rating < RATING_FLOOR || r.rating > RATING_CEILING) {
        errors.push(`ranked.rating must be a finite number between ${RATING_FLOOR} and ${RATING_CEILING}.`);
      }
      if (r.history !== undefined && !Array.isArray(r.history)) errors.push('ranked.history must be an array.');
      if (Array.isArray(r.history) && r.history.length > 200) errors.push('ranked.history is unreasonably long.');
      if (r.season !== undefined && (!Number.isInteger(r.season) || r.season < 1)) {
        errors.push('ranked.season must be an integer >= 1.');
      }
    }
  }

  if (payload.settings !== undefined && (typeof payload.settings !== 'object' || payload.settings === null)) {
    errors.push('settings must be an object.');
  }
  if (payload.updatedAt !== undefined && !Number.isFinite(payload.updatedAt)) {
    errors.push('updatedAt must be a finite timestamp.');
  }

  return { valid: errors.length === 0, errors };
}

function requireDevice(req, res) {
  const userId = req.headers['x-user-id'];
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    res.status(400).json({ error: 'Missing or empty "x-user-id" header.' });
    return null;
  }
  return userId.trim();
}

/** GET /api/user/save — the stored blob, or 404 when this device has never saved. */
router.get('/save', (req, res) => {
  const userId = requireDevice(req, res);
  if (!userId) return undefined;
  try {
    const row = db.prepare('SELECT payload, updated_at FROM saves WHERE user_id = ?').get(userId);
    if (!row) return res.status(404).json({ message: 'No cloud save for this device.' });
    try {
      return res.json({ ...JSON.parse(row.payload), serverUpdatedAt: row.updated_at });
    } catch {
      return res.status(500).json({ error: 'The stored save for this device is not valid JSON.' });
    }
  } catch (error) {
    console.error('[SaveRoute] GET failed:', error.message);
    return res.status(500).json({ error: 'Database read failed.' });
  }
});

/** PUT /api/user/save — upsert, last write wins on timestamp. */
router.put('/save', (req, res) => {
  const userId = requireDevice(req, res);
  if (!userId) return undefined;
  const payload = req.body;
  const { valid, errors } = validateSavePayload(payload);
  if (!valid) return res.status(400).json({ error: 'Save rejected.', details: errors });

  const updatedAt = Number.isFinite(payload.updatedAt) ? payload.updatedAt : Date.now();
  let serialized;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    return res.status(400).json({ error: 'Save could not be serialised.' });
  }
  if (serialized.length > 2_000_000) {
    return res.status(413).json({ error: 'Save exceeds the 2 MB limit.' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO saves (user_id, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
      WHERE excluded.updated_at >= saves.updated_at
    `).run(userId, serialized, updatedAt);
    return res.json({ success: true, userId, updatedAt, stored: result.changes > 0 });
  } catch (error) {
    console.error('[SaveRoute] PUT failed:', error.message);
    return res.status(500).json({ error: 'Database write failed.' });
  }
});

/** DELETE /api/user/save — forget this device's cloud save. */
router.delete('/save', (req, res) => {
  const userId = requireDevice(req, res);
  if (!userId) return undefined;
  try {
    const result = db.prepare('DELETE FROM saves WHERE user_id = ?').run(userId);
    return res.json({ success: true, removed: result.changes });
  } catch (error) {
    console.error('[SaveRoute] DELETE failed:', error.message);
    return res.status(500).json({ error: 'Database write failed.' });
  }
});

export default router;
