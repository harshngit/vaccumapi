// ============================================================
// src/controllers/emailController.js
// ============================================================

const pool       = require('../config/db');
const nodemailer = require('nodemailer');
const { sendError, Errors } = require('../utils/AppError');
const ERROR_CODES = require('../utils/errorCodes');

// ─── Default notification trigger keys ───────────────────────
const DEFAULT_TRIGGERS = [
  { trigger_key: 'job_raised',           label: 'New Job Raised',                 is_enabled: true  },
  { trigger_key: 'job_assigned',         label: 'Job Assigned to Technician',      is_enabled: true  },
  { trigger_key: 'job_completed',        label: 'Job Completed / Closed',          is_enabled: true  },
  { trigger_key: 'report_submitted',     label: 'Report Submitted (Client Email)', is_enabled: true  },
  { trigger_key: 'report_approved',      label: 'Report Approved',                 is_enabled: false },
  { trigger_key: 'amc_created',          label: 'AMC Contract Created',            is_enabled: true  },
  { trigger_key: 'amc_renewal',          label: 'AMC Renewal Reminder',            is_enabled: true  },
  { trigger_key: 'amc_service_reminder', label: 'AMC 10-Day Service Reminder',     is_enabled: true  },
  { trigger_key: 'quotation_sent',       label: 'Quotation Sent',                  is_enabled: false },
];

// ─── Cached pooled transporter ────────────────────────────────
let _transporter    = null;
let _transporterKey = null;

const _buildTransporter = (host, port, user, pass) => {
  const key = `${host}:${port}:${user}`;
  if (_transporter && _transporterKey === key) return _transporter;

  _transporter = nodemailer.createTransport({
    host,
    port:    parseInt(port),
    secure:  parseInt(port) === 465,
    auth:    { user, pass },
    tls:     { rejectUnauthorized: false },
    pool:           true,
    maxConnections: 3,
    maxMessages:    Infinity,
  });

  _transporterKey = key;
  console.log(`[Email] Transporter built → ${host}:${port} (${user})`);
  return _transporter;
};

const _invalidateTransporter = () => {
  _transporter    = null;
  _transporterKey = null;
};

const buildTransporterFromEnv = () =>
  _buildTransporter(
    process.env.SMTP_HOST || 'smtp.gmail.com',
    process.env.SMTP_PORT || '587',
    process.env.SMTP_USER || '',
    process.env.SMTP_PASS || ''
  );

// ────────────────────────────────────────────────────────────
// sendNotification  ← FIRE AND FORGET
//
// Call WITHOUT await:
//   sendNotification('amc_created', { to, subject, html });
//
// Returns undefined immediately. SMTP work runs in background.
// A failed email NEVER affects the HTTP response.
// ────────────────────────────────────────────────────────────
const sendNotification = (triggerKey, { to, subject, html }) => {
  // Detach completely — the caller never waits for this
  _doSend(triggerKey, to, subject, html).catch(() => {});
};

async function _doSend(triggerKey, to, subject, html) {
  try {
    if (!to) {
      console.warn(`[Email] "${triggerKey}" — no recipient, skipping`);
      return;
    }

    // ── Resolve SMTP settings ─────────────────────────────────
    // Use LEFT JOIN so a missing notification_triggers row
    // defaults to is_enabled = true (not silently skipped).
    const dbResult = await pool.query(
      `SELECT
         es.smtp_host,
         es.smtp_port,
         es.from_email,
         es.from_name,
         es.smtp_password_enc,
         COALESCE(nt.is_enabled, true) AS is_enabled
       FROM email_settings es
       LEFT JOIN notification_triggers nt
         ON nt.email_settings_id = es.id
        AND nt.trigger_key = $1
       WHERE es.is_active = TRUE
       LIMIT 1`,
      [triggerKey]
    );

    let host, port, user, pass, fromName, enabled;

    if (dbResult.rows.length > 0) {
      // DB settings found — use them
      const r = dbResult.rows[0];
      enabled  = r.is_enabled;
      host     = r.smtp_host;
      port     = r.smtp_port;
      user     = r.from_email;
      fromName = r.from_name;
      // DB password takes priority; fall back to .env if DB password is empty
      pass     = (r.smtp_password_enc && r.smtp_password_enc.trim())
                   ? r.smtp_password_enc.trim()
                   : (process.env.SMTP_PASS || '');
    } else {
      // No email_settings row in DB — use .env entirely
      enabled  = true;
      host     = process.env.SMTP_HOST      || 'smtp.gmail.com';
      port     = process.env.SMTP_PORT      || '587';
      user     = process.env.SMTP_USER      || '';
      pass     = process.env.SMTP_PASS      || '';
      fromName = process.env.SMTP_FROM_NAME || 'VDTI Service Hub';
    }

    if (!enabled) {
      console.log(`[Email] "${triggerKey}" is disabled — skipping`);
      return;
    }

    if (!user) {
      console.warn(`[Email] No SMTP user configured — skipping "${triggerKey}"`);
      return;
    }

    if (!pass) {
      console.warn(`[Email] No SMTP password configured — skipping "${triggerKey}"`);
      console.warn(`[Email] Fix: set SMTP_PASS in your .env file (must be a 16-char Gmail App Password with no spaces)`);
      return;
    }

    // ── Send ──────────────────────────────────────────────────
    const transporter = _buildTransporter(host, port, user, pass);

    const info = await transporter.sendMail({
      from:    `"${fromName}" <${user}>`,
      to,
      subject,
      html,
    });

    console.log(`[Email] ✅ "${triggerKey}" → ${to} (${info.messageId})`);

  } catch (err) {
    console.error(`[Email] ❌ "${triggerKey}" → ${to} : ${err.message}`);
    // Never re-throw
  }
}

// ────────────────────────────────────────────────────────────
// GET /api/email-settings
// ────────────────────────────────────────────────────────────
const getEmailSettings = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, smtp_host, smtp_port, from_email, from_name, is_active, updated_at
       FROM email_settings WHERE is_active = TRUE LIMIT 1`
    );

    if (result.rows.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          id:        null,
          smtp_host: process.env.SMTP_HOST      || 'smtp.gmail.com',
          smtp_port: parseInt(process.env.SMTP_PORT || '587'),
          from_email: process.env.SMTP_USER     || '',
          from_name:  process.env.SMTP_FROM_NAME || 'VDTI Service Hub',
          is_active:  false,
          notifications: DEFAULT_TRIGGERS.reduce((acc, t) => {
            acc[t.trigger_key] = t.is_enabled;
            return acc;
          }, {}),
        },
        message: 'Using .env defaults (no DB config). Set up via PUT /api/email-settings.',
      });
    }

    const settings = result.rows[0];

    const triggers = await pool.query(
      `SELECT trigger_key, is_enabled, label
       FROM notification_triggers
       WHERE email_settings_id = $1 ORDER BY id`,
      [settings.id]
    );

    const notifications = {};
    for (const t of triggers.rows) notifications[t.trigger_key] = t.is_enabled;
    // Fill defaults for any trigger keys not yet in DB
    for (const d of DEFAULT_TRIGGERS) {
      if (!(d.trigger_key in notifications)) notifications[d.trigger_key] = d.is_enabled;
    }
    settings.notifications = notifications;

    return res.status(200).json({ success: true, data: settings });

  } catch (error) {
    console.error('Get email settings error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// PUT /api/email-settings  (upsert)
// ────────────────────────────────────────────────────────────
const upsertEmailSettings = async (req, res) => {
  const dbClient = await pool.connect();
  try {
    const { smtp_host, smtp_port, from_email, from_name, smtp_password, notifications } = req.body;

    if (!from_email) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        'from_email is required.', { field: 'from_email' });
    }

    const finalHost     = smtp_host || process.env.SMTP_HOST      || 'smtp.gmail.com';
    const finalPort     = smtp_port || parseInt(process.env.SMTP_PORT || '587');
    const finalFromName = from_name || process.env.SMTP_FROM_NAME  || 'VDTI Service Hub';

    await dbClient.query('BEGIN');

    const existing = await dbClient.query(
      'SELECT id, smtp_password_enc FROM email_settings WHERE is_active = TRUE LIMIT 1'
    );

    let settingsId;

    if (existing.rows.length > 0) {
      settingsId = existing.rows[0].id;
      const keepPass = smtp_password !== undefined
        ? smtp_password
        : existing.rows[0].smtp_password_enc;

      await dbClient.query(
        `UPDATE email_settings
         SET smtp_host=$1, smtp_port=$2, from_email=$3, from_name=$4,
             smtp_password_enc=$5, updated_by_user_id=$6, updated_at=NOW()
         WHERE id=$7`,
        [finalHost, finalPort, from_email, finalFromName, keepPass, req.user.id, settingsId]
      );
    } else {
      const initialPass = smtp_password || process.env.SMTP_PASS || null;
      const ins = await dbClient.query(
        `INSERT INTO email_settings
           (smtp_host, smtp_port, from_email, from_name, smtp_password_enc, is_active, updated_by_user_id)
         VALUES ($1,$2,$3,$4,$5,TRUE,$6) RETURNING id`,
        [finalHost, finalPort, from_email, finalFromName, initialPass, req.user.id]
      );
      settingsId = ins.rows[0].id;

      // Seed all default trigger keys for this new settings row
      for (const t of DEFAULT_TRIGGERS) {
        await dbClient.query(
          `INSERT INTO notification_triggers (email_settings_id, trigger_key, is_enabled, label)
           VALUES ($1,$2,$3,$4) ON CONFLICT (email_settings_id, trigger_key) DO NOTHING`,
          [settingsId, t.trigger_key, t.is_enabled, t.label]
        );
      }
    }

    if (notifications && typeof notifications === 'object') {
      for (const [key, enabled] of Object.entries(notifications)) {
        await dbClient.query(
          `INSERT INTO notification_triggers (email_settings_id, trigger_key, is_enabled)
           VALUES ($1,$2,$3)
           ON CONFLICT (email_settings_id, trigger_key)
           DO UPDATE SET is_enabled = EXCLUDED.is_enabled`,
          [settingsId, key, Boolean(enabled)]
        );
      }
    }

    await dbClient.query('COMMIT');

    // Force transporter rebuild with new credentials
    _invalidateTransporter();

    const updated = await pool.query(
      `SELECT id, smtp_host, smtp_port, from_email, from_name, is_active, updated_at
       FROM email_settings WHERE id=$1`, [settingsId]
    );
    const trigRows = await pool.query(
      `SELECT trigger_key, is_enabled, label FROM notification_triggers
       WHERE email_settings_id=$1 ORDER BY id`, [settingsId]
    );
    const notifs = {};
    for (const t of trigRows.rows) notifs[t.trigger_key] = t.is_enabled;
    updated.rows[0].notifications = notifs;

    return res.status(200).json({
      success: true,
      message: 'Email settings saved successfully.',
      data: updated.rows[0],
    });

  } catch (error) {
    await dbClient.query('ROLLBACK');
    console.error('Upsert email settings error:', error);
    return Errors.internalError(res);
  } finally {
    dbClient.release();
  }
};

// ────────────────────────────────────────────────────────────
// POST /api/email-settings/test
// (Synchronous — admin wants live confirmation it worked)
// ────────────────────────────────────────────────────────────
const testEmail = async (req, res) => {
  try {
    const { to } = req.body;
    if (!to) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        '"to" is required.', { field: 'to' });
    }

    const result = await pool.query(
      `SELECT smtp_host, smtp_port, from_email, from_name, smtp_password_enc
       FROM email_settings WHERE is_active = TRUE LIMIT 1`
    );

    let host, port, user, pass, fromName;
    if (result.rows.length > 0) {
      const r = result.rows[0];
      host     = r.smtp_host;
      port     = r.smtp_port;
      user     = r.from_email;
      pass     = (r.smtp_password_enc && r.smtp_password_enc.trim())
                   ? r.smtp_password_enc.trim()
                   : (process.env.SMTP_PASS || '');
      fromName = r.from_name;
    } else {
      host     = process.env.SMTP_HOST      || 'smtp.gmail.com';
      port     = process.env.SMTP_PORT      || '587';
      user     = process.env.SMTP_USER      || '';
      pass     = process.env.SMTP_PASS      || '';
      fromName = process.env.SMTP_FROM_NAME || 'VDTI Service Hub';
    }

    if (!pass) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'SMTP password not configured. Set SMTP_PASS in .env (16-char Gmail App Password, no spaces).');
    }

    const transporter = _buildTransporter(host, port, user, pass);
    await transporter.verify();
    await transporter.sendMail({
      from:    `"${fromName}" <${user}>`,
      to,
      subject: '✅ VDTI Service Hub — SMTP Test',
      html: `
        <div style="font-family:Arial,sans-serif;padding:24px;max-width:500px;">
          <h2 style="color:#2563eb;">SMTP Test Successful</h2>
          <p>Your email configuration is working correctly.</p>
          <p style="color:#9ca3af;font-size:12px;">
            Server: ${host}:${port}<br/>
            From: ${user}
          </p>
        </div>
      `,
    });

    return res.status(200).json({
      success: true,
      message: `Test email delivered to ${to}.`,
    });

  } catch (error) {
    console.error('Test email error:', error);
    return sendError(res, 500, ERROR_CODES.INTERNAL_SERVER_ERROR,
      `SMTP error: ${error.message}`);
  }
};

module.exports = {
  getEmailSettings,
  upsertEmailSettings,
  testEmail,
  sendNotification,
  buildTransporterFromEnv,
};