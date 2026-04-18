const express     = require('express');
const cors        = require('cors');
const path        = require('path');
const swaggerUi   = require('swagger-ui-express');
const swaggerSpec  = require('./config/swagger');
const { sendError } = require('./utils/AppError');
const ERROR_CODES   = require('./utils/errorCodes');

const authRoutes          = require('./routes/authRoutes');
const userRoutes          = require('./routes/userRoutes');
const technicianRoutes    = require('./routes/technicianRoutes');
const clientRoutes        = require('./routes/clientRoutes');
const jobRoutes           = require('./routes/jobRoutes');
const reportRoutes        = require('./routes/reportRoutes');
const amcRoutes           = require('./routes/amcRoutes');
const emailRoutes         = require('./routes/emailRoutes');
const uploadRoutes        = require('./routes/uploadRoutes');
const dashboardRoutes     = require('./routes/dashboardRoutes');
const notificationRoutes  = require('./routes/notificationRoutes');

const app = express();

// ─── Core Middleware ─────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Serve uploaded files as static assets ───────────────────
// Files are accessible at: GET /uploads/filename.jpg
const uploadsDir = path.join(process.cwd(), 'uploads');
app.use('/uploads', express.static(uploadsDir));

// ─── Swagger Docs ────────────────────────────────────────────
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  explorer: true,
  customSiteTitle: 'VDTI Service Hub API Docs',
}));

// ─── Routes ──────────────────────────────────────────────────
app.use('/api/auth',           authRoutes);
app.use('/api/users',          userRoutes);
app.use('/api/technicians',    technicianRoutes);
app.use('/api/clients',        clientRoutes);
app.use('/api/jobs',           jobRoutes);
app.use('/api/reports',        reportRoutes);
app.use('/api/amc',            amcRoutes);
app.use('/api/email-settings', emailRoutes);
app.use('/api/upload',         uploadRoutes);
app.use('/api/dashboard',      dashboardRoutes);
app.use('/api/notifications',  notificationRoutes);

// ─── Health Check ────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'VDTI Service Hub API is running',
    timestamp: new Date(),
  });
});

// ─── 404 Handler ─────────────────────────────────────────────
app.use((req, res) => {
  return sendError(res, 404, ERROR_CODES.ROUTE_NOT_FOUND,
    `The route ${req.method} ${req.originalUrl} does not exist.`);
});

// ─── Global Error Handler ─────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  if (err.isOperational) {
    return sendError(res, err.statusCode, err.errorCode, err.message, err.details);
  }
  return sendError(res, 500, ERROR_CODES.INTERNAL_SERVER_ERROR,
    'Something went wrong on our end. Please try again later.');
});

module.exports = app;