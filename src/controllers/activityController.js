// ============================================================
// src/controllers/activityController.js
//
// TWO exports:
//   logActivity(opts)           — internal helper, called from
//                                  every other controller
//   getActivity(req, res)       — GET /api/activity endpoint
// ============================================================

const pool       = require('../config/db');
const { Errors } = require('../utils/AppError');

// ────────────────────────────────────────────────────────────
// INTERNAL HELPER — logActivity
//
// Call from any controller after a successful write:
//
//   const { logActivity } = require('./activityController');
//   await logActivity({
//     type:        'job',
//     action:      `Job ${jobId} raised — ${title}`,
//     entity_type: 'job',
//     entity_id:   jobId,
//     performed_by: req.user.id,
//   });
// ────────────────────────────────────────────────────────────
const logActivity = async ({ type, action, entity_type = null, entity_id = null, performed_by = null }) => {
  try {
    await pool.query(
      `INSERT INTO activity_log (type, action, entity_type, entity_id, performed_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [type, action, entity_type, entity_id ? String(entity_id) : null, performed_by || null]
    );
  } catch (err) {
    // Activity logging must never crash the main request
    console.error('[Activity] Failed to log:', err.message);
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/activity
// Query params:
//   type     — filter by module (job | report | client | ...)
//   page     — default 1
//   limit    — default 30, max 100
// ────────────────────────────────────────────────────────────
const getActivity = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 30));
    const offset = (page - 1) * limit;
    const { type } = req.query;

    const conditions = [];
    const values     = [];

    if (type) {
      values.push(type);
      conditions.push(`a.type = $${values.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM activity_log a ${where}`, values
    );
    const total = parseInt(countRes.rows[0].count);

    values.push(limit, offset);

    const result = await pool.query(
      `SELECT
         a.id,
         a.type,
         a.action,
         a.entity_type,
         a.entity_id,
         a.performed_at,
         json_build_object(
           'id',         u.id,
           'name',       CONCAT(u.first_name, ' ', u.last_name),
           'role',       u.role
         ) AS performed_by
       FROM activity_log a
       LEFT JOIN users u ON u.id = a.performed_by
       ${where}
       ORDER BY a.performed_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    return res.status(200).json({
      success: true,
      data:    result.rows,
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    });

  } catch (err) {
    console.error('Get activity error:', err);
    return Errors.internalError(res);
  }
};

module.exports = { logActivity, getActivity };
