const express    = require('express');
const cors       = require('cors');
const swaggerUi  = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const { sendError } = require('./utils/AppError');
const ERROR_CODES   = require('./utils/errorCodes');

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');

const app = express();

// ─── Core Middleware ─────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Swagger Docs ────────────────────────────────────────────
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  explorer: true,
  customSiteTitle: 'Project API Docs',
}));

// ─── Routes ──────────────────────────────────────────────────
app.use('/api/auth',  authRoutes);
app.use('/api/users', userRoutes);

// ─── Health Check ────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({ success: true, message: 'Server is running', timestamp: new Date() });
});

// ─── 404 Handler ─────────────────────────────────────────────
app.use((req, res) => {
  return sendError(res, 404, 'ROUTE_NOT_FOUND',
    `The route ${req.method} ${req.originalUrl} does not exist.`);
});

// ─── Global Error Handler ─────────────────────────────────────
// Catches any unhandled errors thrown across the app
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);

  // If it's our own AppError, use its status + code
  if (err.isOperational) {
    return sendError(res, err.statusCode, err.errorCode, err.message, err.details);
  }

  // Unexpected/unknown errors
  return sendError(res, 500, ERROR_CODES.INTERNAL_SERVER_ERROR,
    'Something went wrong on our end. Please try again later.');
});

module.exports = app;