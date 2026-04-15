const swaggerJsdoc = require('swagger-jsdoc');

const isProd = process.env.NODE_ENV === 'production';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Vaccum API',
      version: '1.0.0',
      description: `
## Vaccum REST API
Built with **Node.js + Express + PostgreSQL**

### Authentication
Use the **Authorize** button (top right) and enter your JWT token as:
\`Bearer YOUR_TOKEN_HERE\`

### Base URLs
- **Production:** https://vaccumapi-production.up.railway.app
- **Local:** http://localhost:3000
      `,
      contact: {
        name: 'Vaccum API Support',
      },
    },
    servers: [
      {
        url: 'https://vaccumapi-production.up.railway.app',
        description: '🚀 Production Server (Railway)',
      },
      {
        url: 'http://localhost:3000',
        description: '💻 Local Development Server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT token. Get it from /api/auth/login or /api/auth/register',
        },
      },
      schemas: {
        RegisterRequest: {
          type: 'object',
          required: ['email', 'first_name', 'last_name', 'phone_number', 'password', 'role'],
          properties: {
            email:        { type: 'string', format: 'email', example: 'john@example.com' },
            first_name:   { type: 'string', example: 'John' },
            last_name:    { type: 'string', example: 'Doe' },
            phone_number: { type: 'string', example: '+911234567890' },
            password:     { type: 'string', minLength: 6, example: 'password123' },
            role: {
              type: 'string',
              enum: ['admin', 'engineer', 'labour', 'manager'],
              example: 'engineer',
            },
          },
        },
        LoginRequest: {
          type: 'object',
          required: ['password'],
          properties: {
            email:        { type: 'string', format: 'email', example: 'john@example.com' },
            phone_number: { type: 'string', example: '+911234567890' },
            password:     { type: 'string', example: 'password123' },
          },
        },
        UserResponse: {
          type: 'object',
          properties: {
            id:           { type: 'integer', example: 1 },
            email:        { type: 'string', example: 'john@example.com' },
            first_name:   { type: 'string', example: 'John' },
            last_name:    { type: 'string', example: 'Doe' },
            phone_number: { type: 'string', example: '+911234567890' },
            role:         { type: 'string', enum: ['admin', 'engineer', 'labour', 'manager'], example: 'engineer' },
            is_active:    { type: 'boolean', example: true },
            created_at:   { type: 'string', format: 'date-time' },
            updated_at:   { type: 'string', format: 'date-time' },
          },
        },
        AuthResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Welcome back, John!' },
            token:   { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
            user:    { $ref: '#/components/schemas/UserResponse' },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success:    { type: 'boolean', example: false },
            error_code: { type: 'string', example: 'INVALID_CREDENTIALS' },
            message:    { type: 'string', example: 'Incorrect email/phone or password. Please try again.' },
            details:    { type: 'object', example: { field: 'email' }, nullable: true },
          },
        },
        ForgotPasswordRequest: {
          type: 'object',
          required: ['email'],
          properties: {
            email: { type: 'string', format: 'email', example: 'john@example.com' },
          },
        },
        ResetPasswordRequest: {
          type: 'object',
          required: ['token', 'new_password', 'confirm_password'],
          properties: {
            token:            { type: 'string', example: 'a3f5c9e2b1d4...' },
            new_password:     { type: 'string', minLength: 6, example: 'newSecurePass123' },
            confirm_password: { type: 'string', example: 'newSecurePass123' },
          },
        },
        PaginatedUsersResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: { type: 'array', items: { $ref: '#/components/schemas/UserResponse' } },
            pagination: {
              type: 'object',
              properties: {
                total:       { type: 'integer', example: 50 },
                page:        { type: 'integer', example: 1 },
                limit:       { type: 'integer', example: 10 },
                total_pages: { type: 'integer', example: 5 },
              },
            },
          },
        },
      },
    },
  },
  apis: ['./src/routes/*.js'],
};

const swaggerSpec = swaggerJsdoc(options);
module.exports = swaggerSpec;