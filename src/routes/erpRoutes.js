// ============================================================
// src/routes/erpRoutes.js
// ERP proxy routes — Quotations & Customers
// ============================================================

const express = require('express');
const router  = express.Router();
const {
  getQuotations,
  getQuotationById,
  getCustomers,
  getCustomerById,
} = require('../controllers/erpController');
const { protect, authorize } = require('../middleware/authMiddleware');

// ─────────────────────────────────────────────────────────────
// SWAGGER SCHEMAS (defined inline so this file is self-contained)
// ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * components:
 *   schemas:
 *
 *     ErpQuotation:
 *       type: object
 *       description: >
 *         A quotation record as returned by the ERP system.
 *         Exact field names depend on the ERP; common fields are listed below.
 *       properties:
 *         id:
 *           type: string
 *           example: "QT-2024-00123"
 *           description: ERP quotation ID / number
 *         customer_id:
 *           type: string
 *           example: "CUST-001"
 *         customer_name:
 *           type: string
 *           example: "Acme Corp"
 *         date:
 *           type: string
 *           format: date
 *           example: "2024-05-01"
 *         valid_until:
 *           type: string
 *           format: date
 *           example: "2024-06-01"
 *         status:
 *           type: string
 *           enum: [Draft, Confirmed, Cancelled]
 *           example: "Confirmed"
 *         total_amount:
 *           type: number
 *           example: 45000.00
 *         currency:
 *           type: string
 *           example: "INR"
 *         items:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               description:
 *                 type: string
 *               quantity:
 *                 type: number
 *               unit_price:
 *                 type: number
 *               total:
 *                 type: number
 *
 *     ErpQuotationListResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         source:
 *           type: string
 *           example: "erp"
 *         count:
 *           type: integer
 *           example: 25
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ErpQuotation'
 *         pagination:
 *           type: object
 *           description: Present if the ERP returns pagination metadata
 *           properties:
 *             total:
 *               type: integer
 *             page:
 *               type: integer
 *             limit:
 *               type: integer
 *             total_pages:
 *               type: integer
 *
 *     ErpQuotationSingleResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         source:
 *           type: string
 *           example: "erp"
 *         data:
 *           $ref: '#/components/schemas/ErpQuotation'
 *
 *     ErpCustomer:
 *       type: object
 *       description: >
 *         A customer record as returned by the ERP system.
 *         Exact field names depend on the ERP; common fields are listed below.
 *       properties:
 *         id:
 *           type: string
 *           example: "CUST-001"
 *           description: ERP customer ID
 *         name:
 *           type: string
 *           example: "Acme Corp"
 *         email:
 *           type: string
 *           format: email
 *           example: "contact@acme.com"
 *         phone:
 *           type: string
 *           example: "+911234567890"
 *         address:
 *           type: string
 *           example: "123 Industrial Area, Mumbai"
 *         gstin:
 *           type: string
 *           example: "27AABCU9603R1ZX"
 *         status:
 *           type: string
 *           enum: [Active, Inactive]
 *           example: "Active"
 *         created_date:
 *           type: string
 *           format: date
 *           example: "2023-01-15"
 *
 *     ErpCustomerListResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         source:
 *           type: string
 *           example: "erp"
 *         count:
 *           type: integer
 *           example: 10
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ErpCustomer'
 *         pagination:
 *           type: object
 *           description: Present if the ERP returns pagination metadata
 *           properties:
 *             total:
 *               type: integer
 *             page:
 *               type: integer
 *             limit:
 *               type: integer
 *             total_pages:
 *               type: integer
 *
 *     ErpCustomerSingleResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         source:
 *           type: string
 *           example: "erp"
 *         data:
 *           $ref: '#/components/schemas/ErpCustomer'
 *
 *     ErpErrorResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         error_code:
 *           type: string
 *           example: "ERP_TIMEOUT"
 *         message:
 *           type: string
 *           example: "The ERP server did not respond in time. Please try again."
 */

// ─────────────────────────────────────────────────────────────
// TAG
// ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * tags:
 *   - name: ERP – Quotations
 *     description: >
 *       Read-only proxy to the external ERP Quotation API
 *       (`http://203.192.195.67/erp/QuotationAPI.ashx`).
 *       All responses are forwarded as-is from the ERP with a normalised wrapper.
 *   - name: ERP – Customers
 *     description: >
 *       Read-only proxy to the external ERP Customer API
 *       (`http://203.192.195.67/erp/CustomerAPI.ashx`).
 *       All responses are forwarded as-is from the ERP with a normalised wrapper.
 */

// ─────────────────────────────────────────────────────────────
// QUOTATION ROUTES
// ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/erp/quotations:
 *   get:
 *     summary: Get all quotations from ERP
 *     description: >
 *       Fetches quotation records from the external ERP system
 *       (`QuotationAPI.ashx`). Supports optional filtering and
 *       pagination via query parameters which are forwarded directly
 *       to the ERP.
 *     tags: [ERP – Quotations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Number of records per page
 *       - in: query
 *         name: customer_id
 *         schema:
 *           type: string
 *         description: Filter quotations by ERP customer ID
 *         example: "CUST-001"
 *       - in: query
 *         name: from_date
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter quotations from this date (YYYY-MM-DD)
 *         example: "2024-01-01"
 *       - in: query
 *         name: to_date
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter quotations up to this date (YYYY-MM-DD)
 *         example: "2024-12-31"
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [Draft, Confirmed, Cancelled]
 *         description: Filter by quotation status
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Free-text search (customer name, quotation number, etc.)
 *     responses:
 *       200:
 *         description: List of quotations fetched successfully from ERP
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErpQuotationListResponse'
 *             example:
 *               success: true
 *               source: "erp"
 *               count: 2
 *               data:
 *                 - id: "QT-2024-00123"
 *                   customer_id: "CUST-001"
 *                   customer_name: "Acme Corp"
 *                   date: "2024-05-01"
 *                   status: "Confirmed"
 *                   total_amount: 45000.00
 *                 - id: "QT-2024-00124"
 *                   customer_id: "CUST-002"
 *                   customer_name: "Beta Ltd"
 *                   date: "2024-05-03"
 *                   status: "Draft"
 *                   total_amount: 12500.00
 *       401:
 *         description: Unauthorised – JWT token missing or invalid
 *       502:
 *         description: ERP returned an HTTP error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErpErrorResponse'
 *       504:
 *         description: ERP did not respond within 15 seconds
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErpErrorResponse'
 *       500:
 *         description: Internal server error
 */
router.get('/quotations', protect, getQuotations);

/**
 * @swagger
 * /api/erp/quotations/{id}:
 *   get:
 *     summary: Get a single quotation by ID from ERP
 *     description: >
 *       Fetches a specific quotation record from the external ERP system
 *       by passing `id` as a query parameter to `QuotationAPI.ashx`.
 *     tags: [ERP – Quotations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ERP quotation ID (e.g. QT-2024-00123)
 *         example: "QT-2024-00123"
 *     responses:
 *       200:
 *         description: Quotation record fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErpQuotationSingleResponse'
 *             example:
 *               success: true
 *               source: "erp"
 *               data:
 *                 id: "QT-2024-00123"
 *                 customer_id: "CUST-001"
 *                 customer_name: "Acme Corp"
 *                 date: "2024-05-01"
 *                 valid_until: "2024-06-01"
 *                 status: "Confirmed"
 *                 total_amount: 45000.00
 *                 currency: "INR"
 *                 items:
 *                   - description: "Annual Maintenance Contract"
 *                     quantity: 1
 *                     unit_price: 45000.00
 *                     total: 45000.00
 *       401:
 *         description: Unauthorised – JWT token missing or invalid
 *       404:
 *         description: Quotation not found in ERP
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErpErrorResponse'
 *             example:
 *               success: false
 *               error_code: "QUOTATION_NOT_FOUND"
 *               message: "Quotation with ID 'QT-2024-00123' was not found in the ERP."
 *       502:
 *         description: ERP returned an HTTP error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErpErrorResponse'
 *       504:
 *         description: ERP did not respond within 15 seconds
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErpErrorResponse'
 *       500:
 *         description: Internal server error
 */
router.get('/quotations/:id', protect, getQuotationById);

// ─────────────────────────────────────────────────────────────
// CUSTOMER ROUTES
// ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/erp/customers:
 *   get:
 *     summary: Get all customers from ERP
 *     description: >
 *       Fetches customer records from the external ERP system
 *       (`CustomerAPI.ashx`). Supports optional filtering and
 *       pagination via query parameters which are forwarded directly
 *       to the ERP.
 *     tags: [ERP – Customers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Number of records per page
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by customer name, phone, or email
 *         example: "Acme"
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [Active, Inactive]
 *         description: Filter by customer status
 *     responses:
 *       200:
 *         description: List of customers fetched successfully from ERP
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErpCustomerListResponse'
 *             example:
 *               success: true
 *               source: "erp"
 *               count: 2
 *               data:
 *                 - id: "CUST-001"
 *                   name: "Acme Corp"
 *                   email: "contact@acme.com"
 *                   phone: "+911234567890"
 *                   status: "Active"
 *                 - id: "CUST-002"
 *                   name: "Beta Ltd"
 *                   email: "info@beta.com"
 *                   phone: "+919876543210"
 *                   status: "Active"
 *       401:
 *         description: Unauthorised – JWT token missing or invalid
 *       502:
 *         description: ERP returned an HTTP error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErpErrorResponse'
 *       504:
 *         description: ERP did not respond within 15 seconds
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErpErrorResponse'
 *       500:
 *         description: Internal server error
 */
router.get('/customers', protect, getCustomers);

/**
 * @swagger
 * /api/erp/customers/{id}:
 *   get:
 *     summary: Get a single customer by ID from ERP
 *     description: >
 *       Fetches a specific customer record from the external ERP system
 *       by passing `id` as a query parameter to `CustomerAPI.ashx`.
 *     tags: [ERP – Customers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ERP customer ID (e.g. CUST-001)
 *         example: "CUST-001"
 *     responses:
 *       200:
 *         description: Customer record fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErpCustomerSingleResponse'
 *             example:
 *               success: true
 *               source: "erp"
 *               data:
 *                 id: "CUST-001"
 *                 name: "Acme Corp"
 *                 email: "contact@acme.com"
 *                 phone: "+911234567890"
 *                 address: "123 Industrial Area, Mumbai"
 *                 gstin: "27AABCU9603R1ZX"
 *                 status: "Active"
 *                 created_date: "2023-01-15"
 *       401:
 *         description: Unauthorised – JWT token missing or invalid
 *       404:
 *         description: Customer not found in ERP
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErpErrorResponse'
 *             example:
 *               success: false
 *               error_code: "CUSTOMER_NOT_FOUND"
 *               message: "Customer with ID 'CUST-001' was not found in the ERP."
 *       502:
 *         description: ERP returned an HTTP error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErpErrorResponse'
 *       504:
 *         description: ERP did not respond within 15 seconds
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErpErrorResponse'
 *       500:
 *         description: Internal server error
 */
router.get('/customers/:id', protect, getCustomerById);

module.exports = router;
