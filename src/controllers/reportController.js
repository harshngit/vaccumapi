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
  const result = await client.query(
    `SELECT id FROM reports ORDER BY id DESC LIMIT 1`
  );
  if (result.rows.length === 0) return 'RPT-0001';
  const lastNum = parseInt(result.rows[0].id.replace('RPT-', ''), 10);
  return `RPT-${String(lastNum + 1).padStart(4, '0')}`;
};

// ─── Helper: build report email HTML ─────────────────────────
const buildReportEmailHtml = (report, technicalFiles = []) => {
  const formatDate = (d) =>
    d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  const technicalSection = technicalFiles.length > 0 ? `
    <tr>
      <td style="padding:14px 20px;border-bottom:1px solid #f0f0f0;">
        <strong style="color:#374151;">Attached Technical Reports</strong><br/>
        <ul style="margin:8px 0 0 0;padding-left:18px;">
          ${technicalFiles.map(f => `<li><a href="${f.file_url}" style="color:#2563eb;">${f.file_name}</a></li>`).join('')}
        </ul>
      </td>
    </tr>` : '';

  const checklistItems = report.checklist_items || [];
  const checklistSection = checklistItems.length > 0 ? `
    <tr>
      <td colspan="2" style="padding:12px 20px;border-bottom:1px solid #f0f0f0;background:#f9fafb;">
        <strong style="color:#1e40af;font-size:14px;">🔧 Preventive Maintenance Checklist</strong>
      </td>
    </tr>
    ${checklistItems.map(item => `
    <tr>
      <td style="padding:8px 20px;border-bottom:1px solid #f9f9f9;color:#6b7280;font-size:13px;">${item.sr}. ${item.description}</td>
      <td style="padding:8px 20px;border-bottom:1px solid #f9f9f9;color:#111827;font-size:13px;">${item.status || '—'}</td>
    </tr>`).join('')}` : '';

  const issueItems = report.issue_observations || [];
  const issuesSection = issueItems.length > 0 ? `
    <tr>
      <td colspan="2" style="padding:12px 20px;border-bottom:1px solid #f0f0f0;background:#f9fafb;">
        <strong style="color:#1e40af;font-size:14px;">⚠️ Detailed Issue Observations</strong>
      </td>
    </tr>
    ${issueItems.map(item => `
    <tr>
      <td style="padding:8px 20px;border-bottom:1px solid #f9f9f9;color:#6b7280;font-size:13px;">${item.issue} — ${item.observation}</td>
      <td style="padding:8px 20px;border-bottom:1px solid #f9f9f9;color:#111827;font-size:13px;">${item.severity || '—'} | ${item.recommended_spares || '—'}</td>
    </tr>`).join('')}` : '';

  const spareItems = report.mandatory_spares || [];
  const sparesSection = spareItems.length > 0 ? `
    <tr>
      <td colspan="2" style="padding:12px 20px;border-bottom:1px solid #f0f0f0;background:#f9fafb;">
        <strong style="color:#1e40af;font-size:14px;">🛠 Mandatory Spares</strong>
      </td>
    </tr>
    ${spareItems.map(s => `
    <tr>
      <td style="padding:8px 20px;border-bottom:1px solid #f9f9f9;color:#6b7280;font-size:13px;">${s.spare_name}</td>
      <td style="padding:8px 20px;border-bottom:1px solid #f9f9f9;color:#111827;font-size:13px;">${s.pump_model || '—'} | Qty: ${s.total_to_order || '—'}</td>
    </tr>`).join('')}` : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:30px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0"
             style="background:#ffffff;border-radius:10px;overflow:hidden;
                    box-shadow:0 4px 20px rgba(0,0,0,0.08);max-width:600px;width:100%;">
        <tr>
          <td style="background:linear-gradient(135deg,#1e3a8a 0%,#2563eb 100%);padding:32px 40px;text-align:center;">
            <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:700;letter-spacing:0.5px;">
              Vacuum Drying Technology India LLP
            </h1>
            <p style="color:#bfdbfe;margin:6px 0 0;font-size:13px;">
              101, Om Dronagiri, Girivihar Nagar, Borivali (East), Mumbai - 400 066
            </p>
            <p style="color:#bfdbfe;margin:4px 0 0;font-size:13px;">AMC Service Report Notification</p>
          </td>
        </tr>
        <!-- Greeting -->
        <tr>
          <td style="padding:28px 40px 10px;">
            <p style="color:#111827;font-size:16px;margin:0;">Dear <strong>${report.client_name || 'Valued Client'}</strong>,</p>
            <p style="color:#4b5563;font-size:14px;line-height:1.7;margin:12px 0 0;">
              We are pleased to inform you that a service has been completed at your premises.
              Please find the full AMC service report details below.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                   style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
              <tr style="background:#eff6ff;">
                <td colspan="2" style="padding:12px 20px;">
                  <strong style="color:#1e40af;font-size:15px;">Report ID: ${report.id}</strong>
                </td>
              </tr>
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;width:40%;color:#6b7280;font-size:13px;">Company Name</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#111827;font-size:14px;font-weight:600;">${report.company_name || report.client_name || '—'}</td>
              </tr>
              ${report.location ? `<tr><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;">Location / Site</td><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#111827;font-size:14px;">${report.location}</td></tr>` : ''}
              ${report.contact_person ? `<tr><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;">Contact Person</td><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#111827;font-size:14px;">${report.contact_person}</td></tr>` : ''}
              ${report.model_serial_installation ? `<tr><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;">Model / Serial No. / Installation Year</td><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#111827;font-size:14px;">${report.model_serial_installation}</td></tr>` : ''}
              ${report.operating_hours_per_day ? `<tr><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;">Operating Hours / Day</td><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#111827;font-size:14px;">${report.operating_hours_per_day}</td></tr>` : ''}
              ${report.application_process_description ? `<tr><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;">Application / Process</td><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#374151;font-size:14px;">${report.application_process_description}</td></tr>` : ''}
              ${report.po_number ? `<tr><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;">PO Number</td><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#111827;font-size:14px;">${report.po_number}</td></tr>` : ''}
              <tr><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;">Service Date</td><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#111827;font-size:14px;">${formatDate(report.report_date)}</td></tr>
              <tr><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;">Technician</td><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#111827;font-size:14px;">${report.technician_name || '—'}</td></tr>
              ${checklistSection}
              ${issuesSection}
              ${sparesSection}
              ${report.remarks ? `<tr><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;vertical-align:top;">Remarks</td><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#374151;font-size:14px;line-height:1.6;">${report.remarks.replace(/\n/g, '<br/>')}</td></tr>` : ''}
              ${report.findings ? `<tr><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;vertical-align:top;">Findings</td><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#374151;font-size:14px;line-height:1.6;">${report.findings.replace(/\n/g, '<br/>')}</td></tr>` : ''}
              ${report.recommendations ? `<tr><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;vertical-align:top;">Recommendations</td><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#374151;font-size:14px;line-height:1.6;">${report.recommendations.replace(/\n/g, '<br/>')}</td></tr>` : ''}
              ${report.comments ? `<tr><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;vertical-align:top;">Comments</td><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#374151;font-size:14px;line-height:1.6;">${report.comments.replace(/\n/g, '<br/>')}</td></tr>` : ''}
              ${report.vdt_representative_name || report.client_representative_name ? `
              <tr><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;">VDT Representative</td><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#111827;font-size:14px;">${report.vdt_representative_name || '—'}</td></tr>
              <tr><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;">Client Representative</td><td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#111827;font-size:14px;">${report.client_representative_name || '—'}</td></tr>` : ''}
              ${technicalSection}
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 40px 20px;">
            <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:6px;padding:12px 16px;">
              <span style="color:#92400e;font-size:13px;">
                <strong>Status:</strong> This report is currently under review by our team.
              </span>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:24px 40px;border-top:1px solid #e5e7eb;">
            <p style="color:#6b7280;font-size:13px;margin:0 0 8px;">
              If you have any questions, please contact us at
              <a href="mailto:info@electromechengineering.com" style="color:#2563eb;">info@electromechengineering.com</a>
              or call 9833594555 / 9819982801.
            </p>
            <p style="color:#374151;font-size:13px;margin:0;font-weight:600;">Vacuum Drying Technology India LLP</p>
            <p style="color:#9ca3af;font-size:11px;margin:12px 0 0;">This is an automated notification. Please do not reply directly to this email.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
};

// ─── Helper: generate PDF using pdfkit (no system deps, works on Render) ─────
const generatePdfBuffer = (report) => {
  return new Promise((resolve, reject) => {
    try {
      const PDFDocument = require('pdfkit');
      const chunks = [];

      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 40, bottom: 40, left: 45, right: 45 },
        info: {
          Title: `AMC Service Report - ${report.id}`,
          Author: 'Vacuum Drying Technology India LLP',
          Subject: report.title || 'AMC Service Report',
        },
      });

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end',  ()    => resolve(Buffer.concat(chunks)));
      doc.on('error', err  => reject(err));

      const formatDate = (d) =>
        d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

      const pageWidth  = doc.page.width  - doc.page.margins.left - doc.page.margins.right;
      const COLOR_BLUE = '#1e3a8a';
      const COLOR_GRAY = '#6b7280';
      const COLOR_BLACK = '#111827';
      const COLOR_LIGHT = '#f3f4f6';
      const COLOR_BORDER = '#d1d5db';

      // ── Helper: draw a horizontal rule ───────────────────────
      const hRule = (y, color = COLOR_BORDER) => {
        doc.moveTo(doc.page.margins.left, y)
           .lineTo(doc.page.margins.left + pageWidth, y)
           .strokeColor(color).lineWidth(0.5).stroke();
      };

      // ── Helper: draw a filled rect ───────────────────────────
      const fillRect = (x, y, w, h, color) => {
        doc.rect(x, y, w, h).fillColor(color).fill();
      };

      // ── Helper: two-column info row ──────────────────────────
      const infoRow = (label, value, y) => {
        doc.fontSize(8).fillColor(COLOR_GRAY)
           .text(label, doc.page.margins.left, y, { width: 160 });
        doc.fontSize(9).fillColor(COLOR_BLACK)
           .text(value || '—', doc.page.margins.left + 170, y, { width: pageWidth - 170 });
        return y + 18;
      };

      // ── HEADER ───────────────────────────────────────────────
      fillRect(0, 0, doc.page.width, 80, COLOR_BLUE);
      doc.fontSize(16).fillColor('#ffffff').font('Helvetica-Bold')
         .text('Vacuum Drying Technology India LLP', doc.page.margins.left, 18, { width: pageWidth, align: 'center' });
      doc.fontSize(8).fillColor('#bfdbfe').font('Helvetica')
         .text('101, Om Dronagiri, Girivihar Nagar, Shantivan, opp. Western Express Highway, Borivali (East), Mumbai - 400 066.', doc.page.margins.left, 40, { width: pageWidth, align: 'center' });
      doc.fontSize(8).fillColor('#bfdbfe')
         .text('Contact No.: 9833594555 / 9819982801  |  Email: info@electromechengineering.com', doc.page.margins.left, 55, { width: pageWidth, align: 'center' });

      let y = 95;

      // ── Section: AMC Service Report Title ───────────────────
      doc.fontSize(12).fillColor(COLOR_BLUE).font('Helvetica-Bold')
         .text('AMC Service Report - Italvacuum Pump', doc.page.margins.left, y, { width: pageWidth, align: 'center' });
      y += 20;
      hRule(y); y += 8;

      // ── Report ID + Status pill ──────────────────────────────
      doc.fontSize(9).fillColor(COLOR_GRAY).font('Helvetica')
         .text('Report ID:', doc.page.margins.left, y);
      doc.fontSize(9).fillColor(COLOR_BLUE).font('Helvetica-Bold')
         .text(report.id, doc.page.margins.left + 60, y);

      const statusColors = { Approved: '#16a34a', Rejected: '#dc2626', Pending: '#d97706' };
      const statusColor  = statusColors[report.status] || '#d97706';
      doc.roundedRect(doc.page.margins.left + pageWidth - 70, y - 2, 68, 14, 4)
         .fillColor(statusColor).fill();
      doc.fontSize(8).fillColor('#ffffff').font('Helvetica-Bold')
         .text(report.status, doc.page.margins.left + pageWidth - 70, y + 1, { width: 68, align: 'center' });

      y += 22;
      hRule(y); y += 10;

      // ── Client Info table ────────────────────────────────────
      doc.fontSize(10).fillColor(COLOR_BLUE).font('Helvetica-Bold')
         .text('Client & Report Information', doc.page.margins.left, y);
      y += 14;

      // Table header
      fillRect(doc.page.margins.left, y, pageWidth, 18, COLOR_BLUE);
      doc.fontSize(8).fillColor('#ffffff').font('Helvetica-Bold')
         .text('Field', doc.page.margins.left + 6, y + 4, { width: 160 })
         .text('Details', doc.page.margins.left + 170, y + 4, { width: pageWidth - 170 });
      y += 18;

      // Alternating rows
      const infoRows = [
        ['Company Name',                   report.company_name || report.client_name],
        ['Location / Site',                report.location],
        ['Contact Person',                 report.contact_person],
        ['Model - Serial No. - Inst. Year', report.model_serial_installation],
        ['Operating Hours / Day',          report.operating_hours_per_day],
        ['Application / Process',          report.application_process_description],
        ['PO Number',                      report.po_number],
        ['Serial No.',                     report.serial_no],
        ['Report Date',                    formatDate(report.report_date)],
        ['Technician',                     report.technician_name],
        ['Client Email',                   report.client_email],
      ].filter(r => r[1]);

      infoRows.forEach(([label, value], i) => {
        if (y > 740) { doc.addPage(); y = 50; }
        if (i % 2 === 0) fillRect(doc.page.margins.left, y, pageWidth, 18, '#f9fafb');
        doc.rect(doc.page.margins.left, y, pageWidth, 18).strokeColor(COLOR_BORDER).lineWidth(0.3).stroke();
        doc.fontSize(8).fillColor(COLOR_GRAY).font('Helvetica')
           .text(label, doc.page.margins.left + 6, y + 4, { width: 160 });
        doc.fontSize(8).fillColor(COLOR_BLACK).font('Helvetica')
           .text(String(value || '—'), doc.page.margins.left + 170, y + 4, { width: pageWidth - 176 });
        y += 18;
      });

      y += 12;

      // ── Checklist ────────────────────────────────────────────
      const checklistItems = report.checklist_items || [];
      if (checklistItems.length > 0) {
        if (y > 650) { doc.addPage(); y = 50; }

        doc.fontSize(10).fillColor(COLOR_BLUE).font('Helvetica-Bold')
           .text('Checklist (Routine Preventive Maintenance)', doc.page.margins.left, y);
        y += 14;

        // Table header
        fillRect(doc.page.margins.left, y, pageWidth, 18, COLOR_BLUE);
        doc.fontSize(8).fillColor('#ffffff').font('Helvetica-Bold')
           .text('SR', doc.page.margins.left + 4, y + 4, { width: 25 })
           .text('Description', doc.page.margins.left + 32, y + 4, { width: pageWidth - 130 })
           .text('Status', doc.page.margins.left + pageWidth - 94, y + 4, { width: 90 });
        y += 18;

        checklistItems.forEach((item, i) => {
          if (y > 750) { doc.addPage(); y = 50; }
          const rowH = 18;
          if (i % 2 === 0) fillRect(doc.page.margins.left, y, pageWidth, rowH, '#f9fafb');
          doc.rect(doc.page.margins.left, y, pageWidth, rowH).strokeColor(COLOR_BORDER).lineWidth(0.3).stroke();

          doc.fontSize(8).fillColor(COLOR_GRAY).font('Helvetica')
             .text(String(item.sr), doc.page.margins.left + 4, y + 4, { width: 25 });
          doc.fontSize(8).fillColor(COLOR_BLACK).font('Helvetica')
             .text(item.description || '', doc.page.margins.left + 32, y + 4, { width: pageWidth - 130 });

          if (item.status) {
            const statusBg = item.status.toLowerCase().includes('ok') ? '#dcfce7' :
                             item.status.toLowerCase().includes('spare') ? '#fef3c7' : '#eff6ff';
            const statusFg = item.status.toLowerCase().includes('ok') ? '#15803d' :
                             item.status.toLowerCase().includes('spare') ? '#92400e' : '#1e40af';
            doc.roundedRect(doc.page.margins.left + pageWidth - 94, y + 2, 90, 13, 3)
               .fillColor(statusBg).fill();
            doc.fontSize(7).fillColor(statusFg).font('Helvetica-Bold')
               .text(item.status, doc.page.margins.left + pageWidth - 94, y + 4, { width: 90, align: 'center' });
          }
          y += rowH;
        });

        // Site & Environmental Conditions note
        y += 10;
        if (y > 680) { doc.addPage(); y = 50; }
        fillRect(doc.page.margins.left, y, pageWidth, 72, '#fffbeb');
        doc.rect(doc.page.margins.left, y, pageWidth, 72).strokeColor('#fbbf24').lineWidth(0.5).stroke();
        doc.fontSize(8).fillColor('#92400e').font('Helvetica-Bold')
           .text('Site & Environmental Conditions', doc.page.margins.left + 8, y + 6);
        doc.fontSize(7.5).fillColor('#78350f').font('Helvetica')
           .text('• Maintain the pump installation area in a clean, dry and workable environment.', doc.page.margins.left + 8, y + 18)
           .text('• Ensure proper ventilation, lighting and access for maintenance activities.', doc.page.margins.left + 8, y + 30)
           .text('• Prevent the accumulation of dust, chemicals, solvents, vapours or waste material near the pump.', doc.page.margins.left + 8, y + 42)
           .text('• Maintain environmental cleanliness of the pump, motor and accessories at all times.', doc.page.margins.left + 8, y + 54);
        y += 82;
        doc.fontSize(7).fillColor(COLOR_GRAY).font('Helvetica')
           .text('Note: Client is obliged to maintain the above points.', doc.page.margins.left, y);
        y += 16;
      }

      // ── Issue Observation Matrix ─────────────────────────────
      const issueItems = report.issue_observations || [];
      if (issueItems.length > 0) {
        doc.addPage();
        y = 50;

        // Repeat header on new page
        fillRect(0, 0, doc.page.width, 60, COLOR_BLUE);
        doc.fontSize(14).fillColor('#ffffff').font('Helvetica-Bold')
           .text('Vacuum Drying Technology India LLP', doc.page.margins.left, 14, { width: pageWidth, align: 'center' });
        doc.fontSize(7.5).fillColor('#bfdbfe').font('Helvetica')
           .text('101, Om Dronagiri, Girivihar Nagar, Shantivan, opp. Western Express Highway, Borivali (East), Mumbai - 400 066.', doc.page.margins.left, 32, { width: pageWidth, align: 'center' });
        doc.fontSize(7.5).fillColor('#bfdbfe')
           .text('Contact No.: 9833594555 / 9819982801', doc.page.margins.left, 44, { width: pageWidth, align: 'center' });

        y = 76;
        doc.fontSize(11).fillColor(COLOR_BLUE).font('Helvetica-Bold')
           .text('Detailed Issue - Observation - Impact Matrix', doc.page.margins.left, y, { width: pageWidth, align: 'center' });
        y += 18;

        // Column widths
        const COL = {
          sr:      28,
          issue:   80,
          obs:     130,
          impact:  110,
          sev:     40,
          spares:  pageWidth - 28 - 80 - 130 - 110 - 40,
        };
        const colX = {
          sr:     doc.page.margins.left,
          issue:  doc.page.margins.left + COL.sr,
          obs:    doc.page.margins.left + COL.sr + COL.issue,
          impact: doc.page.margins.left + COL.sr + COL.issue + COL.obs,
          sev:    doc.page.margins.left + COL.sr + COL.issue + COL.obs + COL.impact,
          spares: doc.page.margins.left + COL.sr + COL.issue + COL.obs + COL.impact + COL.sev,
        };

        // Header row
        fillRect(doc.page.margins.left, y, pageWidth, 20, COLOR_BLUE);
        doc.fontSize(7.5).fillColor('#ffffff').font('Helvetica-Bold');
        [['SR', colX.sr, COL.sr], ['Issue', colX.issue, COL.issue], ['Observation', colX.obs, COL.obs],
         ['Impact on Pump', colX.impact, COL.impact], ['Sev.', colX.sev, COL.sev], ['Recommended Spares', colX.spares, COL.spares]]
          .forEach(([label, x, w]) => {
            doc.text(label, x + 3, y + 5, { width: w - 6 });
          });
        y += 20;

        issueItems.forEach((obs, i) => {
          if (y > 730) {
            doc.addPage(); y = 50;
            // Mini header on continuation page
            fillRect(doc.page.margins.left, y, pageWidth, 16, COLOR_BLUE);
            doc.fontSize(7).fillColor('#ffffff').font('Helvetica-Bold');
            [['SR', colX.sr, COL.sr], ['Issue', colX.issue, COL.issue], ['Observation', colX.obs, COL.obs],
             ['Impact on Pump', colX.impact, COL.impact], ['Sev.', colX.sev, COL.sev], ['Recommended Spares', colX.spares, COL.spares]]
              .forEach(([label, x, w]) => doc.text(label, x + 3, y + 3, { width: w - 6 }));
            y += 16;
          }

          const rowH = 22;
          if (i % 2 === 0) fillRect(doc.page.margins.left, y, pageWidth, rowH, '#f9fafb');
          doc.rect(doc.page.margins.left, y, pageWidth, rowH).strokeColor(COLOR_BORDER).lineWidth(0.3).stroke();

          doc.fontSize(7.5).fillColor(COLOR_GRAY).font('Helvetica')
             .text(String(obs.sr || i + 1), colX.sr + 3, y + 5, { width: COL.sr - 6 });
          doc.fontSize(7.5).fillColor(COLOR_BLACK).font('Helvetica-Bold')
             .text(obs.issue || '—', colX.issue + 3, y + 5, { width: COL.issue - 6 });
          doc.fontSize(7.5).fillColor(COLOR_BLACK).font('Helvetica')
             .text(obs.observation || '—', colX.obs + 3, y + 5, { width: COL.obs - 6 })
             .text(obs.impact_on_pump || '—', colX.impact + 3, y + 5, { width: COL.impact - 6 });

          if (obs.severity) {
            const sevBg = obs.severity === 'High' ? '#fee2e2' : obs.severity === 'Med' ? '#fef3c7' : '#dcfce7';
            const sevFg = obs.severity === 'High' ? '#dc2626' : obs.severity === 'Med' ? '#92400e' : '#15803d';
            doc.roundedRect(colX.sev + 2, y + 4, COL.sev - 4, 13, 3).fillColor(sevBg).fill();
            doc.fontSize(7).fillColor(sevFg).font('Helvetica-Bold')
               .text(obs.severity, colX.sev + 2, y + 7, { width: COL.sev - 4, align: 'center' });
          } else {
            doc.fontSize(7.5).fillColor(COLOR_GRAY).font('Helvetica')
               .text('—', colX.sev + 3, y + 5, { width: COL.sev - 6 });
          }

          doc.fontSize(7.5).fillColor(COLOR_BLACK).font('Helvetica')
             .text(obs.recommended_spares || '—', colX.spares + 3, y + 5, { width: COL.spares - 6 });

          y += rowH;
        });
      }

      // ── Remarks ──────────────────────────────────────────────
      if (report.remarks || report.findings || report.recommendations || report.comments) {
        y += 12;
        if (y > 680) { doc.addPage(); y = 50; }

        doc.fontSize(10).fillColor(COLOR_BLUE).font('Helvetica-Bold')
           .text('Remarks & Findings', doc.page.margins.left, y);
        y += 12; hRule(y); y += 8;

        const textFields = [
          ['Remarks',         report.remarks],
          ['Findings',        report.findings],
          ['Recommendations', report.recommendations],
          ['Comments',        report.comments],
        ].filter(f => f[1]);

        textFields.forEach(([label, value]) => {
          if (y > 700) { doc.addPage(); y = 50; }
          doc.fontSize(8).fillColor(COLOR_GRAY).font('Helvetica-Bold').text(label + ':', doc.page.margins.left, y);
          y += 12;
          fillRect(doc.page.margins.left, y, pageWidth, 2, COLOR_BORDER);
          doc.fontSize(8.5).fillColor(COLOR_BLACK).font('Helvetica')
             .text(value, doc.page.margins.left + 4, y + 6, { width: pageWidth - 8 });
          const textH = doc.heightOfString(value, { width: pageWidth - 8 });
          y += textH + 20;
        });
      }

      // ── Mandatory Spares ─────────────────────────────────────
      const spareItems = report.mandatory_spares || [];
      if (spareItems.length > 0) {
        doc.addPage();
        y = 50;

        // Repeat header
        fillRect(0, 0, doc.page.width, 60, COLOR_BLUE);
        doc.fontSize(14).fillColor('#ffffff').font('Helvetica-Bold')
           .text('Vacuum Drying Technology India LLP', doc.page.margins.left, 14, { width: pageWidth, align: 'center' });
        doc.fontSize(7.5).fillColor('#bfdbfe').font('Helvetica')
           .text('101, Om Dronagiri, Girivihar Nagar, Shantivan, opp. Western Express Highway, Borivali (East), Mumbai - 400 066.', doc.page.margins.left, 32, { width: pageWidth, align: 'center' });
        doc.fontSize(7.5).fillColor('#bfdbfe')
           .text('Contact No.: 9833594555 / 9819982801', doc.page.margins.left, 44, { width: pageWidth, align: 'center' });

        y = 76;
        doc.fontSize(11).fillColor(COLOR_BLUE).font('Helvetica-Bold')
           .text('Mandatory Spares - AMC Compliance Matrix', doc.page.margins.left, y, { width: pageWidth, align: 'center' });
        y += 18;

        const SW = { name: pageWidth - 160, model: 110, qty: 50 };
        const SX = {
          name:  doc.page.margins.left,
          model: doc.page.margins.left + SW.name,
          qty:   doc.page.margins.left + SW.name + SW.model,
        };

        fillRect(doc.page.margins.left, y, pageWidth, 20, COLOR_BLUE);
        doc.fontSize(8).fillColor('#ffffff').font('Helvetica-Bold')
           .text('Spare Name',   SX.name  + 4, y + 5, { width: SW.name - 8 })
           .text('Pump Model',  SX.model + 4, y + 5, { width: SW.model - 8 })
           .text('Qty to Order', SX.qty  + 4, y + 5, { width: SW.qty - 8 });
        y += 20;

        spareItems.forEach((s, i) => {
          if (y > 750) { doc.addPage(); y = 50; }
          const rowH = 18;
          if (i % 2 === 0) fillRect(doc.page.margins.left, y, pageWidth, rowH, '#f9fafb');
          doc.rect(doc.page.margins.left, y, pageWidth, rowH).strokeColor(COLOR_BORDER).lineWidth(0.3).stroke();
          doc.fontSize(8).fillColor(COLOR_BLACK).font('Helvetica')
             .text(s.spare_name || '—', SX.name + 4, y + 4, { width: SW.name - 8 });
          doc.fontSize(8).fillColor(COLOR_GRAY).font('Helvetica')
             .text(s.pump_model || '—', SX.model + 4, y + 4, { width: SW.model - 8 })
             .text(s.total_to_order || '—', SX.qty + 4, y + 4, { width: SW.qty - 8 });
          y += rowH;
        });

        // Compliance notes
        y += 14;
        if (y > 660) { doc.addPage(); y = 50; }
        fillRect(doc.page.margins.left, y, pageWidth, 80, '#eff6ff');
        doc.rect(doc.page.margins.left, y, pageWidth, 80).strokeColor('#93c5fd').lineWidth(0.5).stroke();
        doc.fontSize(8).fillColor(COLOR_BLUE).font('Helvetica-Bold')
           .text('Commercial & Compliance Notes (AMC Aligned)', doc.page.margins.left + 8, y + 6);
        doc.fontSize(7.5).fillColor('#1e3a8a').font('Helvetica')
           .text('1. The above-listed spares are classified as MANDATORY / RECOMMENDED and are required to be PROCURED and MAINTAINED at the site before the next scheduled maintenance visit.', doc.page.margins.left + 8, y + 18, { width: pageWidth - 16 })
           .text('2. In case mandatory spares are not available or partially available at the site, the maintenance visit may be restricted to inspection only. It shall be counted as a PM visit under the AMC.', doc.page.margins.left + 8, y + 38, { width: pageWidth - 16 })
           .text('3. Any limitation, delay or reduced scope of maintenance arising due to non-procurement of mandatory spares shall not be attributable to the service provider.', doc.page.margins.left + 8, y + 58, { width: pageWidth - 16 });
        y += 90;

        // Client obligations
        if (y > 680) { doc.addPage(); y = 50; }
        doc.fontSize(9).fillColor(COLOR_BLACK).font('Helvetica-Bold')
           .text('Client Obligations', doc.page.margins.left, y);
        y += 12;
        doc.fontSize(8).fillColor(COLOR_GRAY).font('Helvetica')
           .text('The client shall ensure the timely procurement and availability of all mandatory spares as recommended in this report to ensure uninterrupted operation and effective AMC service.', doc.page.margins.left, y, { width: pageWidth });
        y += 30;
        doc.fontSize(8).fillColor(COLOR_GRAY)
           .text('We acknowledge the above mandatory spares requirement and understand the AMC compliance conditions.', doc.page.margins.left, y, { width: pageWidth });
        y += 24;
      }

      // ── Signature Block ──────────────────────────────────────
      if (y > 680) { doc.addPage(); y = 50; }
      y += 10;
      hRule(y); y += 16;

      const halfW = (pageWidth - 20) / 2;
      // Left box: VDT
      doc.rect(doc.page.margins.left, y, halfW, 72).strokeColor(COLOR_BORDER).lineWidth(0.5).stroke();
      doc.fontSize(8).fillColor(COLOR_BLUE).font('Helvetica-Bold')
         .text('Vacuum Drying Technology Representative', doc.page.margins.left + 8, y + 8, { width: halfW - 16 });
      doc.fontSize(8).fillColor(COLOR_GRAY).font('Helvetica')
         .text('Name:', doc.page.margins.left + 8, y + 24)
         .text(report.vdt_representative_name || '', doc.page.margins.left + 45, y + 24, { width: halfW - 53 })
         .text('Sign:', doc.page.margins.left + 8, y + 40)
         .text('Date:', doc.page.margins.left + 8, y + 56)
         .text(formatDate(report.report_date), doc.page.margins.left + 45, y + 56, { width: halfW - 53 });

      // Right box: Client
      const rx = doc.page.margins.left + halfW + 20;
      doc.rect(rx, y, halfW, 72).strokeColor(COLOR_BORDER).lineWidth(0.5).stroke();
      doc.fontSize(8).fillColor(COLOR_BLUE).font('Helvetica-Bold')
         .text('Client Representative', rx + 8, y + 8, { width: halfW - 16 });
      doc.fontSize(8).fillColor(COLOR_GRAY).font('Helvetica')
         .text('Name:', rx + 8, y + 24)
         .text(report.client_representative_name || '', rx + 45, y + 24, { width: halfW - 53 })
         .text('Sign:', rx + 8, y + 40)
         .text('Date:', rx + 8, y + 56)
         .text(formatDate(report.report_date), rx + 45, y + 56, { width: halfW - 53 });

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
      return sendError(res, 400, ERROR_CODES.INVALID_REPORT_STATUS,
        'Invalid status. Allowed: Pending, Approved, Rejected.', { field: 'status' });
    }

    const conditions = [];
    const values     = [];

    if (status)        { values.push(status);                conditions.push(`r.status = $${values.length}`); }
    if (technician_id) { values.push(parseInt(technician_id)); conditions.push(`r.technician_id = $${values.length}`); }
    if (job_id)        { values.push(job_id);                conditions.push(`r.job_id = $${values.length}`); }
    if (client_id)     { values.push(parseInt(client_id));   conditions.push(`r.client_id = $${values.length}`); }
    if (po_number)     { values.push(po_number);             conditions.push(`r.po_number = $${values.length}`); }
    if (from_date)     { values.push(from_date);             conditions.push(`r.report_date >= $${values.length}`); }
    if (to_date)       { values.push(to_date);               conditions.push(`r.report_date <= $${values.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*) FROM reports r ${where}`, values);
    const total = parseInt(countResult.rows[0].count);

    values.push(limit, offset);
    const result = await pool.query(
      `SELECT
         r.id, r.job_id,
         j.title AS job_title,
         COALESCE(r.client_name, c.name) AS client_name,
         r.client_email, r.client_id,
         r.company_name, r.contact_person,
         r.model_serial_installation, r.operating_hours_per_day,
         r.application_process_description,
         r.po_number, r.location, r.serial_no, r.remarks,
         r.title, r.findings, r.recommendations, r.comments,
         r.vdt_representative_name, r.client_representative_name,
         r.status,
         r.technician_id, t.name AS technician_name,
         r.approved_by_user_id, r.approved_at,
         r.report_date,
         (SELECT COUNT(*) FROM report_images    ri WHERE ri.report_id = r.id) AS image_count,
         (SELECT COUNT(*) FROM technical_reports tr WHERE tr.report_id = r.id) AS technical_report_count,
         r.created_at, r.updated_at
       FROM reports r
       LEFT JOIN jobs        j ON j.id = r.job_id
       LEFT JOIN clients     c ON c.id = COALESCE(r.client_id, j.client_id)
       LEFT JOIN technicians t ON t.id = r.technician_id
       ${where}
       ORDER BY r.created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
      pagination: { total, page, limit, total_pages: Math.ceil(total / limit) },
    });

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
    if (missing.length > 0) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        `Please fill in all required fields: ${missing.join(', ')}.`,
        { missing_fields: missing });
    }

    if (!Array.isArray(technical_reports)) return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'technical_reports must be an array.', { field: 'technical_reports' });
    if (!Array.isArray(checklist_items))   return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'checklist_items must be an array.',   { field: 'checklist_items' });
    if (!Array.isArray(issue_observations)) return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'issue_observations must be an array.', { field: 'issue_observations' });
    if (!Array.isArray(mandatory_spares))  return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'mandatory_spares must be an array.',  { field: 'mandatory_spares' });

    for (let i = 0; i < technical_reports.length; i++) {
      const doc = technical_reports[i];
      if (!doc.file_name || !doc.file_url) {
        return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
          `technical_reports[${i}] must have both file_name and file_url.`,
          { field: `technical_reports[${i}]` });
      }
    }

    const jobCheck = await dbClient.query(
      `SELECT j.id, j.client_id, c.name AS client_name, c.email AS client_email
       FROM jobs j LEFT JOIN clients c ON c.id = j.client_id WHERE j.id = $1`,
      [job_id]
    );
    if (jobCheck.rows.length === 0) return Errors.jobNotFound(res);
    const jobRow = jobCheck.rows[0];

    const techCheck = await dbClient.query('SELECT id, name FROM technicians WHERE id = $1', [technician_id]);
    if (techCheck.rows.length === 0) return Errors.technicianNotFound(res);

    if (po_number) {
      const amcCheck = await dbClient.query('SELECT id FROM amc_contracts WHERE po_number = $1 LIMIT 1', [po_number]);
      if (amcCheck.rows.length === 0) {
        return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
          `PO Number "${po_number}" does not match any AMC contract.`, { field: 'po_number' });
      }
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
       ) VALUES (
         $1,$2,$3,$4,$5,'Pending',$6,CURRENT_DATE,$7,$8,$9,$10,$11,$12,$13,
         $14,$15,$16,$17,$18,$19,$20,$21
       ) RETURNING *`,
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

    for (const item of checklist_items) {
      await dbClient.query(
        `INSERT INTO report_checklist_items (report_id, sr, description, status) VALUES ($1, $2, $3, $4)`,
        [reportId, item.sr, item.description, item.status || null]
      );
    }

    for (const obs of issue_observations) {
      await dbClient.query(
        `INSERT INTO report_issue_observations (report_id, sr, issue, observation, impact_on_pump, severity, recommended_spares)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [reportId, obs.sr || null, obs.issue || null, obs.observation || null,
         obs.impact_on_pump || null, obs.severity || null, obs.recommended_spares || null]
      );
    }

    for (const spare of mandatory_spares) {
      await dbClient.query(
        `INSERT INTO report_mandatory_spares (report_id, spare_name, pump_model, total_to_order) VALUES ($1, $2, $3, $4)`,
        [reportId, spare.spare_name, spare.pump_model || null, spare.total_to_order || null]
      );
    }

    const savedTechnicalReports = [];
    for (const doc of technical_reports) {
      const tr = await dbClient.query(
        `INSERT INTO technical_reports (report_id, file_name, file_url, mime_type, file_size_bytes, uploaded_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, file_name, file_url, mime_type, file_size_bytes, uploaded_at`,
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
        to:      resolvedClientEmail,
        subject: `AMC Service Report ${reportId} — ${title.trim()} | Vacuum Drying Technology India LLP`,
        html,
      });
    }

    await notify({
      event: 'report_submitted', title: 'New Report Submitted',
      message: `${reportId} — ${title.trim()} (Job: ${job_id})`,
      entity_type: 'report', entity_id: reportId, roles: ['admin', 'manager'],
    }, wsManager);

    await logActivity({
      type: 'report', action: `Report ${reportId} submitted — ${title.trim()} (Job: ${job_id})`,
      entity_type: 'report', entity_id: reportId, performed_by: req.user.id,
    });

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
      `SELECT r.*, t.name AS technician_name,
         j.title AS job_title,
         COALESCE(r.client_name, c.name) AS client_name
       FROM reports r
       LEFT JOIN jobs        j ON j.id = r.job_id
       LEFT JOIN clients     c ON c.id = COALESCE(r.client_id, j.client_id)
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

    report.images            = images.rows;
    report.technical_reports = techReports.rows;
    report.checklist_items   = checklist.rows;
    report.issue_observations = issues.rows;
    report.mandatory_spares  = spares.rows;

    return res.status(200).json({ success: true, data: report });

  } catch (error) {
    console.error('Get report by ID error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/reports/:id/pdf
// Uses pdfkit — no Puppeteer, no Chrome, works on Render/Railway/any server
// ────────────────────────────────────────────────────────────
const generateReportPdf = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT r.*, t.name AS technician_name,
         COALESCE(r.client_name, c.name) AS client_name
       FROM reports r
       LEFT JOIN jobs        j ON j.id = r.job_id
       LEFT JOIN clients     c ON c.id = COALESCE(r.client_id, j.client_id)
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
    let { to, subject, message } = req.body;

    if (!to) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'to (email address) is required.', { field: 'to' });
    }
    const recipients = Array.isArray(to) ? to : [to];
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const addr of recipients) {
      if (!emailRegex.test(addr)) {
        return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, `Invalid email address: "${addr}".`, { field: 'to' });
      }
    }

    const result = await pool.query(
      `SELECT r.*, t.name AS technician_name,
         COALESCE(r.client_name, c.name) AS client_name
       FROM reports r
       LEFT JOIN jobs        j ON j.id = r.job_id
       LEFT JOIN clients     c ON c.id = COALESCE(r.client_id, j.client_id)
       LEFT JOIN technicians t ON t.id = r.technician_id
       WHERE r.id = $1`, [id]
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
    const customNote = message
      ? `<tr><td style="padding:16px 40px;"><div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:14px 16px;color:#1e40af;font-size:14px;line-height:1.6;">${message.replace(/\n/g, '<br/>')}</div></td></tr>`
      : '';

    let html = buildReportEmailHtml(report, techReports.rows);
    if (customNote) html = html.replace('<!-- Greeting -->', `<!-- Custom Note -->\n${customNote}\n<!-- Greeting -->`);

    await sendNotification('report_submitted', { to: recipients.join(', '), subject: emailSubject, html });

    await logActivity({
      type: 'report', action: `Report ${id} shared via email to: ${recipients.join(', ')}`,
      entity_type: 'report', entity_id: id, performed_by: req.user.id,
    });

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
    if (!isValidReportStatus(status)) return sendError(res, 400, ERROR_CODES.INVALID_REPORT_STATUS, 'Invalid status. Allowed values: Approved, Rejected.', { field: 'status' });

    const existCheck = await pool.query('SELECT * FROM reports WHERE id = $1', [id]);
    if (existCheck.rows.length === 0) return Errors.reportNotFound(res);

    const report = existCheck.rows[0];
    if (report.status !== 'Pending') {
      return sendError(res, 400, ERROR_CODES.REPORT_ALREADY_REVIEWED,
        `This report has already been ${report.status.toLowerCase()}. Only Pending reports can be reviewed.`);
    }

    const result = await pool.query(
      `UPDATE reports SET status = $1, approved_by_user_id = $2, approved_at = NOW()
       WHERE id = $3 RETURNING id, status, approved_by_user_id, approved_at`,
      [status, req.user.id, id]
    );

    const techUserRes = await pool.query(
      'SELECT t.user_id FROM technicians t JOIN reports r ON r.technician_id = t.id WHERE r.id = $1', [id]
    );
    if (techUserRes.rows[0]?.user_id) {
      await notify({
        event: 'report_reviewed', title: `Report ${status}`,
        message: `Your report ${id} was ${status.toLowerCase()} by admin`,
        entity_type: 'report', entity_id: id, user_id: techUserRes.rows[0].user_id,
      }, wsManager);
    }

    await logActivity({
      type: 'report', action: `Report ${id} ${status.toLowerCase()} by admin`,
      entity_type: 'report', entity_id: id, performed_by: req.user.id,
    });

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
    if (current + images.length > 20) {
      return sendError(res, 400, ERROR_CODES.TOO_MANY_IMAGES,
        `Cannot add ${images.length} image(s). Maximum 20 images per report (currently has ${current}).`);
    }

    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    for (const img of images) {
      if (!img.file_name || !img.file_url) return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Each image must have file_name and file_url.', { missing_fields: ['file_name', 'file_url'] });
      if (img.mime_type && !allowed.includes(img.mime_type)) return sendError(res, 400, ERROR_CODES.INVALID_FILE_TYPE, `Invalid file type "${img.mime_type}". Allowed: ${allowed.join(', ')}.`, { field: 'mime_type', allowed });
    }

    const inserted = [];
    for (const img of images) {
      const r = await pool.query(
        `INSERT INTO report_images (report_id, file_name, file_url, mime_type, file_size_bytes, uploaded_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, report_id, file_name, file_url, mime_type, file_size_bytes, uploaded_at`,
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