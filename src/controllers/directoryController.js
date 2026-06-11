// ============================================================
// src/controllers/directoryController.js
// Combined client directory: returns LOCAL clients and ERP
// customers together in a single response (no pagination —
// the frontend handles paging/filtering).
// ============================================================

const pool = require('../config/db');
const { Errors } = require('../utils/AppError');
const {
  fetchFromERP,
  syncErpCustomersToLocal,
  attachLocalId,
} = require('./erpController');

// ─── Normalisers → one common shape for the frontend ──────────
// Every item exposes:
//   source          'local' | 'erp'
//   client_id       the LOCAL clients.id to use as AMC client_id
//                   (null only for an ERP customer that could not be mirrored)
//   erp_customer_id the ERP CustId (null for pure-local clients)

function fromLocal(row) {
  return {
    source:          'local',
    client_id:       row.id,
    id:              row.id,
    erp_customer_id: row.erp_customer_id ?? null,
    erp_cust_code:   row.erp_cust_code ?? null,
    name:            row.name,
    contact_person:  row.contact_person,
    email:           row.email,
    phone:           row.phone,
    gst_no:          row.gst_no,
    address:         row.address,
    type:            row.type,
    status:          row.status,
    contract_value:  row.contract_value,
    join_date:       row.join_date,
    created_at:      row.created_at,
    updated_at:      row.updated_at,
  };
}

function fromErp(rec) {
  const custId = rec.CustId ?? rec.custId ?? rec.cust_id ?? null;
  const address = [rec.CustAdd, rec.CustAdd1, rec.CustAdd2, rec.PinCode, rec.StateCode]
    .map((p) => (p === null || p === undefined ? '' : String(p).trim()))
    .filter(Boolean)
    .join(', ') || null;

  return {
    source:          'erp',
    client_id:       rec.local_client_id ?? null, // set by syncErpCustomersToLocal/attachLocalId
    id:              rec.local_client_id ?? null,
    erp_customer_id: custId,
    erp_cust_code:   rec.CustCode ?? null,
    name:            rec.CustName ?? null,
    contact_person:  rec.CustName ?? null,
    email:           rec.EmailId ?? null,
    phone:           rec.ContactNo ?? null,
    gst_no:          null,
    address,
    type:            'Corporate',
    status:          'Active',
    contract_value:  null,
    join_date:       null,
    created_at:      null,
    updated_at:      null,
    erp_raw:         rec, // keep the original ERP fields too
  };
}

// ────────────────────────────────────────────────────────────
// GET /api/directory
// Combined list of LOCAL clients + ERP customers (no pagination).
//
// Optional query params (all forwarded to the ERP search):
//   search, status
//
// ERP customers are auto-mirrored into local clients, so each ERP
// item carries a client_id. Local clients that are themselves ERP
// mirrors (origin = 'erp') are NOT repeated — they are represented
// by their ERP entry to avoid duplicates.
// ────────────────────────────────────────────────────────────
const getDirectory = async (req, res) => {
  try {
    const { search, status } = req.query;

    // 1. Local clients (only true-local ones; erp mirrors come from the ERP side)
    const localResult = await pool.query(
      `SELECT id, name, contact_person, email, phone, gst_no, address, type, status,
              contract_value, join_date, origin, erp_customer_id, erp_cust_code,
              created_at, updated_at
         FROM clients
        WHERE origin = 'local'
        ORDER BY name ASC`
    );
    const localItems = localResult.rows.map(fromLocal);

    // 2. ERP customers (live) — mirror + tag with local_client_id
    let erpItems = [];
    let erpAvailable = true;
    try {
      const erpData = await fetchFromERP('CustomerAPI.ashx', { search, status });
      const records = Array.isArray(erpData)
        ? erpData
        : erpData.data ?? erpData.customers ?? erpData.records ?? (erpData.raw ? [] : [erpData]);

      const idMap = await syncErpCustomersToLocal(records);
      erpItems = records
        .map((r) => attachLocalId(r, idMap))
        .map(fromErp);
    } catch (erpErr) {
      // ERP down — still return local clients so the directory keeps working
      erpAvailable = false;
      console.error('Directory ERP fetch failed (returning local only):', erpErr.message);
    }

    const data = [...localItems, ...erpItems];

    return res.status(200).json({
      success:       true,
      erp_available: erpAvailable,
      counts: {
        local: localItems.length,
        erp:   erpItems.length,
        total: data.length,
      },
      data,
    });
  } catch (error) {
    console.error('Directory list error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/directory/:id
// Combined fetch of a single record from EITHER source.
//
// Query param:
//   source = 'local' (default) | 'erp'
//     - local : :id is a local clients.id
//     - erp   : :id is the ERP CustId (will be mirrored on fetch)
// ────────────────────────────────────────────────────────────
const getDirectoryById = async (req, res) => {
  try {
    const { id } = req.params;
    const source = (req.query.source || 'local').toLowerCase();

    if (source === 'erp') {
      const erpData = await fetchFromERP('CustomerAPI.ashx', { id });
      const record  = Array.isArray(erpData) ? erpData[0] : (erpData.data ?? erpData);

      if (!record || (typeof record === 'object' && Object.keys(record).length === 0)) {
        return res.status(404).json({
          success:    false,
          error_code: 'CUSTOMER_NOT_FOUND',
          message:    `ERP customer with ID '${id}' was not found.`,
        });
      }

      const idMap = await syncErpCustomersToLocal([record]);
      const data  = fromErp(attachLocalId(record, idMap));

      return res.status(200).json({ success: true, source: 'erp', data });
    }

    // Default: local client by integer id
    if (!/^\d+$/.test(String(id))) {
      const { sendError } = require('../utils/AppError');
      const ERROR_CODES = require('../utils/errorCodes');
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'Local client id must be a number. For an ERP customer use ?source=erp.',
        { field: 'id' });
    }

    const result = await pool.query(
      `SELECT id, name, contact_person, email, phone, gst_no, address, type, status,
              contract_value, join_date, origin, erp_customer_id, erp_cust_code,
              created_at, updated_at
         FROM clients
        WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) return Errors.clientNotFound(res);

    return res.status(200).json({
      success: true,
      source:  'local',
      data:    fromLocal(result.rows[0]),
    });
  } catch (error) {
    console.error('Directory by-id error:', error);

    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return res.status(504).json({
        success:    false,
        error_code: 'ERP_TIMEOUT',
        message:    'The ERP server did not respond in time. Please try again.',
      });
    }
    if (error.erpStatus) {
      return res.status(502).json({
        success:    false,
        error_code: 'ERP_ERROR',
        message:    `ERP returned an error (HTTP ${error.erpStatus}).`,
      });
    }

    return Errors.internalError(res);
  }
};

module.exports = {
  getDirectory,
  getDirectoryById,
};
