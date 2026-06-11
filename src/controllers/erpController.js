// ============================================================
// src/controllers/erpController.js
// Proxy controller for external ERP APIs (Quotation & Customer)
// ============================================================

const { Errors } = require('../utils/AppError');
const pool = require('../config/db');

const ERP_BASE_URL = process.env.ERP_BASE_URL || 'http://203.192.195.67/erp';
const ERP_API_KEY  = process.env.ERP_API_KEY  || '';   // set in .env if required

// ─── Shared ERP fetch helper ──────────────────────────────────
/**
 * Fetch data from the ERP with optional query params.
 * Converts any ERP-level error into a thrown Error so callers can catch once.
 */
async function fetchFromERP(endpoint, params = {}) {
  const url = new URL(`${ERP_BASE_URL}/${endpoint}`);

  // Forward every param from `params` to the ERP query string
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, v);
    }
  });

  const headers = { Accept: 'application/json' };
  if (ERP_API_KEY) headers['X-API-Key'] = ERP_API_KEY;

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers,
    // 15-second timeout so a slow ERP doesn't hang the client forever
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const err  = new Error(`ERP returned HTTP ${response.status}: ${text}`);
    err.erpStatus = response.status;
    throw err;
  }

  // The ERP may respond with JSON or with XML/HTML — handle both gracefully
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  // Fall back: return raw text wrapped in an object so callers stay consistent
  const text = await response.text();
  return { raw: text };
}

// ─── ERP → local clients mirror helper ────────────────────────
/**
 * Map a single ERP customer record to local `clients` columns.
 * Returns null if it can't be mirrored (missing CustId or CustName).
 */
function mapErpCustomer(rec) {
  if (!rec || typeof rec !== 'object') return null;

  const custId = rec.CustId ?? rec.custId ?? rec.cust_id;
  const name   = (rec.CustName ?? rec.custName ?? '').toString().trim();
  if (custId === undefined || custId === null || custId === '' || !name) return null;

  const address = [rec.CustAdd, rec.CustAdd1, rec.CustAdd2, rec.PinCode, rec.StateCode]
    .map((p) => (p === null || p === undefined ? '' : String(p).trim()))
    .filter(Boolean)
    .join(', ') || null;

  return {
    erp_customer_id: custId,
    erp_cust_code:   rec.CustCode ? String(rec.CustCode).trim() : null,
    name,
    contact_person:  name, // ERP has no separate person field
    email:           rec.EmailId ? String(rec.EmailId).toLowerCase().trim() : null,
    phone:           rec.ContactNo ? String(rec.ContactNo).trim() : null,
    address,
  };
}

/**
 * Bulk-upsert ERP customer records into the local `clients` table and
 * return a Map of erp_customer_id -> local clients.id.
 *
 * Never throws: if the DB is unavailable the ERP proxy must still work,
 * so on any error it logs and returns an empty Map.
 */
async function syncErpCustomersToLocal(records) {
  const map = new Map();
  const mapped = (Array.isArray(records) ? records : [records])
    .map(mapErpCustomer)
    .filter(Boolean);

  // Dedupe by erp_customer_id — the ERP can return the same CustId more
  // than once, and ON CONFLICT cannot affect the same row twice in one
  // statement (that would error out the whole upsert and lose the ids).
  const byId = new Map();
  mapped.forEach((r) => byId.set(String(r.erp_customer_id), r));
  const rows = [...byId.values()];

  if (rows.length === 0) return map;

  try {
    // Build one parameterised bulk INSERT ... ON CONFLICT statement
    const cols = 7; // name, contact_person, email, phone, address, erp_customer_id, erp_cust_code
    const valuesSql = rows.map((_, i) => {
      const b = i * cols;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, 'Corporate', 'Active', 0, CURRENT_DATE, 'erp', $${b + 6}, $${b + 7})`;
    }).join(', ');

    const params = [];
    rows.forEach((r) => {
      params.push(r.name, r.contact_person, r.email, r.phone, r.address, r.erp_customer_id, r.erp_cust_code);
    });

    const result = await pool.query(
      `INSERT INTO clients
         (name, contact_person, email, phone, address, type, status,
          contract_value, join_date, origin, erp_customer_id, erp_cust_code)
       VALUES ${valuesSql}
       ON CONFLICT (erp_customer_id) WHERE erp_customer_id IS NOT NULL
       DO UPDATE SET
         name           = EXCLUDED.name,
         contact_person = EXCLUDED.contact_person,
         email          = EXCLUDED.email,
         phone          = EXCLUDED.phone,
         address        = EXCLUDED.address,
         erp_cust_code  = EXCLUDED.erp_cust_code,
         origin         = 'erp'
       RETURNING id, erp_customer_id`,
      params
    );

    result.rows.forEach((row) => map.set(String(row.erp_customer_id), row.id));
  } catch (error) {
    console.error('ERP customer mirror error (proxy will still return ERP data):', error.message);
  }

  return map;
}

/** Attach local_client_id to an ERP record using the synced id map. */
function attachLocalId(rec, idMap) {
  if (!rec || typeof rec !== 'object') return rec;
  const custId = rec.CustId ?? rec.custId ?? rec.cust_id;
  return { ...rec, local_client_id: idMap.get(String(custId)) ?? null };
}

// ─── GET /api/erp/quotations ──────────────────────────────────
/**
 * Fetch all quotations (or filter by query params) from the ERP.
 *
 * Supported query params forwarded to ERP:
 *   - page         {integer}  page number
 *   - limit        {integer}  records per page
 *   - customer_id  {string}   filter by customer
 *   - from_date    {string}   YYYY-MM-DD
 *   - to_date      {string}   YYYY-MM-DD
 *   - status       {string}   e.g. Draft | Confirmed | Cancelled
 *   - search       {string}   free-text search
 */
const getQuotations = async (req, res) => {
  try {
    const {
      page        = 1,
      limit       = 50,
      customer_id,
      from_date,
      to_date,
      status,
      search,
    } = req.query;

    const erpData = await fetchFromERP('QuotationAPI.ashx', {
      page,
      limit,
      customer_id,
      from_date,
      to_date,
      status,
      search,
    });

    // Normalise: if ERP returns a bare array, wrap it; otherwise pass through
    const records = Array.isArray(erpData)
      ? erpData
      : erpData.data ?? erpData.quotations ?? erpData.records ?? (erpData.raw ? [] : [erpData]);

    return res.status(200).json({
      success : true,
      source  : 'erp',
      count   : records.length,
      data    : records,
      // Preserve any pagination meta the ERP sent back
      ...(erpData.pagination   && { pagination  : erpData.pagination   }),
      ...(erpData.totalRecords && { totalRecords: erpData.totalRecords }),
      ...(erpData.raw          && { raw         : erpData.raw          }),
    });
  } catch (error) {
    console.error('ERP Quotation fetch error:', error.message);

    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return res.status(504).json({
        success    : false,
        error_code : 'ERP_TIMEOUT',
        message    : 'The ERP server did not respond in time. Please try again.',
      });
    }

    if (error.erpStatus) {
      return res.status(502).json({
        success    : false,
        error_code : 'ERP_ERROR',
        message    : `ERP returned an error (HTTP ${error.erpStatus}). Please check the ERP server.`,
      });
    }

    return Errors.internalError(res);
  }
};

// ─── GET /api/erp/quotations/:id ─────────────────────────────
/**
 * Fetch a single quotation by ID.
 */
const getQuotationById = async (req, res) => {
  try {
    const { id } = req.params;

    const erpData = await fetchFromERP('QuotationAPI.ashx', { id });

    // ERP may return single object or single-item array
    const record = Array.isArray(erpData) ? erpData[0] : (erpData.data ?? erpData);

    if (!record || (typeof record === 'object' && Object.keys(record).length === 0)) {
      return res.status(404).json({
        success    : false,
        error_code : 'QUOTATION_NOT_FOUND',
        message    : `Quotation with ID '${id}' was not found in the ERP.`,
      });
    }

    return res.status(200).json({
      success : true,
      source  : 'erp',
      data    : record,
    });
  } catch (error) {
    console.error('ERP Quotation by ID fetch error:', error.message);

    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return res.status(504).json({
        success    : false,
        error_code : 'ERP_TIMEOUT',
        message    : 'The ERP server did not respond in time. Please try again.',
      });
    }

    if (error.erpStatus) {
      return res.status(502).json({
        success    : false,
        error_code : 'ERP_ERROR',
        message    : `ERP returned an error (HTTP ${error.erpStatus}).`,
      });
    }

    return Errors.internalError(res);
  }
};

// ─── GET /api/erp/customers ───────────────────────────────────
/**
 * Fetch all customers (or filter by query params) from the ERP.
 *
 * Supported query params forwarded to ERP:
 *   - page     {integer}  page number
 *   - limit    {integer}  records per page
 *   - search   {string}   name / phone / email
 *   - status   {string}   Active | Inactive
 */
const getCustomers = async (req, res) => {
  try {
    const {
      page   = 1,
      limit  = 50,
      search,
      status,
    } = req.query;

    const erpData = await fetchFromERP('CustomerAPI.ashx', {
      page,
      limit,
      search,
      status,
    });

    const records = Array.isArray(erpData)
      ? erpData
      : erpData.data ?? erpData.customers ?? erpData.records ?? (erpData.raw ? [] : [erpData]);

    // Auto-mirror these ERP customers into local clients and tag each
    // record with its local_client_id (used as client_id for AMC).
    const idMap = await syncErpCustomersToLocal(records);
    const data  = records.map((r) => attachLocalId(r, idMap));

    return res.status(200).json({
      success : true,
      source  : 'erp',
      count   : data.length,
      data,
      ...(erpData.pagination   && { pagination  : erpData.pagination   }),
      ...(erpData.totalRecords && { totalRecords: erpData.totalRecords }),
      ...(erpData.raw          && { raw         : erpData.raw          }),
    });
  } catch (error) {
    console.error('ERP Customer fetch error:', error.message);

    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return res.status(504).json({
        success    : false,
        error_code : 'ERP_TIMEOUT',
        message    : 'The ERP server did not respond in time. Please try again.',
      });
    }

    if (error.erpStatus) {
      return res.status(502).json({
        success    : false,
        error_code : 'ERP_ERROR',
        message    : `ERP returned an error (HTTP ${error.erpStatus}). Please check the ERP server.`,
      });
    }

    return Errors.internalError(res);
  }
};

// ─── GET /api/erp/customers/:id ──────────────────────────────
/**
 * Fetch a single customer by ID.
 */
const getCustomerById = async (req, res) => {
  try {
    const { id } = req.params;

    const erpData = await fetchFromERP('CustomerAPI.ashx', { id });

    const record = Array.isArray(erpData) ? erpData[0] : (erpData.data ?? erpData);

    if (!record || (typeof record === 'object' && Object.keys(record).length === 0)) {
      return res.status(404).json({
        success    : false,
        error_code : 'CUSTOMER_NOT_FOUND',
        message    : `Customer with ID '${id}' was not found in the ERP.`,
      });
    }

    // Auto-mirror into local clients and tag with local_client_id
    const idMap = await syncErpCustomersToLocal([record]);
    const data  = attachLocalId(record, idMap);

    return res.status(200).json({
      success : true,
      source  : 'erp',
      data,
    });
  } catch (error) {
    console.error('ERP Customer by ID fetch error:', error.message);

    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return res.status(504).json({
        success    : false,
        error_code : 'ERP_TIMEOUT',
        message    : 'The ERP server did not respond in time. Please try again.',
      });
    }

    if (error.erpStatus) {
      return res.status(502).json({
        success    : false,
        error_code : 'ERP_ERROR',
        message    : `ERP returned an error (HTTP ${error.erpStatus}).`,
      });
    }

    return Errors.internalError(res);
  }
};

module.exports = {
  getQuotations,
  getQuotationById,
  getCustomers,
  getCustomerById,
  // exported for reuse by the combined directory endpoints
  fetchFromERP,
  syncErpCustomersToLocal,
  attachLocalId,
};