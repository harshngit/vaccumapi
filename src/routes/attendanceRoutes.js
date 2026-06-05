// ============================================================
// src/routes/attendanceRoutes.js
// ============================================================

const express = require('express');
const router  = express.Router();
const {
  viewEmployeeFromPeople,
  storeEmployee,
  editEmployee,
  setEmployeeSalary,
  getAllStoredEmployees,
  getStoredEmployee,
  fetchAttendanceByDate,
} = require('../controllers/attendanceController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.use(protect);

/**
 * @swagger
 * tags:
 *   name: Attendance
 *   description: Employee management via RazorpayX People API
 */

// ── Static paths first (must come before /:employee_id) ──────

/**
 * @swagger
 * /api/attendance/people/view/{employee_id}:
 *   get:
 *     summary: Live fetch employee from RazorpayX (no DB write)
 *     description: |
 *       Calls `https://payroll.razorpay.com/api/people` with
 *       `sub-type: view`. Returns raw RazorpayX response.
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: employee_id
 *         required: true
 *         schema: { type: integer, example: 1 }
 *       - in: query
 *         name: employee_type
 *         schema: { type: string, default: "employee" }
 *     responses:
 *       200: { description: Employee details from RazorpayX }
 *       400: { description: Invalid employee_id }
 *       502: { description: RazorpayX API error }
 */
/**
 * @swagger
 * /api/attendance/fetch:
 *   get:
 *     summary: Fetch attendance for a specific date from RazorpayX
 *     description: |
 *       Calls `https://payroll.razorpay.com/api/att` with `sub-type: fetch`.
 *       Returns the attendance record for the given employee email and date.
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: email
 *         required: true
 *         schema: { type: string, example: "rbaikar06@gmail.com" }
 *         description: Employee email address
 *       - in: query
 *         name: date
 *         required: true
 *         schema: { type: string, example: "2020-12-15" }
 *         description: Date in YYYY-MM-DD format
 *       - in: query
 *         name: employee_type
 *         schema: { type: string, default: "employee", example: "employee" }
 *         description: RazorpayX employee type
 *     responses:
 *       200:
 *         description: Attendance record for the given date
 *       400:
 *         description: Missing or invalid email / date
 *       502:
 *         description: RazorpayX API error
 */
router.get('/fetch', authorize('admin', 'manager'), fetchAttendanceByDate);

router.get('/people/view/:employee_id', authorize('admin'), viewEmployeeFromPeople);

/**
 * @swagger
 * /api/attendance/people:
 *   post:
 *     summary: Store employee from request body into local DB
 *     description: |
 *       Saves the employee into `razorpayx_employees`.
 *       Rejects with **409** if another employee already has the same
 *       email or phone number.
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [employee_id, employee]
 *             properties:
 *               employee_id: { type: string, example: "1" }
 *               employee:
 *                 type: object
 *                 properties:
 *                   name:                { type: string,  example: "Rushikesh Laxman Baikar" }
 *                   email:               { type: string,  example: "rbaikar06@gmail.com" }
 *                   phone_number:        { type: string,  example: "+917028638687" }
 *                   date-of-birth:       { type: string,  example: "27/09/1998" }
 *                   date-of-hiring:      { type: string,  example: "11/05/2026" }
 *                   title:               { type: string,  example: "Accounts Executives" }
 *                   department:          { type: string,  example: "Accounts" }
 *                   manager-employee-id: { type: string,  example: "17" }
 *                   manager-email:       { type: string,  example: "office@example.com" }
 *                   pan:                 { type: string,  example: "CQDPB7079R" }
 *                   bank-ifsc:           { type: string,  example: "HDFC0002869" }
 *                   bank-account-number: { type: string,  example: "50100459550683" }
 *                   is_active:           { type: boolean, example: true }
 *           example:
 *             employee_id: "1"
 *             employee:
 *               name: "Rushikesh Laxman Baikar"
 *               email: "rbaikar06@gmail.com"
 *               phone_number: "+917028638687"
 *               date-of-birth: "27/09/1998"
 *               date-of-hiring: "11/05/2026"
 *               title: "Accounts Executives"
 *               department: "Accounts"
 *               manager-employee-id: "17"
 *               manager-email: "office@electromechengineering.com"
 *               pan: "CQDPB7079R"
 *               bank-ifsc: "HDFC0002869"
 *               bank-account-number: "50100459550683"
 *               is_active: true
 *     responses:
 *       200: { description: Employee stored successfully }
 *       400: { description: Missing employee_id or employee object }
 *       409: { description: Duplicate email or phone number }
 */
router.post('/people', authorize('admin'), storeEmployee);

/**
 * @swagger
 * /api/attendance/people:
 *   get:
 *     summary: List all stored employees from local DB
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Array of all employees }
 */
router.get('/people', authorize('admin', 'manager'), getAllStoredEmployees);

// ── Parameterised paths ───────────────────────────────────────

/**
 * @swagger
 * /api/attendance/people/{employee_id}:
 *   get:
 *     summary: Get a single stored employee from local DB
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: employee_id
 *         required: true
 *         schema: { type: string, example: "1" }
 *     responses:
 *       200: { description: Employee record }
 *       404: { description: Not found — store first via POST /api/attendance/people }
 */
router.get('/people/:employee_id', authorize('admin', 'manager'), getStoredEmployee);

/**
 * @swagger
 * /api/attendance/people/{employee_id}:
 *   put:
 *     summary: Edit employee in RazorpayX and update local DB
 *     description: |
 *       Calls `https://payroll.razorpay.com/api/people` with `sub-type: edit`
 *       and mirrors the changed fields into the local `razorpayx_employees` table.
 *       Send only the fields you want to update.
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: employee_id
 *         required: true
 *         schema: { type: integer, example: 3 }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:                   { type: string, example: "varun@example.com" }
 *               title:                   { type: string, example: "Senior Recruiter" }
 *               department:              { type: string, example: "Human Resources" }
 *               manager-employee-id:     { type: integer, example: 127 }
 *               manager-employee-type:   { type: string, example: "contractor" }
 *               bank-ifsc:               { type: string, example: "CORP0002106" }
 *               bank-account-number:     { type: string, example: "1234567890" }
 *               pan:                     { type: string, example: "AGCPJ0387P" }
 *               phone-number:            { type: string, example: "9810012345" }
 *               hiring-date:             { type: string, example: "2020-01-01" }
 *               state:                   { type: string, example: "karnataka" }
 *               pt-enabled:              { type: boolean, example: true }
 *               pastSalary:              { type: number, example: 0 }
 *               pastExemption:           { type: number, example: 0 }
 *               pastTds:                 { type: number, example: 0 }
 *               previousEmployerSalary:  { type: number, example: 0 }
 *               previousEmployerTds:     { type: number, example: 0 }
 *     responses:
 *       200: { description: Employee updated in RazorpayX and local DB }
 *       400: { description: Invalid employee_id }
 *       502: { description: RazorpayX API error }
 */
router.put('/people/:employee_id', authorize('admin'), editEmployee);

/**
 * @swagger
 * /api/attendance/people/{employee_id}/salary:
 *   post:
 *     summary: Set employee salary in RazorpayX and store in local DB
 *     description: |
 *       Calls `https://payroll.razorpay.com/api/people` with `sub-type: set-salary`
 *       and saves `annual_ctc` and `custom_salary_structure` into the local DB.
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: employee_id
 *         required: true
 *         schema: { type: integer, example: 3 }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [annual-ctc]
 *             properties:
 *               annual-ctc:
 *                 type: number
 *                 example: 600000
 *               custom-salary-structure:
 *                 type: boolean
 *                 example: false
 *           example:
 *             annual-ctc: 600000
 *             custom-salary-structure: false
 *     responses:
 *       200: { description: Salary set in RazorpayX and updated in local DB }
 *       400: { description: Missing annual-ctc or invalid employee_id }
 *       502: { description: RazorpayX API error }
 */
router.post('/people/:employee_id/salary', authorize('admin'), setEmployeeSalary);

module.exports = router;
