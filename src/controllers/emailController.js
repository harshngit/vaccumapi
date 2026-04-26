// ============================================================
// src/controllers/emailController.js
// Email Settings + Nodemailer + Notification helper
// ============================================================

const pool       = require('../config/db');
const nodemailer = require('nodemailer');
const { sendError, Errors } = require('../utils/AppError');
const ERROR_CODES = require('../utils/errorCodes');

// ─── Default notification trigger keys ───────────────────────
const DEFAULT_TRIGGERS = [
  { trigger_key: 'job_raised',            label: 'New Job Raised',                   is_enabled: true  },
  { trigger_key: 'job_assigned',          label: 'Job Assigned to Technician',        is_enabled: true  },
  { trigger_key: 'job_completed',         label: 'Job Completed / Closed',            is_enabled: true  },
  { trigger_key: 'report_submitted',      label: 'Report Submitted (Client Email)',   is_enabled: true  },
  { trigger_key: 'report_approved',       label: 'Report Approved',                   is_enabled: false },
  { trigger_key: 'amc_created',           label: 'AMC Contract Created',              is_enabled: true  },
  { trigger_key: 'amc_renewal',           label: 'AMC Renewal Reminder',              is_enabled: true  },
  { trigger_key: 'amc_service_reminder',  label: 'AMC 10-Day Service Reminder',       is_enabled: true  },
  { trigger_key: 'quotation_sent',        label: 'Quotation Sent',                    is_enabled: false },
];

// ─── Build nodemailer transporter ────────────────────────────
const buildTransporter = (settings) => {
  const host = settings.smtp_host         || process.env.SMTP_HOST     || 'smtp.gmail.com';
  const port = settings.smtp_port         || parseInt(process.env.SMTP_PORT || '587');
  const user = settings.from_email        || process.env.SMTP_USER;
  const pass = settings.smtp_password_enc || process.env.SMTP_PASS;

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    tls:  { rejectUnauthorized: false },
  });
};

// ─── Build transporter directly from env (for jobs / cron) ───
const buildTransporterFromEnv = () => buildTransporter({});

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
          id:           null,
          smtp_host:    process.env.SMTP_HOST     || 'smtp.gmail.com',
          smtp_port:    parseInt(process.env.SMTP_PORT || '587'),
          from_email:   process.env.SMTP_USER     || '',
          from_name:    process.env.SMTP_FROM_NAME || 'Electromech Engineering',
          is_active:    false,
          notifications: DEFAULT_TRIGGERS.reduce((acc, t) => {
            acc[t.trigger_key] = t.is_enabled;
            return acc;
          }, {}),
        },
        message: 'Using environment defaults. Configure via PUT /api/email-settings.',
      });
    }

    const settings = result.rows[0];

    const triggers = await pool.query(
      `SELECT trigger_key, is_enabled, label
       FROM notification_triggers
       WHERE email_settings_id = $1
       ORDER BY id`,
      [settings.id]
    );

    const notifications = {};
    for (const t of triggers.rows) notifications[t.trigger_key] = t.is_enabled;

    for (const d of DEFAULT_TRIGGERS) {
      if (!(d.trigger_key in notifications)) {
        notifications[d.trigger_key] = d.is_enabled;
      }
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
    const {
      smtp_host, smtp_port, from_email, from_name,
      smtp_password, notifications,
    } = req.body;

    if (!from_email) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        'from_email is required.', { field: 'from_email' });
    }

    const finalHost     = smtp_host  || process.env.SMTP_HOST      || 'smtp.gmail.com';
    const finalPort     = smtp_port  || parseInt(process.env.SMTP_PORT || '587');
    const finalFromName = from_name  || process.env.SMTP_FROM_NAME  || 'Electromech Engineering';

    await dbClient.query('BEGIN');

    const existing = await dbClient.query(
      'SELECT id, smtp_password_enc FROM email_settings WHERE is_active = TRUE LIMIT 1'
    );

    let settingsId;

    if (existing.rows.length > 0) {
      settingsId = existing.rows[0].id;
      const keepPassword = smtp_password !== undefined
        ? smtp_password
        : existing.rows[0].smtp_password_enc;

      await dbClient.query(
        `UPDATE email_settings
         SET smtp_host=$1, smtp_port=$2, from_email=$3, from_name=$4,
             smtp_password_enc=$5, updated_by_user_id=$6, updated_at=NOW()
         WHERE id=$7`,
        [finalHost, finalPort, from_email, finalFromName,
         keepPassword, req.user.id, settingsId]
      );
    } else {
      const initialPassword = smtp_password || process.env.SMTP_PASS || null;

      const insertResult = await dbClient.query(
        `INSERT INTO email_settings
           (smtp_host, smtp_port, from_email, from_name, smtp_password_enc,
            is_active, updated_by_user_id)
         VALUES ($1, $2, $3, $4, $5, TRUE, $6)
         RETURNING id`,
        [finalHost, finalPort, from_email, finalFromName,
         initialPassword, req.user.id]
      );
      settingsId = insertResult.rows[0].id;

      for (const t of DEFAULT_TRIGGERS) {
        await dbClient.query(
          `INSERT INTO notification_triggers
             (email_settings_id, trigger_key, is_enabled, label)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (email_settings_id, trigger_key) DO NOTHING`,
          [settingsId, t.trigger_key, t.is_enabled, t.label]
        );
      }
    }

    if (notifications && typeof notifications === 'object') {
      for (const [key, enabled] of Object.entries(notifications)) {
        await dbClient.query(
          `INSERT INTO notification_triggers (email_settings_id, trigger_key, is_enabled)
           VALUES ($1, $2, $3)
           ON CONFLICT (email_settings_id, trigger_key)
           DO UPDATE SET is_enabled = EXCLUDED.is_enabled`,
          [settingsId, key, Boolean(enabled)]
        );
      }
    }

    await dbClient.query('COMMIT');

    const updated = await pool.query(
      `SELECT id, smtp_host, smtp_port, from_email, from_name, is_active, updated_at
       FROM email_settings WHERE id = $1`,
      [settingsId]
    );

    const triggerRows = await pool.query(
      `SELECT trigger_key, is_enabled, label FROM notification_triggers
       WHERE email_settings_id = $1 ORDER BY id`,
      [settingsId]
    );

    const notifs = {};
    for (const t of triggerRows.rows) notifs[t.trigger_key] = t.is_enabled;

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
// ────────────────────────────────────────────────────────────
const testEmail = async (req, res) => {
  try {
    const { to } = req.body;

    if (!to) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        '"to" email address is required.', { field: 'to' });
    }

    const result = await pool.query(
      `SELECT smtp_host, smtp_port, from_email, from_name, smtp_password_enc
       FROM email_settings WHERE is_active = TRUE LIMIT 1`
    );

    let settings;
    if (result.rows.length > 0) {
      settings = result.rows[0];
    } else {
      settings = {
        smtp_host:         process.env.SMTP_HOST     || 'smtp.gmail.com',
        smtp_port:         parseInt(process.env.SMTP_PORT || '587'),
        from_email:        process.env.SMTP_USER      || '',
        from_name:         process.env.SMTP_FROM_NAME || 'Electromech Engineering',
        smtp_password_enc: process.env.SMTP_PASS       || null,
      };
    }

    if (!settings.smtp_password_enc) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'SMTP password not set. Add SMTP_PASS to your .env or configure it via PUT /api/email-settings.');
    }

    const transporter = buildTransporter(settings);
    await transporter.verify();

    await transporter.sendMail({
      from:    `"${settings.from_name}" <${settings.from_email}>`,
      to,
      subject: '✅ Electromech Engineering — Test Email',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
          <h2 style="color:#2563eb;margin-bottom:4px;">Electromech Engineering</h2>
          <p style="color:#6b7280;margin-top:0;">Notification System Test</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
          <p>Your SMTP configuration is working correctly.</p>
          <p>You will receive automated notifications for enabled events.</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
          <p style="color:#9ca3af;font-size:12px;">
            Server: ${settings.smtp_host}:${settings.smtp_port}
          </p>
        </div>
      `,
    });

    return res.status(200).json({
      success: true,
      message: `Test email sent successfully to ${to}.`,
    });

  } catch (error) {
    console.error('Test email error:', error);
    return sendError(res, 500, ERROR_CODES.INTERNAL_SERVER_ERROR,
      `SMTP error: ${error.message}. Check your credentials or use a Gmail App Password.`);
  }
};

// ────────────────────────────────────────────────────────────
// HELPER — sendNotification
// Used internally by controllers and cron jobs.
// Falls back gracefully — email failures never crash the request.
// ────────────────────────────────────────────────────────────
const sendNotification = async (triggerKey, { to, subject, html }) => {
  try {
    // Try DB settings first
    const result = await pool.query(
      `SELECT es.smtp_host, es.smtp_port, es.from_email, es.from_name,
              es.smtp_password_enc, nt.is_enabled
       FROM email_settings es
       JOIN notification_triggers nt
         ON nt.email_settings_id = es.id AND nt.trigger_key = $1
       WHERE es.is_active = TRUE LIMIT 1`,
      [triggerKey]
    );

    let settings;

    if (result.rows.length > 0 && result.rows[0].is_enabled) {
      settings = result.rows[0];
      if (!settings.smtp_password_enc) {
        settings.smtp_password_enc = process.env.SMTP_PASS || null;
      }
    } else if (result.rows.length === 0) {
      // No DB settings at all — fall back entirely to .env
      settings = {
        smtp_host:         process.env.SMTP_HOST      || 'smtp.gmail.com',
        smtp_port:         parseInt(process.env.SMTP_PORT || '587'),
        from_email:        process.env.SMTP_USER       || '',
        from_name:         process.env.SMTP_FROM_NAME  || 'Electromech Engineering',
        smtp_password_enc: process.env.SMTP_PASS        || null,
        is_enabled:        true, // assume enabled if no DB config
      };
    } else {
      // Trigger exists but is disabled
      console.log(`[Email] Trigger "${triggerKey}" is disabled. Skipping.`);
      return;
    }

    if (!settings.smtp_password_enc) {
      console.warn(`[Email] No SMTP password configured. Skipping "${triggerKey}".`);
      return;
    }

    const transporter = buildTransporter(settings);

    await transporter.sendMail({
      from: `"${settings.from_name}" <${settings.from_email}>`,
      to,
      subject,
      html,
    });

    console.log(`[Email] ✅ "${triggerKey}" notification sent to ${to}`);

  } catch (err) {
    console.error(`[Email] ❌ Failed to send "${triggerKey}":`, err.message);
    // Never throw — email failures must not crash the main request
  }
};

module.exports = {
  getEmailSettings,
  upsertEmailSettings,
  testEmail,
  sendNotification,
  buildTransporterFromEnv,
};