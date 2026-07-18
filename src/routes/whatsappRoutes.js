// ============================================================
// src/routes/whatsappRoutes.js
// ============================================================

const express = require('express');
const router  = express.Router();
const { verifyWebhook, handleWebhookEvent } = require('../controllers/whatsappController');

/**
 * @swagger
 * tags:
 *   name: WhatsApp
 *   description: WhatsApp Cloud API webhook (Meta calls these — not for frontend use)
 */

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/whatsapp/webhook:
 *   get:
 *     summary: Webhook verification handshake (called by Meta)
 *     tags: [WhatsApp]
 *     responses:
 *       200:
 *         description: Verified — echoes back hub.challenge
 *       403:
 *         description: Verify token mismatch
 */
router.get('/webhook', verifyWebhook);

/**
 * @swagger
 * /api/whatsapp/webhook:
 *   post:
 *     summary: Receive incoming messages and status updates (called by Meta)
 *     tags: [WhatsApp]
 *     responses:
 *       200:
 *         description: Event acknowledged
 */
router.post('/webhook', handleWebhookEvent);

module.exports = router;
