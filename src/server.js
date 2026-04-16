require('dotenv').config();
const app = require('./app');

// ─── Startup validation ───────────────────────────────────────
// Support both DATABASE_URL (Railway) or individual DB vars
const hasDbUrl = !!process.env.DATABASE_URL;
const hasIndividualVars = !!(process.env.DB_HOST && process.env.DB_NAME && process.env.DB_USER && process.env.DB_PASSWORD);

if (!hasDbUrl && !hasIndividualVars) {
  console.error('❌ No database configuration found!');
  console.error('Please set either DATABASE_URL or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD');
  process.exit(1);
}

if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET is missing!');
  process.exit(1);
}

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  if (hasDbUrl) {
    console.log(`🗄️  Database: connected via DATABASE_URL`);
  } else {
    console.log(`🗄️  Database: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
  }
  console.log(`📚 Swagger: https://vaccumapi-production.up.railway.app/api-docs`);
});

process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Rejection:', err.message);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err.message);
  process.exit(1);
});