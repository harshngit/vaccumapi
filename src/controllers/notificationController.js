// ============================================================
// src/controllers/notificationController.js
// REST endpoints so the frontend can fetch persisted
// notifications (history) even after a page refresh.
//
// The WebSocket pushes them in real-time AND saves them here.
// ============================================================

const pool = require('../config/db');
const { Errors, sendError } = require('../utils/AppError');
const ERROR_CODES = require('../utils/errorCodes');

// ────────────────────────────────────────────────────────────
// INTERNAL HELPER — called by other controllers (not a route)
// Saves a notification to the DB and simultaneously pushes it
// via WebSocket to the right users.
//
// Usage:
//   const { notify } = require('./notificationController');
//   await notify({
//     event:       'job_raised',
//     title:       'New Job Raised',
//     message:     'JOB-0001 — HVAC Servicing raised by Arjun',
//     entity_type: 'job',
//     entity_id:   'JOB-0001',
//     roles:       ['admin', 'manager', 'engineer'],  // who receives it
//     // OR:
//     user_id:     5,   // send only to a specific user
//   }, wsManager);
// ────────────────────────────────────────────────────────────
const notify = async (opts, wsManager) => {
  const {
    event,
    title,
    message,
    entity_type = null,
    entity_id   = null,
    roles       = null,   // array of role strings, or null = all roles
    user_id     = null,   // specific user, takes priority over roles
  } = opts;

  try {
    if (user_id) {
      // ── Targeted to one user ─────────────────────────────
      await pool.query(
        `INSERT INTO notifications (user_id, event, title, message, entity_type, entity_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [user_id, event, title, message, entity_type, entity_id]
      );
      if (wsManager) {
        wsManager.sendToUser(user_id, event, { title, message, entity_type, entity_id });
      }
    } else if (roles && roles.length > 0) {
      // ── Targeted to one or more roles ────────────────────
      // Fetch all user IDs with those roles so we can save per-user rows
      const placeholders = roles.map((_, i) => `$${i + 1}`).join(', ');
      const usersRes = await pool.query(
        `SELECT id FROM users WHERE role = ANY(ARRAY[${placeholders}]::text[]) AND is_active = TRUE`,
        roles
      );
      for (const row of usersRes.rows) {
        await pool.query(
          `INSERT INTO notifications (user_id, role, event, title, message, entity_type, entity_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [row.id, roles[0], event, title, message, entity_type, entity_id]
        );
      }
      // Push via WS to each role
      if (wsManager) {
        for (const role of roles) {
          wsManager.sendToRole(role, event, { title, message, entity_type, entity_id });
        }
      }
    } else {
      // ── Broadcast to everyone ────────────────────────────
      // Save one row with user_id=NULL (all users fetch it)
      await pool.query(
        `INSERT INTO notifications (event, title, message, entity_type, entity_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [event, title, message, entity_type, entity_id]
      );
      if (wsManager) {
        wsManager.broadcast(event, { title, message, entity_type, entity_id });
      }
    }
  } catch (err) {
    console.error('[Notification] Failed to save/send notification:', err.message);
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/notifications
// Returns notifications for the current logged-in user:
//   - rows where user_id = me
//   - rows where user_id IS NULL and role = my role (or role IS NULL)
// ────────────────────────────────────────────────────────────
const getNotifications = async (req, res) => {
  try {
    const userId  = req.user.id;
    const role    = req.user.role;
    const limit   = Math.min(50, parseInt(req.query.limit) || 30);
    const unread  = req.query.unread === 'true';

    let whereExtra = '';
    if (unread) whereExtra = 'AND n.is_read = FALSE';

    const result = await pool.query(
      `SELECT id, event, title, message, entity_type, entity_id, is_read, created_at
       FROM notifications n
       WHERE (
         n.user_id = $1
         OR (n.user_id IS NULL AND (n.role = $2 OR n.role IS NULL))
       )
       ${whereExtra}
       ORDER BY created_at DESC
       LIMIT $3`,
      [userId, role, limit]
    );

    // Unread count
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM notifications n
       WHERE (n.user_id = $1 OR (n.user_id IS NULL AND (n.role = $2 OR n.role IS NULL)))
         AND n.is_read = FALSE`,
      [userId, role]
    );

    return res.status(200).json({
      success:      true,
      data:         result.rows,
      unread_count: parseInt(countRes.rows[0].count),
    });
  } catch (err) {
    console.error('Get notifications error:', err);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// PATCH /api/notifications/read
// Mark all (or specific IDs) as read for the current user
// Body: { ids: [1,2,3] }  OR empty body = mark ALL as read
// ────────────────────────────────────────────────────────────
const markRead = async (req, res) => {
  try {
    const userId = req.user.id;
    const role   = req.user.role;
    const { ids } = req.body;

    if (ids && Array.isArray(ids) && ids.length > 0) {
      await pool.query(
        `UPDATE notifications
         SET is_read = TRUE
         WHERE id = ANY($1::int[])
           AND (user_id = $2 OR (user_id IS NULL AND (role = $3 OR role IS NULL)))`,
        [ids, userId, role]
      );
    } else {
      // Mark all
      await pool.query(
        `UPDATE notifications
         SET is_read = TRUE
         WHERE (user_id = $1 OR (user_id IS NULL AND (role = $2 OR role IS NULL)))
           AND is_read = FALSE`,
        [userId, role]
      );
    }

    return res.status(200).json({ success: true, message: 'Notifications marked as read.' });
  } catch (err) {
    console.error('Mark read error:', err);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// DELETE /api/notifications
// Clear all notifications for the current user
// ────────────────────────────────────────────────────────────
const clearNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const role   = req.user.role;

    await pool.query(
      `DELETE FROM notifications
       WHERE user_id = $1
          OR (user_id IS NULL AND (role = $2 OR role IS NULL))`,
      [userId, role]
    );

    return res.status(200).json({ success: true, message: 'All notifications cleared.' });
  } catch (err) {
    console.error('Clear notifications error:', err);
    return Errors.internalError(res);
  }
};

module.exports = { notify, getNotifications, markRead, clearNotifications };
