// ============================================================
// src/controllers/erpController.js
// Proxy controller for external ERP APIs (Quotation & Customer)
// ============================================================

const { Errors } = require('../utils/AppError');
const pool = require('../config/db');

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

// ─── ERP value sanitisers ─────────────────────────────────────
// The ERP sends "" (empty string) for fields with no value.
// PostgreSQL rejects "" for INTEGER/DATE columns — use these helpers.
const toInt   = v => (v !== '' && v != null && !isNaN(parseInt(v, 10))) ? parseInt(v, 10) : null;
const toFloat = v => (v !== '' && v != null && !isNaN(parseFloat(v)))   ? parseFloat(v)   : 0;
const toDate  = v => (v && v !== '')  ? v : null;
const toStr   = v => (v == null || v === 'Select') ? '' : String(v).trim();

// ─── Group flat ERP rows (1 row per line item) into quotations ─
// The ERP returns one row per product line. This groups them by
// QuotId and nests items[] inside each quotation object.
function groupQuotations(rawRows) {
  const map = new Map();

  for (const row of rawRows) {
    const key = row.QuotId;

    if (!map.has(key)) {
      map.set(key, {
        quot_id        : toInt(row.QuotId),
        quot_no        : toStr(row.QuotNoText),
        enquiry_no     : toStr(row.EnquiryNoText),
        enquiry_id     : toInt(row.EnquiryID),
        date           : toDate(row.QuotDate),
        enquiry_date   : toDate(row.EnquiryDate),
        subject        : toStr(row.Sub),
        kind_attention : toStr(row.KindAtten),
        email          : toStr(row.EmailId),

        customer: {
          id   : toInt(row.EnquiryCustomerId),
          code : toStr(row.EnquiryCustomerCode),
          name : toStr(row.CustName || row.EnquiryCustomerName),
        },
        bill_to: {
          id   : toInt(row.BillToCustId),
          name : toStr(row.BillToCustName),
        },
        ship_to: {
          id   : toInt(row.ShipToCustId),
          name : toStr(row.ShipToCustName),
        },

        priority       : toStr(row.EnquiryPriority),
        category       : toStr(row.CategoryName),
        sector         : toStr(row.Enq_Sector),
        plant          : toStr(row.EnquiryPlantName),
        financial_year : toStr(row.FyName),
        currency       : toStr(row.CurrencyCode) || 'Rs',

        net_total    : toFloat(row.NetTotal),
        discount_per : toFloat(row.Disc_Per),
        discount_amt : toFloat(row.Disc_Amt),
        gst: {
          cgst_per : toFloat(row.CGSTPer),
          cgst_amt : toFloat(row.CGSTAmt),
          sgst_per : toFloat(row.SGSTPer),
          sgst_amt : toFloat(row.SGSTAmt),
          igst_per : toFloat(row.IGSTPer),
          igst_amt : toFloat(row.IGSTAmt),
        },

        // People
        prepared_by    : toStr(row.PreparedByName),
        prepared_by_id : toInt(row.PreparedById),
        entered_by     : toStr(row.EntryUserName),
        entered_by_id  : toInt(row.UserId),

        // Derived status
        quotation_status : deriveStatus(row),
        enquiry_status   : toStr(row.EnquiryStatus),
        is_amended       : row.IsAmmend === 'Y',
        is_cancelled     : row.QCancel  === 'Y',
        version_no       : toInt(row.VersionNo) ?? 0,

        authorization: {
          auth1_status : toStr(row.Auth1Status),
          auth1_by     : toStr(row.Auth1UserName),
          auth1_date   : toDate(row.Auth1Date),
          auth2_status : toStr(row.Auth2Status),
          auth2_by     : toStr(row.Auth2UserName),
          auth2_date   : toDate(row.Auth2Date),
        },

        cancel_info: row.QCancel === 'Y' ? {
          cancelled_by   : toStr(row.QCancelUserName),
          cancelled_date : toDate(row.QCancelDate),
          remark         : toStr(row.QCancelRemark),
        } : null,

        items: [],
      });
    }

    // Append line item (DetailAutoId is 0 when there are no products)
    if (row.DetailAutoId) {
      map.get(key).items.push({
        line_id      : toInt(row.DetailAutoId),
        item_id      : toInt(row.ItemId),
        item_code    : toStr(row.ItemCode),
        item_no      : toStr(row.ItemNo),
        description  : toStr(row.Description || row.ItemDesc),
        qty          : toFloat(row.Qty),
        unit         : toStr(row.UnitCode),
        rate         : toFloat(row.Rate),
        discount_per : toFloat(row.DiscountPer),
        discount_amt : toFloat(row.DiscountAmt),
        total        : toFloat(row.Total),
        note         : toStr(row.Note),
        hsn_code     : toStr(row.HSNCode),
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
// ERP does not support server-side search/status filtering.
// We fetch all records and filter client-side.
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

    // Fetch everything — no params passed since ERP ignores them
    const erpData = await fetchFromERP('CustomerAPI.ashx');

    let records = Array.isArray(erpData)
      ? erpData
      : erpData.data ?? erpData.customers ?? erpData.records ?? (erpData.raw ? [] : [erpData]);

    // ── Client-side filters ────────────────────────────────────

    if (search) {
      const q = search.toLowerCase();
      // Search across every string value in the customer object —
      // works regardless of what the ERP field names are
      records = records.filter(c =>
        Object.values(c).some(v => typeof v === 'string' && v.toLowerCase().includes(q))
      );
    }

    if (status) {
      const s = status.toLowerCase();
      // Try common ERP status field names
      records = records.filter(c => {
        const val = (
          c.Status ?? c.CustomerStatus ?? c.IsActive ?? c.status ?? ''
        ).toString().toLowerCase();
        return val.includes(s);
      });
    }

    // ── Paginate ───────────────────────────────────────────────
    const total       = records.length;
    const total_pages = Math.ceil(total / limit) || 1;
    const offset      = (page - 1) * limit;
    const pageData    = records.slice(offset, offset + limit);

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
        search : search || null,
        status : status || null,
      },
    });
  } catch (error) {
    return handleErpError(error, res, 'Customer list');
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

// ─── POST /api/erp/sync/quotations ───────────────────────────
// Pulls all quotations from ERP and upserts them into the local
// erp_quotations + erp_quotation_items tables.
// ERP customers are auto-linked to local clients via clients.erp_customer_id.
const syncQuotations = async (_req, res) => {
  const startedAt = Date.now();

  try {
    // 1. Fetch + group all quotations from ERP
    const erpData = await fetchFromERP('QuotationAPI.ashx');
    const rawRows = toRawArray(erpData);
    const quotations = groupQuotations(rawRows);

    if (!quotations.length) {
      return res.status(200).json({
        success  : true,
        message  : 'No quotations found in ERP.',
        total    : 0, inserted: 0, updated: 0, failed: 0,
        duration_ms: Date.now() - startedAt,
      });
    }

    // 2. Load all local clients that have an ERP customer id (one DB call)
    const clientsRes = await pool.query(
      `SELECT id, erp_customer_id FROM clients WHERE erp_customer_id IS NOT NULL`
    );
    const clientMap = new Map(); // erp_customer_id → local client id
    for (const row of clientsRes.rows) {
      clientMap.set(Number(row.erp_customer_id), row.id);
    }

    // 3. Upsert each quotation inside a transaction
    let inserted = 0, updated = 0, failed = 0;
    const errors = [];

    const db = await pool.connect();
    try {
      await db.query('BEGIN');

      for (const qt of quotations) {
        try {
          const clientId = clientMap.get(qt.customer.id) || null;

          // Upsert main quotation row
          const existing = await db.query(
            `SELECT quot_id FROM erp_quotations WHERE quot_id = $1`, [qt.quot_id]
          );
          const isNew = existing.rows.length === 0;

          await db.query(`
            INSERT INTO erp_quotations (
              quot_id, quot_no, enquiry_no, enquiry_id,
              date, enquiry_date, subject, kind_attention, email,
              erp_customer_id, erp_customer_code, erp_customer_name,
              bill_to_id, bill_to_name, ship_to_id, ship_to_name,
              client_id,
              priority, category, sector, plant, financial_year, currency,
              net_total, discount_per, discount_amt,
              cgst_per, cgst_amt, sgst_per, sgst_amt, igst_per, igst_amt,
              prepared_by, prepared_by_id, entered_by, entered_by_id,
              quotation_status, enquiry_status, is_amended, is_cancelled, version_no,
              auth1_status, auth1_by, auth1_date,
              auth2_status, auth2_by, auth2_date,
              cancel_by, cancel_date, cancel_remark,
              synced_at
            ) VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,
              $10,$11,$12,$13,$14,$15,$16,$17,
              $18,$19,$20,$21,$22,$23,
              $24,$25,$26,$27,$28,$29,$30,$31,$32,
              $33,$34,$35,$36,
              $37,$38,$39,$40,$41,
              $42,$43,$44,$45,$46,$47,
              $48,$49,$50,
              NOW()
            )
            ON CONFLICT (quot_id) DO UPDATE SET
              quot_no           = EXCLUDED.quot_no,
              enquiry_no        = EXCLUDED.enquiry_no,
              enquiry_id        = EXCLUDED.enquiry_id,
              date              = EXCLUDED.date,
              enquiry_date      = EXCLUDED.enquiry_date,
              subject           = EXCLUDED.subject,
              kind_attention    = EXCLUDED.kind_attention,
              email             = EXCLUDED.email,
              erp_customer_id   = EXCLUDED.erp_customer_id,
              erp_customer_code = EXCLUDED.erp_customer_code,
              erp_customer_name = EXCLUDED.erp_customer_name,
              bill_to_id        = EXCLUDED.bill_to_id,
              bill_to_name      = EXCLUDED.bill_to_name,
              ship_to_id        = EXCLUDED.ship_to_id,
              ship_to_name      = EXCLUDED.ship_to_name,
              client_id         = EXCLUDED.client_id,
              priority          = EXCLUDED.priority,
              category          = EXCLUDED.category,
              sector            = EXCLUDED.sector,
              plant             = EXCLUDED.plant,
              financial_year    = EXCLUDED.financial_year,
              currency          = EXCLUDED.currency,
              net_total         = EXCLUDED.net_total,
              discount_per      = EXCLUDED.discount_per,
              discount_amt      = EXCLUDED.discount_amt,
              cgst_per          = EXCLUDED.cgst_per,
              cgst_amt          = EXCLUDED.cgst_amt,
              sgst_per          = EXCLUDED.sgst_per,
              sgst_amt          = EXCLUDED.sgst_amt,
              igst_per          = EXCLUDED.igst_per,
              igst_amt          = EXCLUDED.igst_amt,
              prepared_by       = EXCLUDED.prepared_by,
              prepared_by_id    = EXCLUDED.prepared_by_id,
              entered_by        = EXCLUDED.entered_by,
              entered_by_id     = EXCLUDED.entered_by_id,
              quotation_status  = EXCLUDED.quotation_status,
              enquiry_status    = EXCLUDED.enquiry_status,
              is_amended        = EXCLUDED.is_amended,
              is_cancelled      = EXCLUDED.is_cancelled,
              version_no        = EXCLUDED.version_no,
              auth1_status      = EXCLUDED.auth1_status,
              auth1_by          = EXCLUDED.auth1_by,
              auth1_date        = EXCLUDED.auth1_date,
              auth2_status      = EXCLUDED.auth2_status,
              auth2_by          = EXCLUDED.auth2_by,
              auth2_date        = EXCLUDED.auth2_date,
              cancel_by         = EXCLUDED.cancel_by,
              cancel_date       = EXCLUDED.cancel_date,
              cancel_remark     = EXCLUDED.cancel_remark,
              synced_at         = NOW()
          `, [
            qt.quot_id, qt.quot_no, qt.enquiry_no, qt.enquiry_id,
            qt.date || null, qt.enquiry_date || null, qt.subject, qt.kind_attention, qt.email,
            qt.customer.id, qt.customer.code, qt.customer.name,
            qt.bill_to.id, qt.bill_to.name, qt.ship_to.id, qt.ship_to.name,
            clientId,
            qt.priority, qt.category, qt.sector, qt.plant, qt.financial_year, qt.currency,
            qt.net_total, qt.discount_per, qt.discount_amt,
            qt.gst.cgst_per, qt.gst.cgst_amt, qt.gst.sgst_per, qt.gst.sgst_amt,
            qt.gst.igst_per, qt.gst.igst_amt,
            qt.prepared_by, qt.prepared_by_id, qt.entered_by, qt.entered_by_id,
            qt.quotation_status, qt.enquiry_status, qt.is_amended, qt.is_cancelled, qt.version_no,
            qt.authorization.auth1_status, qt.authorization.auth1_by, qt.authorization.auth1_date || null,
            qt.authorization.auth2_status, qt.authorization.auth2_by, qt.authorization.auth2_date || null,
            qt.cancel_info?.cancelled_by || null,
            qt.cancel_info?.cancelled_date || null,
            qt.cancel_info?.remark || null,
          ]);

          // Replace items — delete old then insert fresh
          await db.query(`DELETE FROM erp_quotation_items WHERE quot_id = $1`, [qt.quot_id]);
          for (const item of qt.items) {
            await db.query(`
              INSERT INTO erp_quotation_items
                (quot_id, line_id, item_id, item_code, item_no, description,
                 qty, unit, rate, discount_per, discount_amt, total, note, hsn_code)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
            `, [
              qt.quot_id, item.line_id, item.item_id, item.item_code, item.item_no,
              item.description, item.qty, item.unit, item.rate,
              item.discount_per, item.discount_amt, item.total,
              item.note || '', item.hsn_code || '',
            ]);
          }

          isNew ? inserted++ : updated++;
        } catch (rowErr) {
          failed++;
          errors.push({ quot_id: qt.quot_id, quot_no: qt.quot_no, error: rowErr.message });
        }
      }

      await db.query('COMMIT');
    } catch (txErr) {
      await db.query('ROLLBACK');
      throw txErr;
    } finally {
      db.release();
    }

    return res.status(200).json({
      success     : true,
      message     : `Sync complete. ${inserted} inserted, ${updated} updated, ${failed} failed.`,
      total       : quotations.length,
      inserted,
      updated,
      failed,
      duration_ms : Date.now() - startedAt,
      ...(errors.length ? { errors } : {}),
    });

  } catch (error) {
    return handleErpError(error, res, 'Quotation sync');
  }
};

// ─── Helper: flat DB row → nested quotation object ───────────
// Converts a raw erp_quotations row (with aggregated items JSON)
// back into the same shape the ERP proxy returns.
function formatLocalQuotation(row) {
  return {
    quot_id        : row.quot_id,
    quot_no        : row.quot_no,
    enquiry_no     : row.enquiry_no,
    enquiry_id     : row.enquiry_id,
    date           : row.date,
    enquiry_date   : row.enquiry_date,
    subject        : row.subject,
    kind_attention : row.kind_attention,
    email          : row.email,

    customer: {
      id   : row.erp_customer_id,
      code : row.erp_customer_code,
      name : row.erp_customer_name,
    },
    bill_to : { id: row.bill_to_id, name: row.bill_to_name },
    ship_to : { id: row.ship_to_id, name: row.ship_to_name },

    // Local DB extra — which local client this maps to (null if unlinked)
    client_id      : row.client_id,

    priority       : row.priority,
    category       : row.category,
    sector         : row.sector,
    plant          : row.plant,
    financial_year : row.financial_year,
    currency       : row.currency,

    net_total    : parseFloat(row.net_total)    || 0,
    discount_per : parseFloat(row.discount_per) || 0,
    discount_amt : parseFloat(row.discount_amt) || 0,
    gst: {
      cgst_per : parseFloat(row.cgst_per) || 0,
      cgst_amt : parseFloat(row.cgst_amt) || 0,
      sgst_per : parseFloat(row.sgst_per) || 0,
      sgst_amt : parseFloat(row.sgst_amt) || 0,
      igst_per : parseFloat(row.igst_per) || 0,
      igst_amt : parseFloat(row.igst_amt) || 0,
    },

    prepared_by    : row.prepared_by,
    prepared_by_id : row.prepared_by_id,
    entered_by     : row.entered_by,
    entered_by_id  : row.entered_by_id,

    quotation_status : row.quotation_status,
    enquiry_status   : row.enquiry_status,
    is_amended       : row.is_amended,
    is_cancelled     : row.is_cancelled,
    version_no       : row.version_no,

    authorization: {
      auth1_status : row.auth1_status,
      auth1_by     : row.auth1_by,
      auth1_date   : row.auth1_date,
      auth2_status : row.auth2_status,
      auth2_by     : row.auth2_by,
      auth2_date   : row.auth2_date,
    },

    cancel_info: row.is_cancelled ? {
      cancelled_by   : row.cancel_by,
      cancelled_date : row.cancel_date,
      remark         : row.cancel_remark,
    } : null,

    items     : row.items || [],
    synced_at : row.synced_at,
  };
}

// ─── Shared items SELECT fragment ─────────────────────────────
const ITEMS_AGG = `
  COALESCE(
    json_agg(
      json_build_object(
        'id',           i.id,
        'line_id',      i.line_id,
        'item_id',      i.item_id,
        'item_code',    i.item_code,
        'item_no',      i.item_no,
        'description',  i.description,
        'qty',          i.qty,
        'unit',         i.unit,
        'rate',         i.rate,
        'discount_per', i.discount_per,
        'discount_amt', i.discount_amt,
        'total',        i.total,
        'note',         i.note,
        'hsn_code',     i.hsn_code
      ) ORDER BY i.id
    ) FILTER (WHERE i.id IS NOT NULL),
    '[]'::json
  ) AS items
`;

// ─── GET /api/erp/local/quotations ───────────────────────────
/**
 * Same filters as GET /api/erp/quotations but reads from local DB
 * (erp_quotations table) instead of calling the ERP live.
 * Much faster — use this for day-to-day UI queries.
 * Use the sync endpoint to refresh data from ERP first.
 */
const getLocalQuotations = async (req, res) => {
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
      client_id,
    } = req.query;

    const page   = Math.max(1, parseInt(rawPage)  || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(rawLimit) || 20));
    const offset = (page - 1) * limit;

    // Build parameterised WHERE clauses
    const where  = [];
    const params = [];
    let   p      = 1;

    if (search) {
      where.push(`(
        q.quot_no           ILIKE $${p} OR
        q.enquiry_no        ILIKE $${p} OR
        q.erp_customer_name ILIKE $${p} OR
        q.subject           ILIKE $${p} OR
        q.kind_attention    ILIKE $${p}
      )`);
      params.push(`%${search}%`); p++;
    }

    if (status) {
      where.push(`q.quotation_status = $${p}`);
      params.push(status === 'Rejected' ? 'Cancelled' : status); p++;
    }

    if (from_date) {
      where.push(`q.date >= $${p}`);
      params.push(from_date); p++;
    }

    if (to_date) {
      where.push(`q.date <= $${p}`);
      params.push(to_date); p++;
    }

    if (priority) {
      where.push(`q.priority ILIKE $${p}`);
      params.push(priority); p++;
    }

    if (category) {
      where.push(`q.category ILIKE $${p}`);
      params.push(`%${category}%`); p++;
    }

    if (prepared_by) {
      where.push(`q.prepared_by ILIKE $${p}`);
      params.push(`%${prepared_by}%`); p++;
    }

    if (entered_by) {
      where.push(`q.entered_by ILIKE $${p}`);
      params.push(`%${entered_by}%`); p++;
    }

    if (client_id) {
      where.push(`q.client_id = $${p}`);
      params.push(parseInt(client_id)); p++;
    }

    const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // Total count
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM erp_quotations q ${whereSQL}`,
      params
    );
    const total = parseInt(countRes.rows[0].count);

    // Paginated data with items aggregated via JSON_AGG
    const dataRes = await pool.query(`
      SELECT
        q.quot_id, q.quot_no, q.enquiry_no, q.enquiry_id,
        q.date, q.enquiry_date, q.subject, q.kind_attention, q.email,
        q.erp_customer_id, q.erp_customer_code, q.erp_customer_name,
        q.bill_to_id, q.bill_to_name, q.ship_to_id, q.ship_to_name,
        q.client_id,
        q.priority, q.category, q.sector, q.plant, q.financial_year, q.currency,
        q.net_total, q.discount_per, q.discount_amt,
        q.cgst_per, q.cgst_amt, q.sgst_per, q.sgst_amt, q.igst_per, q.igst_amt,
        q.prepared_by, q.prepared_by_id, q.entered_by, q.entered_by_id,
        q.quotation_status, q.enquiry_status, q.is_amended, q.is_cancelled, q.version_no,
        q.auth1_status, q.auth1_by, q.auth1_date,
        q.auth2_status, q.auth2_by, q.auth2_date,
        q.cancel_by, q.cancel_date, q.cancel_remark,
        q.synced_at,
        ${ITEMS_AGG}
      FROM erp_quotations q
      LEFT JOIN erp_quotation_items i ON i.quot_id = q.quot_id
      ${whereSQL}
      GROUP BY q.quot_id
      ORDER BY q.date DESC, q.quot_id DESC
      LIMIT $${p} OFFSET $${p + 1}
    `, [...params, limit, offset]);

    const total_pages = Math.ceil(total / limit) || 1;

    return res.status(200).json({
      success : true,
      source  : 'local_db',
      data    : dataRes.rows.map(formatLocalQuotation),
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
        client_id   : client_id   || null,
      },
    });
  } catch (error) {
    console.error('Local quotations fetch error:', error);
    return Errors.internalError(res);
  }
};

// ─── GET /api/erp/local/quotations/:id ───────────────────────
const getLocalQuotationById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      SELECT
        q.quot_id, q.quot_no, q.enquiry_no, q.enquiry_id,
        q.date, q.enquiry_date, q.subject, q.kind_attention, q.email,
        q.erp_customer_id, q.erp_customer_code, q.erp_customer_name,
        q.bill_to_id, q.bill_to_name, q.ship_to_id, q.ship_to_name,
        q.client_id,
        q.priority, q.category, q.sector, q.plant, q.financial_year, q.currency,
        q.net_total, q.discount_per, q.discount_amt,
        q.cgst_per, q.cgst_amt, q.sgst_per, q.sgst_amt, q.igst_per, q.igst_amt,
        q.prepared_by, q.prepared_by_id, q.entered_by, q.entered_by_id,
        q.quotation_status, q.enquiry_status, q.is_amended, q.is_cancelled, q.version_no,
        q.auth1_status, q.auth1_by, q.auth1_date,
        q.auth2_status, q.auth2_by, q.auth2_date,
        q.cancel_by, q.cancel_date, q.cancel_remark,
        q.synced_at,
        ${ITEMS_AGG}
      FROM erp_quotations q
      LEFT JOIN erp_quotation_items i ON i.quot_id = q.quot_id
      WHERE q.quot_id = $1
      GROUP BY q.quot_id
    `, [id]);

    if (!result.rows.length) {
      return res.status(404).json({
        success    : false,
        error_code : 'QUOTATION_NOT_FOUND',
        message    : `Quotation with ID '${id}' was not found in the local database. Try syncing first.`,
      });
    }

    return res.status(200).json({
      success : true,
      source  : 'local_db',
      data    : formatLocalQuotation(result.rows[0]),
    });
  } catch (error) {
    console.error('Local quotation by ID error:', error);
    return Errors.internalError(res);
  }
};

module.exports = {
  getQuotations,
  getQuotationById,
  getCustomers,
  getCustomerById,
  syncQuotations,
  getLocalQuotations,
  getLocalQuotationById,
};
