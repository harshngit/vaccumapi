// ============================================================
// src/controllers/reportController.js
// ============================================================

const pool = require('../config/db');
const { sendError, Errors } = require('../utils/AppError');
const ERROR_CODES = require('../utils/errorCodes');
const { isValidReportStatus } = require('../utils/validators');
const { notify } = require('./notificationController');
const wsManager  = require('../config/websocketManager');
const { logActivity } = require('./activityController');
const { sendNotification } = require('./emailController');

// ─── Helper: generate next report ID ─────────────────────────
const generateReportId = async (client) => {
  const result = await client.query(`SELECT id FROM reports ORDER BY id DESC LIMIT 1`);
  if (result.rows.length === 0) return 'RPT-0001';
  const lastNum = parseInt(result.rows[0].id.replace('RPT-', ''), 10);
  return `RPT-${String(lastNum + 1).padStart(4, '0')}`;
};

// ─── MASTER ISSUE DATA — full matrix from PDF Pages 2 & 3 ────
const MASTER_ISSUE_DATA = [
  {
    sr: 1, issue: 'Low Vaccum', rows: [
      { observation: 'Valve damage (chock up)',                      impact_on_pump: 'Overheat',                                    severity: 'Med',  recommended_spares: 'Valve set'                          },
      { observation: 'Slide valve Damaged',                           impact_on_pump: 'Abnormal Noise',                              severity: 'High', recommended_spares: 'Slide valve or spring'              },
      { observation: 'Piston ring Damaged',                           impact_on_pump: 'Piston or cylinder damage',                   severity: 'High', recommended_spares: 'Piston ring'                        },
      { observation: 'Oil seal Damaged',                              impact_on_pump: 'Oil consumption Vacuum',                      severity: 'Med',  recommended_spares: 'Sealing set'                        },
    ],
  },
  {
    sr: 2, issue: 'Abnormal Sound', rows: [
      { observation: 'Slide valve / Slide Valve spring Damaged',      impact_on_pump: 'Overheat, Low Vacuum',                        severity: 'High', recommended_spares: 'Slide valve / Slide Valve spring'   },
      { observation: 'Shell Bearing Damaged',                         impact_on_pump: 'Mechanical Damaged',                          severity: 'High', recommended_spares: 'Shell Bearing'                      },
      { observation: 'Piston Pin / Bush Damaged',                     impact_on_pump: 'Mechanical Damaged',                          severity: 'High', recommended_spares: 'Piston Pin / Bush'                  },
      { observation: 'Flywheel / Distrubustion Rod Bearing Damaged',  impact_on_pump: 'High Vibration',                              severity: 'High', recommended_spares: 'Flywheel / Distrubustion Rod Bearing'},
      { observation: 'Distribution Control Pin Damaged',              impact_on_pump: 'Lubrication Pump Damage',                     severity: 'High', recommended_spares: 'Distribution Control Pin'           },
      { observation: 'Pin For Outer Lever Damaged',                   impact_on_pump: 'Tie Rod Head Damage',                         severity: 'High', recommended_spares: 'Pin For Outer Lever'                },
      { observation: 'Connecting Rod Damaged',                        impact_on_pump: 'Mechanical Damage',                           severity: 'High', recommended_spares: 'Connecting Rod'                     },
      { observation: 'Crankshaft Damaged',                            impact_on_pump: 'Mechanical Damage',                           severity: 'High', recommended_spares: 'Crank Shaft'                        },
      { observation: 'Inner Lever Damaged',                           impact_on_pump: 'Slide Valve Damage',                          severity: 'High', recommended_spares: 'Inner Lever'                        },
      { observation: 'Cross Head Damaged',                            impact_on_pump: 'Mechanical Damage',                           severity: 'High', recommended_spares: 'Cross Head'                         },
    ],
  },
  {
    sr: 3, issue: 'Excessive Oil', rows: [
      { observation: 'Gland Packing Damaged',                         impact_on_pump: 'Oil Leakage and Smoke',                       severity: 'Med',  recommended_spares: 'Gland Packing'                      },
      { observation: 'Oil seal Damaged',                              impact_on_pump: 'Oil Leakage',                                 severity: 'High', recommended_spares: 'Oil seal'                           },
      { observation: 'Nylon Tubing Damaged',                          impact_on_pump: 'Oil Leakage',                                 severity: 'High', recommended_spares: 'Nylon Tubing'                       },
      { observation: 'Oil connector / Oiler Damaged',                 impact_on_pump: 'Oil Leakage',                                 severity: 'High', recommended_spares: 'Oil connector / Oiler'              },
      { observation: 'Piston Rod Damaged',                            impact_on_pump: 'Oil Consumption and Smoke',                   severity: 'Med',  recommended_spares: 'Piston Rod'                         },
    ],
  },
  {
    sr: 4, issue: 'No Lubrication', rows: [
      { observation: 'Oil Filter Chocked / Damaged',                  impact_on_pump: 'Overheat, Wear and Tare on Cylinder and Piston', severity: 'High', recommended_spares: 'Oil Filter Choked'             },
      { observation: 'Lubrication Pump/ Lever Damaged',               impact_on_pump: 'Overheat, Wear and Tare on Cylinder and Piston', severity: 'High', recommended_spares: 'Lubrication Pump / Lever'      },
    ],
  },
];

// ─── Helper: build report email HTML ─────────────────────────
const buildReportEmailHtml = (report, technicalFiles = []) => {
  const formatDate = (d) =>
    d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  const technicalSection = technicalFiles.length > 0 ? `
    <tr><td style="padding:14px 20px;border-bottom:1px solid #f0f0f0;">
      <strong style="color:#374151;">Attached Technical Reports</strong><br/>
      <ul style="margin:8px 0 0 0;padding-left:18px;">
        ${technicalFiles.map(f => `<li><a href="${f.file_url}" style="color:#2563eb;">${f.file_name}</a></li>`).join('')}
      </ul>
    </td></tr>` : '';

  const checklistItems   = report.checklist_items    || [];
  const issueItems       = report.issue_observations || [];
  const spareItems       = report.mandatory_spares   || [];

  const checklistSection = checklistItems.length > 0 ? `
    <tr><td colspan="2" style="padding:12px 20px;border-bottom:1px solid #f0f0f0;background:#f9fafb;">
      <strong style="color:#1e40af;font-size:14px;">Preventive Maintenance Checklist</strong>
    </td></tr>
    ${checklistItems.map(item => `
    <tr>
      <td style="padding:8px 20px;border-bottom:1px solid #f9f9f9;color:#6b7280;font-size:13px;">${item.sr}. ${item.description}</td>
      <td style="padding:8px 20px;border-bottom:1px solid #f9f9f9;color:#111827;font-size:13px;">${item.status || '—'}</td>
    </tr>`).join('')}` : '';

  const issuesSection = issueItems.length > 0 ? `
    <tr><td colspan="2" style="padding:12px 20px;border-bottom:1px solid #f0f0f0;background:#f9fafb;">
      <strong style="color:#1e40af;font-size:14px;">Detailed Issue Observations</strong>
    </td></tr>
    ${issueItems.map(item => `
    <tr>
      <td style="padding:8px 20px;border-bottom:1px solid #f9f9f9;color:#6b7280;font-size:13px;">${item.issue} — ${item.observation}</td>
      <td style="padding:8px 20px;border-bottom:1px solid #f9f9f9;color:#111827;font-size:13px;">${item.severity || '—'} | ${item.recommended_spares || '—'}</td>
    </tr>`).join('')}` : '';

  const sparesSection = spareItems.length > 0 ? `
    <tr><td colspan="2" style="padding:12px 20px;border-bottom:1px solid #f0f0f0;background:#f9fafb;">
      <strong style="color:#1e40af;font-size:14px;">Mandatory Spares</strong>
    </td></tr>
    ${spareItems.map(s => `
    <tr>
      <td style="padding:8px 20px;border-bottom:1px solid #f9f9f9;color:#6b7280;font-size:13px;">${s.spare_name}</td>
      <td style="padding:8px 20px;border-bottom:1px solid #f9f9f9;color:#111827;font-size:13px;">${s.pump_model || '—'} | Qty: ${s.total_to_order || '—'}</td>
    </tr>`).join('')}` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
  <table width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:30px 0;">
    <tr><td align="center">
      <table width="600" cellspacing="0" cellpadding="0"
             style="background:#fff;border-radius:10px;overflow:hidden;max-width:600px;width:100%;">
        <tr><td style="background:linear-gradient(135deg,#1e3a8a,#2563eb);padding:32px 40px;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700;">Vacuum Drying Technology India LLP</h1>
          <p style="color:#bfdbfe;margin:6px 0 0;font-size:12px;">101, Om Dronagiri, Girivihar Nagar, Borivali (East), Mumbai - 400 066</p>
          <p style="color:#bfdbfe;margin:4px 0 0;font-size:12px;">AMC Service Report Notification</p>
        </td></tr>
        <!-- Greeting -->
        <tr><td style="padding:28px 40px 10px;">
          <p style="color:#111827;font-size:16px;margin:0;">Dear <strong>${report.client_name || 'Valued Client'}</strong>,</p>
          <p style="color:#4b5563;font-size:14px;line-height:1.7;margin:12px 0 0;">
            A service has been completed at your premises. Please find the full AMC service report details below.
          </p>
        </td></tr>
        <tr><td style="padding:20px 40px;">
          <table width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
            <tr style="background:#eff6ff;">
              <td colspan="2" style="padding:12px 20px;">
                <strong style="color:#1e40af;font-size:15px;">Report ID: ${report.id}</strong>
              </td>
            </tr>
            <tr><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;width:40%;color:#6b7280;font-size:13px;">Company Name</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#111827;font-size:14px;font-weight:600;">${report.company_name || report.client_name || '—'}</td></tr>
            ${report.contact_person ? `<tr><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;">Contact Person</td><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#111827;font-size:14px;">${report.contact_person}</td></tr>` : ''}
            ${report.po_number ? `<tr><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;">PO Number</td><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#111827;font-size:14px;">${report.po_number}</td></tr>` : ''}
            <tr><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;">Service Date</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#111827;font-size:14px;">${formatDate(report.report_date)}</td></tr>
            <tr><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;">Technician</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#111827;font-size:14px;">${report.technician_name || '—'}</td></tr>
            ${checklistSection}${issuesSection}${sparesSection}
            ${report.remarks ? `<tr><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;vertical-align:top;">Remarks</td><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#374151;font-size:14px;line-height:1.6;">${report.remarks.replace(/\n/g,'<br/>')}</td></tr>` : ''}
          </table>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:24px 40px;border-top:1px solid #e5e7eb;">
          <p style="color:#6b7280;font-size:13px;margin:0 0 8px;">
            Questions? Contact us at <a href="mailto:info@electromechengineering.com" style="color:#2563eb;">info@electromechengineering.com</a> or call 9833594555 / 9819982801.
          </p>
          <p style="color:#374151;font-size:13px;margin:0;font-weight:600;">Vacuum Drying Technology India LLP</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
};

// ────────────────────────────────────────────────────────────
// PDF GENERATION
// Fixed: proper column widths so "Severity" never wraps
// ────────────────────────────────────────────────────────────
const generatePdfBuffer = (report) => {
  return new Promise((resolve, reject) => {
    try {
      const PDFDocument = require('pdfkit');
      const chunks = [];

      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 40, bottom: 40, left: 45, right: 45 },
        info: {
          Title: `Service Report - ${report.id}`,
          Author: 'Vacuum Drying Technology India LLP',
        },
      });

      doc.on('data', c => chunks.push(c));
      doc.on('end',  () => resolve(Buffer.concat(chunks)));
      doc.on('error', e => reject(e));

      // ── Layout constants ────────────────────────────────────
      const L   = 45;          // left margin
      const PW  = 595 - 90;    // A4 = 595, margins = 45+45, usable = 505
      const BLK = '#000000';
      const GRAY = '#555555';
      const ROW_H = 22;

      // ── Issue matrix FIXED column widths ─────────────────────
      // Total = PW = 505
      // Tick=14, SR=22, Issue=62, Obs=120, Impact=108, Severity=32, Spares=147
      const TICK_W = 14;
      const IC = {
        sr:     22,
        issue:  62,
        obs:    118,
        impact: 108,
        sev:    32,   // ← was 38, now exactly "High\n" width + padding — no wrap
      };
      IC.spares = PW - TICK_W - IC.sr - IC.issue - IC.obs - IC.impact - IC.sev;
      // spares = 505-14-22-62-118-108-32 = 149

      const IX = {
        tick:   L,
        sr:     L + TICK_W,
        issue:  L + TICK_W + IC.sr,
        obs:    L + TICK_W + IC.sr + IC.issue,
        impact: L + TICK_W + IC.sr + IC.issue + IC.obs,
        sev:    L + TICK_W + IC.sr + IC.issue + IC.obs + IC.impact,
        spares: L + TICK_W + IC.sr + IC.issue + IC.obs + IC.impact + IC.sev,
      };

      const formatDate = (d) =>
        d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

      // ── Drawing helpers ──────────────────────────────────────
      const border = (x, y, w, h) =>
        doc.rect(x, y, w, h).strokeColor(BLK).lineWidth(0.5).stroke();

      const hline = (x1, y, x2, lw = 0.5) =>
        doc.moveTo(x1, y).lineTo(x2, y).strokeColor(BLK).lineWidth(lw).stroke();

      const vline = (x, y1, y2, lw = 0.5) =>
        doc.moveTo(x, y1).lineTo(x, y2).strokeColor(BLK).lineWidth(lw).stroke();

      // Real checkbox: empty square with tick mark ✓ when selected
      const checkbox = (x, y, filled) => {
        const S = 8;
        doc.rect(x, y, S, S).strokeColor(BLK).lineWidth(0.6).stroke();
        if (filled) {
          // Draw a tick mark inside the box
          doc.save()
             .strokeColor(BLK)
             .lineWidth(1.2)
             .moveTo(x + 1.5, y + 4)
             .lineTo(x + 3,   y + 6.5)
             .lineTo(x + 6.5, y + 1.5)
             .stroke()
             .restore();
        }
      };

      // ── Page header ──────────────────────────────────────────
      const drawPageHeader = () => {
        let y = 40;
        doc.fontSize(22).fillColor(BLK).font('Helvetica-Bold')
           .text('Vacuum Drying Technology India LLP', L, y, { width: PW, align: 'center' });
        y += 28;
        doc.fontSize(7.5).fillColor(BLK).font('Helvetica')
           .text('101, Om Dronagiri, Girivihar Nagar, Shantivan, opp. Western Express Highway, Borivali (East), Mumbai - 400 066.', L, y, { width: PW, align: 'center' });
        y += 11;
        doc.fontSize(7.5).text('Contact No. : 9833594555 / 9819982801', L, y, { width: PW, align: 'center' });
        y += 11;
        doc.fontSize(7.5).text('Email : info@electromechengineering.com / clientservices@electromechengineering.com', L, y, { width: PW, align: 'center' });
        y += 12;
        hline(L, y, L + PW, 1.2);
        return y + 10;
      };

      // ── Issue matrix column header ───────────────────────────
      const drawIssueHeader = (y) => {
        const H = 20;
        border(L, y, PW, H);
        vline(IX.sr,     y, y + H);
        vline(IX.issue,  y, y + H);
        vline(IX.obs,    y, y + H);
        vline(IX.impact, y, y + H);
        vline(IX.sev,    y, y + H);
        vline(IX.spares, y, y + H);

        // Use font size 8 so "Severity" fits in the narrow column
        doc.fontSize(8).fillColor(BLK).font('Helvetica-Bold')
           .text('SR',                 IX.sr     + 2, y + 5, { width: IC.sr - 4,     lineBreak: false })
           .text('Issue',              IX.issue  + 3, y + 5, { width: IC.issue - 6,  lineBreak: false })
           .text('Observation',        IX.obs    + 3, y + 5, { width: IC.obs - 6,    lineBreak: false })
           .text('Impact on Pump',     IX.impact + 3, y + 5, { width: IC.impact - 6, lineBreak: false })
           .text('Severity',           IX.sev    + 2, y + 5, { width: IC.sev - 4,    lineBreak: false })
           .text('Recommended Spares', IX.spares + 3, y + 5, { width: IC.spares - 6, lineBreak: false });
        return y + H;
      };

      // ────────────────────────────────────────────────────────
      // PAGE 1: Header + Client Info + Checklist
      // ────────────────────────────────────────────────────────
      let y = drawPageHeader();

      doc.fontSize(11).fillColor(BLK).font('Helvetica-Bold')
         .text('AMC Service Report - Italvacuum Pump', L, y, { width: PW, align: 'center' });
      y += 18;

      // Client info table
      const COL1 = Math.round(PW * 0.42);
      const COL2 = PW - COL1;

      const clientRows = [
        ['Company Name',                            report.company_name || report.client_name || ''],
        ['Location / Site',                         report.location || ''],
        ['Contact Person',                          report.contact_person || ''],
        ['Madel - Serial No. - Installation Year',  report.model_serial_installation || ''],
        ['Operating Hours / Day',                   report.operating_hours_per_day || ''],
        ['Application / Process Description',       report.application_process_description || ''],
      ];

      // Header
      border(L, y, PW, ROW_H);
      vline(L + COL1, y, y + ROW_H);
      doc.fontSize(9).fillColor(BLK).font('Helvetica-Bold')
         .text('Field',   L + 5,        y + 6, { width: COL1 - 10, lineBreak: false })
         .text('Details', L + COL1 + 5, y + 6, { width: COL2 - 10, lineBreak: false });
      y += ROW_H;

      clientRows.forEach(([label, val]) => {
        border(L, y, PW, ROW_H);
        vline(L + COL1, y, y + ROW_H);
        doc.fontSize(8.5).fillColor(BLK).font('Helvetica')
           .text(label, L + 5,        y + 6, { width: COL1 - 10, lineBreak: false })
           .text(val,   L + COL1 + 5, y + 6, { width: COL2 - 10, lineBreak: false });
        y += ROW_H;
      });

      y += 16;

      // ── Checklist ────────────────────────────────────────────
      doc.fontSize(11).fillColor(BLK).font('Helvetica-Bold')
         .text('Checklist (Routine Preventive Maintenance)', L, y, { width: PW, align: 'center' });
      y += 14;

      const ALL_CHECKLIST = [
        { sr: 1, description: 'Check the oil level in the oil reserves.',                      options: ['OK', 'Topped Up'] },
        { sr: 2, description: 'Check the oil level on the Root Compressors (If available).',   options: ['OK', 'Topped Up', 'NA'] },
        { sr: 3, description: 'Check the lubrication circuit.',                                options: ['Normal', 'Leakage', 'Blockage'] },
        { sr: 4, description: 'Check the discharge valves.',                                   options: ['OK', 'Cleaned / Replaced', 'Spare Required'] },
        { sr: 5, description: 'Check & adjust the Gland packing.',                            options: ['OK', 'Adjusted / Replaced', 'Spare Required'] },
        { sr: 6, description: 'Oil filter cleaning.',                                         options: ['OK', 'Cleaned / Replaced', 'Spare Required'] },
        { sr: 7, description: 'Greasing of the pump.',                                        options: ['OK', 'Done'] },
        { sr: 8, description: 'Check the oil seal Ring.',                                     options: ['OK', 'Replaced', 'Spare Required'] },
        { sr: 9, description: 'Check & adjustment of the driving belts.',                     options: ['OK', 'Replaced', 'Spare Required'] },
      ];

      const checklistMap = {};
      (report.checklist_items || []).forEach(item => { checklistMap[item.sr] = item.status || ''; });

      const SR_W   = 28;
      const DESC_W = Math.round(PW * 0.52);
      const STAT_W = PW - SR_W - DESC_W;

      border(L, y, PW, ROW_H);
      vline(L + SR_W,          y, y + ROW_H);
      vline(L + SR_W + DESC_W, y, y + ROW_H);
      doc.fontSize(9).fillColor(BLK).font('Helvetica-Bold')
         .text('SR',          L + 8,                 y + 6, { width: SR_W - 10,   lineBreak: false })
         .text('Description', L + SR_W + 5,          y + 6, { width: DESC_W - 10, lineBreak: false })
         .text('Status',      L + SR_W + DESC_W + 5, y + 6, { width: STAT_W - 10, lineBreak: false });
      y += ROW_H;

      ALL_CHECKLIST.forEach(item => {
        const sel          = checklistMap[item.sr] || '';
        const twoLines     = [4, 5, 6].includes(item.sr);
        const cellH        = twoLines ? 36 : ROW_H;

        if (y + cellH > 780) { doc.addPage(); y = drawPageHeader(); }

        border(L, y, PW, cellH);
        vline(L + SR_W,          y, y + cellH);
        vline(L + SR_W + DESC_W, y, y + cellH);

        doc.fontSize(9).fillColor(BLK).font('Helvetica')
           .text(String(item.sr), L + 8, y + (cellH / 2) - 5, { width: SR_W - 10, lineBreak: false });
        doc.fontSize(8.5).fillColor(BLK).font('Helvetica')
           .text(item.description, L + SR_W + 5, y + (cellH / 2) - 5, { width: DESC_W - 10 });

        const statusX = L + SR_W + DESC_W + 6;
        if (!twoLines) {
          let cx = statusX;
          item.options.forEach(opt => {
            checkbox(cx, y + 7, sel === opt);
            doc.fontSize(8).fillColor(BLK).font('Helvetica')
               .text(opt, cx + 10, y + 7, { lineBreak: false });
            cx += 10 + doc.widthOfString(opt, { fontSize: 8 }) + 8;
          });
        } else {
          const topOpts = item.options.slice(0, 2);
          const btmOpts = item.options.slice(2);
          let cx = statusX;
          topOpts.forEach(opt => {
            checkbox(cx, y + 5, sel === opt);
            doc.fontSize(8).fillColor(BLK).font('Helvetica').text(opt, cx + 10, y + 5, { lineBreak: false });
            cx += 10 + doc.widthOfString(opt, { fontSize: 8 }) + 8;
          });
          cx = statusX;
          btmOpts.forEach(opt => {
            checkbox(cx, y + 21, sel === opt);
            doc.fontSize(8).fillColor(BLK).font('Helvetica').text(opt, cx + 10, y + 21, { lineBreak: false });
            cx += 10 + doc.widthOfString(opt, { fontSize: 8 }) + 8;
          });
        }
        y += cellH;
      });

      y += 14;

      // ── Site & Environmental Conditions ─────────────────────
      if (y + 90 > 780) { doc.addPage(); y = drawPageHeader(); }

      const envLines = [
        'Maintain the pump installation area in a clean, dry and workable environment.',
        'Ensure proper ventilation, lighting and access for maintenance activities.',
        'Prevent the accumulation of dust, chemicals, solvents, vapours or waste material near the pump.',
        'Maintain environmental cleanliness of the pump, motor and accessories at all times.',
      ];
      const envBoxH = 20 + envLines.length * 14;
      border(L, y, PW, envBoxH);
      hline(L, y + 18, L + PW);
      doc.fontSize(9).fillColor(BLK).font('Helvetica-Bold')
         .text('Site & Environmental Conditions', L + 5, y + 5, { width: PW - 10, align: 'center' });
      let ey = y + 22;
      envLines.forEach(line => {
        doc.fontSize(8).fillColor(BLK).font('Helvetica').text(line, L + 8, ey, { width: PW - 16 });
        ey += 14;
      });
      y += envBoxH + 6;
      doc.fontSize(7.5).fillColor(GRAY).font('Helvetica')
         .text('Note : Client is obliged to maintain the above points.', L, y);

      // ────────────────────────────────────────────────────────
      // HELPER: draw one issue group's rows onto the current page
      // ────────────────────────────────────────────────────────
      const selectedSet = new Set();
      (report.issue_observations || []).forEach(obs => {
        if (obs.issue && obs.observation)
          selectedSet.add(`${obs.issue}||${obs.observation}`);
      });

      const measure = (text, w) =>
        doc.heightOfString(text || '', { width: w, fontSize: 8 });

      const drawIssueGroup = (issueGroup, yStart) => {
        let y = yStart;
        issueGroup.rows.forEach((row, rowIdx) => {
          const isSelected = selectedSet.has(`${issueGroup.issue}||${row.observation}`);

          const hObs    = measure(row.observation,        IC.obs - 6);
          const hImpact = measure(row.impact_on_pump,     IC.impact - 6);
          const hSpares = measure(row.recommended_spares, IC.spares - 6);
          const rowH    = Math.max(hObs, hImpact, hSpares, 10, 16) + 10;

          // Row border + internal vertical dividers
          border(L, y, PW, rowH);
          vline(IX.sr,     y, y + rowH);
          vline(IX.issue,  y, y + rowH);
          vline(IX.obs,    y, y + rowH);
          vline(IX.impact, y, y + rowH);
          vline(IX.sev,    y, y + rowH);
          vline(IX.spares, y, y + rowH);

          const ty = y + 5;

          // Tick column — small checkbox, ticked if selected
          const cbS = 7;
          const cbX = IX.tick + 2;
          const cbY = ty + 2;
          doc.rect(cbX, cbY, cbS, cbS).strokeColor(BLK).lineWidth(0.6).stroke();
          if (isSelected) {
            doc.save()
               .strokeColor(BLK)
               .lineWidth(1.2)
               .moveTo(cbX + 1.2, cbY + 3.5)
               .lineTo(cbX + 2.8, cbY + 5.5)
               .lineTo(cbX + 5.8, cbY + 1.2)
               .stroke()
               .restore();
          }

          // SR — only on first row of group
          if (rowIdx === 0) {
            doc.fontSize(8).fillColor(BLK).font('Helvetica')
               .text(String(issueGroup.sr), IX.sr + 3, ty, { width: IC.sr - 6, lineBreak: false });
          }

          // Issue label — only on first row of group
          if (rowIdx === 0) {
            doc.fontSize(8).fillColor(BLK).font('Helvetica')
               .text(issueGroup.issue, IX.issue + 3, ty, { width: IC.issue - 6 });
          }

          // Observation, Impact, Severity, Spares
          doc.fontSize(8).fillColor(BLK).font('Helvetica')
             .text(row.observation     || '', IX.obs    + 3, ty, { width: IC.obs - 6 })
             .text(row.impact_on_pump  || '', IX.impact + 3, ty, { width: IC.impact - 6 });

          doc.fontSize(8).fillColor(BLK).font('Helvetica')
             .text(row.severity || '', IX.sev + 2, ty, { width: IC.sev - 4, lineBreak: false });

          doc.fontSize(8).fillColor(BLK).font('Helvetica')
             .text(row.recommended_spares || '', IX.spares + 3, ty, { width: IC.spares - 6 });

          y += rowH;
        });
        return y;
      };

      // ────────────────────────────────────────────────────────
      // PAGE 2: SR 1 (Low Vacuum) + SR 2 (Abnormal Sound)
      // ────────────────────────────────────────────────────────
      doc.addPage();
      y = drawPageHeader();

      doc.fontSize(11).fillColor(BLK).font('Helvetica-Bold')
         .text('Detailed Issue - Observation - Impact Matrix', L, y, { width: PW, align: 'center' });
      y += 16;

      y = drawIssueHeader(y);

      // SR 1 & SR 2 — first two issue groups
      const page2Groups = MASTER_ISSUE_DATA.slice(0, 2);
      page2Groups.forEach(issueGroup => {
        y = drawIssueGroup(issueGroup, y);
      });

      // ────────────────────────────────────────────────────────
      // PAGE 3: SR 3 (Excessive Oil) + SR 4 (No Lubrication) + Remarks
      // ────────────────────────────────────────────────────────
      doc.addPage();
      y = drawPageHeader();

      doc.fontSize(11).fillColor(BLK).font('Helvetica-Bold')
         .text('Detailed Issue - Observation - Impact Matrix', L, y, { width: PW, align: 'center' });
      y += 16;

      y = drawIssueHeader(y);

      // SR 3 & SR 4 — last two issue groups
      const page3Groups = MASTER_ISSUE_DATA.slice(2);
      page3Groups.forEach(issueGroup => {
        y = drawIssueGroup(issueGroup, y);
      });

      // ── Remarks section below the table on page 3 ───────────
      y += 20;
      if (y + 60 > 780) { doc.addPage(); y = drawPageHeader(); }

      doc.fontSize(9).fillColor(BLK).font('Helvetica').text('Remarks :', L, y);
      y += 16;

      const remarksLines = (report.remarks || '').split('\n');
      for (let i = 0; i < 8; i++) {
        if (y + 14 > 780) { doc.addPage(); y = drawPageHeader(); }
        hline(L, y + 12, L + PW);
        if (remarksLines[i]) {
          doc.fontSize(8.5).fillColor(BLK).font('Helvetica')
             .text(remarksLines[i], L + 2, y + 2, { width: PW - 4 });
        }
        y += 16;
      }

      // ────────────────────────────────────────────────────────
      // PAGE 3: MANDATORY SPARES + COMPLIANCE + SIGNATURES
      // ────────────────────────────────────────────────────────
      doc.addPage();
      y = drawPageHeader();

      doc.fontSize(11).fillColor(BLK).font('Helvetica-Bold')
         .text('Mandatory Spares - AMC Compliance Matrix', L, y, { width: PW, align: 'center' });
      y += 16;

      const SC = { name: Math.round(PW * 0.55), model: Math.round(PW * 0.25) };
      SC.qty = PW - SC.name - SC.model;
      const SX = { name: L, model: L + SC.name, qty: L + SC.name + SC.model };

      border(L, y, PW, ROW_H);
      vline(SX.model, y, y + ROW_H);
      vline(SX.qty,   y, y + ROW_H);
      doc.fontSize(9).fillColor(BLK).font('Helvetica-Bold')
         .text('Spare Name',             SX.name  + 5, y + 6, { width: SC.name - 10,  lineBreak: false })
         .text('Pump Model',             SX.model + 5, y + 6, { width: SC.model - 10, lineBreak: false })
         .text('Total To Order (Total)', SX.qty   + 5, y + 6, { width: SC.qty - 10,   lineBreak: false });
      y += ROW_H;

      const DEFAULT_SPARE_NAMES = [
        'Complete set of Gaskets', 'Complete set of Valve Gasket', 'Complete set of Valve Spring',
        'Complete set of Valve Screw', 'Complete set of Oil Connectors',
        'Ferrule / Insert / Reducer set', 'Nylon Tubing Set',
      ];

      const spareMap = {};
      (report.mandatory_spares || []).forEach(s => { if (s.spare_name) spareMap[s.spare_name] = s; });

      const allSpares = [
        ...DEFAULT_SPARE_NAMES.map(name => spareMap[name] || { spare_name: name, pump_model: '', total_to_order: '' }),
        ...(report.mandatory_spares || []).filter(s => !DEFAULT_SPARE_NAMES.includes(s.spare_name)),
      ];
      while (allSpares.length < 12) allSpares.push({ spare_name: '', pump_model: '', total_to_order: '' });

      allSpares.forEach(s => {
        if (y + ROW_H > 780) { doc.addPage(); y = drawPageHeader(); }
        border(L, y, PW, ROW_H);
        vline(SX.model, y, y + ROW_H);
        vline(SX.qty,   y, y + ROW_H);
        doc.fontSize(8.5).fillColor(BLK).font('Helvetica')
           .text(s.spare_name || '',     SX.name  + 5, y + 6, { width: SC.name - 10,  lineBreak: false })
           .text(s.pump_model || '',     SX.model + 5, y + 6, { width: SC.model - 10, lineBreak: false })
           .text(s.total_to_order || '', SX.qty   + 5, y + 6, { width: SC.qty - 10,   lineBreak: false });
        y += ROW_H;
      });

      y += 16;
      if (y + 80 > 780) { doc.addPage(); y = drawPageHeader(); }

      doc.fontSize(9).fillColor(BLK).font('Helvetica-BoldOblique')
         .text('Commercial & Compliance Notes (AMC Aligned)', L, y);
      y += 14;

      [
        'The above-listed spares are classified as MANDATORY / RECOMMENDED and are required to be PROCURED and MAINTAINED at the site before the next scheduled maintenance visit.',
        'In case mandatory spares are not available or partially available at the site, the maintenance visit may be restricted to inspection only. It shall be counted as a PM visit under the AMC.',
        'Any limitation, delay or reduced scope of maintenance arising due to non-procurement of mandatory spares shall not be attributable to the service provider.',
      ].forEach((note, i) => {
        if (y + 20 > 780) { doc.addPage(); y = drawPageHeader(); }
        const nh = doc.heightOfString(`${i + 1}.  ${note}`, { width: PW - 20, fontSize: 8.5 });
        doc.fontSize(8.5).fillColor(BLK).font('Helvetica')
           .text(`${i + 1}.  ${note}`, L + 10, y, { width: PW - 20 });
        y += nh + 6;
      });

      y += 10;
      if (y + 60 > 780) { doc.addPage(); y = drawPageHeader(); }

      doc.fontSize(9).fillColor(BLK).font('Helvetica-BoldOblique').text('Client Obligations', L, y);
      y += 13;
      const co1 = 'The client shall ensure the timely procurement and availability of all mandatory spares as recommended in this report to ensure uninterrupted operation and effective AMC service.';
      const co2 = 'We acknowledge the above mandatory spares requirement and understand the AMC compliance conditions.';
      doc.fontSize(8.5).fillColor(BLK).font('Helvetica').text(co1, L + 10, y, { width: PW - 20 });
      y += doc.heightOfString(co1, { width: PW - 20, fontSize: 8.5 }) + 8;
      doc.fontSize(8.5).fillColor(BLK).font('Helvetica').text(co2, L + 10, y, { width: PW - 20 });
      y += 22;

      // Signature table
      if (y + 80 > 780) { doc.addPage(); y = drawPageHeader(); }
      y += 6;

      const sigH   = 72;
      const halfSW = Math.floor(PW / 2);

      border(L, y, PW, sigH);
      vline(L + halfSW, y, y + sigH);
      hline(L, y + 18, L + PW);

      doc.fontSize(8.5).fillColor(BLK).font('Helvetica-Bold')
         .text('Vacuum Drying Technology Representative', L + 5,          y + 4, { width: halfSW - 10 })
         .text('Client Representative',                  L + halfSW + 5, y + 4, { width: halfSW - 10 });

      const sigVdt    = [report.vdt_representative_name || '', '', formatDate(report.report_date)];
      const sigClient = [report.client_representative_name || '', '', formatDate(report.report_date)];
      let sy = y + 21;
      ['Name :', 'Sign :', 'Date :'].forEach((lbl, i) => {
        hline(L, sy, L + PW);
        doc.fontSize(8.5).fillColor(BLK).font('Helvetica')
           .text(`${lbl}  ${sigVdt[i]}`,    L + 5,          sy + 3, { width: halfSW - 10 })
           .text(`${lbl}  ${sigClient[i]}`,  L + halfSW + 5, sy + 3, { width: halfSW - 10 });
        sy += 17;
      });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};

// ────────────────────────────────────────────────────────────
// GET /api/reports
// ────────────────────────────────────────────────────────────
const getReports = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const { status, technician_id, job_id, from_date, to_date, client_id, po_number } = req.query;

    if (status && !['Pending', 'Approved', 'Rejected'].includes(status)) {
      return sendError(res, 400, ERROR_CODES.INVALID_REPORT_STATUS, 'Invalid status.', { field: 'status' });
    }

    const conditions = [];
    const values     = [];
    if (status)        { values.push(status);                 conditions.push(`r.status = $${values.length}`); }
    if (technician_id) { values.push(parseInt(technician_id)); conditions.push(`r.technician_id = $${values.length}`); }
    if (job_id)        { values.push(job_id);                 conditions.push(`r.job_id = $${values.length}`); }
    if (client_id)     { values.push(parseInt(client_id));    conditions.push(`r.client_id = $${values.length}`); }
    if (po_number)     { values.push(po_number);              conditions.push(`r.po_number = $${values.length}`); }
    if (from_date)     { values.push(from_date);              conditions.push(`r.report_date >= $${values.length}`); }
    if (to_date)       { values.push(to_date);                conditions.push(`r.report_date <= $${values.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await pool.query(`SELECT COUNT(*) FROM reports r ${where}`, values);
    const total = parseInt(countResult.rows[0].count);

    values.push(limit, offset);
    const result = await pool.query(
      `SELECT r.id, r.job_id, j.title AS job_title,
         COALESCE(r.client_name, c.name) AS client_name,
         r.client_email, r.client_id, r.company_name, r.contact_person,
         r.model_serial_installation, r.operating_hours_per_day,
         r.application_process_description, r.po_number, r.location,
         r.serial_no, r.remarks, r.title, r.findings, r.recommendations,
         r.comments, r.vdt_representative_name, r.client_representative_name,
         r.status, r.technician_id, t.name AS technician_name,
         r.approved_by_user_id, r.approved_at, r.report_date,
         (SELECT COUNT(*) FROM report_images    ri WHERE ri.report_id = r.id) AS image_count,
         (SELECT COUNT(*) FROM technical_reports tr WHERE tr.report_id = r.id) AS technical_report_count,
         r.created_at, r.updated_at
       FROM reports r
       LEFT JOIN jobs j ON j.id = r.job_id
       LEFT JOIN clients c ON c.id = COALESCE(r.client_id, j.client_id)
       LEFT JOIN technicians t ON t.id = r.technician_id
       ${where}
       ORDER BY r.created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    return res.status(200).json({ success: true, data: result.rows, pagination: { total, page, limit, total_pages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('Get reports error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// POST /api/reports
// ────────────────────────────────────────────────────────────
const createReport = async (req, res) => {
  const dbClient = await pool.connect();
  try {
    const {
      job_id, title, findings, recommendations, technician_id,
      po_number, location, serial_no, comments,
      client_id, client_name, client_email,
      technical_reports = [],
      company_name, contact_person,
      model_serial_installation, operating_hours_per_day,
      application_process_description, remarks,
      checklist_items = [], issue_observations = [], mandatory_spares = [],
      vdt_representative_name, client_representative_name,
    } = req.body;

    const missing = [];
    if (!job_id)        missing.push('job_id');
    if (!title)         missing.push('title');
    if (!technician_id) missing.push('technician_id');
    if (missing.length > 0) return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS, `Please fill in all required fields: ${missing.join(', ')}.`, { missing_fields: missing });

    if (!Array.isArray(technical_reports))  return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'technical_reports must be an array.', { field: 'technical_reports' });
    if (!Array.isArray(checklist_items))    return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'checklist_items must be an array.', { field: 'checklist_items' });
    if (!Array.isArray(issue_observations)) return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'issue_observations must be an array.', { field: 'issue_observations' });
    if (!Array.isArray(mandatory_spares))   return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'mandatory_spares must be an array.', { field: 'mandatory_spares' });

    for (let i = 0; i < technical_reports.length; i++) {
      if (!technical_reports[i].file_name || !technical_reports[i].file_url)
        return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS, `technical_reports[${i}] must have both file_name and file_url.`, { field: `technical_reports[${i}]` });
    }

    const jobCheck = await dbClient.query(
      `SELECT j.id, j.client_id, c.name AS client_name, c.email AS client_email
       FROM jobs j LEFT JOIN clients c ON c.id = j.client_id WHERE j.id = $1`, [job_id]
    );
    if (jobCheck.rows.length === 0) return Errors.jobNotFound(res);
    const jobRow = jobCheck.rows[0];

    const techCheck = await dbClient.query('SELECT id, name FROM technicians WHERE id = $1', [technician_id]);
    if (techCheck.rows.length === 0) return Errors.technicianNotFound(res);

    if (po_number) {
      const amcCheck = await dbClient.query('SELECT id FROM amc_contracts WHERE po_number = $1 LIMIT 1', [po_number]);
      if (amcCheck.rows.length === 0)
        return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, `PO Number "${po_number}" does not match any AMC contract.`, { field: 'po_number' });
    }

    const resolvedClientId    = client_id    || jobRow.client_id    || null;
    const resolvedClientName  = client_name  || jobRow.client_name  || null;
    const resolvedClientEmail = client_email || jobRow.client_email || null;

    await dbClient.query('BEGIN');
    const reportId = await generateReportId(dbClient);

    const result = await dbClient.query(
      `INSERT INTO reports (
         id, job_id, title, findings, recommendations, status, technician_id, report_date,
         po_number, location, serial_no, comments, client_id, client_name, client_email,
         company_name, contact_person, model_serial_installation,
         operating_hours_per_day, application_process_description, remarks,
         vdt_representative_name, client_representative_name
       ) VALUES ($1,$2,$3,$4,$5,'Pending',$6,CURRENT_DATE,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING *`,
      [
        reportId, job_id, title.trim(),
        findings || null, recommendations || null, technician_id,
        po_number || null, location || null, serial_no || null, comments || null,
        resolvedClientId, resolvedClientName, resolvedClientEmail,
        company_name || null, contact_person || null, model_serial_installation || null,
        operating_hours_per_day || null, application_process_description || null,
        remarks || null, vdt_representative_name || null, client_representative_name || null,
      ]
    );
    const createdReport = result.rows[0];

    for (const item of checklist_items)
      await dbClient.query(`INSERT INTO report_checklist_items (report_id, sr, description, status) VALUES ($1,$2,$3,$4)`,
        [reportId, item.sr, item.description, item.status || null]);

    for (const obs of issue_observations)
      await dbClient.query(
        `INSERT INTO report_issue_observations (report_id, sr, issue, observation, impact_on_pump, severity, recommended_spares) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [reportId, obs.sr || null, obs.issue || null, obs.observation || null, obs.impact_on_pump || null, obs.severity || null, obs.recommended_spares || null]
      );

    for (const spare of mandatory_spares)
      await dbClient.query(`INSERT INTO report_mandatory_spares (report_id, spare_name, pump_model, total_to_order) VALUES ($1,$2,$3,$4)`,
        [reportId, spare.spare_name, spare.pump_model || null, spare.total_to_order || null]);

    const savedTechnicalReports = [];
    for (const doc of technical_reports) {
      const tr = await dbClient.query(
        `INSERT INTO technical_reports (report_id, file_name, file_url, mime_type, file_size_bytes, uploaded_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, file_name, file_url, mime_type, file_size_bytes, uploaded_at`,
        [reportId, doc.file_name, doc.file_url, doc.mime_type || 'application/pdf', doc.file_size_bytes || null, req.user.id]
      );
      savedTechnicalReports.push(tr.rows[0]);
    }

    await dbClient.query('COMMIT');

    createdReport.technician_name    = techCheck.rows[0].name;
    createdReport.technical_reports  = savedTechnicalReports;
    createdReport.checklist_items    = checklist_items;
    createdReport.issue_observations = issue_observations;
    createdReport.mandatory_spares   = mandatory_spares;

    if (resolvedClientEmail) {
      const html = buildReportEmailHtml(createdReport, savedTechnicalReports);
      await sendNotification('report_submitted', {
        to: resolvedClientEmail,
        subject: `AMC Service Report ${reportId} — ${title.trim()} | Vacuum Drying Technology India LLP`,
        html,
      });
    }

    await notify({ event: 'report_submitted', title: 'New Report Submitted', message: `${reportId} — ${title.trim()} (Job: ${job_id})`, entity_type: 'report', entity_id: reportId, roles: ['admin', 'manager'] }, wsManager);
    await logActivity({ type: 'report', action: `Report ${reportId} submitted — ${title.trim()} (Job: ${job_id})`, entity_type: 'report', entity_id: reportId, performed_by: req.user.id });

    return res.status(201).json({
      success: true,
      message: `Report ${reportId} submitted successfully.${resolvedClientEmail ? ` Notification sent to ${resolvedClientEmail}.` : ''}`,
      data: createdReport,
    });

  } catch (error) {
    await dbClient.query('ROLLBACK');
    console.error('Create report error:', error);
    return Errors.internalError(res);
  } finally {
    dbClient.release();
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/reports/:id
// ────────────────────────────────────────────────────────────
const getReportById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT r.*, t.name AS technician_name, j.title AS job_title,
         COALESCE(r.client_name, c.name) AS client_name
       FROM reports r
       LEFT JOIN jobs j ON j.id = r.job_id
       LEFT JOIN clients c ON c.id = COALESCE(r.client_id, j.client_id)
       LEFT JOIN technicians t ON t.id = r.technician_id
       WHERE r.id = $1`, [id]
    );
    if (result.rows.length === 0) return Errors.reportNotFound(res);
    const report = result.rows[0];
    const [images, techReports, checklist, issues, spares] = await Promise.all([
      pool.query(`SELECT id, file_name, file_url, mime_type, file_size_bytes, uploaded_at FROM report_images WHERE report_id = $1 ORDER BY uploaded_at ASC`, [id]),
      pool.query(`SELECT id, file_name, file_url, mime_type, file_size_bytes, uploaded_at FROM technical_reports WHERE report_id = $1 ORDER BY uploaded_at ASC`, [id]),
      pool.query(`SELECT sr, description, status FROM report_checklist_items WHERE report_id = $1 ORDER BY sr ASC`, [id]),
      pool.query(`SELECT sr, issue, observation, impact_on_pump, severity, recommended_spares FROM report_issue_observations WHERE report_id = $1 ORDER BY id ASC`, [id]),
      pool.query(`SELECT spare_name, pump_model, total_to_order FROM report_mandatory_spares WHERE report_id = $1 ORDER BY id ASC`, [id]),
    ]);
    report.images             = images.rows;
    report.technical_reports  = techReports.rows;
    report.checklist_items    = checklist.rows;
    report.issue_observations = issues.rows;
    report.mandatory_spares   = spares.rows;
    return res.status(200).json({ success: true, data: report });
  } catch (error) {
    console.error('Get report by ID error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/reports/:id/pdf
// ────────────────────────────────────────────────────────────
const generateReportPdf = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT r.*, t.name AS technician_name,
         COALESCE(r.client_name, c.name) AS client_name
       FROM reports r
       LEFT JOIN jobs j ON j.id = r.job_id
       LEFT JOIN clients c ON c.id = COALESCE(r.client_id, j.client_id)
       LEFT JOIN technicians t ON t.id = r.technician_id
       WHERE r.id = $1`, [id]
    );
    if (result.rows.length === 0) return Errors.reportNotFound(res);
    const report = result.rows[0];
    const [checklist, issues, spares] = await Promise.all([
      pool.query(`SELECT sr, description, status FROM report_checklist_items WHERE report_id = $1 ORDER BY sr ASC`, [id]),
      pool.query(`SELECT sr, issue, observation, impact_on_pump, severity, recommended_spares FROM report_issue_observations WHERE report_id = $1 ORDER BY id ASC`, [id]),
      pool.query(`SELECT spare_name, pump_model, total_to_order FROM report_mandatory_spares WHERE report_id = $1 ORDER BY id ASC`, [id]),
    ]);
    report.checklist_items    = checklist.rows;
    report.issue_observations = issues.rows;
    report.mandatory_spares   = spares.rows;
    const pdfBuffer = await generatePdfBuffer(report);
    res.set({
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="ServiceReport_${id}.pdf"`,
      'Content-Length':       pdfBuffer.length,
      'Cache-Control':        'no-cache',
    });
    return res.send(pdfBuffer);
  } catch (error) {
    console.error('Generate report PDF error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// POST /api/reports/:id/share
// ────────────────────────────────────────────────────────────
const shareReport = async (req, res) => {
  try {
    const { id } = req.params;
    const { to, subject, message } = req.body;
    if (!to) return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'to (email address) is required.', { field: 'to' });
    const recipients = Array.isArray(to) ? to : [to];
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const addr of recipients)
      if (!emailRegex.test(addr)) return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, `Invalid email address: "${addr}".`, { field: 'to' });

    const result = await pool.query(
      `SELECT r.*, t.name AS technician_name, COALESCE(r.client_name, c.name) AS client_name
       FROM reports r LEFT JOIN jobs j ON j.id = r.job_id LEFT JOIN clients c ON c.id = COALESCE(r.client_id, j.client_id) LEFT JOIN technicians t ON t.id = r.technician_id WHERE r.id = $1`, [id]
    );
    if (result.rows.length === 0) return Errors.reportNotFound(res);
    const report = result.rows[0];
    const [checklist, issues, spares, techReports] = await Promise.all([
      pool.query(`SELECT sr, description, status FROM report_checklist_items WHERE report_id = $1 ORDER BY sr ASC`, [id]),
      pool.query(`SELECT sr, issue, observation, impact_on_pump, severity, recommended_spares FROM report_issue_observations WHERE report_id = $1 ORDER BY id ASC`, [id]),
      pool.query(`SELECT spare_name, pump_model, total_to_order FROM report_mandatory_spares WHERE report_id = $1 ORDER BY id ASC`, [id]),
      pool.query(`SELECT file_name, file_url, mime_type FROM technical_reports WHERE report_id = $1 ORDER BY uploaded_at ASC`, [id]),
    ]);
    report.checklist_items    = checklist.rows;
    report.issue_observations = issues.rows;
    report.mandatory_spares   = spares.rows;

    const emailSubject = subject || `AMC Service Report ${id} — ${report.title} | Vacuum Drying Technology India LLP`;
    const customNote   = message ? `<tr><td style="padding:16px 40px;"><div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:14px 16px;color:#1e40af;font-size:14px;line-height:1.6;">${message.replace(/\n/g, '<br/>')}</div></td></tr>` : '';
    let html = buildReportEmailHtml(report, techReports.rows);
    if (customNote) html = html.replace('<!-- Greeting -->', `<!-- Custom Note -->\n${customNote}\n<!-- Greeting -->`);

    await sendNotification('report_submitted', { to: recipients.join(', '), subject: emailSubject, html });
    await logActivity({ type: 'report', action: `Report ${id} shared via email to: ${recipients.join(', ')}`, entity_type: 'report', entity_id: id, performed_by: req.user.id });
    return res.status(200).json({ success: true, message: `Report ${id} shared successfully to: ${recipients.join(', ')}.`, recipients });
  } catch (error) {
    console.error('Share report error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// PATCH /api/reports/:id/status
// ────────────────────────────────────────────────────────────
const updateReportStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'status is required.', { field: 'status' });
    if (!isValidReportStatus(status)) return sendError(res, 400, ERROR_CODES.INVALID_REPORT_STATUS, 'Invalid status. Allowed: Approved, Rejected.', { field: 'status' });
    const existCheck = await pool.query('SELECT * FROM reports WHERE id = $1', [id]);
    if (existCheck.rows.length === 0) return Errors.reportNotFound(res);
    if (existCheck.rows[0].status !== 'Pending')
      return sendError(res, 400, ERROR_CODES.REPORT_ALREADY_REVIEWED, `This report has already been ${existCheck.rows[0].status.toLowerCase()}. Only Pending reports can be reviewed.`);
    const result = await pool.query(
      `UPDATE reports SET status=$1, approved_by_user_id=$2, approved_at=NOW() WHERE id=$3 RETURNING id, status, approved_by_user_id, approved_at`,
      [status, req.user.id, id]
    );
    const techUserRes = await pool.query('SELECT t.user_id FROM technicians t JOIN reports r ON r.technician_id = t.id WHERE r.id = $1', [id]);
    if (techUserRes.rows[0]?.user_id)
      await notify({ event: 'report_reviewed', title: `Report ${status}`, message: `Your report ${id} was ${status.toLowerCase()} by admin`, entity_type: 'report', entity_id: id, user_id: techUserRes.rows[0].user_id }, wsManager);
    await logActivity({ type: 'report', action: `Report ${id} ${status.toLowerCase()} by admin`, entity_type: 'report', entity_id: id, performed_by: req.user.id });
    return res.status(200).json({ success: true, message: `Report ${id} ${status.toLowerCase()} successfully.`, data: result.rows[0] });
  } catch (error) {
    console.error('Update report status error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// POST /api/reports/:id/images
// ────────────────────────────────────────────────────────────
const addReportImage = async (req, res) => {
  try {
    const { id } = req.params;
    const images = Array.isArray(req.body) ? req.body : [req.body];
    const existCheck = await pool.query('SELECT id FROM reports WHERE id = $1', [id]);
    if (existCheck.rows.length === 0) return Errors.reportNotFound(res);
    const countCheck = await pool.query('SELECT COUNT(*) FROM report_images WHERE report_id = $1', [id]);
    const current = parseInt(countCheck.rows[0].count);
    if (current + images.length > 20) return sendError(res, 400, ERROR_CODES.TOO_MANY_IMAGES, `Cannot add ${images.length} image(s). Maximum 20 images per report (currently has ${current}).`);
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    for (const img of images) {
      if (!img.file_name || !img.file_url) return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Each image must have file_name and file_url.', { missing_fields: ['file_name', 'file_url'] });
      if (img.mime_type && !allowed.includes(img.mime_type)) return sendError(res, 400, ERROR_CODES.INVALID_FILE_TYPE, `Invalid file type "${img.mime_type}".`, { field: 'mime_type', allowed });
    }
    const inserted = [];
    for (const img of images) {
      const r = await pool.query(
        `INSERT INTO report_images (report_id, file_name, file_url, mime_type, file_size_bytes, uploaded_by_user_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, report_id, file_name, file_url, mime_type, file_size_bytes, uploaded_at`,
        [id, img.file_name, img.file_url, img.mime_type || 'image/jpeg', img.file_size_bytes || null, req.user.id]
      );
      inserted.push(r.rows[0]);
    }
    return res.status(201).json({ success: true, message: `${inserted.length} image(s) added to report ${id}.`, data: inserted });
  } catch (error) {
    console.error('Add report image error:', error);
    return Errors.internalError(res);
  }
};

module.exports = {
  getReports, createReport, getReportById,
  generateReportPdf, shareReport, updateReportStatus, addReportImage,
};