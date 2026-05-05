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

  // ── Build checklist rows if present ────────────────────────
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

  // ── Build issues rows if present ───────────────────────────
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

  // ── Build mandatory spares rows if present ─────────────────
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

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1e3a8a 0%,#2563eb 100%);
                     padding:32px 40px;text-align:center;">
            <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:700;letter-spacing:0.5px;">
              ⚙️ Vacuum Drying Technology India LLP
            </h1>
            <p style="color:#bfdbfe;margin:6px 0 0;font-size:13px;">
              101, Om Dronagiri, Girivihar Nagar, Borivali (East), Mumbai - 400 066
            </p>
            <p style="color:#bfdbfe;margin:4px 0 0;font-size:13px;">
              AMC Service Report Notification
            </p>
          </td>
        </tr>

        <!-- Greeting -->
        <tr>
          <td style="padding:28px 40px 10px;">
            <p style="color:#111827;font-size:16px;margin:0;">
              Dear <strong>${report.client_name || 'Valued Client'}</strong>,
            </p>
            <p style="color:#4b5563;font-size:14px;line-height:1.7;margin:12px 0 0;">
              We are pleased to inform you that a service has been completed at your premises.
              Please find the full AMC service report details below.
            </p>
          </td>
        </tr>

        <!-- Report Details Table -->
        <tr>
          <td style="padding:20px 40px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                   style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
              <tr style="background:#eff6ff;">
                <td colspan="2" style="padding:12px 20px;">
                  <strong style="color:#1e40af;font-size:15px;">
                    📋 Report ID: ${report.id}
                  </strong>
                </td>
              </tr>
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;width:40%;color:#6b7280;font-size:13px;">Company Name</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#111827;font-size:14px;font-weight:600;">${report.company_name || report.client_name || '—'}</td>
              </tr>
              ${report.location ? `
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;">Location / Site</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#111827;font-size:14px;">${report.location}</td>
              </tr>` : ''}
              ${report.contact_person ? `
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;">Contact Person</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#111827;font-size:14px;">${report.contact_person}</td>
              </tr>` : ''}
              ${report.model_serial_installation ? `
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;">Model / Serial No. / Installation Year</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#111827;font-size:14px;">${report.model_serial_installation}</td>
              </tr>` : ''}
              ${report.operating_hours_per_day ? `
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;">Operating Hours / Day</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#111827;font-size:14px;">${report.operating_hours_per_day}</td>
              </tr>` : ''}
              ${report.application_process_description ? `
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;">Application / Process</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#374151;font-size:14px;">${report.application_process_description}</td>
              </tr>` : ''}
              ${report.po_number ? `
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;">PO Number</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#111827;font-size:14px;">${report.po_number}</td>
              </tr>` : ''}
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;">Service Date</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#111827;font-size:14px;">${formatDate(report.report_date)}</td>
              </tr>
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;">Technician</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#111827;font-size:14px;">${report.technician_name || '—'}</td>
              </tr>
              ${checklistSection}
              ${issuesSection}
              ${sparesSection}
              ${report.remarks ? `
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;vertical-align:top;">Remarks</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#374151;font-size:14px;line-height:1.6;">${report.remarks.replace(/\n/g, '<br/>')}</td>
              </tr>` : ''}
              ${report.findings ? `
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;vertical-align:top;">Findings</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#374151;font-size:14px;line-height:1.6;">${report.findings.replace(/\n/g, '<br/>')}</td>
              </tr>` : ''}
              ${report.recommendations ? `
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;vertical-align:top;">Recommendations</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#374151;font-size:14px;line-height:1.6;">${report.recommendations.replace(/\n/g, '<br/>')}</td>
              </tr>` : ''}
              ${report.comments ? `
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;vertical-align:top;">Comments</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#374151;font-size:14px;line-height:1.6;">${report.comments.replace(/\n/g, '<br/>')}</td>
              </tr>` : ''}
              ${report.vdt_representative_name || report.client_representative_name ? `
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;">VDT Representative</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#111827;font-size:14px;">${report.vdt_representative_name || '—'}</td>
              </tr>
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;">Client Representative</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;color:#111827;font-size:14px;">${report.client_representative_name || '—'}</td>
              </tr>` : ''}
              ${technicalSection}
            </table>
          </td>
        </tr>

        <!-- Status Badge -->
        <tr>
          <td style="padding:0 40px 20px;">
            <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:6px;padding:12px 16px;">
              <span style="color:#92400e;font-size:13px;">
                ⏳ <strong>Status:</strong> This report is currently under review by our team.
              </span>
            </div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:24px 40px;border-top:1px solid #e5e7eb;">
            <p style="color:#6b7280;font-size:13px;margin:0 0 8px;">
              If you have any questions regarding this service report, please contact us at
              <a href="mailto:info@electromechengineering.com" style="color:#2563eb;">info@electromechengineering.com</a>
              or call 9833594555 / 9819982801.
            </p>
            <p style="color:#374151;font-size:13px;margin:0;font-weight:600;">
              Vacuum Drying Technology India LLP
            </p>
            <p style="color:#9ca3af;font-size:11px;margin:12px 0 0;">
              This is an automated notification. Please do not reply directly to this email.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
};

// ─── Helper: build PDF HTML (full AMC report layout) ─────────
const buildReportPdfHtml = (report) => {
  const formatDate = (d) =>
    d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  const checklistItems  = report.checklist_items  || [];
  const issueItems      = report.issue_observations || [];
  const spareItems      = report.mandatory_spares  || [];

  const checklistRows = checklistItems.map(item => `
    <tr>
      <td style="padding:6px 10px;border:1px solid #d1d5db;">${item.sr}</td>
      <td style="padding:6px 10px;border:1px solid #d1d5db;">${item.description}</td>
      <td style="padding:6px 10px;border:1px solid #d1d5db;">${item.status || ''}</td>
    </tr>`).join('');

  const issueRows = issueItems.map(item => `
    <tr>
      <td style="padding:6px 10px;border:1px solid #d1d5db;">${item.sr || ''}</td>
      <td style="padding:6px 10px;border:1px solid #d1d5db;">${item.issue || ''}</td>
      <td style="padding:6px 10px;border:1px solid #d1d5db;">${item.observation || ''}</td>
      <td style="padding:6px 10px;border:1px solid #d1d5db;">${item.impact_on_pump || ''}</td>
      <td style="padding:6px 10px;border:1px solid #d1d5db;">${item.severity || ''}</td>
      <td style="padding:6px 10px;border:1px solid #d1d5db;">${item.recommended_spares || ''}</td>
    </tr>`).join('');

  const spareRows = spareItems.map(s => `
    <tr>
      <td style="padding:6px 10px;border:1px solid #d1d5db;">${s.spare_name || ''}</td>
      <td style="padding:6px 10px;border:1px solid #d1d5db;">${s.pump_model || ''}</td>
      <td style="padding:6px 10px;border:1px solid #d1d5db;">${s.total_to_order || ''}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111827; padding: 32px; }
  .header { text-align: center; margin-bottom: 24px; border-bottom: 2px solid #1e3a8a; padding-bottom: 16px; }
  .header h1 { font-size: 20px; font-weight: bold; color: #1e3a8a; }
  .header p  { font-size: 11px; color: #4b5563; margin-top: 4px; }
  .section-title { font-size: 13px; font-weight: bold; text-align: center; margin: 20px 0 10px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th { background: #f3f4f6; font-weight: 600; padding: 8px 10px; border: 1px solid #d1d5db; text-align: left; }
  td { padding: 6px 10px; border: 1px solid #d1d5db; vertical-align: top; }
  .field-label { color: #6b7280; width: 40%; font-weight: 500; }
  .signature-table td { padding: 10px; border: 1px solid #d1d5db; }
  .remarks-box { border: 1px solid #d1d5db; padding: 10px; min-height: 60px; margin-bottom: 16px; }
  .env-box { border: 1px solid #d1d5db; padding: 10px; margin-bottom: 6px; font-size: 11px; }
  .note { font-size: 11px; color: #6b7280; margin-top: 4px; }
  .page-break { page-break-after: always; }
</style>
</head>
<body>

<!-- ── HEADER ─────────────────────────────────────────────── -->
<div class="header">
  <h1>Vacuum Drying Technology India LLP</h1>
  <p>101, Om Dronagiri, Girivihar Nagar, Shantivan, opp. Western Express Highway, Borivali (East), Mumbai - 400 066.</p>
  <p>Contact No.: 9833594555 / 9819982801 &nbsp;|&nbsp; Email: info@electromechengineering.com / clientservices@electromechengineering.com</p>
</div>

<!-- ── PAGE 1: CLIENT INFO + CHECKLIST ───────────────────── -->
<div class="section-title">AMC Service Report - Italvacuum Pump</div>

<table>
  <thead><tr><th>Field</th><th>Details</th></tr></thead>
  <tbody>
    <tr><td class="field-label">Company Name</td><td>${report.company_name || report.client_name || ''}</td></tr>
    <tr><td class="field-label">Location / Site</td><td>${report.location || ''}</td></tr>
    <tr><td class="field-label">Contact Person</td><td>${report.contact_person || ''}</td></tr>
    <tr><td class="field-label">Model - Serial No. - Installation Year</td><td>${report.model_serial_installation || ''}</td></tr>
    <tr><td class="field-label">Operating Hours / Day</td><td>${report.operating_hours_per_day || ''}</td></tr>
    <tr><td class="field-label">Application / Process Description</td><td>${report.application_process_description || ''}</td></tr>
  </tbody>
</table>

${checklistItems.length > 0 ? `
<div class="section-title">Checklist (Routine Preventive Maintenance)</div>
<table>
  <thead>
    <tr><th style="width:5%">SR</th><th>Description</th><th>Status</th></tr>
  </thead>
  <tbody>${checklistRows}</tbody>
</table>` : ''}

<div style="border:1px solid #d1d5db;padding:10px;margin-bottom:12px;">
  <strong style="display:block;margin-bottom:6px;">Site &amp; Environmental Conditions</strong>
  <p style="margin-bottom:4px;font-size:11px;">Maintain the pump installation area in a clean, dry and workable environment.</p>
  <p style="margin-bottom:4px;font-size:11px;">Ensure proper ventilation, lighting and access for maintenance activities.</p>
  <p style="margin-bottom:4px;font-size:11px;">Prevent the accumulation of dust, chemicals, solvents, vapours or waste material near the pump.</p>
  <p style="font-size:11px;">Maintain environmental cleanliness of the pump, motor and accessories at all times.</p>
</div>
<p class="note">Note: Client is obliged to maintain the above points.</p>

${issueItems.length > 0 ? `
<div class="page-break"></div>

<!-- ── PAGE 2: ISSUE OBSERVATION MATRIX ──────────────────── -->
<div class="header">
  <h1>Vacuum Drying Technology India LLP</h1>
  <p>101, Om Dronagiri, Girivihar Nagar, Shantivan, opp. Western Express Highway, Borivali (East), Mumbai - 400 066.</p>
  <p>Contact No.: 9833594555 / 9819982801</p>
</div>

<div class="section-title">Detailed Issue - Observation - Impact Matrix</div>
<table>
  <thead>
    <tr>
      <th style="width:4%">SR</th>
      <th>Issue</th>
      <th>Observation</th>
      <th>Impact on Pump</th>
      <th>Severity</th>
      <th>Recommended Spares</th>
    </tr>
  </thead>
  <tbody>${issueRows}</tbody>
</table>` : ''}

${report.remarks ? `
<div style="margin-top:16px;">
  <strong>Remarks:</strong>
  <div class="remarks-box">${report.remarks.replace(/\n/g, '<br/>')}</div>
</div>` : `
<div style="margin-top:16px;">
  <strong>Remarks:</strong>
  <div class="remarks-box"></div>
  <div class="remarks-box"></div>
  <div class="remarks-box"></div>
</div>`}

${spareItems.length > 0 ? `
<div class="page-break"></div>

<!-- ── PAGE 3: MANDATORY SPARES ──────────────────────────── -->
<div class="header">
  <h1>Vacuum Drying Technology India LLP</h1>
  <p>101, Om Dronagiri, Girivihar Nagar, Shantivan, opp. Western Express Highway, Borivali (East), Mumbai - 400 066.</p>
  <p>Contact No.: 9833594555 / 9819982801</p>
</div>

<div class="section-title">Mandatory Spares - AMC Compliance Matrix</div>
<table>
  <thead>
    <tr><th>Spare Name</th><th>Pump Model</th><th>Total To Order (Total)</th></tr>
  </thead>
  <tbody>${spareRows}</tbody>
</table>` : ''}

<!-- ── COMPLIANCE NOTES ───────────────────────────────────── -->
<div style="margin-bottom:16px;">
  <p style="font-weight:bold;margin-bottom:6px;font-style:italic;">Commercial &amp; Compliance Notes (AMC Aligned)</p>
  <ol style="padding-left:18px;font-size:11px;line-height:1.7;color:#374151;">
    <li>The above-listed spares are classified as MANDATORY / RECOMMENDED and are required to be PROCURED and MAINTAINED at the site before the next scheduled maintenance visit.</li>
    <li>In case mandatory spares are not available or partially available at the site, the maintenance visit may be restricted to inspection only. It shall be counted as a PM visit under the AMC.</li>
    <li>Any limitation, delay or reduced scope of maintenance arising due to non-procurement of mandatory spares shall not be attributable to the service provider.</li>
  </ol>
</div>

<div style="margin-bottom:16px;">
  <p style="font-weight:bold;margin-bottom:4px;font-style:italic;">Client Obligations</p>
  <p style="font-size:11px;line-height:1.7;color:#374151;">The client shall ensure the timely procurement and availability of all mandatory spares as recommended in this report to ensure uninterrupted operation and effective AMC service.</p>
  <p style="font-size:11px;line-height:1.7;color:#374151;margin-top:6px;">We acknowledge the above mandatory spares requirement and understand the AMC compliance conditions.</p>
</div>

<!-- ── SIGNATURE TABLE ────────────────────────────────────── -->
<table class="signature-table">
  <tr>
    <td style="width:50%;"><strong>Vacuum Drying Technology Representative</strong></td>
    <td style="width:50%;"><strong>Client Representative</strong></td>
  </tr>
  <tr>
    <td>Name:&nbsp; ${report.vdt_representative_name || ''}</td>
    <td>Name:&nbsp; ${report.client_representative_name || ''}</td>
  </tr>
  <tr>
    <td>Sign:&nbsp;</td>
    <td>Sign:&nbsp;</td>
  </tr>
  <tr>
    <td>Date:&nbsp; ${formatDate(report.report_date)}</td>
    <td>Date:&nbsp; ${formatDate(report.report_date)}</td>
  </tr>
</table>

</body>
</html>`;
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
//
// AMC Service Report - Italvacuum Pump
// Fields from PDF:
//   Page 1 → client info block + checklist_items[] + site conditions
//   Page 2 → issue_observations[] (Issue-Observation-Impact Matrix)
//   Page 3 → remarks (free text)
//   Page 4 → mandatory_spares[] + signatures
//
// technical_reports flow (2 steps):
//   Step 1 → POST /api/upload/technical-reports  (multipart)
//            Returns: [{ file_name, file_url, ... }, ...]
//   Step 2 → POST /api/reports  (JSON)
//            Pass the URLs from step 1 in technical_reports[]
// ────────────────────────────────────────────────────────────
const createReport = async (req, res) => {
  const dbClient = await pool.connect();
  try {
    const {
      // ── core / existing ──────────────────────────────────
      job_id, title, findings, recommendations, technician_id,
      po_number, location, serial_no, comments,
      client_id, client_name, client_email,
      technical_reports = [],

      // ── NEW: AMC PDF fields ──────────────────────────────
      company_name,               // "Company Name" — header block
      contact_person,             // "Contact Person"
      model_serial_installation,  // "Model - Serial No. - Installation Year"
      operating_hours_per_day,    // "Operating Hours / Day"
      application_process_description, // "Application / Process Description"
      remarks,                    // Free-text "Remarks" section (Page 3)

      // Checklist array — Page 1
      // Each item: { sr, description, status }
      // status examples: "OK", "Topped Up", "Leakage", "Cleaned / Replaced", etc.
      checklist_items = [],

      // Issue-Observation matrix — Page 2
      // Each item: { sr, issue, observation, impact_on_pump, severity, recommended_spares }
      issue_observations = [],

      // Mandatory Spares — Page 4
      // Each item: { spare_name, pump_model, total_to_order }
      mandatory_spares = [],

      // Signature block — Page 4
      vdt_representative_name,
      client_representative_name,
    } = req.body;

    // ── Required fields ──────────────────────────────────────
    const missing = [];
    if (!job_id)        missing.push('job_id');
    if (!title)         missing.push('title');
    if (!technician_id) missing.push('technician_id');
    if (missing.length > 0) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        `Please fill in all required fields: ${missing.join(', ')}.`,
        { missing_fields: missing });
    }

    // ── Validate technical_reports ───────────────────────────
    if (!Array.isArray(technical_reports)) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'technical_reports must be an array.', { field: 'technical_reports' });
    }
    for (let i = 0; i < technical_reports.length; i++) {
      const doc = technical_reports[i];
      if (!doc.file_name || !doc.file_url) {
        return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
          `technical_reports[${i}] must have both file_name and file_url.`,
          { field: `technical_reports[${i}]` });
      }
    }

    // ── Validate checklist_items ─────────────────────────────
    if (!Array.isArray(checklist_items)) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'checklist_items must be an array.', { field: 'checklist_items' });
    }

    // ── Validate issue_observations ──────────────────────────
    if (!Array.isArray(issue_observations)) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'issue_observations must be an array.', { field: 'issue_observations' });
    }

    // ── Validate mandatory_spares ────────────────────────────
    if (!Array.isArray(mandatory_spares)) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'mandatory_spares must be an array.', { field: 'mandatory_spares' });
    }

    // ── Validate job ─────────────────────────────────────────
    const jobCheck = await dbClient.query(
      `SELECT j.id, j.client_id, c.name AS client_name, c.email AS client_email
       FROM jobs j LEFT JOIN clients c ON c.id = j.client_id WHERE j.id = $1`,
      [job_id]
    );
    if (jobCheck.rows.length === 0) return Errors.jobNotFound(res);
    const jobRow = jobCheck.rows[0];

    // ── Validate technician ──────────────────────────────────
    const techCheck = await dbClient.query(
      'SELECT id, name FROM technicians WHERE id = $1', [technician_id]
    );
    if (techCheck.rows.length === 0) return Errors.technicianNotFound(res);

    // ── Validate PO Number against AMC contracts ─────────────
    if (po_number) {
      const amcCheck = await dbClient.query(
        'SELECT id FROM amc_contracts WHERE po_number = $1 LIMIT 1', [po_number]
      );
      if (amcCheck.rows.length === 0) {
        return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
          `PO Number "${po_number}" does not match any AMC contract. Please enter a valid AMC PO Number.`,
          { field: 'po_number' });
      }
    }

    // ── Resolve client info ──────────────────────────────────
    const resolvedClientId    = client_id    || jobRow.client_id    || null;
    const resolvedClientName  = client_name  || jobRow.client_name  || null;
    const resolvedClientEmail = client_email || jobRow.client_email || null;

    await dbClient.query('BEGIN');

    const reportId = await generateReportId(dbClient);

    // ── Insert report ────────────────────────────────────────
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
        remarks || null,
        vdt_representative_name || null, client_representative_name || null,
      ]
    );
    const createdReport = result.rows[0];

    // ── Insert checklist items ───────────────────────────────
    for (const item of checklist_items) {
      await dbClient.query(
        `INSERT INTO report_checklist_items (report_id, sr, description, status)
         VALUES ($1, $2, $3, $4)`,
        [reportId, item.sr, item.description, item.status || null]
      );
    }

    // ── Insert issue observations ────────────────────────────
    for (const obs of issue_observations) {
      await dbClient.query(
        `INSERT INTO report_issue_observations
           (report_id, sr, issue, observation, impact_on_pump, severity, recommended_spares)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          reportId,
          obs.sr || null,
          obs.issue || null,
          obs.observation || null,
          obs.impact_on_pump || null,
          obs.severity || null,
          obs.recommended_spares || null,
        ]
      );
    }

    // ── Insert mandatory spares ──────────────────────────────
    for (const spare of mandatory_spares) {
      await dbClient.query(
        `INSERT INTO report_mandatory_spares (report_id, spare_name, pump_model, total_to_order)
         VALUES ($1, $2, $3, $4)`,
        [reportId, spare.spare_name, spare.pump_model || null, spare.total_to_order || null]
      );
    }

    // ── Insert technical reports ─────────────────────────────
    const savedTechnicalReports = [];
    for (const doc of technical_reports) {
      const tr = await dbClient.query(
        `INSERT INTO technical_reports
           (report_id, file_name, file_url, mime_type, file_size_bytes, uploaded_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, file_name, file_url, mime_type, file_size_bytes, uploaded_at`,
        [
          reportId,
          doc.file_name,
          doc.file_url,
          doc.mime_type       || 'application/pdf',
          doc.file_size_bytes || null,
          req.user.id,
        ]
      );
      savedTechnicalReports.push(tr.rows[0]);
    }

    await dbClient.query('COMMIT');

    createdReport.technician_name        = techCheck.rows[0].name;
    createdReport.technical_reports      = savedTechnicalReports;
    createdReport.checklist_items        = checklist_items;
    createdReport.issue_observations     = issue_observations;
    createdReport.mandatory_spares       = mandatory_spares;

    // ── Send email to client ─────────────────────────────────
    if (resolvedClientEmail) {
      const html = buildReportEmailHtml(createdReport, savedTechnicalReports);
      await sendNotification('report_submitted', {
        to:      resolvedClientEmail,
        subject: `AMC Service Report ${reportId} — ${title.trim()} | Vacuum Drying Technology India LLP`,
        html,
      });
    }

    // ── Real-time notification ───────────────────────────────
    await notify({
      event:       'report_submitted',
      title:       'New Report Submitted',
      message:     `${reportId} — ${title.trim()} (Job: ${job_id})`,
      entity_type: 'report',
      entity_id:   reportId,
      roles:       ['admin', 'manager'],
    }, wsManager);

    await logActivity({
      type:         'report',
      action:       `Report ${reportId} submitted — ${title.trim()} (Job: ${job_id})`,
      entity_type:  'report',
      entity_id:    reportId,
      performed_by: req.user.id,
    });

    return res.status(201).json({
      success: true,
      message: `Report ${reportId} submitted successfully.${resolvedClientEmail ? ` Notification sent to ${resolvedClientEmail}.` : ''}`,
      data:    createdReport,
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
      `SELECT
         r.id, r.job_id,
         j.title AS job_title,
         COALESCE(r.client_name, c.name) AS client_name,
         r.client_email, r.client_id,
         r.company_name, r.contact_person,
         r.model_serial_installation, r.operating_hours_per_day,
         r.application_process_description,
         r.po_number, r.location, r.serial_no, r.remarks, r.comments,
         r.title, r.findings, r.recommendations, r.status,
         r.vdt_representative_name, r.client_representative_name,
         r.technician_id, t.name AS technician_name,
         r.approved_by_user_id, r.approved_at,
         r.report_date, r.created_at, r.updated_at
       FROM reports r
       LEFT JOIN jobs        j ON j.id = r.job_id
       LEFT JOIN clients     c ON c.id = COALESCE(r.client_id, j.client_id)
       LEFT JOIN technicians t ON t.id = r.technician_id
       WHERE r.id = $1`,
      [id]
    );

    if (result.rows.length === 0) return Errors.reportNotFound(res);

    const report = result.rows[0];

    // Fetch images
    const images = await pool.query(
      `SELECT id, file_name, file_url, mime_type, file_size_bytes, uploaded_at
       FROM report_images WHERE report_id = $1 ORDER BY uploaded_at ASC`,
      [id]
    );
    report.images = images.rows;

    // Fetch technical reports
    const techReports = await pool.query(
      `SELECT id, file_name, file_url, mime_type, file_size_bytes, uploaded_at
       FROM technical_reports WHERE report_id = $1 ORDER BY uploaded_at ASC`,
      [id]
    );
    report.technical_reports = techReports.rows;

    // Fetch checklist items
    const checklist = await pool.query(
      `SELECT sr, description, status FROM report_checklist_items
       WHERE report_id = $1 ORDER BY sr ASC`,
      [id]
    );
    report.checklist_items = checklist.rows;

    // Fetch issue observations
    const issues = await pool.query(
      `SELECT sr, issue, observation, impact_on_pump, severity, recommended_spares
       FROM report_issue_observations WHERE report_id = $1 ORDER BY id ASC`,
      [id]
    );
    report.issue_observations = issues.rows;

    // Fetch mandatory spares
    const spares = await pool.query(
      `SELECT spare_name, pump_model, total_to_order
       FROM report_mandatory_spares WHERE report_id = $1 ORDER BY id ASC`,
      [id]
    );
    report.mandatory_spares = spares.rows;

    return res.status(200).json({ success: true, data: report });

  } catch (error) {
    console.error('Get report by ID error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/reports/:id/pdf
// Generates and streams the AMC Service Report as a PDF
// Uses puppeteer (if available) or falls back to HTML response.
// ────────────────────────────────────────────────────────────
const generateReportPdf = async (req, res) => {
  try {
    const { id } = req.params;

    // ── Fetch the full report ────────────────────────────────
    const result = await pool.query(
      `SELECT
         r.*, t.name AS technician_name,
         COALESCE(r.client_name, c.name) AS client_name
       FROM reports r
       LEFT JOIN jobs        j ON j.id = r.job_id
       LEFT JOIN clients     c ON c.id = COALESCE(r.client_id, j.client_id)
       LEFT JOIN technicians t ON t.id = r.technician_id
       WHERE r.id = $1`,
      [id]
    );
    if (result.rows.length === 0) return Errors.reportNotFound(res);

    const report = result.rows[0];

    // Fetch related data
    const [checklist, issues, spares] = await Promise.all([
      pool.query(
        `SELECT sr, description, status FROM report_checklist_items
         WHERE report_id = $1 ORDER BY sr ASC`, [id]
      ),
      pool.query(
        `SELECT sr, issue, observation, impact_on_pump, severity, recommended_spares
         FROM report_issue_observations WHERE report_id = $1 ORDER BY id ASC`, [id]
      ),
      pool.query(
        `SELECT spare_name, pump_model, total_to_order
         FROM report_mandatory_spares WHERE report_id = $1 ORDER BY id ASC`, [id]
      ),
    ]);

    report.checklist_items    = checklist.rows;
    report.issue_observations = issues.rows;
    report.mandatory_spares   = spares.rows;

    const html = buildReportPdfHtml(report);

    // ── Try puppeteer for real PDF ───────────────────────────
    let puppeteer;
    try { puppeteer = require('puppeteer'); } catch (_) { puppeteer = null; }

    if (puppeteer) {
      const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdfBuffer = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
        });
        res.set({
          'Content-Type':        'application/pdf',
          'Content-Disposition': `attachment; filename="ServiceReport_${id}.pdf"`,
          'Content-Length':       pdfBuffer.length,
        });
        return res.send(pdfBuffer);
      } finally {
        await browser.close();
      }
    }

    // ── Fallback: return HTML (client can print-to-PDF) ──────
    res.set({
      'Content-Type':        'text/html; charset=utf-8',
      'Content-Disposition': `inline; filename="ServiceReport_${id}.html"`,
    });
    return res.send(html);

  } catch (error) {
    console.error('Generate report PDF error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// POST /api/reports/:id/share
// Emails the AMC Service Report (HTML + optional PDF attachment)
// to the provided email address(es).
//
// Body:
//   { to: string | string[], subject?: string, message?: string }
// ────────────────────────────────────────────────────────────
const shareReport = async (req, res) => {
  try {
    const { id } = req.params;
    let { to, subject, message } = req.body;

    // ── Validate recipients ──────────────────────────────────
    if (!to) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        'to (email address) is required.', { field: 'to' });
    }
    const recipients = Array.isArray(to) ? to : [to];
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const addr of recipients) {
      if (!emailRegex.test(addr)) {
        return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
          `Invalid email address: "${addr}".`, { field: 'to' });
      }
    }

    // ── Fetch full report ────────────────────────────────────
    const result = await pool.query(
      `SELECT
         r.*, t.name AS technician_name,
         COALESCE(r.client_name, c.name) AS client_name
       FROM reports r
       LEFT JOIN jobs        j ON j.id = r.job_id
       LEFT JOIN clients     c ON c.id = COALESCE(r.client_id, j.client_id)
       LEFT JOIN technicians t ON t.id = r.technician_id
       WHERE r.id = $1`,
      [id]
    );
    if (result.rows.length === 0) return Errors.reportNotFound(res);

    const report = result.rows[0];

    // Fetch related data
    const [checklist, issues, spares, techReports] = await Promise.all([
      pool.query(
        `SELECT sr, description, status FROM report_checklist_items
         WHERE report_id = $1 ORDER BY sr ASC`, [id]
      ),
      pool.query(
        `SELECT sr, issue, observation, impact_on_pump, severity, recommended_spares
         FROM report_issue_observations WHERE report_id = $1 ORDER BY id ASC`, [id]
      ),
      pool.query(
        `SELECT spare_name, pump_model, total_to_order
         FROM report_mandatory_spares WHERE report_id = $1 ORDER BY id ASC`, [id]
      ),
      pool.query(
        `SELECT file_name, file_url, mime_type FROM technical_reports
         WHERE report_id = $1 ORDER BY uploaded_at ASC`, [id]
      ),
    ]);

    report.checklist_items    = checklist.rows;
    report.issue_observations = issues.rows;
    report.mandatory_spares   = spares.rows;

    const technicalFiles = techReports.rows;

    // ── Build email ──────────────────────────────────────────
    const emailSubject = subject ||
      `AMC Service Report ${id} — ${report.title} | Vacuum Drying Technology India LLP`;

    const customNote = message
      ? `<tr><td style="padding:16px 40px;"><div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:14px 16px;color:#1e40af;font-size:14px;line-height:1.6;">${message.replace(/\n/g, '<br/>')}</div></td></tr>`
      : '';

    // Inject custom note into the HTML body
    let html = buildReportEmailHtml(report, technicalFiles);
    if (customNote) {
      html = html.replace('<!-- Greeting -->', `<!-- Custom Note -->\n${customNote}\n<!-- Greeting -->`);
    }

    // ── Send email ───────────────────────────────────────────
    await sendNotification('report_submitted', {
      to:      recipients.join(', '),
      subject: emailSubject,
      html,
    });

    // ── Log activity ─────────────────────────────────────────
    await logActivity({
      type:         'report',
      action:       `Report ${id} shared via email to: ${recipients.join(', ')}`,
      entity_type:  'report',
      entity_id:    id,
      performed_by: req.user.id,
    });

    return res.status(200).json({
      success:    true,
      message:    `Report ${id} shared successfully to: ${recipients.join(', ')}.`,
      recipients,
    });

  } catch (error) {
    console.error('Share report error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// PATCH /api/reports/:id/status  — admin only
// ────────────────────────────────────────────────────────────
const updateReportStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejection_note } = req.body;

    if (!status) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        'status is required.', { field: 'status' });
    }
    if (!isValidReportStatus(status)) {
      return sendError(res, 400, ERROR_CODES.INVALID_REPORT_STATUS,
        'Invalid status. Allowed values: Approved, Rejected.', { field: 'status' });
    }

    const existCheck = await pool.query('SELECT * FROM reports WHERE id = $1', [id]);
    if (existCheck.rows.length === 0) return Errors.reportNotFound(res);

    const report = existCheck.rows[0];
    if (report.status !== 'Pending') {
      return sendError(res, 400, ERROR_CODES.REPORT_ALREADY_REVIEWED,
        `This report has already been ${report.status.toLowerCase()}. Only Pending reports can be reviewed.`);
    }

    const result = await pool.query(
      `UPDATE reports
       SET status = $1, approved_by_user_id = $2, approved_at = NOW()
       WHERE id = $3
       RETURNING id, status, approved_by_user_id, approved_at`,
      [status, req.user.id, id]
    );

    const techUserRes = await pool.query(
      'SELECT t.user_id FROM technicians t JOIN reports r ON r.technician_id = t.id WHERE r.id = $1',
      [id]
    );
    if (techUserRes.rows[0]?.user_id) {
      await notify({
        event:       'report_reviewed',
        title:       `Report ${status}`,
        message:     `Your report ${id} was ${status.toLowerCase()} by admin`,
        entity_type: 'report',
        entity_id:   id,
        user_id:     techUserRes.rows[0].user_id,
      }, wsManager);
    }

    await logActivity({
      type:         'report',
      action:       `Report ${id} ${status.toLowerCase()} by admin`,
      entity_type:  'report',
      entity_id:    id,
      performed_by: req.user.id,
    });

    return res.status(200).json({
      success: true,
      message: `Report ${id} ${status.toLowerCase()} successfully.`,
      data:    result.rows[0],
    });

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

    const existCheck = await pool.query('SELECT id, status FROM reports WHERE id = $1', [id]);
    if (existCheck.rows.length === 0) return Errors.reportNotFound(res);

    const countCheck = await pool.query(
      'SELECT COUNT(*) FROM report_images WHERE report_id = $1', [id]
    );
    const current = parseInt(countCheck.rows[0].count);
    if (current + images.length > 20) {
      return sendError(res, 400, ERROR_CODES.TOO_MANY_IMAGES,
        `Cannot add ${images.length} image(s). Maximum 20 images per report (currently has ${current}).`);
    }

    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    for (const img of images) {
      if (!img.file_name || !img.file_url) {
        return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
          'Each image must have file_name and file_url.',
          { missing_fields: ['file_name', 'file_url'] });
      }
      if (img.mime_type && !allowed.includes(img.mime_type)) {
        return sendError(res, 400, ERROR_CODES.INVALID_FILE_TYPE,
          `Invalid file type "${img.mime_type}". Allowed: ${allowed.join(', ')}.`,
          { field: 'mime_type', allowed });
      }
    }

    const inserted = [];
    for (const img of images) {
      const r = await pool.query(
        `INSERT INTO report_images
           (report_id, file_name, file_url, mime_type, file_size_bytes, uploaded_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, report_id, file_name, file_url, mime_type, file_size_bytes, uploaded_at`,
        [id, img.file_name, img.file_url,
         img.mime_type || 'image/jpeg', img.file_size_bytes || null, req.user.id]
      );
      inserted.push(r.rows[0]);
    }

    return res.status(201).json({
      success: true,
      message: `${inserted.length} image(s) added to report ${id}.`,
      data:    inserted,
    });

  } catch (error) {
    console.error('Add report image error:', error);
    return Errors.internalError(res);
  }
};

module.exports = {
  getReports,
  createReport,
  getReportById,
  generateReportPdf,
  shareReport,
  updateReportStatus,
  addReportImage,
};