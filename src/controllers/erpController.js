// ============================================================
// src/controllers/erpController.js
// Proxy controller for external ERP APIs (Quotation & Customer)
// ============================================================

const { Errors } = require('../utils/AppError');

const ERP_BASE_URL = process.env.ERP_BASE_URL || 'http://203.192.195.67/erp';
const ERP_API_KEY  = process.env.ERP_API_KEY  || '';

// ─── Shared ERP fetch helper ──────────────────────────────────
async function fetchFromERP(endpoint, params = {}) {
  const url = new URL(`${ERP_BASE_URL}/${endpoint}`);

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
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const err  = new Error(`ERP returned HTTP ${response.status}: ${text}`);
    err.erpStatus = response.status;
    throw err;
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json();
  const text = await response.text();
  return { raw: text };
}

// ─── Normalise raw ERP array ──────────────────────────────────
function toRawArray(erpData) {
  if (Array.isArray(erpData)) return erpData;
  return erpData.data ?? erpData.quotations ?? erpData.records ?? (erpData.raw ? [] : [erpData]);
}

// ─── Derive a clean quotation_status from ERP flags ──────────
// ERP has no single status field for quotations. We derive:
//   Cancelled  — QCancel = "Y"
//   Approved   — Auth1Status = "Y" AND Auth2Status = "Y" (and not cancelled)
//   Open       — everything else
function deriveStatus(row) {
  if (row.QCancel === 'Y')                                    return 'Cancelled';
  if (row.Auth1Status === 'Y' && row.Auth2Status === 'Y')    return 'Approved';
  return 'Open';
}

// ─── Group flat ERP rows (1 row per line item) into quotations ─
// The ERP returns one row per product line. This groups them by
// QuotId and nests items[] inside each quotation object.
function groupQuotations(rawRows) {
  const map = new Map();

  for (const row of rawRows) {
    const key = row.QuotId;

    if (!map.has(key)) {
      map.set(key, {
        quot_id        : row.QuotId,
        quot_no        : row.QuotNoText,
        enquiry_no     : row.EnquiryNoText,
        enquiry_id     : row.EnquiryID,
        date           : row.QuotDate,
        enquiry_date   : row.EnquiryDate,
        subject        : row.Sub,
        kind_attention : row.KindAtten?.trim() || '',
        email          : row.EmailId?.trim()   || '',

        customer: {
          id   : row.EnquiryCustomerId,
          code : row.EnquiryCustomerCode,
          name : row.CustName || row.EnquiryCustomerName,
        },
        bill_to: {
          id   : row.BillToCustId,
          name : row.BillToCustName,
        },
        ship_to: {
          id   : row.ShipToCustId,
          name : row.ShipToCustName,
        },

        priority       : row.EnquiryPriority,  // High | Medium | Low
        category       : row.CategoryName || '',   // AMC Service | Spare | Accessories | etc.
        sector         : row.Enq_Sector   !== 'Select' ? (row.Enq_Sector || '') : '',
        plant          : row.EnquiryPlantName,
        financial_year : row.FyName,
        currency       : row.CurrencyCode,

        net_total    : row.NetTotal,
        discount_per : row.Disc_Per  || 0,
        discount_amt : row.Disc_Amt  || 0,
        gst: {
          cgst_per : row.CGSTPer  || 0,
          cgst_amt : row.CGSTAmt  || 0,
          sgst_per : row.SGSTPer  || 0,
          sgst_amt : row.SGSTAmt  || 0,
          igst_per : row.IGSTPer  || 0,
          igst_amt : row.IGSTAmt  || 0,
        },

        // People
        prepared_by    : row.PreparedByName,
        prepared_by_id : row.PreparedById,
        entered_by     : row.EntryUserName,
        entered_by_id  : row.UserId,

        // Derived status
        quotation_status : deriveStatus(row),
        enquiry_status   : row.EnquiryStatus,
        is_amended       : row.IsAmmend === 'Y',
        is_cancelled     : row.QCancel  === 'Y',
        version_no       : row.VersionNo || 0,

        authorization: {
          auth1_status : row.Auth1Status,
          auth1_by     : row.Auth1UserName,
          auth1_date   : row.Auth1Date,
          auth2_status : row.Auth2Status,
          auth2_by     : row.Auth2UserName,
          auth2_date   : row.Auth2Date,
        },

        cancel_info: row.QCancel === 'Y' ? {
          cancelled_by   : row.QCancelUserName  || '',
          cancelled_date : row.QCancelDate      || '',
          remark         : row.QCancelRemark    || '',
        } : null,

        items: [],
      });
    }

    // Append line item (DetailAutoId is 0 when there are no products)
    if (row.DetailAutoId) {
      map.get(key).items.push({
        line_id      : row.DetailAutoId,
        item_id      : row.ItemId,
        item_code    : row.ItemCode,
        item_no      : row.ItemNo,
        description  : row.Description || row.ItemDesc,
        qty          : row.Qty,
        unit         : row.UnitCode,
        rate         : row.Rate,
        discount_per : row.DiscountPer || 0,
        discount_amt : row.DiscountAmt || 0,
        total        : row.Total,
        note         : row.Note     || '',
        hsn_code     : row.HSNCode  || '',
      });
    }
  }

  return Array.from(map.values());
}

// ─── Shared ERP error response ────────────────────────────────
function handleErpError(error, res, context) {
  console.error(`ERP ${context} error:`, error.message);
  if (error.name === 'TimeoutError' || error.name === 'AbortError') {
    return res.status(504).json({
      success: false, error_code: 'ERP_TIMEOUT',
      message: 'The ERP server did not respond in time. Please try again.',
    });
  }
  if (error.erpStatus) {
    return res.status(502).json({
      success: false, error_code: 'ERP_ERROR',
      message: `ERP returned an error (HTTP ${error.erpStatus}). Please check the ERP server.`,
    });
  }
  return Errors.internalError(res);
}

// ─── GET /api/erp/quotations ──────────────────────────────────
/**
 * Returns grouped quotations (items[] nested inside each).
 * All filtering is done client-side since the ERP returns all records.
 *
 * Query params:
 *   search       — searches quot_no, enquiry_no, customer name, subject
 *   status       — Open | Approved | Cancelled  (alias: Rejected → Cancelled)
 *   from_date    — YYYY-MM-DD  (filters by QuotDate >=)
 *   to_date      — YYYY-MM-DD  (filters by QuotDate <=)
 *   priority     — High | Medium | Low
 *   category     — AMC Service | Spare | Accessories | etc. (partial match)
 *   prepared_by  — partial name match on PreparedByName
 *   entered_by   — partial name match on EntryUserName
 *   page         — default 1
 *   limit        — default 20, max 100
 */
const getQuotations = async (req, res) => {
  try {
    const {
      page        : rawPage,
      limit       : rawLimit,
      search,
      status,
      from_date,
      to_date,
      priority,
      category,
      prepared_by,
      entered_by,
    } = req.query;

    const page  = Math.max(1, parseInt(rawPage)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(rawLimit) || 20));

    // Fetch everything from ERP (no server-side filtering supported)
    const erpData = await fetchFromERP('QuotationAPI.ashx');
    const rawRows = toRawArray(erpData);

    // Group flat line-item rows → quotation objects with items[]
    let quotations = groupQuotations(rawRows);

    // ── Filters ────────────────────────────────────────────────

    if (search) {
      const q = search.toLowerCase();
      quotations = quotations.filter(qt =>
        qt.quot_no?.toLowerCase().includes(q)         ||
        qt.enquiry_no?.toLowerCase().includes(q)      ||
        qt.customer.name?.toLowerCase().includes(q)   ||
        qt.subject?.toLowerCase().includes(q)         ||
        qt.kind_attention?.toLowerCase().includes(q)
      );
    }

    if (status) {
      // Accept "Rejected" as alias for "Cancelled"
      const target = status === 'Rejected' ? 'Cancelled' : status;
      quotations = quotations.filter(qt =>
        qt.quotation_status.toLowerCase() === target.toLowerCase()
      );
    }

    if (from_date) {
      quotations = quotations.filter(qt => qt.date >= from_date);
    }

    if (to_date) {
      quotations = quotations.filter(qt => qt.date <= to_date);
    }

    if (priority) {
      quotations = quotations.filter(qt =>
        qt.priority?.toLowerCase() === priority.toLowerCase()
      );
    }

    if (category) {
      const q = category.toLowerCase();
      quotations = quotations.filter(qt =>
        qt.category?.toLowerCase().includes(q)
      );
    }

    if (prepared_by) {
      const q = prepared_by.toLowerCase();
      quotations = quotations.filter(qt =>
        qt.prepared_by?.toLowerCase().includes(q)
      );
    }

    if (entered_by) {
      const q = entered_by.toLowerCase();
      quotations = quotations.filter(qt =>
        qt.entered_by?.toLowerCase().includes(q)
      );
    }

    // ── Paginate ───────────────────────────────────────────────
    const total       = quotations.length;
    const total_pages = Math.ceil(total / limit) || 1;
    const offset      = (page - 1) * limit;
    const pageData    = quotations.slice(offset, offset + limit);

    return res.status(200).json({
      success : true,
      source  : 'erp',
      data    : pageData,
      pagination: {
        total,
        page,
        limit,
        total_pages,
        has_next : page < total_pages,
        has_prev : page > 1,
      },
      filters_applied: {
        search      : search      || null,
        status      : status      || null,
        from_date   : from_date   || null,
        to_date     : to_date     || null,
        priority    : priority    || null,
        category    : category    || null,
        prepared_by : prepared_by || null,
        entered_by  : entered_by  || null,
      },
    });
  } catch (error) {
    return handleErpError(error, res, 'Quotation list');
  }
};

// ─── GET /api/erp/quotations/:id ─────────────────────────────
const getQuotationById = async (req, res) => {
  try {
    const { id } = req.params;

    const erpData = await fetchFromERP('QuotationAPI.ashx', { id });
    const rawRows = toRawArray(erpData);

    if (!rawRows.length) {
      return res.status(404).json({
        success    : false,
        error_code : 'QUOTATION_NOT_FOUND',
        message    : `Quotation with ID '${id}' was not found in the ERP.`,
      });
    }

    // Group in case the ERP returns multiple line-item rows for this one quote
    const grouped = groupQuotations(rawRows);
    const quotation = grouped[0];

    return res.status(200).json({
      success : true,
      source  : 'erp',
      data    : quotation,
    });
  } catch (error) {
    return handleErpError(error, res, 'Quotation by ID');
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
      page: rawPage,
      limit: rawLimit,
      search,
      status,
    } = req.query;

    const page  = Math.max(1, parseInt(rawPage)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(rawLimit) || 50));

    const erpData = await fetchFromERP('CustomerAPI.ashx', {
      search,
      status,
    });

    let records = Array.isArray(erpData)
      ? erpData
      : erpData.data ?? erpData.customers ?? erpData.records ?? (erpData.raw ? [] : [erpData]);

    const total = records.length;
    const total_pages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    records = records.slice(offset, offset + limit);

    return res.status(200).json({
      success : true,
      source  : 'erp',
      data    : records,
      pagination: {
        total,
        page,
        limit,
        total_pages,
      },
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
