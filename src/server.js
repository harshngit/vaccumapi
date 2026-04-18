// ============================================================
// src/server.js
// ============================================================

require('dotenv').config();
const http = require('http');
const app  = require('./app');
const { initWebSocket }    = require('./config/websocketManager');
const { startAmcExpiryJob } = require('./jobs/amcExpiryJob');

const PORT = process.env.PORT || 3000;

// ─── Create HTTP server (required for WebSocket upgrade) ─────
const server = http.createServer(app);

// ─── Attach WebSocket server ──────────────────────────────────
initWebSocket(server);

// ─── Start AMC expiry notification cron ──────────────────────
// Fires amc_expiring notifications once at startup, then daily.
startAmcExpiryJob();

// ─── Start listening ──────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`🚀 VDTI Service Hub API running on port ${PORT}`);
  console.log(`📚 Swagger docs: http://localhost:${PORT}/api-docs`);
  console.log(`🔌 WebSocket:    ws://localhost:${PORT}/ws`);
  console.log(`🌍 Environment:  ${process.env.NODE_ENV || 'development'}`);
});

// ─── Graceful shutdown ────────────────────────────────────────
process.on('SIGTERM', () => {
  console.log('SIGTERM received — shutting down gracefully...');
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});

module.exports = server;