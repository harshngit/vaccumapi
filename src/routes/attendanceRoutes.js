// ============================================================
// src/routes/attendanceRoutes.js
// ============================================================

const express = require('express');
const router  = express.Router();
const {
  syncEmployees,
  fetchEmployeesFromRazorpayX,
  setEmployeeRazorpayId,
  syncAttendance,
  getAttendance,
  getAttendanceSummary,
  getEmployeesWithAttendanceSummary,
  getEmployeeList,
  markAttendance,
} = require('../controllers/attendanceController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.use(protect);

/**
 * @swagger
 * tags:
 *   name: Attendance
 *   description: Attendance management via RazorpayX Payroll API
 */

// ────────────────────────────────────────────────────────────
// STEP 1 — Sync local employees into cache table
// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/attendance/employees/sync:
 *   get:
 *     summary: "STEP 1 — Sync technicians into attendance employee cache"
 *     description: |
 *       Pulls all technicians from your local DB into `razorpayx_employees` table.
 *       After this, use **PATCH /api/attendance/employees/:id** to assign each
 *       employee their RazorpayX Employee ID (found in RazorpayX → My Profile).
 *
 *       **Console output:**
 *       - `[Attendance] Syncing employee list from local DB...`
 *       - `[Attendance] Employee sync complete. Synced: N technicians`
 *       - `[Attendance] ⚠️  Set RazorpayX Employee IDs via PATCH /api/attendance/employees/:id`
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Employees cached successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AttendanceSyncEmployeesResponse'
 */
router.get('/employees/sync', authorize('admin'), syncEmployees);

/**
 * @swagger
 * /api/attendance/employees/fetch-from-razorpayx:
 *   get:
 *     summary: Fetch employee list directly from RazorpayX and cache locally
 *     description: |
 *       Calls RazorpayX `employee/list` with the given payroll month.
 *       RazorpayX requires a payroll month even for the employee list.
 *       Employees are upserted into the local cache — ready for attendance sync.
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: payroll_month
 *         required: true
 *         schema: { type: string, example: "2025-06" }
 *         description: "Month in YYYY-MM format"
 *     responses:
 *       200:
 *         description: Employees fetched and cached
 *       400:
 *         description: Missing or invalid payroll_month
 *       502:
 *         description: RazorpayX API error
 */
router.get('/employees/fetch-from-razorpayx', authorize('admin'), fetchEmployeesFromRazorpayX);

/**
 * @swagger
 * /api/attendance/employees/with-summary:
 *   get:
 *     summary: All employees with their attendance summary
 *     description: |
 *       Returns every employee from the cache joined with their attendance
 *       totals. Filter by `payroll_month` (YYYY-MM) or `from_date`/`to_date`.
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: payroll_month
 *         schema: { type: string, example: "2025-06" }
 *         description: Shorthand — expands to first/last day of the month
 *       - in: query
 *         name: from_date
 *         schema: { type: string, format: date, example: "2025-06-01" }
 *       - in: query
 *         name: to_date
 *         schema: { type: string, format: date, example: "2025-06-30" }
 *     responses:
 *       200:
 *         description: Employee list with attendance totals
 */
router.get('/employees/with-summary', authorize('admin', 'manager'), getEmployeesWithAttendanceSummary);


/**
 * @swagger
 * /api/attendance/employees/list:
 *   get:
 *     summary: List all cached employees and their RazorpayX ID status
 *     description: |
 *       Returns cached employees. The `razorpayx_id_set` field tells you
 *       which employees still need their RazorpayX ID assigned.
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Employee list
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AttendanceEmployeeListResponse'
 */
router.get('/employees/list', authorize('admin', 'manager'), getEmployeeList);

/**
 * @swagger
 * /api/attendance/employees/{id}:
 *   patch:
 *     summary: "STEP 2 — Assign RazorpayX Employee ID to a cached employee"
 *     description: |
 *       Set the RazorpayX Employee ID for an employee. Find each employee's ID
 *       in **RazorpayX → My Profile** section.
 *       This must be done before attendance sync will work for that employee.
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: The local DB row ID (from /employees/list)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [razorpayx_employee_id]
 *             properties:
 *               razorpayx_employee_id:
 *                 type: string
 *                 example: "12345"
 *                 description: The numeric employee ID from RazorpayX Payroll
 *     responses:
 *       200:
 *         description: RazorpayX ID updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessMessageResponse'
 *       404:
 *         description: Employee not found
 *       409:
 *         description: RazorpayX ID already assigned to another employee
 */
router.patch('/employees/:id', authorize('admin'), setEmployeeRazorpayId);

// ────────────────────────────────────────────────────────────
// STEP 3 — Sync attendance from RazorpayX
// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/attendance/sync:
 *   post:
 *     summary: "STEP 3 — Pull attendance from RazorpayX for a payroll month"
 *     description: |
 *       Fetches payroll/attendance data from RazorpayX for all employees
 *       that have a RazorpayX ID set, and saves records to the local DB.
 *
 *       **Console output:**
 *       - `[Attendance] Syncing payroll for N employees — month: 2025-06`
 *       - `[Attendance] ✅ Rushikesh Baikar (12345) — synced`
 *       - `[Attendance] Sync done. Records: N, Errors: 0`
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AttendanceSyncRequest'
 *           example:
 *             payroll_month: "2025-06"
 *     responses:
 *       200:
 *         description: Attendance synced
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AttendanceSyncResponse'
 *       400:
 *         description: Missing payroll_month or no employees have RazorpayX IDs set
 *       502:
 *         description: RazorpayX API error
 */
router.post('/sync', authorize('admin'), syncAttendance);

// ────────────────────────────────────────────────────────────
// QUERY & MANUAL
// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/attendance:
 *   get:
 *     summary: Get attendance records from local DB
 *     description: Paginated attendance records with optional filters.
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from_date
 *         schema: { type: string, format: date, example: "2025-06-01" }
 *       - in: query
 *         name: to_date
 *         schema: { type: string, format: date, example: "2025-06-30" }
 *       - in: query
 *         name: employee_id
 *         schema: { type: string, example: "12345" }
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [present, absent, half_day, on_leave, holiday]
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200:
 *         description: Attendance records
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AttendanceListResponse'
 */
router.get('/', authorize('admin', 'manager'), getAttendance);

/**
 * @swagger
 * /api/attendance/summary:
 *   get:
 *     summary: Per-employee attendance summary (present/absent/hours)
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from_date
 *         schema: { type: string, format: date, example: "2025-06-01" }
 *       - in: query
 *         name: to_date
 *         schema: { type: string, format: date, example: "2025-06-30" }
 *     responses:
 *       200:
 *         description: Summary per employee
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AttendanceSummaryResponse'
 */
router.get('/summary', authorize('admin', 'manager'), getAttendanceSummary);

/**
 * @swagger
 * /api/attendance/mark:
 *   post:
 *     summary: Manually mark or override attendance for an employee
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AttendanceMarkRequest'
 *           example:
 *             employee_id: "12345"
 *             date: "2025-06-15"
 *             check_in: "2025-06-15T09:00:00.000Z"
 *             check_out: "2025-06-15T18:00:00.000Z"
 *             status: "present"
 *     responses:
 *       200:
 *         description: Attendance marked
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AttendanceMarkResponse'
 */
router.post('/mark', authorize('admin', 'manager'), markAttendance);

module.exports = router;