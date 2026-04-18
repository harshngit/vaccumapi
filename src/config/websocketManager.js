// ============================================================
// src/config/websocketManager.js
// WebSocket server — real-time notifications for web + mobile
//
// EVENTS EMITTED:
//   job_raised       — new job created
//   job_status       — job status changed
//   report_submitted — new report submitted
//   report_reviewed  — report approved / rejected
//   amc_expiring     — AMC nearing expiry
//   notification     — generic notification message
//
// CLIENT USAGE (browser / React Native):
//   const ws = new WebSocket('wss://vaccumapi-production.up.railway.app');
//   ws.onopen  = () => ws.send(JSON.stringify({ type: 'auth', token: 'JWT...' }));
//   ws.onmessage = (e) => {
//     const msg = JSON.parse(e.data);
//     console.log(msg.event, msg.data);
//   };
// ============================================================

const WebSocket = require('ws');
const jwt       = require('jsonwebtoken');
const pool      = require('./db');

let wss = null;

// ─── Client store: Map<userId, Set<WebSocket>> ───────────────
// One user may have multiple open tabs / devices
const clients = new Map();

// ─── Initialize WebSocket server ─────────────────────────────
const initWebSocket = (server) => {
  wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    console.log('[WS] New connection from', req.socket.remoteAddress);

    ws.isAuthenticated = false;
    ws.userId          = null;
    ws.userRole        = null;

    // ── Auth timeout: close if not authenticated within 10s ──
    const authTimeout = setTimeout(() => {
      if (!ws.isAuthenticated) {
        ws.send(JSON.stringify({ event: 'error', data: { message: 'Authentication timeout.' } }));
        ws.close(4001, 'Authentication timeout');
      }
    }, 10000);

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        // ── Handle auth message ────────────────────────────
        if (msg.type === 'auth') {
          if (!msg.token) {
            return ws.send(JSON.stringify({ event: 'error', data: { message: 'Token required.' } }));
          }

          let decoded;
          try {
            decoded = jwt.verify(msg.token, process.env.JWT_SECRET);
          } catch {
            ws.send(JSON.stringify({ event: 'error', data: { message: 'Invalid or expired token.' } }));
            return ws.close(4001, 'Invalid token');
          }

          // Verify user still exists and is active
          const userRes = await pool.query(
            'SELECT id, role, is_active FROM users WHERE id = $1', [decoded.id]
          );

          if (!userRes.rows.length || !userRes.rows[0].is_active) {
            ws.send(JSON.stringify({ event: 'error', data: { message: 'Account not found or inactive.' } }));
            return ws.close(4003, 'Unauthorized');
          }

          clearTimeout(authTimeout);

          ws.isAuthenticated = true;
          ws.userId          = decoded.id;
          ws.userRole        = userRes.rows[0].role;

          // Register in clients map
          if (!clients.has(ws.userId)) clients.set(ws.userId, new Set());
          clients.get(ws.userId).add(ws);

          ws.send(JSON.stringify({
            event: 'connected',
            data: {
              message:  'Authenticated successfully.',
              user_id:  ws.userId,
              role:     ws.userRole,
            },
          }));

          console.log(`[WS] User ${ws.userId} (${ws.userRole}) authenticated`);
          return;
        }

        // ── Handle ping (keep-alive) ───────────────────────
        if (msg.type === 'ping') {
          return ws.send(JSON.stringify({ event: 'pong', data: { ts: Date.now() } }));
        }

        // All other messages require auth
        if (!ws.isAuthenticated) {
          return ws.send(JSON.stringify({ event: 'error', data: { message: 'Not authenticated.' } }));
        }

      } catch {
        ws.send(JSON.stringify({ event: 'error', data: { message: 'Invalid message format. Send JSON.' } }));
      }
    });

    ws.on('close', () => {
      if (ws.userId && clients.has(ws.userId)) {
        clients.get(ws.userId).delete(ws);
        if (clients.get(ws.userId).size === 0) clients.delete(ws.userId);
      }
      console.log(`[WS] User ${ws.userId || 'unauthenticated'} disconnected`);
    });

    ws.on('error', (err) => {
      console.error('[WS] Socket error:', err.message);
    });
  });

  console.log('✅ WebSocket server initialized at /ws');
  return wss;
};

// ─── Send to a specific user (all their devices) ─────────────
const sendToUser = (userId, event, data) => {
  if (!wss) return;
  const userSockets = clients.get(userId);
  if (!userSockets) return;

  const payload = JSON.stringify({ event, data, ts: new Date().toISOString() });
  for (const ws of userSockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
};

// ─── Send to all users with a given role ─────────────────────
const sendToRole = (role, event, data) => {
  if (!wss) return;
  const payload = JSON.stringify({ event, data, ts: new Date().toISOString() });
  for (const [, userSockets] of clients) {
    for (const ws of userSockets) {
      if (ws.readyState === WebSocket.OPEN && ws.userRole === role) {
        ws.send(payload);
      }
    }
  }
};

// ─── Broadcast to ALL connected authenticated clients ─────────
const broadcast = (event, data) => {
  if (!wss) return;
  const payload = JSON.stringify({ event, data, ts: new Date().toISOString() });
  for (const [, userSockets] of clients) {
    for (const ws of userSockets) {
      if (ws.readyState === WebSocket.OPEN && ws.isAuthenticated) {
        ws.send(payload);
      }
    }
  }
};

// ─── Send to multiple roles ───────────────────────────────────
const sendToRoles = (roles, event, data) => {
  for (const role of roles) sendToRole(role, event, data);
};

// ─── Convenience: get count of connected users ───────────────
const getConnectedCount = () => clients.size;

module.exports = {
  initWebSocket,
  sendToUser,
  sendToRole,
  sendToRoles,
  broadcast,
  getConnectedCount,
};
