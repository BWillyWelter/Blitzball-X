import http from 'node:http';
import express from 'express';
import cors from 'cors';
import saveRoutes from './routes/save.js';
import matchRoutes from './routes/match.js';
import db from './db.js';
import { createDuelServer } from './ws.js';

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware Setup
app.use(cors());
app.use(express.json({ limit: '5mb' })); // Higher limit to accommodate replay input logs

// Anonymous Device Auth Route
//
// usernames are UNIQUE in the schema, so a name someone already took must not 500 the request:
// the suffix loop keeps a preferred name when it is free and quietly makes it unique when it is
// not.
app.post('/api/auth/anonymous', (req, res) => {
  const requested = typeof req.body?.username === 'string'
    ? req.body.username.replace(/[<>&]/g, '').trim().slice(0, 18)
    : '';
  const userId = `usr_${Math.random().toString(36).slice(2, 11)}`;
  const base = requested || `Player_${userId.slice(4, 8)}`;
  const insert = db.prepare('INSERT INTO users (id, username, created_at) VALUES (?, ?, ?)');

  try {
    for (let attempt = 0; attempt < 12; attempt++) {
      const candidate = attempt === 0 ? base : `${base.slice(0, 15)}${Math.floor(Math.random() * 9000 + 1000)}`;
      try {
        insert.run(userId, candidate, Date.now());
        return res.json({ userId, username: candidate });
      } catch (error) {
        if (!String(error.message).includes('UNIQUE')) throw error;
      }
    }
    return res.status(503).json({ error: 'Could not allocate a username. Try another name.' });
  } catch (error) {
    console.error('[Auth] anonymous user creation failed:', error.message);
    return res.status(500).json({ error: 'Could not create an anonymous profile.' });
  }
});

// Route Registrations
app.use('/api/user', saveRoutes);
app.use('/api/match', matchRoutes);

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'online', timestamp: Date.now() });
});

// The HTTP server is created explicitly so the online-duel WebSocket server can share the port:
// one process, one origin, no separate socket host for a client to guess.
const server = http.createServer(app);
const duel = createDuelServer(server, { path: '/ws' });

app.get('/api/duel/stats', (req, res) => {
  res.json({ status: 'online', ...duel.stats() });
});

server.listen(PORT, () => {
  console.log(`[Blitzball-X Backend] Server listening on http://localhost:${PORT}`);
  console.log(`[Blitzball-X Backend] Online duel rooms at ws://localhost:${PORT}/ws`);
});

// Unknown /api routes answer in JSON rather than Express's HTML error page, so a client that
// mistypes a path gets something it can actually read.
app.use('/api', (req, res) => {
  res.status(404).json({ error: `No API route for ${req.method} ${req.originalUrl}` });
});

// Anything thrown inside a handler lands here instead of leaking a stack trace as HTML.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('[Blitzball-X Backend] Unhandled request error:', error.message);
  return res.status(500).json({ error: 'Server error.' });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    duel.close();
    server.close(() => process.exit(0));
  });
}
