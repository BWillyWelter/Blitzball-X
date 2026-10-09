import express from 'express';
import cors from 'cors';
import { crypto } from 'node:crypto';
import saveRoutes from './routes/save.js';
import matchRoutes from './routes/match.js';
import db from './db.js';

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware Setup
app.use(cors());
app.use(express.json({ limit: '5mb' })); // Higher limit to accommodate replay input logs

// Anonymous Device Auth Route
app.post('/api/auth/anonymous', (req, res) => {
  const { username } = req.body;
  const userId = `usr_${Math.random().toString(36).substring(2, 11)}`;
  const finalUsername = username || `Player_${userId.substring(4, 8)}`;

  const stmt = db.prepare('INSERT INTO users (id, username, created_at) VALUES (?, ?, ?)');
  stmt.run(userId, finalUsername, Date.now());

  return res.json({ userId, username: finalUsername });
});

// Route Registrations
app.use('/api/user', saveRoutes);
app.use('/api/match', matchRoutes);

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'online', timestamp: Date.now() });
});

app.listen(PORT, () => {
  console.log(`[Blitzball-X Backend] Server listening on http://localhost:${PORT}`);
});
