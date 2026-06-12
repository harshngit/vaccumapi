// ============================================================
// src/controllers/erpController.js
// Proxy controller for external ERP APIs (Quotation & Customer)
// ============================================================

const { Errors } = require('../utils/AppError');

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
      customer_id,
      from_date,
      to_date,
      status,
      search,
    } = req.query;

    const erpData = await fetchFromERP('QuotationAPI.ashx', {
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

    return res.status(200).json({
      success : true,
      source  : 'erp',
      count   : records.length,
      data    : records,
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

    return res.status(200).json({
      success : true,
      source  : 'erp',
      data    : record,
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
};
