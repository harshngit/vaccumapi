// ============================================================
// src/controllers/visitReportController.js
// Monthly Visit Schedule Excel Report
// ============================================================

const pool    = require('../config/db');
const ExcelJS = require('exceljs');
const { sendError, Errors } = require('../utils/AppError');
const ERROR_CODES = require('../utils/errorCodes');

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

// ────────────────────────────────────────────────────────────
// GET /api/reports/visit-schedule/excel?month=6&year=2026
// Optional: &technician_id=5
// Returns: .xlsx file download
// ────────────────────────────────────────────────────────────
const getMonthlyVisitExcel = async (req, res) => {
  try {
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
    const { technician_id, status, category } = req.query;

    if (month < 1 || month > 12) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'Month must be between 1 and 12.', { field: 'month' });
    }

    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const conditions = [
      `(j.scheduled_date >= $1::date AND j.scheduled_date < ($1::date + INTERVAL '1 month'))`,
    ];
    const values = [startDate];

    if (technician_id) {
      values.push(parseInt(technician_id));
      conditions.push(`j.technician_id = $${values.length}`);
    }
    if (status) {
      values.push(status);
      conditions.push(`j.status = $${values.length}`);
    }
    if (category) {
      values.push(category);
      conditions.push(`j.category = $${values.length}`);
    }

    const where = conditions.join(' AND ');

    const result = await pool.query(
      `SELECT
         j.id AS job_id,
         j.title,
         j.scheduled_date,
         j.raised_date,
         j.closed_date,
         j.status,
         j.category,
         j.priority,
         j.amount,
         j.description,
         c.name AS client_name,
         c.address AS site_location,
         c.contact_person,
         c.phone AS client_phone,
         t.name AS technician_name,
         t.phone AS technician_phone,
         t.specialization
       FROM jobs j
       LEFT JOIN clients c ON c.id = j.client_id
       LEFT JOIN technicians t ON t.id = j.technician_id
       WHERE ${where}
       ORDER BY j.scheduled_date ASC, j.id ASC`,
      values
    );

    const visits = result.rows;

    // ── Build Excel workbook ─────────────────────────────
    const wb = new ExcelJS.Workbook();
    wb.creator = 'VDTI Service Hub';
    wb.created = new Date();

    const monthName = MONTHS[month - 1];
    const sheetName = `${monthName} ${year}`;
    const ws = wb.addWorksheet(sheetName);

    // ── Title row ────────────────────────────────────────
    ws.mergeCells('A1:J1');
    const titleCell = ws.getCell('A1');
    titleCell.value = `Monthly Visit Schedule Report — ${monthName} ${year}`;
    titleCell.font = { bold: true, size: 16, color: { argb: 'FF1F2937' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 35;

    // ── Generated info row ───────────────────────────────
    ws.mergeCells('A2:J2');
    const infoCell = ws.getCell('A2');
    infoCell.value = `Generated on: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}  |  Total Visits: ${visits.length}`;
    infoCell.font = { size: 10, italic: true, color: { argb: 'FF6B7280' } };
    infoCell.alignment = { horizontal: 'center' };

    // ── Empty row ────────────────────────────────────────
    ws.addRow([]);

    // ── Header row ───────────────────────────────────────
    const headers = [
      'Sr. No',
      'Visit Date',
      'Job ID',
      'Client Name',
      'Site Location',
      'Technician Name',
      'Visit Type',
      'Priority',
      'Visit Status',
      'Remarks',
    ];

    const headerRow = ws.addRow(headers);
    headerRow.height = 28;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: 'FF065F46' },
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });

    // ── Data rows ────────────────────────────────────────
    const statusColors = {
      'Closed':      'FFD1FAE5',
      'In Progress': 'FFDBEAFE',
      'Assigned':    'FFFEF3C7',
      'Raised':      'FFFEE2E2',
    };

    visits.forEach((v, i) => {
      const remarks = [];
      if (v.description) remarks.push(v.description);
      if (v.closed_date) remarks.push(`Closed: ${new Date(v.closed_date).toLocaleDateString('en-IN')}`);
      if (!v.technician_name) remarks.push('No technician assigned');

      const row = ws.addRow([
        i + 1,
        v.scheduled_date
          ? new Date(v.scheduled_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
          : 'Not Scheduled',
        v.job_id,
        v.client_name || '—',
        v.site_location || '—',
        v.technician_name || 'Unassigned',
        v.category || '—',
        v.priority || '—',
        v.status,
        remarks.join(' | ') || '—',
      ]);

      row.eachCell((cell) => {
        cell.alignment = { vertical: 'middle', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        };
      });

      // Color-code status column
      const statusCell = row.getCell(9);
      const bgColor = statusColors[v.status];
      if (bgColor) {
        statusCell.fill = {
          type: 'pattern', pattern: 'solid',
          fgColor: { argb: bgColor },
        };
      }
      statusCell.font = { bold: true };
      statusCell.alignment = { horizontal: 'center', vertical: 'middle' };

      // Alternate row shading
      if (i % 2 === 1) {
        row.eachCell((cell) => {
          if (!cell.fill || cell.fill.pattern === 'none') {
            cell.fill = {
              type: 'pattern', pattern: 'solid',
              fgColor: { argb: 'FFF9FAFB' },
            };
          }
        });
      }
    });

    // ── Column widths ────────────────────────────────────
    ws.columns = [
      { width: 8  },  // Sr. No
      { width: 16 },  // Visit Date
      { width: 14 },  // Job ID
      { width: 25 },  // Client Name
      { width: 30 },  // Site Location
      { width: 22 },  // Technician Name
      { width: 18 },  // Visit Type
      { width: 12 },  // Priority
      { width: 15 },  // Visit Status
      { width: 35 },  // Remarks
    ];

    // ── Summary section ──────────────────────────────────
    ws.addRow([]);
    ws.addRow([]);

    const summaryTitleRow = ws.addRow(['Summary']);
    summaryTitleRow.getCell(1).font = { bold: true, size: 13, color: { argb: 'FF1F2937' } };

    const statusCounts = {};
    const categoryCounts = {};
    for (const v of visits) {
      statusCounts[v.status] = (statusCounts[v.status] || 0) + 1;
      categoryCounts[v.category] = (categoryCounts[v.category] || 0) + 1;
    }

    ws.addRow(['Status Breakdown']);
    ws.lastRow.getCell(1).font = { bold: true, size: 11 };
    for (const [stat, count] of Object.entries(statusCounts)) {
      ws.addRow(['', stat, count]);
    }
    ws.addRow(['', 'Total', visits.length]).getCell(3).font = { bold: true };

    ws.addRow([]);
    ws.addRow(['Visit Type Breakdown']);
    ws.lastRow.getCell(1).font = { bold: true, size: 11 };
    for (const [cat, count] of Object.entries(categoryCounts)) {
      ws.addRow(['', cat, count]);
    }
    ws.addRow(['', 'Total', visits.length]).getCell(3).font = { bold: true };

    // ── Send response ────────────────────────────────────
    const filename = `Visit_Schedule_${monthName}_${year}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await wb.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('Monthly visit Excel error:', error);
    if (!res.headersSent) return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/reports/visit-schedule?month=6&year=2026
// JSON version — same data, no Excel download
// ────────────────────────────────────────────────────────────
const getMonthlyVisitJSON = async (req, res) => {
  try {
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const { technician_id, status, category } = req.query;

    if (month < 1 || month > 12) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'Month must be between 1 and 12.', { field: 'month' });
    }

    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const conditions = [
      `(j.scheduled_date >= $1::date AND j.scheduled_date < ($1::date + INTERVAL '1 month'))`,
    ];
    const values = [startDate];

    if (technician_id) {
      values.push(parseInt(technician_id));
      conditions.push(`j.technician_id = $${values.length}`);
    }
    if (status) {
      values.push(status);
      conditions.push(`j.status = $${values.length}`);
    }
    if (category) {
      values.push(category);
      conditions.push(`j.category = $${values.length}`);
    }

    const where = conditions.join(' AND ');

    // Count
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM jobs j WHERE ${where}`, values
    );
    const total = parseInt(countResult.rows[0].count);

    // Summary
    const summaryResult = await pool.query(
      `SELECT
         COUNT(*) AS total_visits,
         COUNT(*) FILTER (WHERE j.status = 'Closed')       AS completed,
         COUNT(*) FILTER (WHERE j.status = 'In Progress')  AS in_progress,
         COUNT(*) FILTER (WHERE j.status = 'Assigned')     AS assigned,
         COUNT(*) FILTER (WHERE j.status = 'Raised')       AS pending,
         COUNT(DISTINCT j.technician_id)                    AS technicians_involved,
         COUNT(DISTINCT j.client_id)                        AS clients_served
       FROM jobs j
       WHERE ${where}`,
      values
    );

    // Paginated data
    const dataValues = [...values, limit, offset];
    const result = await pool.query(
      `SELECT
         j.id AS job_id, j.title,
         j.scheduled_date, j.raised_date, j.closed_date,
         j.status, j.category, j.priority, j.amount, j.description,
         c.name AS client_name, c.address AS site_location,
         t.name AS technician_name
       FROM jobs j
       LEFT JOIN clients c ON c.id = j.client_id
       LEFT JOIN technicians t ON t.id = j.technician_id
       WHERE ${where}
       ORDER BY j.scheduled_date ASC, j.id ASC
       LIMIT $${dataValues.length - 1} OFFSET $${dataValues.length}`,
      dataValues
    );

    return res.status(200).json({
      success: true,
      month: MONTHS[month - 1],
      year,
      summary: summaryResult.rows[0],
      data: result.rows,
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    });

  } catch (error) {
    console.error('Monthly visit JSON error:', error);
    return Errors.internalError(res);
  }
};

module.exports = {
  getMonthlyVisitExcel,
  getMonthlyVisitJSON,
};
