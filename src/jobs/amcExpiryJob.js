// ============================================================
// src/jobs/amcExpiryJob.js
// Runs once per day on startup + every 24 hours.
//
// Handles:
//   1. Renewal reminder emails — when contract expiry is within
//      renewal_reminder_days, sends email to client.
//   2. Service date reminder — 10 days before next_service_date,
//      sends a service reminder email to client.
// ============================================================

const pool       = require('../config/db');
const { notify } = require('../controllers/notificationController');
const wsManager  = require('../config/websocketManager');
const { sendNotification } = require('../controllers/emailController');
const {
  buildAmcRenewalEmail,
  buildServiceReminderEmail,
} = require('../controllers/amcController');

// ────────────────────────────────────────────────────────────
// 1. Renewal Reminder
// ────────────────────────────────────────────────────────────
const runRenewalReminderCheck = async () => {
  console.log('[AMC Cron] Running renewal reminder check…');
  try {
    const result = await pool.query(`
      SELECT
        a.id, a.title, a.end_date, a.renewal_reminder_days, a.po_number,
        c.name  AS client_name,
        c.email AS client_email,
        (a.end_date - CURRENT_DATE) AS days_left
      FROM amc_contracts a
      LEFT JOIN clients c ON c.id = a.client_id
      WHERE (a.end_date - a.renewal_reminder_days) <= CURRENT_DATE
        AND a.end_date >= CURRENT_DATE
    `);

    for (const amc of result.rows) {
      const daysLeft = parseInt(amc.days_left);

      // ── WS notification ────────────────────────────────────
      await notify({
        event:       'amc_expiring',
        title:       'AMC Renewal Reminder',
        message:     `${amc.id} — ${amc.title} (${amc.client_name}) expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`,
        entity_type: 'amc',
        entity_id:   amc.id,
        roles:       ['admin', 'manager'],
      }, wsManager);

      // ── Email to client ────────────────────────────────────
      if (amc.client_email) {
        const html = buildAmcRenewalEmail(amc);
        await sendNotification('amc_renewal', {
          to:      amc.client_email,
          subject: `⚠️ AMC Renewal Reminder — ${amc.title} expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} | Electromech Engineering`,
          html,
        });
        console.log(`[AMC Cron] Renewal reminder sent to ${amc.client_email} for ${amc.id}`);
      }

      console.log(`[AMC Cron] Renewal reminder notified for ${amc.id} — ${daysLeft} days left`);
    }

    console.log(`[AMC Cron] Renewal check done. Checked ${result.rows.length} contracts.`);
  } catch (err) {
    console.error('[AMC Cron] Renewal reminder error:', err.message);
  }
};

// ────────────────────────────────────────────────────────────
// 2. Service Date Reminder (10 days before next_service_date)
// ────────────────────────────────────────────────────────────
const runServiceDateReminderCheck = async () => {
  console.log('[AMC Cron] Running 10-day service reminder check…');
  try {
    // Fire exactly when (next_service_date - TODAY) = 10 days
    const result = await pool.query(`
      SELECT
        a.id, a.title, a.next_service_date, a.po_number,
        c.name  AS client_name,
        c.email AS client_email
      FROM amc_contracts a
      LEFT JOIN clients c ON c.id = a.client_id
      WHERE a.next_service_date IS NOT NULL
        AND (a.next_service_date - CURRENT_DATE) = 10
        AND a.status != 'Expired'
    `);

    for (const amc of result.rows) {
      // ── WS notification ────────────────────────────────────
      await notify({
        event:       'amc_service_upcoming',
        title:       'Upcoming Service Reminder',
        message:     `${amc.id} — ${amc.title} (${amc.client_name}) — service in 10 days on ${amc.next_service_date}`,
        entity_type: 'amc',
        entity_id:   amc.id,
        roles:       ['admin', 'manager'],
      }, wsManager);

      // ── Email to client ────────────────────────────────────
      if (amc.client_email) {
        const html = buildServiceReminderEmail(amc);
        await sendNotification('amc_service_reminder', {
          to:      amc.client_email,
          subject: `🔔 Service Reminder — Scheduled Visit in 10 Days | Electromech Engineering`,
          html,
        });
        console.log(`[AMC Cron] Service reminder sent to ${amc.client_email} for ${amc.id}`);
      }
    }

    console.log(`[AMC Cron] Service reminder check done. Found ${result.rows.length} upcoming services.`);
  } catch (err) {
    console.error('[AMC Cron] Service reminder error:', err.message);
  }
};

// ────────────────────────────────────────────────────────────
// Start both jobs
// ────────────────────────────────────────────────────────────
const startAmcExpiryJob = () => {
  // Run both immediately on startup
  runRenewalReminderCheck();
  runServiceDateReminderCheck();

  // Then repeat every 24 hours
  setInterval(() => {
    runRenewalReminderCheck();
    runServiceDateReminderCheck();
  }, 24 * 60 * 60 * 1000);
};

module.exports = { startAmcExpiryJob };