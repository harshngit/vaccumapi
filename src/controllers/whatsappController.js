// ============================================================
// src/controllers/whatsappController.js
// WhatsApp Cloud API webhook — receives incoming messages and
// delivery status updates from Meta.
// ============================================================

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

module.exports = { verifyWebhook, handleWebhookEvent };
