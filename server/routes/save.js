import { Router } from 'express';
import db from '../db.js';

const router = Router();

// Retrieve User Save Data
router.get('/save', (req, res) => {
  const userId = req.headers['x-user-id'];

  if (!userId) {
    return res.status(401).json({ error: 'Missing x-user-id header' });
  }

  const row = db.prepare('SELECT payload, updated_at FROM saves WHERE user_id = ?').get(userId);

  if (!row) {
    return res.status(404).json({ error: 'No save data found' });
  }

  const payload = JSON.parse(row.payload);
  payload.updatedAt = row.updated_at;

  return res.json(payload);
});

// Update User Save Data
router.post('/save', (req, res) => {
  const userId = req.headers['x-user-id'];
  const saveData = req.body;

  if (!userId) {
    return res.status(401).json({ error: 'Missing x-user-id header' });
  }

  if (!saveData || typeof saveData !== 'object') {
    return res.status(400).json({ error: 'Invalid save payload' });
  }

  const updatedAt = saveData.updatedAt || Date.now();
  const payloadString = JSON.stringify(saveData);

  const stmt = db.prepare(`
    INSERT INTO saves (user_id, payload, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `);

  stmt.run(userId, payloadString, updatedAt);

  return res.json({ success: true, updatedAt });
});

export default router;
