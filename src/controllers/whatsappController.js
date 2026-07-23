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
const notifyTechnicianJobAssignment = async (jobId, technicianId) => {
  try {
    const result = await pool.query(
      `SELECT j.id, j.title, t.name AS technician_name, t.phone AS technician_phone,
              c.name AS client_name
       FROM jobs j
       JOIN technicians t ON t.id = $2
       LEFT JOIN clients c ON c.id = j.client_id
       WHERE j.id = $1`,
      [jobId, technicianId]
    );
    if (!result.rows.length) return;

    const row = result.rows[0];
    const to  = formatWhatsAppNumber(row.technician_phone);
    if (!to) return;

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
        ],
      }],
    });
  } catch (err) {
    console.error('[WhatsApp] notifyTechnicianJobAssignment error:', err.message);
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
  formatWhatsAppNumber,
};
