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
const { sendWhatsAppTemplateMessage, formatWhatsAppNumber, formatDateShort } = require('../controllers/whatsappController');

// ─── Helper: phone number formatted for display (tap-to-call text) ──
const formatPhoneDisplay = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return 'Not available';
  return digits.length === 10 ? `+91 ${digits}` : `+${digits}`;
};

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
        c.phone AS client_phone,
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

      // ── WhatsApp to client ──────────────────────────────────
      const whatsappTo = formatWhatsAppNumber(amc.client_phone);
      if (!whatsappTo) {
        console.warn(`[WhatsApp] Skipped reminder for ${amc.id} — client "${amc.client_name}" has no phone number on file.`);
      } else {
        await sendWhatsAppTemplateMessage({
          to: whatsappTo,
          templateName: 'amc_renewal_reminder',
          components: [{
            type: 'body',
            parameters: [
              { type: 'text', text: amc.client_name || 'Customer' },
              { type: 'text', text: amc.id },
              { type: 'text', text: amc.title },
              { type: 'text', text: String(daysLeft) },
              { type: 'text', text: formatDateShort(amc.end_date) },
              { type: 'text', text: amc.po_number || 'N/A' },
            ],
          }],
        });
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
        c.email AS client_email,
        c.phone AS client_phone,
        t.name  AS technician_name,
        t.phone AS technician_phone
      FROM amc_contracts a
      LEFT JOIN clients c ON c.id = a.client_id
      LEFT JOIN LATERAL (
        SELECT technician_id FROM jobs
        WHERE amc_id = a.id AND scheduled_date = a.next_service_date AND technician_id IS NOT NULL
        ORDER BY created_at DESC LIMIT 1
      ) j ON true
      LEFT JOIN technicians t ON t.id = j.technician_id
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

      // ── WhatsApp to client ──────────────────────────────────
      const whatsappTo = formatWhatsAppNumber(amc.client_phone);
      if (!whatsappTo) {
        console.warn(`[WhatsApp] Skipped reminder for ${amc.id} — client "${amc.client_name}" has no phone number on file.`);
      } else {
        await sendWhatsAppTemplateMessage({
          to: whatsappTo,
          templateName: 'service_reminder_v2',
          components: [{
            type: 'body',
            parameters: [
              { type: 'text', text: amc.client_name || 'Customer' },
              { type: 'text', text: amc.id },
              { type: 'text', text: amc.title },
              { type: 'text', text: formatDateShort(amc.next_service_date) },
              { type: 'text', text: amc.po_number || 'N/A' },
              { type: 'text', text: amc.technician_name || 'Not yet assigned' },
              { type: 'text', text: amc.technician_name ? formatPhoneDisplay(amc.technician_phone) : 'N/A' },
            ],
          }],
        });
      }
    }

    console.log(`[AMC Cron] Service reminder check done. Found ${result.rows.length} upcoming services.`);
  } catch (err) {
    console.error('[AMC Cron] Service reminder error:', err.message);
  }
};

// ────────────────────────────────────────────────────────────
// 3. Numbered Service Date Reminders (service_date_1..6)
//    Same 10-days-before logic as next_service_date, fired once
//    per configured visit date.
// ────────────────────────────────────────────────────────────
const runNumberedServiceDateReminderCheck = async () => {
  console.log('[AMC Cron] Running service_date_1..6 reminder check…');
  try {
    const unionParts = [1, 2, 3, 4, 5, 6].map(n => `
      SELECT
        a.id, a.title, a.po_number,
        a.service_date_${n} AS next_service_date, ${n} AS service_number,
        c.name  AS client_name,
        c.email AS client_email,
        c.phone AS client_phone,
        t.name  AS technician_name,
        t.phone AS technician_phone
      FROM amc_contracts a
      LEFT JOIN clients c ON c.id = a.client_id
      LEFT JOIN LATERAL (
        SELECT technician_id FROM jobs
        WHERE amc_id = a.id AND scheduled_date = a.service_date_${n} AND technician_id IS NOT NULL
        ORDER BY created_at DESC LIMIT 1
      ) j ON true
      LEFT JOIN technicians t ON t.id = j.technician_id
      WHERE a.service_date_${n} IS NOT NULL
        AND (a.service_date_${n} - CURRENT_DATE) = 10
        AND a.status != 'Expired'
    `).join(' UNION ALL ');

    const result = await pool.query(unionParts);

    for (const amc of result.rows) {
      // ── WS notification ────────────────────────────────────
      await notify({
        event:       'amc_service_upcoming',
        title:       `Upcoming Service ${amc.service_number} Reminder`,
        message:     `${amc.id} — ${amc.title} (${amc.client_name}) — service ${amc.service_number} in 10 days on ${amc.next_service_date}`,
        entity_type: 'amc',
        entity_id:   amc.id,
        roles:       ['admin', 'manager'],
      }, wsManager);

      // ── Email to client ────────────────────────────────────
      if (amc.client_email) {
        const html = buildServiceReminderEmail(amc);
        await sendNotification('amc_service_reminder', {
          to:      amc.client_email,
          subject: `🔔 Service ${amc.service_number} Reminder — Scheduled Visit in 10 Days | Electromech Engineering`,
          html,
        });
        console.log(`[AMC Cron] Service ${amc.service_number} reminder sent to ${amc.client_email} for ${amc.id}`);
      }

      // ── WhatsApp to client ──────────────────────────────────
      const whatsappTo = formatWhatsAppNumber(amc.client_phone);
      if (!whatsappTo) {
        console.warn(`[WhatsApp] Skipped reminder for ${amc.id} — client "${amc.client_name}" has no phone number on file.`);
      } else {
        await sendWhatsAppTemplateMessage({
          to: whatsappTo,
          templateName: 'service_reminder_v2',
          components: [{
            type: 'body',
            parameters: [
              { type: 'text', text: amc.client_name || 'Customer' },
              { type: 'text', text: amc.id },
              { type: 'text', text: amc.title },
              { type: 'text', text: formatDateShort(amc.next_service_date) },
              { type: 'text', text: amc.po_number || 'N/A' },
              { type: 'text', text: amc.technician_name || 'Not yet assigned' },
              { type: 'text', text: amc.technician_name ? formatPhoneDisplay(amc.technician_phone) : 'N/A' },
            ],
          }],
        });
      }
    }

    console.log(`[AMC Cron] service_date_1..6 reminder check done. Found ${result.rows.length} upcoming services.`);
  } catch (err) {
    console.error('[AMC Cron] Numbered service reminder error:', err.message);
  }
};

// ────────────────────────────────────────────────────────────
// 4. AMC Visit Reminders — 30 / 15 / 7 days before each visit
//    Fires for next_service_date AND service_date_1..6.
//    Sends to client (email) + all admin users (email + WS).
// ────────────────────────────────────────────────────────────
const VISIT_REMINDER_DAYS = [30, 15, 7];

const buildVisitReminderEmail = (amc, daysLeft) => `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
  body{font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px}
  .card{background:#fff;border-radius:8px;padding:28px 32px;max-width:560px;margin:auto}
  h2{color:#1a2744;margin:0 0 8px}
  .badge{display:inline-block;background:#e8f0fe;color:#1a56db;padding:4px 12px;border-radius:20px;font-weight:700;font-size:14px;margin-bottom:20px}
  table{width:100%;border-collapse:collapse;margin:20px 0}
  td{padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px}
  td:first-child{color:#666;width:45%}
  .footer{margin-top:24px;font-size:12px;color:#999;text-align:center}
</style></head>
<body><div class="card">
  <h2>Upcoming AMC Visit Reminder</h2>
  <div class="badge">⏰ ${daysLeft} days remaining</div>
  <p>Dear ${amc.client_name || 'Customer'},</p>
  <p>This is a reminder that your scheduled AMC visit is coming up in <strong>${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong>.</p>
  <table>
    <tr><td>AMC Contract</td><td><strong>${amc.id}</strong></td></tr>
    <tr><td>Title</td><td>${amc.title}</td></tr>
    <tr><td>Visit Date</td><td><strong>${amc.next_service_date}</strong></td></tr>
    <tr><td>PO Number</td><td>${amc.po_number || 'N/A'}</td></tr>
    ${amc.technician_name ? `<tr><td>Technician</td><td>${amc.technician_name}</td></tr>` : ''}
  </table>
  <p>Please ensure your site is accessible on the visit date. Contact us for any rescheduling.</p>
  <div class="footer">Electromech Engineering Services | Automated Reminder</div>
</div></body></html>`;

const buildVisitReminderEmailAdmin = (amc, daysLeft) => `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8">
<style>
  body{font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px}
  .card{background:#fff;border-radius:8px;padding:28px 32px;max-width:560px;margin:auto}
  h2{color:#1a2744;margin:0 0 8px}
  .badge{display:inline-block;background:#fef3c7;color:#92400e;padding:4px 12px;border-radius:20px;font-weight:700;font-size:14px;margin-bottom:20px}
  table{width:100%;border-collapse:collapse;margin:20px 0}
  td{padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px}
  td:first-child{color:#666;width:45%}
  .footer{margin-top:24px;font-size:12px;color:#999;text-align:center}
</style></head>
<body><div class="card">
  <h2>Admin: AMC Visit Reminder</h2>
  <div class="badge">⚠️ ${daysLeft} days to visit</div>
  <p>An AMC visit is scheduled in <strong>${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong>. Please ensure a technician is assigned.</p>
  <table>
    <tr><td>Client</td><td><strong>${amc.client_name || 'N/A'}</strong></td></tr>
    <tr><td>AMC Contract</td><td>${amc.id}</td></tr>
    <tr><td>Title</td><td>${amc.title}</td></tr>
    <tr><td>Visit Date</td><td><strong>${amc.next_service_date}</strong></td></tr>
    <tr><td>PO Number</td><td>${amc.po_number || 'N/A'}</td></tr>
    <tr><td>Technician</td><td>${amc.technician_name || '<span style="color:red">Not assigned</span>'}</td></tr>
    <tr><td>Client Email</td><td>${amc.client_email || 'N/A'}</td></tr>
    <tr><td>Client Phone</td><td>${amc.client_phone || 'N/A'}</td></tr>
  </table>
  <div class="footer">VDTI Service Hub — Internal Reminder</div>
</div></body></html>`;

const runVisitReminderCheck = async () => {
  console.log('[AMC Cron] Running 30/15/7-day visit reminder check…');
  try {
    // Build UNION for next_service_date + service_date_1..6
    const dateFields = ['next_service_date', ...Array.from({ length: 6 }, (_, i) => `service_date_${i + 1}`)];
    const unionParts = dateFields.map(field => `
      SELECT
        a.id, a.title, a.po_number,
        a.${field} AS next_service_date,
        c.name  AS client_name,
        c.email AS client_email,
        c.phone AS client_phone,
        t.name  AS technician_name
      FROM amc_contracts a
      LEFT JOIN clients c ON c.id = a.client_id
      LEFT JOIN LATERAL (
        SELECT technician_id FROM jobs
        WHERE amc_id = a.id AND scheduled_date = a.${field} AND technician_id IS NOT NULL
        ORDER BY created_at DESC LIMIT 1
      ) j ON true
      LEFT JOIN technicians t ON t.id = j.technician_id
      WHERE a.${field} IS NOT NULL
        AND (a.${field} - CURRENT_DATE) IN (${VISIT_REMINDER_DAYS.join(',')})
        AND a.status != 'Expired'
    `).join(' UNION ALL ');

    const result = await pool.query(unionParts);

    if (result.rows.length === 0) {
      console.log('[AMC Cron] No visit reminders due today.');
      return;
    }

    // Fetch all active admin emails once
    const adminResult = await pool.query(
      `SELECT email FROM users WHERE role = 'admin' AND is_active = TRUE AND email IS NOT NULL`
    );
    const adminEmails = adminResult.rows.map(r => r.email);

    for (const amc of result.rows) {
      const daysLeft = Math.round((new Date(amc.next_service_date) - new Date()) / (1000 * 60 * 60 * 24));

      // ── WS notification to admin + manager ─────────────────
      await notify({
        event:       'amc_visit_upcoming',
        title:       `AMC Visit in ${daysLeft} Days`,
        message:     `${amc.id} — ${amc.title} (${amc.client_name}) — visit on ${amc.next_service_date}`,
        entity_type: 'amc',
        entity_id:   amc.id,
        roles:       ['admin', 'manager'],
      }, wsManager);

      // ── Email to client ─────────────────────────────────────
      if (amc.client_email) {
        await sendNotification('amc_visit_reminder_client', {
          to:      amc.client_email,
          subject: `🔔 AMC Visit Reminder — ${daysLeft} Days to Your Scheduled Service | Electromech Engineering`,
          html:    buildVisitReminderEmail(amc, daysLeft),
        });
        console.log(`[AMC Cron] Visit reminder (${daysLeft}d) sent to client: ${amc.client_email} for ${amc.id}`);
      }

      // ── Email to all admins ─────────────────────────────────
      for (const adminEmail of adminEmails) {
        await sendNotification('amc_visit_reminder_admin', {
          to:      adminEmail,
          subject: `⚠️ [Admin] AMC Visit in ${daysLeft} Days — ${amc.client_name} | ${amc.id}`,
          html:    buildVisitReminderEmailAdmin(amc, daysLeft),
        });
        console.log(`[AMC Cron] Visit reminder (${daysLeft}d) sent to admin: ${adminEmail}`);
      }
    }

    console.log(`[AMC Cron] Visit reminder check done. Processed ${result.rows.length} record(s).`);
  } catch (err) {
    console.error('[AMC Cron] Visit reminder error:', err.message);
  }
};

// ────────────────────────────────────────────────────────────
// Start all jobs
// ────────────────────────────────────────────────────────────
const startAmcExpiryJob = () => {
  // Run all immediately on startup
  runRenewalReminderCheck();
  runServiceDateReminderCheck();
  runNumberedServiceDateReminderCheck();
  runVisitReminderCheck();

  // Then repeat every 24 hours
  setInterval(() => {
    runRenewalReminderCheck();
    runServiceDateReminderCheck();
    runNumberedServiceDateReminderCheck();
    runVisitReminderCheck();
  }, 24 * 60 * 60 * 1000);
};

module.exports = { startAmcExpiryJob };