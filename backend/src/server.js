'use strict';

require('dotenv').config();

const express  = require('express');
const http     = require('http');
const cors     = require('cors');
const { Server } = require('socket.io');
const webpush  = require('web-push');

const { initDb }        = require('./db/database');
const { startCronJobs } = require('./jobs/cronJobs');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:5173', methods: ['GET','POST'] }
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(express.json());

// ── Web Push setup ────────────────────────────────────────────────────────────
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// ── Routes (added in Phase 3) ─────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Routes
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/matches',     require('./routes/matches'));
app.use('/api/teams',       require('./routes/teams'));
app.use('/api/leaderboard', require('./routes/leaderboard'));
app.use('/api/admin',       require('./routes/admin'));
app.use('/api/push',        require('./routes/push'));
app.use('/api/feedback',   feedbackRouter);
app.use('/api/bootstrap',   require('./routes/bootstrap'));

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  // Client joins a match room for live updates
  socket.on('joinMatch', (matchId) => {
    socket.join(`match:${matchId}`);
  });

  socket.on('leaveMatch', (matchId) => {
    socket.leave(`match:${matchId}`);
  });

  socket.on('disconnect', () => {});
});

// ── Boot ──────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

function start() {
  initDb();
  console.log('[db] Database initialised.');

  startCronJobs(io);

  server.listen(PORT, () => {
    console.log(`[server] Fantasy Cricket backend running on port ${PORT}`);
  });
}

start();

function getIo() { return io; }
module.exports = { app, io, getIo };
