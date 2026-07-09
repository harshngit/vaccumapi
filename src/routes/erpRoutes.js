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
  syncQuotations,
  getLocalQuotations,
  getLocalQuotationById,
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
 *     ErpQuotationItem:
 *       type: object
 *       description: A single product/service line inside a quotation
 *       properties:
 *         line_id:      { type: integer, example: 17748 }
 *         item_id:      { type: integer, example: 82 }
 *         item_code:    { type: string,  example: "ZRCHSGMB21" }
 *         item_no:      { type: string,  example: "FG0082" }
 *         description:  { type: string,  example: "Complete Set of Piston Ring VVB" }
 *         qty:          { type: number,  example: 1 }
 *         unit:         { type: string,  example: "SET" }
 *         rate:         { type: number,  example: 72411.25 }
 *         discount_per: { type: number,  example: 0 }
 *         discount_amt: { type: number,  example: 0 }
 *         total:        { type: number,  example: 72411.25 }
 *         note:         { type: string,  example: "" }
 *         hsn_code:     { type: string,  example: "" }
 *
 *     ErpQuotation:
 *       type: object
 *       description: >
 *         A grouped quotation. The ERP returns one flat row per line item;
 *         this API groups them so `items[]` is nested inside each quotation.
 *       properties:
 *         quot_id:        { type: integer, example: 3485 }
 *         quot_no:        { type: string,  example: "Q-V-262700116" }
 *         enquiry_no:     { type: string,  example: "ENQ262700219" }
 *         enquiry_id:     { type: integer, example: 3399 }
 *         date:           { type: string, format: date, example: "2026-06-30" }
 *         enquiry_date:   { type: string, format: date, example: "2026-06-30" }
 *         subject:
 *           type: string
 *           example: "Quotation for Spares Part of Italvacuum Pump Model VVB"
 *         kind_attention: { type: string, example: "Mr. Jaypalsinh Gohil" }
 *         email:          { type: string, example: "jaypalsinh.gohil@piind.com" }
 *         customer:
 *           type: object
 *           properties:
 *             id:   { type: integer, example: 163 }
 *             code: { type: string,  example: "C112" }
 *             name: { type: string,  example: "Agrocel Industries Private Limited" }
 *         bill_to:
 *           type: object
 *           properties:
 *             id:   { type: integer, example: 163 }
 *             name: { type: string,  example: "Agrocel Industries Private Limited" }
 *         ship_to:
 *           type: object
 *           properties:
 *             id:   { type: integer, example: 163 }
 *             name: { type: string,  example: "Agrocel Industries Private Limited" }
 *         priority:       { type: string, enum: [High, Medium, Low], example: "High" }
 *         category:
 *           type: string
 *           description: Quotation category from ERP (AMC Service | Spare | Accessories | etc.)
 *           example: "Spare"
 *         sector:         { type: string, example: "" }
 *         plant:          { type: string, example: "VACUUM" }
 *         financial_year: { type: string, example: "26-27" }
 *         currency:       { type: string, example: "Rs" }
 *         net_total:      { type: number, example: 227708.24 }
 *         discount_per:   { type: number, example: 0 }
 *         discount_amt:   { type: number, example: 0 }
 *         gst:
 *           type: object
 *           properties:
 *             cgst_per: { type: number, example: 0 }
 *             cgst_amt: { type: number, example: 0 }
 *             sgst_per: { type: number, example: 0 }
 *             sgst_amt: { type: number, example: 0 }
 *             igst_per: { type: number, example: 0 }
 *             igst_amt: { type: number, example: 0 }
 *         prepared_by:    { type: string, example: "PriyankaS" }
 *         prepared_by_id: { type: integer, example: 1 }
 *         entered_by:     { type: string, example: "SwaraS" }
 *         entered_by_id:  { type: integer, example: 9 }
 *         quotation_status:
 *           type: string
 *           enum: [Open, Approved, Cancelled]
 *           description: >
 *             Derived from ERP flags — `Cancelled` if QCancel=Y,
 *             `Approved` if both Auth1+Auth2=Y, otherwise `Open`.
 *           example: "Approved"
 *         enquiry_status: { type: string, example: "Open" }
 *         is_amended:     { type: boolean, example: false }
 *         is_cancelled:   { type: boolean, example: false }
 *         version_no:     { type: integer, example: 0 }
 *         authorization:
 *           type: object
 *           properties:
 *             auth1_status: { type: string, example: "Y" }
 *             auth1_by:     { type: string, example: "SwaraS" }
 *             auth1_date:   { type: string, format: date, example: "2026-06-30" }
 *             auth2_status: { type: string, example: "Y" }
 *             auth2_by:     { type: string, example: "SwaraS" }
 *             auth2_date:   { type: string, format: date, example: "2026-06-30" }
 *         cancel_info:
 *           type: object
 *           nullable: true
 *           description: Present only when is_cancelled is true
 *           properties:
 *             cancelled_by:   { type: string }
 *             cancelled_date: { type: string, format: date }
 *             remark:         { type: string }
 *         items:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ErpQuotationItem'
 *
 *     ErpQuotationListResponse:
 *       type: object
 *       properties:
 *         success:  { type: boolean, example: true }
 *         source:   { type: string,  example: "erp" }
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ErpQuotation'
 *         pagination:
 *           type: object
 *           properties:
 *             total:       { type: integer, example: 42 }
 *             page:        { type: integer, example: 1 }
 *             limit:       { type: integer, example: 20 }
 *             total_pages: { type: integer, example: 3 }
 *             has_next:    { type: boolean, example: true }
 *             has_prev:    { type: boolean, example: false }
 *         filters_applied:
 *           type: object
 *           properties:
 *             search:      { type: string, nullable: true }
 *             status:      { type: string, nullable: true }
 *             from_date:   { type: string, nullable: true }
 *             to_date:     { type: string, nullable: true }
 *             priority:    { type: string, nullable: true }
 *             category:    { type: string, nullable: true }
 *             prepared_by: { type: string, nullable: true }
 *             entered_by:  { type: string, nullable: true }
 *
 *     ErpQuotationSingleResponse:
 *       type: object
 *       properties:
 *         success: { type: boolean, example: true }
 *         source:  { type: string,  example: "erp" }
 *         data:
 *           $ref: '#/components/schemas/ErpQuotation'
 *
 *     ErpCustomer:
 *       type: object
 *       description: A customer record as returned by the ERP system.
 *       properties:
 *         id:           { type: string, example: "CUST-001" }
 *         name:         { type: string, example: "Acme Corp" }
 *         email:        { type: string, format: email, example: "contact@acme.com" }
 *         phone:        { type: string, example: "+911234567890" }
 *         address:      { type: string, example: "123 Industrial Area, Mumbai" }
 *         gstin:        { type: string, example: "27AABCU9603R1ZX" }
 *         status:       { type: string, enum: [Active, Inactive], example: "Active" }
 *         created_date: { type: string, format: date, example: "2023-01-15" }
 *
 *     ErpCustomerListResponse:
 *       type: object
 *       properties:
 *         success: { type: boolean, example: true }
 *         source:  { type: string,  example: "erp" }
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ErpCustomer'
 *         pagination:
 *           type: object
 *           properties:
 *             total:       { type: integer }
 *             page:        { type: integer }
 *             limit:       { type: integer }
 *             total_pages: { type: integer }
 *
 *     ErpCustomerSingleResponse:
 *       type: object
 *       properties:
 *         success: { type: boolean, example: true }
 *         source:  { type: string,  example: "erp" }
 *         data:
 *           $ref: '#/components/schemas/ErpCustomer'
 *
 *     ErpErrorResponse:
 *       type: object
 *       properties:
 *         success:    { type: boolean, example: false }
 *         error_code: { type: string,  example: "ERP_TIMEOUT" }
 *         message:    { type: string,  example: "The ERP server did not respond in time. Please try again." }
 */

// ─────────────────────────────────────────────────────────────
// TAG
// ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * tags:
 *   - name: ERP – Quotations
 *     description: >
 *       Live proxy to the external ERP Quotation API (`QuotationAPI.ashx`).
 *       Fetches directly from ERP on every request. Use for real-time data.
 *   - name: ERP – Customers
 *     description: >
 *       Live proxy to the external ERP Customer API (`CustomerAPI.ashx`).
 *       Fetches directly from ERP on every request.
 *   - name: ERP – Sync & Local DB
 *     description: |
 *       **Two-step workflow:**
 *       1. `POST /api/erp/sync/quotations` — Pull all quotations from ERP into local DB
 *       2. `GET  /api/erp/local/quotations` — Query local DB fast with full filters
 *
 *       Local DB queries are much faster than live ERP calls and support
 *       SQL-level filtering (ILIKE, date ranges, client_id FK join, etc.).
 *       Run sync periodically (or on-demand) to keep local data fresh.
 */

// ─────────────────────────────────────────────────────────────
// QUOTATION ROUTES
// ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/erp/quotations:
 *   get:
 *     summary: Get all quotations from ERP (grouped, with filters)
 *     description: |
 *       Fetches all quotation records from the ERP (`QuotationAPI.ashx`), groups
 *       the flat line-item rows into proper quotation objects, applies filters,
 *       then paginates the result.
 *
 *       > **Note:** The ERP returns one row per product line.
 *       > This API groups them so each quotation has an `items[]` array inside it.
 *
 *       ### Quotation Status (derived field)
 *       There is no single status field in the ERP — it is derived from flags:
 *
 *       | `quotation_status` | Condition |
 *       |---|---|
 *       | `Cancelled` | `QCancel = "Y"` |
 *       | `Approved` | Auth1 = Y **and** Auth2 = Y (and not cancelled) |
 *       | `Open` | Everything else |
 *
 *       > Use `status=Rejected` as an alias for `status=Cancelled`.
 *     tags: [ERP – Quotations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: >
 *           Free-text search across quotation number, enquiry number,
 *           customer name, subject line, and kind-attention name.
 *         example: "Agrocel"
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [Open, Approved, Cancelled, Rejected]
 *         description: >
 *           Filter by derived quotation status.
 *           `Rejected` is an alias for `Cancelled`.
 *         example: "Approved"
 *       - in: query
 *         name: from_date
 *         schema: { type: string, format: date }
 *         description: Show quotations on or after this date (QuotDate ≥ from_date)
 *         example: "2026-01-01"
 *       - in: query
 *         name: to_date
 *         schema: { type: string, format: date }
 *         description: Show quotations on or before this date (QuotDate ≤ to_date)
 *         example: "2026-06-30"
 *       - in: query
 *         name: priority
 *         schema:
 *           type: string
 *           enum: [High, Medium, Low]
 *         description: Filter by enquiry priority
 *         example: "High"
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *         description: >
 *           Partial match on quotation category (from ERP `CategoryName` field).
 *           Common values: `AMC Service`, `Spare`, `Accessories`.
 *           Case-insensitive — `spare` matches "Spare Parts".
 *         example: "AMC Service"
 *       - in: query
 *         name: prepared_by
 *         schema: { type: string }
 *         description: Partial name match on the person who prepared the quotation
 *         example: "Priyanka"
 *       - in: query
 *         name: entered_by
 *         schema: { type: string }
 *         description: Partial name match on the person who entered/raised the quotation
 *         example: "Swara"
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *         description: Page number (pagination is on grouped quotations, not raw rows)
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *         description: Number of quotations per page (max 100)
 *     responses:
 *       200:
 *         description: List of grouped quotations
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErpQuotationListResponse'
 *             example:
 *               success: true
 *               source: "erp"
 *               data:
 *                 - quot_id: 3485
 *                   quot_no: "Q-V-262700116"
 *                   enquiry_no: "ENQ262700219"
 *                   date: "2026-06-30"
 *                   subject: "Quotation for Spares Part of Italvacuum Pump Model VVB"
 *                   customer:
 *                     id: 163
 *                     code: "C112"
 *                     name: "Agrocel Industries Private Limited"
 *                   priority: "High"
 *                   net_total: 227708.24
 *                   currency: "Rs"
 *                   prepared_by: "PriyankaS"
 *                   entered_by: "SwaraS"
 *                   quotation_status: "Approved"
 *                   enquiry_status: "Open"
 *                   items:
 *                     - line_id: 17748
 *                       item_code: "ZRCHSGMB21"
 *                       description: "Complete Set of Piston Ring VVB"
 *                       qty: 1
 *                       unit: "SET"
 *                       rate: 72411.25
 *                       total: 72411.25
 *               pagination:
 *                 total: 1
 *                 page: 1
 *                 limit: 20
 *                 total_pages: 1
 *                 has_next: false
 *                 has_prev: false
 *               filters_applied:
 *                 search: null
 *                 status: null
 *                 from_date: null
 *                 to_date: null
 *                 priority: null
 *                 prepared_by: null
 *                 entered_by: null
 *       401:
 *         description: Unauthorised – JWT token missing or invalid
 *       502:
 *         description: ERP returned an HTTP error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErpErrorResponse' }
 *       504:
 *         description: ERP did not respond within 15 seconds
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErpErrorResponse' }
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
 *         description: Single quotation with all line items grouped inside
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErpQuotationSingleResponse'
 *             example:
 *               success: true
 *               source: "erp"
 *               data:
 *                 quot_id: 3485
 *                 quot_no: "Q-V-262700116"
 *                 enquiry_no: "ENQ262700219"
 *                 date: "2026-06-30"
 *                 subject: "Quotation for Spares Part of Italvacuum Pump Model VVB"
 *                 customer:
 *                   id: 163
 *                   code: "C112"
 *                   name: "Agrocel Industries Private Limited"
 *                 priority: "High"
 *                 net_total: 227708.24
 *                 currency: "Rs"
 *                 prepared_by: "PriyankaS"
 *                 entered_by: "SwaraS"
 *                 quotation_status: "Approved"
 *                 enquiry_status: "Open"
 *                 authorization:
 *                   auth1_status: "Y"
 *                   auth1_by: "SwaraS"
 *                   auth1_date: "2026-06-30"
 *                   auth2_status: "Y"
 *                   auth2_by: "SwaraS"
 *                   auth2_date: "2026-06-30"
 *                 cancel_info: null
 *                 items:
 *                   - line_id: 17748
 *                     item_code: "ZRCHSGMB21"
 *                     description: "Complete Set of Piston Ring VVB"
 *                     qty: 1
 *                     unit: "SET"
 *                     rate: 72411.25
 *                     total: 72411.25
 *       401:
 *         description: Unauthorised – JWT token missing or invalid
 *       404:
 *         description: Quotation not found in ERP
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErpErrorResponse' }
 *             example:
 *               success: false
 *               error_code: "QUOTATION_NOT_FOUND"
 *               message: "Quotation with ID '9999' was not found in the ERP."
 *       502:
 *         description: ERP returned an HTTP error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErpErrorResponse' }
 *       504:
 *         description: ERP did not respond within 15 seconds
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErpErrorResponse' }
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

// ─────────────────────────────────────────────────────────────
// SYNC ROUTE
// ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/erp/sync/quotations:
 *   post:
 *     summary: Sync all ERP quotations into the local database
 *     description: |
 *       Pulls every quotation from the ERP (`QuotationAPI.ashx`), groups the flat
 *       line-item rows, then **upserts** them into the local `erp_quotations` and
 *       `erp_quotation_items` tables.
 *
 *       ### What happens on each sync
 *       | Situation | Action |
 *       |---|---|
 *       | Quotation not in local DB | **INSERT** |
 *       | Quotation already in local DB | **UPDATE** all fields + `synced_at` |
 *       | Line items | Old items deleted and re-inserted fresh |
 *       | ERP customer matches `clients.erp_customer_id` | `client_id` FK set automatically |
 *       | No matching local client | `client_id` = NULL |
 *
 *       > **Prerequisite:** Run `db/queries/009_erp_quotations.sql` on the database first.
 *
 *       > **Access:** Admin and Manager only.
 *     tags: [ERP – Sync & Local DB]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Sync completed (check `failed` count for partial errors)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:     { type: boolean, example: true }
 *                 message:     { type: string,  example: "Sync complete. 38 inserted, 4 updated, 0 failed." }
 *                 total:       { type: integer, example: 42, description: "Total quotations found in ERP" }
 *                 inserted:    { type: integer, example: 38, description: "New quotations added to local DB" }
 *                 updated:     { type: integer, example: 4,  description: "Existing quotations refreshed" }
 *                 failed:      { type: integer, example: 0,  description: "Quotations that could not be saved" }
 *                 duration_ms: { type: integer, example: 1243 }
 *                 errors:
 *                   type: array
 *                   description: Present only when failed > 0
 *                   items:
 *                     type: object
 *                     properties:
 *                       quot_id:  { type: integer }
 *                       quot_no:  { type: string }
 *                       error:    { type: string }
 *             example:
 *               success: true
 *               message: "Sync complete. 38 inserted, 4 updated, 0 failed."
 *               total: 42
 *               inserted: 38
 *               updated: 4
 *               failed: 0
 *               duration_ms: 1243
 *       401:
 *         description: Unauthorised
 *       403:
 *         description: Forbidden — admin or manager role required
 *       502:
 *         description: ERP returned an HTTP error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErpErrorResponse' }
 *       504:
 *         description: ERP did not respond within 15 seconds
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErpErrorResponse' }
 *       500:
 *         description: Internal server error
 */
router.post('/sync/quotations', protect, authorize('admin', 'manager'), syncQuotations);

// ─────────────────────────────────────────────────────────────
// LOCAL DB QUOTATION ROUTES
// ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/erp/local/quotations:
 *   get:
 *     summary: Get synced quotations from local database (fast, with full filters)
 *     description: |
 *       Reads from the local `erp_quotations` table — much faster than calling
 *       the ERP live. Use `POST /api/erp/sync/quotations` to refresh data first.
 *
 *       Returns the **exact same object shape** as `GET /api/erp/quotations`
 *       so the frontend can switch between live ERP and local DB with no code change.
 *       The only difference is `source: "local_db"` and an extra `client_id` field
 *       (your local client FK, `null` if the ERP customer has no local match).
 *
 *       ### Filters (all optional)
 *       | Param | Description |
 *       |---|---|
 *       | `search` | Searches quot_no, enquiry_no, customer name, subject, kind_attention |
 *       | `status` | `Open` / `Approved` / `Cancelled` / `Rejected` (alias for Cancelled) |
 *       | `from_date` | QuotDate ≥ this date (YYYY-MM-DD) |
 *       | `to_date` | QuotDate ≤ this date (YYYY-MM-DD) |
 *       | `priority` | `High` / `Medium` / `Low` |
 *       | `category` | Partial match — `AMC Service`, `Spare`, `Accessories`, etc. |
 *       | `prepared_by` | Partial name match |
 *       | `entered_by` | Partial name match |
 *       | `client_id` | Filter by local client ID (only quotations linked to that client) |
 *       | `page` / `limit` | Pagination (default 1 / 20, max limit 100) |
 *     tags: [ERP – Sync & Local DB]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Search across quot_no, enquiry_no, customer name, subject, kind_attention
 *         example: "Alembic"
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [Open, Approved, Cancelled, Rejected]
 *         example: "Approved"
 *       - in: query
 *         name: from_date
 *         schema: { type: string, format: date }
 *         example: "2026-01-01"
 *       - in: query
 *         name: to_date
 *         schema: { type: string, format: date }
 *         example: "2026-07-31"
 *       - in: query
 *         name: priority
 *         schema: { type: string, enum: [High, Medium, Low] }
 *         example: "High"
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *         description: Partial match — AMC Service | Spare | Accessories
 *         example: "Accessories"
 *       - in: query
 *         name: prepared_by
 *         schema: { type: string }
 *         example: "Shruti"
 *       - in: query
 *         name: entered_by
 *         schema: { type: string }
 *         example: "Gaurangi"
 *       - in: query
 *         name: client_id
 *         schema: { type: integer }
 *         description: Filter by local client ID (from clients table)
 *         example: 13
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *     responses:
 *       200:
 *         description: Paginated list of quotations from local database
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErpQuotationListResponse'
 *             example:
 *               success: true
 *               source: "local_db"
 *               data:
 *                 - quot_id: 3496
 *                   quot_no: "Q-V-262700054"
 *                   enquiry_no: "ENQ262700230"
 *                   date: "2026-07-09"
 *                   subject: "Quotation for Accessories of Italvacuum Pump model VVC"
 *                   customer:
 *                     id: 13
 *                     code: "C10013"
 *                     name: "Alembic Pharmaceuticals Limited"
 *                   client_id: 13
 *                   priority: "High"
 *                   category: "Accessories"
 *                   net_total: 425500
 *                   currency: "Rs"
 *                   prepared_by: "ShrutiT"
 *                   entered_by: "Gaurangi N"
 *                   quotation_status: "Approved"
 *                   items:
 *                     - line_id: 17849
 *                       item_code: "FVVCCPWAF"
 *                       description: "VVC Control Panel with Autoflushing System"
 *                       qty: 1
 *                       unit: "NOS"
 *                       rate: 425500
 *                       total: 425500
 *                   synced_at: "2026-07-10T08:30:00Z"
 *               pagination:
 *                 total: 42
 *                 page: 1
 *                 limit: 20
 *                 total_pages: 3
 *                 has_next: true
 *                 has_prev: false
 *               filters_applied:
 *                 search: null
 *                 status: null
 *                 from_date: null
 *                 to_date: null
 *                 priority: null
 *                 category: null
 *                 prepared_by: null
 *                 entered_by: null
 *                 client_id: null
 *       401:
 *         description: Unauthorised
 *       500:
 *         description: Internal server error
 */
router.get('/local/quotations', protect, getLocalQuotations);

/**
 * @swagger
 * /api/erp/local/quotations/{id}:
 *   get:
 *     summary: Get a single synced quotation from local database by quot_id
 *     tags: [ERP – Sync & Local DB]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: ERP quot_id (e.g. 3496)
 *         example: 3496
 *     responses:
 *       200:
 *         description: Single quotation with all line items
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErpQuotationSingleResponse'
 *             example:
 *               success: true
 *               source: "local_db"
 *               data:
 *                 quot_id: 3496
 *                 quot_no: "Q-V-262700054"
 *                 client_id: 13
 *                 customer:
 *                   id: 13
 *                   code: "C10013"
 *                   name: "Alembic Pharmaceuticals Limited"
 *                 net_total: 425500
 *                 quotation_status: "Approved"
 *                 synced_at: "2026-07-10T08:30:00Z"
 *                 items:
 *                   - item_code: "FVVCCPWAF"
 *                     description: "VVC Control Panel with Autoflushing System"
 *                     qty: 1
 *                     rate: 425500
 *                     total: 425500
 *       404:
 *         description: Quotation not found in local DB
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErpErrorResponse' }
 *             example:
 *               success: false
 *               error_code: "QUOTATION_NOT_FOUND"
 *               message: "Quotation with ID '9999' was not found in the local database. Try syncing first."
 *       401:
 *         description: Unauthorised
 *       500:
 *         description: Internal server error
 */
router.get('/local/quotations/:id', protect, getLocalQuotationById);

module.exports = router;
