// ============================================================
// src/jobs/amcExpiryJob.js
// Runs once per day (called from server.js on startup + daily).
// Checks AMC contracts whose renewal_reminder_days threshold
// has been crossed and fires an amc_expiring WS notification.
// ============================================================

const pool      = require('../config/db');
const { notify } = require('../controllers/notificationController');
const wsManager  = require('../config/websocketManager');

const runAmcExpiryCheck = async () => {
  console.log('[AMC Cron] Running expiry check…');
  try {
    // Same query as GET /api/amc/expiring
    const result = await pool.query(`
      SELECT
        a.id, a.title, a.end_date, a.renewal_reminder_days,
        c.name AS client_name,
        (a.end_date - CURRENT_DATE) AS days_left
      FROM amc_contracts a
      LEFT JOIN clients c ON c.id = a.client_id
      WHERE (a.end_date - a.renewal_reminder_days) <= CURRENT_DATE
        AND a.end_date >= CURRENT_DATE
    `);

    for (const amc of result.rows) {
      const daysLeft = parseInt(amc.days_left);
      await notify({
        event:       'amc_expiring',
        title:       'AMC Renewal Reminder',
        message:     `${amc.id} — ${amc.title} (${amc.client_name}) expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`,
        entity_type: 'amc',
        entity_id:   amc.id,
        roles:       ['admin', 'manager'],
      }, wsManager);
      console.log(`[AMC Cron] Notified for ${amc.id} — ${daysLeft} days left`);
    }

    console.log(`[AMC Cron] Done. Checked ${result.rows.length} contracts.`);
  } catch (err) {
    console.error('[AMC Cron] Error:', err.message);
  }
};

// Schedule: run once at startup, then every 24 hours
const startAmcExpiryJob = () => {
  runAmcExpiryCheck(); // immediate first run
  setInterval(runAmcExpiryCheck, 24 * 60 * 60 * 1000); // then daily
};

module.exports = { startAmcExpiryJob };
