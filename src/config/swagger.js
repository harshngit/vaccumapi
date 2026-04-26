const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'VDTI Service Hub API',
      version: '1.0.0',
      description: `
## VDTI Service Hub REST API
Built with **Node.js + Express + PostgreSQL**

### Authentication
Use the **Authorize** button (top right) and enter your JWT token as:
\`Bearer YOUR_TOKEN_HERE\`

### File Uploads
1. **POST /api/upload** — Upload image(s) → get back public \`file_url\`
2. Use that \`file_url\` in **POST /api/jobs/:id/images** or **POST /api/reports/:id/images**

### Base URLs
- **Production:** https://vaccumapi-production.up.railway.app
- **Local:** http://localhost:3000
      `,
    },
    servers: [
      { url: 'https://vaccumapi.onrender.com/', description: '🚀 Production (Render)' },
      { url: 'http://localhost:3000',                        description: '💻 Local Dev' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {

        // ── Auth ──────────────────────────────────────────────
        RegisterRequest: {
          type: 'object', required: ['first_name', 'last_name', 'password', 'role'],
          properties: {
            first_name: { type: 'string', example: 'John' },
            last_name:  { type: 'string', example: 'Doe' },
            email:      { type: 'string', format: 'email', example: 'john@example.com' },
            phone_number: { type: 'string', example: '+911234567890' },
            password:   { type: 'string', minLength: 6, example: 'password123' },
            role:       { type: 'string', enum: ['admin','manager','engineer','technician','labour'] },
          },
        },
        LoginRequest: {
          type: 'object', required: ['password'],
          properties: {
            email:        { type: 'string', format: 'email', example: 'john@example.com' },
            phone_number: { type: 'string', example: '+911234567890' },
            password:     { type: 'string', example: 'password123' },
          },
        },

        // ── User ──────────────────────────────────────────────
        UserResponse: {
          type: 'object',
          properties: {
            id: { type: 'integer' }, first_name: { type: 'string' }, last_name: { type: 'string' },
            email: { type: 'string', nullable: true }, phone_number: { type: 'string', nullable: true },
            role: { type: 'string', enum: ['admin','manager','engineer','technician','labour'] },
            is_active: { type: 'boolean' }, last_login_at: { type: 'string', format: 'date-time', nullable: true },
            created_at: { type: 'string', format: 'date-time' }, updated_at: { type: 'string', format: 'date-time' },
          },
        },
        CreateUserRequest: {
          type: 'object', required: ['first_name', 'last_name', 'password', 'role'],
          properties: {
            first_name: { type: 'string', example: 'Priya' }, last_name: { type: 'string', example: 'Sharma' },
            email: { type: 'string', format: 'email', example: 'priya@vdti.com' },
            phone_number: { type: 'string', example: '+919123456789' },
            password: { type: 'string', minLength: 6, example: 'initialPass123' },
            role: { type: 'string', enum: ['admin','manager','engineer','technician','labour'], example: 'manager' },
            is_active: { type: 'boolean', default: true },
          },
        },
        UpdateUserRequest: {
          type: 'object',
          properties: {
            first_name: { type: 'string' }, last_name: { type: 'string' },
            phone_number: { type: 'string' },
            role: { type: 'string', enum: ['admin','manager','engineer','technician','labour'], description: 'Admin only' },
            is_active: { type: 'boolean', description: 'Admin only' },
          },
        },
        AuthResponse: {
          type: 'object',
          properties: { success: { type: 'boolean' }, message: { type: 'string' }, token: { type: 'string' }, user: { $ref: '#/components/schemas/UserResponse' } },
        },
        PaginatedUsersResponse: {
          type: 'object',
          properties: { success: { type: 'boolean' }, data: { type: 'array', items: { $ref: '#/components/schemas/UserResponse' } }, pagination: { $ref: '#/components/schemas/Pagination' } },
        },

        // ── Technician ────────────────────────────────────────
        TechnicianResponse: {
          type: 'object',
          properties: {
            id: { type: 'integer' }, user_id: { type: 'integer', nullable: true },
            name: { type: 'string', example: 'Ravi Kumar' }, email: { type: 'string', nullable: true },
            phone: { type: 'string' }, specialization: { type: 'string', example: 'HVAC' },
            status: { type: 'string', enum: ['Active','On Leave','Inactive'] },
            join_date: { type: 'string', format: 'date', nullable: true, example: '2022-03-15' },
            jobs_completed: { type: 'integer' }, rating: { type: 'number' }, avatar: { type: 'string', example: 'RK' },
            created_at: { type: 'string', format: 'date-time' }, updated_at: { type: 'string', format: 'date-time' },
          },
        },
        CreateTechnicianRequest: {
          type: 'object', required: ['name', 'phone', 'specialization'],
          properties: {
            name: { type: 'string', example: 'Ravi Kumar' }, email: { type: 'string', format: 'email' },
            phone: { type: 'string', example: '9876543210' }, specialization: { type: 'string', example: 'HVAC' },
            status: { type: 'string', enum: ['Active','On Leave','Inactive'], default: 'Active' },
            join_date: { type: 'string', format: 'date', example: '2024-01-20' },
            password: { type: 'string', minLength: 6, description: 'Optional. Creates login account if provided.' },
          },
        },
        UpdateTechnicianRequest: {
          type: 'object',
          properties: {
            name: { type: 'string' }, email: { type: 'string', format: 'email' }, phone: { type: 'string' },
            specialization: { type: 'string' }, status: { type: 'string', enum: ['Active','On Leave','Inactive'] },
            join_date: { type: 'string', format: 'date', example: '2022-03-15' },
          },
        },
        PaginatedTechniciansResponse: {
          type: 'object',
          properties: { success: { type: 'boolean' }, data: { type: 'array', items: { $ref: '#/components/schemas/TechnicianResponse' } }, pagination: { $ref: '#/components/schemas/Pagination' } },
        },

        // ── Client ────────────────────────────────────────────
        ClientResponse: {
          type: 'object',
          properties: {
            id: { type: 'integer' }, name: { type: 'string' }, contact_person: { type: 'string' },
            email: { type: 'string', nullable: true }, phone: { type: 'string', nullable: true },
            gst_no: { type: 'string', nullable: true }, address: { type: 'string', nullable: true },
            type: { type: 'string', enum: ['Corporate','Residential','Commercial','Healthcare','Government'] },
            status: { type: 'string', enum: ['Active','Inactive'] },
            contract_value: { type: 'number' }, join_date: { type: 'string', format: 'date', nullable: true },
            created_at: { type: 'string', format: 'date-time' }, updated_at: { type: 'string', format: 'date-time' },
          },
        },
        CreateClientRequest: {
          type: 'object', required: ['name', 'contact_person'],
          properties: {
            name: { type: 'string', example: 'Rainbow Tech Park' }, contact_person: { type: 'string', example: 'Sunita Menon' },
            email: { type: 'string', format: 'email' }, phone: { type: 'string' },
            gst_no: { type: 'string', example: '27AAACG1234A1Z5' }, address: { type: 'string' },
            type: { type: 'string', enum: ['Corporate','Residential','Commercial','Healthcare','Government'], default: 'Corporate' },
            status: { type: 'string', enum: ['Active','Inactive'], default: 'Active' },
            contract_value: { type: 'number', example: 250000 },
          },
        },
        UpdateClientRequest: {
          type: 'object',
          properties: {
            name: { type: 'string' }, contact_person: { type: 'string' }, email: { type: 'string', format: 'email' },
            phone: { type: 'string' }, gst_no: { type: 'string' }, address: { type: 'string' },
            type: { type: 'string', enum: ['Corporate','Residential','Commercial','Healthcare','Government'] },
            status: { type: 'string', enum: ['Active','Inactive'] }, contract_value: { type: 'number' },
          },
        },
        PaginatedClientsResponse: {
          type: 'object',
          properties: { success: { type: 'boolean' }, data: { type: 'array', items: { $ref: '#/components/schemas/ClientResponse' } }, pagination: { $ref: '#/components/schemas/Pagination' } },
        },

        // ── Job ───────────────────────────────────────────────
        JobResponse: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'JOB-0001' }, title: { type: 'string' }, description: { type: 'string', nullable: true },
            client_id: { type: 'integer' }, client_name: { type: 'string' },
            technician_id: { type: 'integer', nullable: true }, technician_name: { type: 'string', nullable: true },
            status: { type: 'string', enum: ['Raised','Assigned','In Progress','Closed'] },
            priority: { type: 'string', enum: ['Low','Medium','High','Critical'] },
            category: { type: 'string', enum: ['Maintenance','Repair','Installation','Inspection'] },
            amount: { type: 'number' }, raised_date: { type: 'string', format: 'date' },
            scheduled_date: { type: 'string', format: 'date', nullable: true },
            closed_date: { type: 'string', format: 'date', nullable: true },
            image_count: { type: 'integer' }, created_at: { type: 'string', format: 'date-time' }, updated_at: { type: 'string', format: 'date-time' },
          },
        },
        CreateJobRequest: {
          type: 'object', required: ['title', 'client_id'],
          properties: {
            title: { type: 'string', example: 'Generator Annual Maintenance' },
            description: { type: 'string', example: 'Full generator service and load testing.' },
            client_id: { type: 'integer', example: 1 },
            technician_id: { type: 'integer', example: 1, description: 'Optional. Auto-sets status to Assigned.' },
            priority: { type: 'string', enum: ['Low','Medium','High','Critical'], default: 'Medium' },
            category: { type: 'string', enum: ['Maintenance','Repair','Installation','Inspection'], default: 'Maintenance' },
            scheduled_date: { type: 'string', format: 'date', example: '2024-02-01' },
            amount: { type: 'number', example: 15000 },
          },
        },
        UpdateJobRequest: {
          type: 'object',
          properties: {
            title: { type: 'string' }, description: { type: 'string' }, technician_id: { type: 'integer' },
            priority: { type: 'string', enum: ['Low','Medium','High','Critical'] },
            category: { type: 'string', enum: ['Maintenance','Repair','Installation','Inspection'] },
            scheduled_date: { type: 'string', format: 'date' }, amount: { type: 'number' },
          },
        },
        UpdateJobStatusRequest: {
          type: 'object', required: ['status'],
          properties: { status: { type: 'string', enum: ['Assigned','In Progress','Closed'], example: 'In Progress', description: 'Raised→Assigned→In Progress→Closed' } },
        },
        PaginatedJobsResponse: {
          type: 'object',
          properties: { success: { type: 'boolean' }, data: { type: 'array', items: { $ref: '#/components/schemas/JobResponse' } }, pagination: { $ref: '#/components/schemas/Pagination' } },
        },

        // ── Report ────────────────────────────────────────────
        ReportResponse: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'RPT-0001' }, job_id: { type: 'string' }, job_title: { type: 'string' }, client_name: { type: 'string' },
            title: { type: 'string' }, findings: { type: 'string', nullable: true }, recommendations: { type: 'string', nullable: true },
            status: { type: 'string', enum: ['Pending','Approved','Rejected'] },
            technician_id: { type: 'integer' }, technician_name: { type: 'string' },
            approved_by_user_id: { type: 'integer', nullable: true }, approved_at: { type: 'string', format: 'date-time', nullable: true },
            report_date: { type: 'string', format: 'date' }, image_count: { type: 'integer' },
            created_at: { type: 'string', format: 'date-time' }, updated_at: { type: 'string', format: 'date-time' },
          },
        },
        CreateReportRequest: {
          type: 'object', required: ['job_id', 'title', 'technician_id'],
          properties: {
            job_id: { type: 'string', example: 'JOB-0001' },
            title: { type: 'string', example: 'HVAC Servicing Report' },
            findings: { type: 'string', example: 'All units cleaned. Replaced 3 filters.' },
            recommendations: { type: 'string', example: 'Next service due in 6 months.' },
            technician_id: { type: 'integer', example: 1 },
          },
        },
        UpdateReportStatusRequest: {
          type: 'object', required: ['status'],
          properties: {
            status: { type: 'string', enum: ['Approved','Rejected'], example: 'Approved' },
            rejection_note: { type: 'string', description: 'Optional note when rejecting.' },
          },
        },
        PaginatedReportsResponse: {
          type: 'object',
          properties: { success: { type: 'boolean' }, data: { type: 'array', items: { $ref: '#/components/schemas/ReportResponse' } }, pagination: { $ref: '#/components/schemas/Pagination' } },
        },

        // ── AMC ───────────────────────────────────────────────
        AmcResponse: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'AMC-0001' },
            client_id: { type: 'integer', example: 1 }, client_name: { type: 'string', example: 'TechCorp Solutions' },
            title: { type: 'string', example: 'HVAC AMC - TechCorp' },
            start_date: { type: 'string', format: 'date', example: '2024-01-01' },
            end_date: { type: 'string', format: 'date', example: '2024-12-31' },
            value: { type: 'number', example: 450000 },
            status: { type: 'string', enum: ['Active','Expiring Soon','Expired'] },
            next_service_date: { type: 'string', format: 'date', nullable: true },
            renewal_reminder_days: { type: 'integer', example: 30 },
            days_left: { type: 'integer', example: 250, description: 'Computed: end_date - today. Negative if expired.' },
            services: { type: 'array', items: { type: 'string' }, example: ['HVAC Servicing', 'Filter Replacement', 'Emergency Support'] },
            created_at: { type: 'string', format: 'date-time' }, updated_at: { type: 'string', format: 'date-time' },
          },
        },
        AmcExpiringResponse: {
          type: 'object',
          properties: {
            id: { type: 'string' }, client_id: { type: 'integer' }, client_name: { type: 'string' },
            client_email: { type: 'string', nullable: true }, contact_person: { type: 'string' },
            title: { type: 'string' }, end_date: { type: 'string', format: 'date' },
            renewal_reminder_days: { type: 'integer' }, days_left: { type: 'integer' },
          },
        },
        CreateAmcRequest: {
          type: 'object', required: ['client_id', 'title', 'start_date', 'end_date', 'value'],
          properties: {
            client_id: { type: 'integer', example: 1 },
            title: { type: 'string', example: 'HVAC AMC - TechCorp' },
            start_date: { type: 'string', format: 'date', example: '2024-01-01' },
            end_date: { type: 'string', format: 'date', example: '2024-12-31' },
            value: { type: 'number', example: 450000 },
            next_service_date: { type: 'string', format: 'date', example: '2024-04-01' },
            renewal_reminder_days: { type: 'integer', default: 30, example: 30 },
            services: { type: 'array', items: { type: 'string' }, example: ['HVAC Servicing', 'Filter Replacement', 'Emergency Support'] },
          },
        },
        UpdateAmcRequest: {
          type: 'object', description: 'All fields optional.',
          properties: {
            title: { type: 'string' }, end_date: { type: 'string', format: 'date' },
            value: { type: 'number' }, next_service_date: { type: 'string', format: 'date' },
            renewal_reminder_days: { type: 'integer' },
            services: { type: 'array', items: { type: 'string' }, description: 'Replaces entire services list if provided.' },
          },
        },
        PaginatedAmcResponse: {
          type: 'object',
          properties: { success: { type: 'boolean' }, data: { type: 'array', items: { $ref: '#/components/schemas/AmcResponse' } }, pagination: { $ref: '#/components/schemas/Pagination' } },
        },

        // ── Email Settings ────────────────────────────────────
        EmailSettingsResponse: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            smtp_host: { type: 'string', example: 'smtp.gmail.com' },
            smtp_port: { type: 'integer', example: 587 },
            from_email: { type: 'string', example: 'notifications@vdti.com' },
            from_name: { type: 'string', example: 'VDTI Service Hub' },
            is_active: { type: 'boolean' },
            updated_at: { type: 'string', format: 'date-time' },
            notifications: {
              type: 'object',
              properties: {
                job_raised:      { type: 'boolean', example: true },
                job_assigned:    { type: 'boolean', example: true },
                job_completed:   { type: 'boolean', example: true },
                report_approved: { type: 'boolean', example: false },
                amc_renewal:     { type: 'boolean', example: true },
                quotation_sent:  { type: 'boolean', example: false },
              },
            },
          },
        },
        UpsertEmailSettingsRequest: {
          type: 'object', required: ['from_email'],
          properties: {
            smtp_host:     { type: 'string', example: 'smtp.gmail.com' },
            smtp_port:     { type: 'integer', example: 587 },
            from_email:    { type: 'string', format: 'email', example: 'notifications@vdti.com' },
            from_name:     { type: 'string', example: 'VDTI Service Hub' },
            smtp_password: { type: 'string', example: 'app-specific-password-here', description: 'SMTP password. If omitted on update, existing password is kept.' },
            notifications: {
              type: 'object',
              description: 'Map of trigger keys to booleans.',
              example: {
                job_raised: true, job_assigned: true,
                job_completed: true, report_approved: false,
                amc_renewal: true, quotation_sent: false,
              },
            },
          },
        },

        // ── Upload ────────────────────────────────────────────
        UploadResponse: {
          type: 'object',
          properties: {
            id:              { type: 'integer', example: 1 },
            original_name:   { type: 'string', example: 'site_before.jpg' },
            stored_name:     { type: 'string', example: '1714012345678_site_before.jpg' },
            file_url:        { type: 'string', example: 'https://vaccumapi-production.up.railway.app/uploads/1714012345678_site_before.jpg' },
            mime_type:       { type: 'string', example: 'image/jpeg' },
            file_size_bytes: { type: 'integer', example: 204800 },
            entity_type:     { type: 'string', nullable: true, example: 'job' },
            entity_id:       { type: 'string', nullable: true, example: 'JOB-0001' },
            uploaded_at:     { type: 'string', format: 'date-time' },
          },
        },

        // ── Images (shared) ───────────────────────────────────
        AddImageRequest: {
          description: 'Single image object or array of image objects.',
          oneOf: [
            { $ref: '#/components/schemas/ImageUploadItem' },
            { type: 'array', items: { $ref: '#/components/schemas/ImageUploadItem' } },
          ],
        },
        ImageUploadItem: {
          type: 'object', required: ['file_name', 'file_url'],
          properties: {
            file_name:       { type: 'string', example: 'site_before.jpg' },
            file_url:        { type: 'string', example: 'https://vaccumapi-production.up.railway.app/uploads/1714012345678_site_before.jpg' },
            mime_type:       { type: 'string', enum: ['image/jpeg','image/png','image/webp'], default: 'image/jpeg' },
            file_size_bytes: { type: 'integer', example: 204800 },
          },
        },
        ImageResponse: {
          type: 'object',
          properties: {
            id: { type: 'integer' }, file_name: { type: 'string' }, file_url: { type: 'string' },
            mime_type: { type: 'string' }, file_size_bytes: { type: 'integer', nullable: true },
            uploaded_at: { type: 'string', format: 'date-time' },
          },
        },

        // ── Shared ────────────────────────────────────────────
        Pagination: {
          type: 'object',
          properties: {
            total: { type: 'integer' }, page: { type: 'integer' },
            limit: { type: 'integer' }, total_pages: { type: 'integer' },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success:    { type: 'boolean', example: false },
            error_code: { type: 'string', example: 'JOB_NOT_FOUND' },
            message:    { type: 'string' },
            details:    { type: 'object', nullable: true },
          },
        },
        SuccessMessageResponse: {
          type: 'object',
          properties: { success: { type: 'boolean', example: true }, message: { type: 'string' } },
        },

      },
    },
  },
  apis: ['./src/routes/*.js'],
};

const swaggerSpec = swaggerJsdoc(options);
module.exports = swaggerSpec;