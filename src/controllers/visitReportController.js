// ============================================================
// src/controllers/visitReportController.js
// Monthly / Day-wise Visit Schedule Excel Report
// ============================================================

const pool    = require('../config/db');
const ExcelJS = require('exceljs');
const { sendError, Errors } = require('../utils/AppError');
const ERROR_CODES = require('../utils/errorCodes');

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const fmtDate = (d) => d
  ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
  : '—';

// ────────────────────────────────────────────────────────────
// Shared query builder
// Params: year, month (1-12), optional day, technician_id,
//         status, category
// Returns: { visits, title }
// ────────────────────────────────────────────────────────────
const buildVisitQuery = async ({ year, month, day, technician_id, status, category }) => {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;

  // Date range condition — support single day or full month
  let dateCondition;
  const values = [];

  if (day) {
    values.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    dateCondition = `COALESCE(j.scheduled_date, j.start_date) = $${values.length}::date`;
  } else {
    values.push(startDate);
    dateCondition = `(
      COALESCE(j.scheduled_date, j.start_date) >= $${values.length}::date
      AND COALESCE(j.scheduled_date, j.start_date) < ($${values.length}::date + INTERVAL '1 month')
    )`;
  }

  const conditions = [dateCondition];

  if (technician_id) {
    values.push(parseInt(technician_id));
    conditions.push(`EXISTS (
      SELECT 1 FROM job_technicians jt2
      WHERE jt2.job_id = j.id AND jt2.technician_id = $${values.length}
    )`);
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
       j.id                                                           AS job_id,
       EXTRACT(YEAR FROM COALESCE(j.scheduled_date, j.start_date))::int AS year,
       COALESCE(j.scheduled_date, j.start_date)                      AS visit_date,
       (
         SELECT string_agg(t2.name, ', ' ORDER BY jt.assigned_at)
         FROM job_technicians jt
         JOIN technicians t2 ON t2.id = jt.technician_id
         WHERE jt.job_id = j.id
       )                                                              AS technician_names,
       c.name                                                         AS client_name,
       j.category                                                     AS visit_category,
       j.status,
       CASE WHEN r.id IS NOT NULL THEN 'Received' ELSE 'Not Received' END AS service_report_status,
       CASE WHEN j.status NOT IN ('Closed', 'Cancelled') THEN 'Yes' ELSE 'No' END AS pending_visit,
       COALESCE(a.status, 'N/A')                                      AS amc_po_status,
       a.service_date_1,
       a.service_date_2,
       a.service_date_3,
       a.service_date_4,
       a.service_date_5,
       a.service_date_6
     FROM jobs j
     LEFT JOIN clients c ON c.id = j.client_id
     LEFT JOIN LATERAL (
       SELECT r2.id FROM reports r2 WHERE r2.job_id = j.id LIMIT 1
     ) r ON true
     LEFT JOIN LATERAL (
       SELECT a2.status,
              a2.service_date_1, a2.service_date_2, a2.service_date_3,
              a2.service_date_4, a2.service_date_5, a2.service_date_6
       FROM amc_contracts a2
       WHERE a2.client_id = j.client_id
       ORDER BY a2.created_at DESC
       LIMIT 1
     ) a ON true
     WHERE ${where}
     ORDER BY COALESCE(j.scheduled_date, j.start_date) ASC, j.id ASC`,
    values
  );

  return result.rows;
};

// ────────────────────────────────────────────────────────────
// GET /api/reports/visit-schedule/excel
//   ?month=6&year=2026           — full month
//   ?month=6&year=2026&day=15   — single day
//   Optional: &technician_id= &status= &category=
// ────────────────────────────────────────────────────────────
const getMonthlyVisitExcel = async (req, res) => {
  try {
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
    const day   = req.query.day ? parseInt(req.query.day) : null;
    const { technician_id, status, category } = req.query;

    if (month < 1 || month > 12) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'Month must be between 1 and 12.', { field: 'month' });
    }

    const visits = await buildVisitQuery({ year, month, day, technician_id, status, category });

    // ── Build Excel workbook ─────────────────────────────
    const wb = new ExcelJS.Workbook();
    wb.creator = 'VDTI Service Hub';
    wb.created = new Date();

    const monthName = MONTHS[month - 1];
    const sheetTitle = day
      ? `${String(day).padStart(2, '0')} ${monthName} ${year}`
      : `${monthName} ${year}`;
    const ws = wb.addWorksheet(sheetTitle);

    const COL_COUNT = 14;

    // ── Title row ────────────────────────────────────────
    ws.mergeCells(`A1:N1`);
    const titleCell = ws.getCell('A1');
    titleCell.value = `Visit Schedule Report — ${sheetTitle}`;
    titleCell.font = { bold: true, size: 16, color: { argb: 'FF1F2937' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 35;

    // ── Generated info row ───────────────────────────────
    ws.mergeCells('A2:N2');
    const infoCell = ws.getCell('A2');
    infoCell.value = `Generated on: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}  |  Total Visits: ${visits.length}`;
    infoCell.font = { size: 10, italic: true, color: { argb: 'FF6B7280' } };
    infoCell.alignment = { horizontal: 'center' };

    ws.addRow([]);

    // ── Header row ───────────────────────────────────────
    const headers = [
      'Year',
      'Date',
      'Technician Name',
      'Client Name',
      'Visit Category',
      'Service Report',
      'Pending Visit',
      'AMC PO Status',
      '1st Visit Date',
      '2nd Visit Date',
      '3rd Visit Date',
      '4th Visit Date',
      '5th Visit Date',
      '6th Visit Date',
    ];

    const headerRow = ws.addRow(headers);
    headerRow.height = 30;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF065F46' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });

    // ── Status colours ───────────────────────────────────
    const statusColors = {
      'Closed':      'FFD1FAE5',
      'In Progress': 'FFDBEAFE',
      'Assigned':    'FFFEF3C7',
      'Raised':      'FFFEE2E2',
      'Cancelled':   'FFF3F4F6',
    };

    const amcStatusColors = {
      'Active':        'FF065F46',
      'Expiring Soon': 'FFB45309',
      'Expired':       'FFB91C1C',
      'N/A':           'FF6B7280',
    };

    // ── Data rows ────────────────────────────────────────
    visits.forEach((v, i) => {
      const row = ws.addRow([
        v.year || year,
        v.visit_date ? fmtDate(v.visit_date) : 'Not Scheduled',
        v.technician_names || 'Unassigned',
        v.client_name || '—',
        v.visit_category || '—',
        v.service_report_status,
        v.pending_visit,
        v.amc_po_status,
        fmtDate(v.service_date_1),
        fmtDate(v.service_date_2),
        fmtDate(v.service_date_3),
        fmtDate(v.service_date_4),
        fmtDate(v.service_date_5),
        fmtDate(v.service_date_6),
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

      // Alternate row shading
      if (i % 2 === 1) {
        row.eachCell((cell) => {
          if (!cell.fill || !cell.fill.fgColor || cell.fill.fgColor.argb === 'FF000000') {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
          }
        });
      }

      // Service Report column (col 6) — colour
      const srCell = row.getCell(6);
      srCell.font = { bold: true, color: { argb: v.service_report_status === 'Received' ? 'FF065F46' : 'FFB91C1C' } };
      srCell.alignment = { horizontal: 'center', vertical: 'middle' };

      // Pending Visit column (col 7)
      const pvCell = row.getCell(7);
      pvCell.font = { bold: true, color: { argb: v.pending_visit === 'Yes' ? 'FFB45309' : 'FF065F46' } };
      pvCell.alignment = { horizontal: 'center', vertical: 'middle' };

      // AMC PO Status column (col 8)
      const amcCell = row.getCell(8);
      const amcArgb = amcStatusColors[v.amc_po_status] || 'FF6B7280';
      amcCell.font = { bold: true, color: { argb: amcArgb } };
      amcCell.alignment = { horizontal: 'center', vertical: 'middle' };

      // Year column (col 1) — center
      row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    });

    // ── Column widths ────────────────────────────────────
    ws.columns = [
      { width: 8  },   // Year
      { width: 16 },   // Date
      { width: 26 },   // Technician Name
      { width: 26 },   // Client Name
      { width: 22 },   // Visit Category
      { width: 20 },   // Service Report
      { width: 14 },   // Pending Visit
      { width: 16 },   // AMC PO Status
      { width: 15 },   // 1st Visit Date
      { width: 15 },   // 2nd Visit Date
      { width: 15 },   // 3rd Visit Date
      { width: 15 },   // 4th Visit Date
      { width: 15 },   // 5th Visit Date
      { width: 15 },   // 6th Visit Date
    ];

    // ── Summary section ──────────────────────────────────
    ws.addRow([]);
    ws.addRow([]);

    const summaryTitleRow = ws.addRow(['Summary']);
    summaryTitleRow.getCell(1).font = { bold: true, size: 13, color: { argb: 'FF1F2937' } };

    const statusCounts   = {};
    const categoryCounts = {};
    let receivedCount    = 0;
    let pendingCount     = 0;

    for (const v of visits) {
      statusCounts[v.status]           = (statusCounts[v.status] || 0) + 1;
      categoryCounts[v.visit_category] = (categoryCounts[v.visit_category] || 0) + 1;
      if (v.service_report_status === 'Received') receivedCount++;
      if (v.pending_visit === 'Yes')              pendingCount++;
    }

    ws.addRow(['Status Breakdown']);
    ws.lastRow.getCell(1).font = { bold: true, size: 11 };
    for (const [stat, count] of Object.entries(statusCounts)) {
      ws.addRow(['', stat, count]);
    }
    ws.addRow(['', 'Total', visits.length]).getCell(3).font = { bold: true };

    ws.addRow([]);
    ws.addRow(['Visit Category Breakdown']);
    ws.lastRow.getCell(1).font = { bold: true, size: 11 };
    for (const [cat, count] of Object.entries(categoryCounts)) {
      ws.addRow(['', cat, count]);
    }

    ws.addRow([]);
    ws.addRow(['Service Report Summary']);
    ws.lastRow.getCell(1).font = { bold: true, size: 11 };
    ws.addRow(['', 'Received',     receivedCount]);
    ws.addRow(['', 'Not Received', visits.length - receivedCount]);
    ws.addRow(['', 'Pending Visits', pendingCount]);

    // ── Send file ────────────────────────────────────────
    const filename = day
      ? `Visit_Report_${String(day).padStart(2, '0')}_${monthName}_${year}.xlsx`
      : `Visit_Report_${monthName}_${year}.xlsx`;

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
// GET /api/reports/visit-schedule
// JSON version — same data, no download
// ────────────────────────────────────────────────────────────
const getMonthlyVisitJSON = async (req, res) => {
  try {
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
    const day   = req.query.day ? parseInt(req.query.day) : null;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const { technician_id, status, category } = req.query;

    if (month < 1 || month > 12) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'Month must be between 1 and 12.', { field: 'month' });
    }

    const visits = await buildVisitQuery({ year, month, day, technician_id, status, category });
    const total  = visits.length;
    const paged  = visits.slice((page - 1) * limit, page * limit);

    const summary = {
      total_visits:        total,
      completed:           visits.filter(v => v.status === 'Closed').length,
      in_progress:         visits.filter(v => v.status === 'In Progress').length,
      assigned:            visits.filter(v => v.status === 'Assigned').length,
      pending:             visits.filter(v => v.status === 'Raised').length,
      cancelled:           visits.filter(v => v.status === 'Cancelled').length,
      report_received:     visits.filter(v => v.service_report_status === 'Received').length,
      report_not_received: visits.filter(v => v.service_report_status === 'Not Received').length,
      pending_visits:      visits.filter(v => v.pending_visit === 'Yes').length,
    };

    return res.status(200).json({
      success: true,
      month:   MONTHS[month - 1],
      year,
      day:     day || null,
      summary,
      data: paged,
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
