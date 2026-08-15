// ============================================================
// src/controllers/whatsappController.js
// WhatsApp Cloud API — webhook (incoming) + template sends (outgoing).
// ============================================================

const pool = require('../config/db');

const WHATSAPP_API_VERSION = 'v20.0';

// ─── Helper: normalize a stored phone number to WhatsApp's
// expected "countrycode + number" digit-only format. Assumes
// India (+91) when only a 10-digit local number is stored.
const formatWhatsAppNumber = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  return digits.length === 10 ? `91${digits}` : digits;
};

// ─── Helper: format a DATE column value as DD-MM-YYYY ─────────
const formatDateShort = (d) => d
  ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
  : 'Not scheduled';

// ─── Core sender: posts a template message via the Graph API ─
// Requires the template to already exist and be Approved in
// WhatsApp Manager → Message Templates.
const sendWhatsAppTemplateMessage = async ({ to, templateName, languageCode = 'en', components = [] }) => {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    console.error('[WhatsApp] Not configured — missing WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_ACCESS_TOKEN.');
    return { success: false };
  }
  if (!to) return { success: false };

  try {
    const response = await fetch(
      `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: templateName,
            language: { code: languageCode },
            ...(components.length ? { components } : {}),
          },
        }),
      }
    );

    const data = await response.json();
    if (!response.ok) {
      console.error(`[WhatsApp] Send failed ("${templateName}" -> ${to}):`, JSON.stringify(data));
      return { success: false, error: data };
    }
    console.log(`[WhatsApp] Sent "${templateName}" to ${to}`);
    return { success: true, data };
  } catch (err) {
    console.error('[WhatsApp] Send error:', err.message);
    return { success: false, error: err.message };
  }
};

// ─── Technician: notify on job assignment ─────────────────────
// Looks up the technician's phone + job/client details itself,
// so callers only need to pass the job and technician IDs.
// Format date display: range if start+end present, single date otherwise
const formatJobDate = (row) => {
  if (row.start_date && row.end_date) {
    return `${formatDateShort(row.start_date)} – ${formatDateShort(row.end_date)}`;
  }
  return row.scheduled_date ? formatDateShort(row.scheduled_date) : 'N/A';
};

const notifyTechnicianJobAssignment = async (jobId, technicianId) => {
  try {
    // Fetch job + the specific technician's phone
    const result = await pool.query(
      `SELECT j.id, j.title, j.scheduled_date, j.start_date, j.end_date,
              t.name AS technician_name, t.phone AS technician_phone,
              c.name AS client_name
       FROM jobs j
       JOIN technicians t ON t.id = $2
       LEFT JOIN clients c ON c.id = j.client_id
       WHERE j.id = $1`,
      [jobId, technicianId]
    );
    if (!result.rows.length) {
      console.warn(`[WhatsApp] Skipped job_assigned — job "${jobId}" or technician id=${technicianId} not found.`);
      return;
    }

    const row = result.rows[0];
    const to  = formatWhatsAppNumber(row.technician_phone);
    if (!to) {
      console.warn(`[WhatsApp] Skipped job_assigned for ${jobId} — technician "${row.technician_name}" has no phone number.`);
      return;
    }

    // Fetch all technician names assigned to this job
    const allTechs = await pool.query(
      `SELECT t.name FROM job_technicians jt
       JOIN technicians t ON t.id = jt.technician_id
       WHERE jt.job_id = $1 ORDER BY jt.assigned_at`,
      [jobId]
    );
    const allTechNames = allTechs.rows.map(r => r.name).join(', ') || row.technician_name;

    await sendWhatsAppTemplateMessage({
      to,
      templateName: 'job_assigned',
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: row.technician_name },
          { type: 'text', text: row.id },
          { type: 'text', text: row.title },
          { type: 'text', text: row.client_name || 'N/A' },
          { type: 'text', text: formatJobDate(row) },
          { type: 'text', text: allTechNames },
        ],
      }],
    });
  } catch (err) {
    console.error('[WhatsApp] notifyTechnicianJobAssignment error:', err.message);
  }
};

// ────────────────────────────────────────────────────────────
// Notify client on job cancellation via WhatsApp
// ────────────────────────────────────────────────────────────
const notifyJobCancellation = async (jobId, cancelReason = '') => {
  try {
    const result = await pool.query(
      `SELECT j.id, j.title, j.scheduled_date, j.start_date, j.end_date,
              c.name AS client_name
       FROM jobs j
       LEFT JOIN clients c ON c.id = j.client_id
       WHERE j.id = $1`,
      [jobId]
    );

    if (!result.rows.length) return;
    const job = result.rows[0];

    // Fetch all technicians assigned to this job
    const techResult = await pool.query(
      `SELECT t.name, t.phone FROM job_technicians jt
       JOIN technicians t ON t.id = jt.technician_id
       WHERE jt.job_id = $1 ORDER BY jt.assigned_at`,
      [jobId]
    );

    if (!techResult.rows.length) {
      console.warn(`[WhatsApp] Skipped job_cancelled for ${jobId} — no technicians assigned.`);
      return;
    }

    const visitDate  = formatJobDate(job);
    const clientName = job.client_name || 'N/A';

    // Send cancellation message to each assigned technician
    for (const tech of techResult.rows) {
      const to = formatWhatsAppNumber(tech.phone);
      if (!to) {
        console.warn(`[WhatsApp] Skipped job_cancelled for ${jobId} — technician "${tech.name}" has no phone number.`);
        continue;
      }

      await sendWhatsAppTemplateMessage({
        to,
        templateName: 'job_cancelled',
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: tech.name },
            { type: 'text', text: job.id },
            { type: 'text', text: job.title },
            { type: 'text', text: clientName },
            { type: 'text', text: visitDate },
            { type: 'text', text: cancelReason || 'N/A' },
          ],
        }],
      });

      console.log(`[WhatsApp] Cancellation notification sent to technician ${tech.name} (${to}) for job ${jobId}`);
    }
  } catch (err) {
    console.error('[WhatsApp] notifyJobCancellation error:', err.message);
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/whatsapp/webhook — verification handshake
// Meta calls this once when you save the webhook config in
// the developer dashboard, to confirm you own the endpoint.
// ────────────────────────────────────────────────────────────
const verifyWebhook = (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('[WhatsApp Webhook] Verified successfully.');
    return res.status(200).send(challenge);
  }

  console.warn('[WhatsApp Webhook] Verification failed — token mismatch.');
  return res.sendStatus(403);
};

// ────────────────────────────────────────────────────────────
// POST /api/whatsapp/webhook — incoming messages & status updates
// Meta expects a fast 200 response; heavier processing should
// be added incrementally as the integration grows.
// ────────────────────────────────────────────────────────────
const handleWebhookEvent = (req, res) => {
  try {
    console.log('[WhatsApp Webhook] Event received:', JSON.stringify(req.body));
    // TODO: parse req.body.entry[].changes[].value (messages / statuses)
    // and persist/notify once the send-side integration is wired up.
  } catch (err) {
    console.error('[WhatsApp Webhook] Error handling event:', err.message);
  }
  return res.sendStatus(200);
};

module.exports = {
  verifyWebhook,
  handleWebhookEvent,
  sendWhatsAppTemplateMessage,
  notifyTechnicianJobAssignment,
  notifyJobCancellation,
  formatWhatsAppNumber,
  formatDateShort,
};
