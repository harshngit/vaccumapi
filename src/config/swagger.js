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
- **Production:** https://apivdti.asynk.in/
- **Local:** http://localhost:3000
      `,
    },
    servers: [
      { url: 'https://apivdti.asynk.in/', description: '🚀 Production SSH' },
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
            first_name:   { type: 'string', example: 'Rahul' },
            last_name:    { type: 'string', example: 'Mehta' },
            email:        { type: 'string', format: 'email', example: 'rahul.mehta@vdti.com' },
            phone_number: { type: 'string', example: '+919876543210' },
            password:     { type: 'string', minLength: 6, example: 'Vdti@1234' },
            role:         { type: 'string', enum: ['admin','manager','engineer','technician','labour'], example: 'technician' },
          },
        },
        LoginRequest: {
          type: 'object', required: ['password'],
          properties: {
            email:        { type: 'string', format: 'email', example: 'admin@vdti.com' },
            phone_number: { type: 'string', example: '+919876543210' },
            password:     { type: 'string', example: 'Vdti@1234' },
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
            documents: {
              type: 'array',
              description: 'Optional. Attach documents at creation time. Upload files first via POST /api/upload/technician-documents.',
              items: {
                type: 'object',
                required: ['document_type', 'document_name', 'file_name', 'file_url'],
                properties: {
                  document_type:   { type: 'string', enum: ['Aadhaar Card','Technician Photo','WC Policy','Medical Insurance Policy','Other'], example: 'Aadhaar Card' },
                  document_name:   { type: 'string', example: 'Ravi Aadhaar Front' },
                  file_name:       { type: 'string', example: 'aadhaar_front.jpg' },
                  file_url:        { type: 'string', example: 'https://apivdti.asynk.in/uploads/1714012345678_aadhaar_front.jpg' },
                  mime_type:       { type: 'string', default: 'application/pdf' },
                  file_size_bytes: { type: 'integer' },
                  expiry_date:     { type: 'string', format: 'date', example: '2026-12-31' },
                  notes:           { type: 'string', example: 'Front side scan' },
                },
              },
            },
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
        TechnicianLoginResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Welcome back, Ravi Kumar!' },
            token:   { type: 'string' },
            user: {
              type: 'object',
              properties: {
                id:                { type: 'integer' },
                email:             { type: 'string', nullable: true },
                first_name:        { type: 'string' },
                last_name:         { type: 'string' },
                phone_number:      { type: 'string', nullable: true },
                role:              { type: 'string', example: 'technician' },
                is_active:         { type: 'boolean' },
                technician_id:     { type: 'integer', nullable: true },
                technician_name:   { type: 'string', nullable: true },
                specialization:    { type: 'string', nullable: true },
                technician_status: { type: 'string', nullable: true },
                avatar:            { type: 'string', nullable: true },
              },
            },
          },
        },
        TechnicianDetailResponse: {
          type: 'object',
          properties: {
            id: { type: 'integer' }, user_id: { type: 'integer', nullable: true },
            name: { type: 'string' }, email: { type: 'string', nullable: true },
            phone: { type: 'string' }, specialization: { type: 'string' },
            status: { type: 'string', enum: ['Active','On Leave','Inactive'] },
            join_date: { type: 'string', format: 'date', nullable: true },
            jobs_completed: { type: 'integer' }, rating: { type: 'number' }, avatar: { type: 'string' },
            created_at: { type: 'string', format: 'date-time' }, updated_at: { type: 'string', format: 'date-time' },
            recent_jobs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', example: 'JOB-0001' }, title: { type: 'string' },
                  status: { type: 'string' }, closed_date: { type: 'string', format: 'date', nullable: true },
                },
              },
            },
            documents: {
              type: 'array',
              items: { $ref: '#/components/schemas/TechnicianDocumentResponse' },
            },
          },
        },

        // ── Technician Ratings ────────────────────────────────
        TechnicianRatingResponse: {
          type: 'object',
          properties: {
            id:            { type: 'integer' },
            technician_id: { type: 'integer' },
            job_id:        { type: 'string', nullable: true, example: 'JOB-0001' },
            rating:        { type: 'number', example: 4.5 },
            review:        { type: 'string', nullable: true, example: 'Excellent work' },
            rated_by:      { type: 'integer', nullable: true },
            rated_by_name: { type: 'string', nullable: true, description: 'Present in GET list' },
            job_title:     { type: 'string', nullable: true, description: 'Present in GET list' },
            created_at:    { type: 'string', format: 'date-time' },
          },
        },
        AddTechnicianRatingRequest: {
          type: 'object', required: ['rating'],
          properties: {
            rating: { type: 'number', minimum: 1, maximum: 5, example: 4.5, description: 'Rating 1.0–5.0 (rounded to nearest 0.5)' },
            review: { type: 'string', example: 'Excellent work, completed ahead of schedule' },
            job_id: { type: 'string', example: 'JOB-0001', description: 'Optional. Job must be Closed and assigned to this technician. One rating per job.' },
          },
        },
        UpdateTechnicianRatingRequest: {
          type: 'object',
          properties: {
            rating: { type: 'number', minimum: 1, maximum: 5, example: 4.0 },
            review: { type: 'string', nullable: true },
          },
        },

        // ── Technician Documents ─────────────────────────────
        TechnicianDocumentResponse: {
          type: 'object',
          properties: {
            id:              { type: 'integer' },
            technician_id:   { type: 'integer' },
            document_type:   { type: 'string', enum: ['Aadhaar Card','Technician Photo','WC Policy','Medical Insurance Policy','Other'] },
            document_name:   { type: 'string', example: 'Ravi Aadhaar Front' },
            file_name:       { type: 'string', example: 'aadhaar_front.jpg' },
            file_url:        { type: 'string', example: 'https://apivdti.asynk.in/uploads/1714012345678_aadhaar_front.jpg' },
            mime_type:       { type: 'string', example: 'image/jpeg' },
            file_size_bytes: { type: 'integer', nullable: true },
            expiry_date:     { type: 'string', format: 'date', nullable: true, example: '2026-12-31' },
            notes:           { type: 'string', nullable: true },
            uploaded_by:     { type: 'integer', nullable: true },
            uploaded_by_name:{ type: 'string', nullable: true },
            expiry_status:   { type: 'string', enum: ['expired','expiring_soon'], nullable: true, description: 'Only present in /documents/expiring response' },
            technician_name: { type: 'string', nullable: true, description: 'Only present in /documents/expiring response' },
            technician_phone:{ type: 'string', nullable: true, description: 'Only present in /documents/expiring response' },
            created_at:      { type: 'string', format: 'date-time' },
            updated_at:      { type: 'string', format: 'date-time' },
          },
        },
        AddTechnicianDocumentRequest: {
          type: 'object', required: ['document_type', 'document_name', 'file_name', 'file_url'],
          properties: {
            document_type:   { type: 'string', enum: ['Aadhaar Card','Technician Photo','WC Policy','Medical Insurance Policy','Other'], example: 'Aadhaar Card' },
            document_name:   { type: 'string', example: 'Ravi Aadhaar Front' },
            file_name:       { type: 'string', example: 'aadhaar_front.jpg', description: 'Original filename from upload response' },
            file_url:        { type: 'string', example: 'https://apivdti.asynk.in/uploads/1714012345678_aadhaar_front.jpg', description: 'URL from upload response' },
            mime_type:       { type: 'string', default: 'application/pdf' },
            file_size_bytes: { type: 'integer' },
            expiry_date:     { type: 'string', format: 'date', example: '2026-12-31', description: 'Optional. Track document expiry.' },
            notes:           { type: 'string', example: 'Front side scan' },
          },
        },
        UpdateTechnicianDocumentRequest: {
          type: 'object',
          properties: {
            document_name: { type: 'string' },
            expiry_date:   { type: 'string', format: 'date', nullable: true, description: 'Pass null to clear expiry' },
            notes:         { type: 'string', nullable: true },
          },
        },
        TechnicianDocUploadItem: {
          type: 'object',
          properties: {
            id:              { type: 'integer' },
            file_name:       { type: 'string', example: 'aadhaar_front.jpg' },
            stored_name:     { type: 'string' },
            file_url:        { type: 'string', example: 'https://apivdti.asynk.in/uploads/1714012345678_aadhaar_front.jpg' },
            mime_type:       { type: 'string', example: 'image/jpeg' },
            file_size_bytes: { type: 'integer' },
            uploaded_at:     { type: 'string', format: 'date-time' },
            document_type:   { type: 'string', nullable: true, enum: ['Aadhaar Card','Technician Photo','WC Policy','Medical Insurance Policy','Other'], description: 'Echoed from query param if provided' },
            document_name:   { type: 'string', nullable: true, description: 'Echoed from query param, or defaults to original filename' },
            expiry_date:     { type: 'string', format: 'date', nullable: true, description: 'Echoed from query param if provided' },
            notes:           { type: 'string', nullable: true, description: 'Echoed from query param if provided' },
          },
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
        ClientDetailResponse: {
          type: 'object',
          properties: {
            id: { type: 'integer' }, name: { type: 'string' }, contact_person: { type: 'string' },
            email: { type: 'string', nullable: true }, phone: { type: 'string', nullable: true },
            gst_no: { type: 'string', nullable: true }, address: { type: 'string', nullable: true },
            type: { type: 'string' }, status: { type: 'string' },
            contract_value: { type: 'number' }, join_date: { type: 'string', format: 'date', nullable: true },
            created_at: { type: 'string', format: 'date-time' }, updated_at: { type: 'string', format: 'date-time' },
            total_jobs: { type: 'integer' }, open_jobs: { type: 'integer' }, active_amc_count: { type: 'integer' },
          },
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
            category: { type: 'string', enum: ['Service','AMC Visit','Breakdown','Installation & Commissioning','Inspection'] },
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
            category: { type: 'string', enum: ['Service','AMC Visit','Breakdown','Installation & Commissioning','Inspection'], default: 'Service' },
            scheduled_date: { type: 'string', format: 'date', example: '2024-02-01' },
            amount: { type: 'number', example: 15000 },
          },
        },
        UpdateJobRequest: {
          type: 'object',
          properties: {
            title: { type: 'string' }, description: { type: 'string' }, technician_id: { type: 'integer' },
            priority: { type: 'string', enum: ['Low','Medium','High','Critical'] },
            category: { type: 'string', enum: ['Service','AMC Visit','Breakdown','Installation & Commissioning','Inspection'] },
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
            last_service_date: { type: 'string', format: 'date', nullable: true, description: 'Date of the most recent completed service visit' },
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

        // ── Dashboard ─────────────────────────────────────────
        DashboardResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                stats: {
                  type: 'object',
                  properties: {
                    active_jobs:        { type: 'integer' },
                    total_clients:      { type: 'integer' },
                    active_technicians: { type: 'integer' },
                    total_technicians:  { type: 'integer' },
                    revenue_approved:   { type: 'number' },
                    pending_reports:    { type: 'integer' },
                    active_amc_count:   { type: 'integer' },
                    mom_active_jobs:    { type: 'integer', nullable: true },
                    mom_revenue:        { type: 'integer', nullable: true },
                    mom_clients:        { type: 'integer', nullable: true },
                  },
                },
                job_status_breakdown: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { status: { type: 'string' }, count: { type: 'integer' } },
                  },
                },
                monthly_stats: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      month: { type: 'string', example: 'Jun 2026' }, month_key: { type: 'string', example: '2026-06' },
                      jobs_raised: { type: 'integer' }, jobs_completed: { type: 'integer' }, revenue: { type: 'number' },
                    },
                  },
                },
                revenue_trend: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { month: { type: 'string' }, revenue: { type: 'number' } },
                  },
                },
                quick_overview: {
                  type: 'object',
                  properties: {
                    jobs_this_month:     { type: 'object', properties: { value: { type: 'integer' }, target: { type: 'integer' } } },
                    jobs_completed:      { type: 'object', properties: { value: { type: 'integer' }, target: { type: 'integer' } } },
                    active_technicians:  { type: 'object', properties: { value: { type: 'integer' }, target: { type: 'integer' } } },
                    amc_active:          { type: 'object', properties: { value: { type: 'integer' }, target: { type: 'integer' } } },
                  },
                },
                recent_jobs: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' }, title: { type: 'string' },
                      client_name: { type: 'string' }, technician_name: { type: 'string', nullable: true },
                      status: { type: 'string' }, priority: { type: 'string' },
                      amount: { type: 'number' }, raised_date: { type: 'string', format: 'date' },
                      scheduled_date: { type: 'string', format: 'date', nullable: true },
                      closed_date: { type: 'string', format: 'date', nullable: true },
                    },
                  },
                },
              },
            },
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

        // ── My Data ───────────────────────────────────────────
        MyDataResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            role:    { type: 'string', enum: ['admin','manager','engineer','technician','labour'] },
            profile: {
              type: 'object',
              properties: {
                id:           { type: 'string', description: 'UUID' },
                first_name:   { type: 'string' },
                last_name:    { type: 'string' },
                email:        { type: 'string', nullable: true },
                phone_number: { type: 'string', nullable: true },
                role:         { type: 'string' },
                is_active:    { type: 'boolean' },
                last_login_at:{ type: 'string', format: 'date-time', nullable: true },
                created_at:   { type: 'string', format: 'date-time' },
              },
            },
            technician_profile: {
              nullable: true,
              description: 'Present for technician/engineer/labour roles only. Null if no linked profile.',
              type: 'object',
              properties: {
                id:             { type: 'integer' },
                name:           { type: 'string' },
                specialization: { type: 'string' },
                status:         { type: 'string' },
                jobs_completed: { type: 'integer' },
                rating:         { type: 'number' },
              },
            },
            stats: {
              type: 'object',
              properties: {
                jobs: {
                  type: 'object',
                  properties: {
                    total:         { type: 'integer' },
                    raised:        { type: 'integer' },
                    assigned:      { type: 'integer' },
                    in_progress:   { type: 'integer' },
                    closed:        { type: 'integer' },
                    open:          { type: 'integer' },
                    total_revenue: { type: 'number', description: 'Admin/manager only' },
                  },
                },
                reports: {
                  type: 'object',
                  properties: {
                    total:    { type: 'integer' },
                    pending:  { type: 'integer' },
                    approved: { type: 'integer' },
                    rejected: { type: 'integer' },
                  },
                },
                amc: {
                  type: 'object',
                  description: 'Admin/manager only',
                  properties: {
                    total:         { type: 'integer' },
                    active:        { type: 'integer' },
                    expiring_soon: { type: 'integer' },
                    expired:       { type: 'integer' },
                  },
                },
                technicians: {
                  type: 'object',
                  description: 'Admin/manager only',
                  properties: {
                    total:    { type: 'integer' },
                    active:   { type: 'integer' },
                    on_leave: { type: 'integer' },
                    inactive: { type: 'integer' },
                  },
                },
                clients: {
                  type: 'object',
                  description: 'Admin/manager only',
                  properties: {
                    total:  { type: 'integer' },
                    active: { type: 'integer' },
                  },
                },
              },
            },
            recent: {
              type: 'object',
              properties: {
                jobs:    { type: 'array', items: { $ref: '#/components/schemas/JobResponse' } },
                reports: { type: 'array', items: { $ref: '#/components/schemas/ReportResponse' } },
                amc: {
                  type: 'array',
                  description: 'Admin/manager only',
                  items: { $ref: '#/components/schemas/AmcResponse' },
                },
                activity: {
                  type: 'array',
                  description: 'Admin/manager only — last 10 activity log entries',
                  items: {
                    type: 'object',
                    properties: {
                      id:                { type: 'integer' },
                      type:              { type: 'string' },
                      action:            { type: 'string' },
                      entity_type:       { type: 'string' },
                      entity_id:         { type: 'string' },
                      performed_by_name: { type: 'string' },
                      created_at:        { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
            message: {
              type: 'string',
              description: 'Only present when user has no linked technician profile.',
              example: 'No technician profile is linked to your account yet. Please contact your administrator.',
            },
          },
        },

        // ── Attendance ────────────────────────────────────────
        AttendanceRecord: {
          type: 'object',
          properties: {
            id:             { type: 'integer' },
            employee_id:    { type: 'string', example: 'EMP-001' },
            name:           { type: 'string', example: 'Rushikesh Baikar' },
            date:           { type: 'string', format: 'date', example: '2025-06-15' },
            check_in:       { type: 'string', format: 'date-time', nullable: true },
            check_out:      { type: 'string', format: 'date-time', nullable: true },
            status:         { type: 'string', enum: ['present','absent','half_day','on_leave','holiday'] },
            working_hours:  { type: 'number', example: 9.0 },
            source:         { type: 'string', enum: ['razorpayx','manual'] },
            synced_at:      { type: 'string', format: 'date-time' },
            user_name:      { type: 'string', nullable: true },
            specialization: { type: 'string', nullable: true },
          },
        },
        AttendanceEmployee: {
          type: 'object',
          properties: {
            employee_id:    { type: 'string', example: 'EMP-001' },
            name:           { type: 'string', example: 'Rushikesh Baikar' },
            email:          { type: 'string', nullable: true },
            user_id:        { type: 'integer', nullable: true },
            technician_id:  { type: 'integer', nullable: true },
            is_active:      { type: 'boolean' },
            last_synced_at: { type: 'string', format: 'date-time' },
          },
        },
        AttendanceSyncRequest: {
          type: 'object', required: ['from_date', 'to_date'],
          properties: {
            from_date: { type: 'string', format: 'date', example: '2025-06-01' },
            to_date:   { type: 'string', format: 'date', example: '2025-06-30' },
          },
        },
        AttendanceMarkRequest: {
          type: 'object', required: ['employee_id', 'date', 'status'],
          properties: {
            employee_id: { type: 'string', example: 'EMP-001' },
            date:        { type: 'string', format: 'date', example: '2025-06-15' },
            check_in:    { type: 'string', format: 'date-time', example: '2025-06-15T09:00:00.000Z', nullable: true },
            check_out:   { type: 'string', format: 'date-time', example: '2025-06-15T18:00:00.000Z', nullable: true },
            status:      { type: 'string', enum: ['present','absent','half_day','on_leave','holiday'], example: 'present' },
          },
        },
        AttendanceSyncEmployeesResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Employee list synced. 20 employees updated.' },
            total:   { type: 'integer', example: 20 },
          },
        },
        AttendanceSyncResponse: {
          type: 'object',
          properties: {
            success:         { type: 'boolean', example: true },
            message:         { type: 'string', example: 'Attendance sync complete.' },
            records_synced:  { type: 'integer', example: 480 },
            errors_count:    { type: 'integer', example: 0 },
            errors:          { type: 'array', nullable: true, items: { type: 'object', properties: { employee_id: { type: 'string' }, error: { type: 'string' } } } },
          },
        },
        AttendanceEmployeeListResponse: {
          type: 'object',
          properties: {
            success:   { type: 'boolean', example: true },
            total:     { type: 'integer', example: 20 },
            employees: { type: 'array', items: { $ref: '#/components/schemas/AttendanceEmployee' } },
          },
        },
        AttendanceListResponse: {
          type: 'object',
          properties: {
            success:     { type: 'boolean', example: true },
            total:       { type: 'integer' },
            page:        { type: 'integer' },
            limit:       { type: 'integer' },
            total_pages: { type: 'integer' },
            attendance:  { type: 'array', items: { $ref: '#/components/schemas/AttendanceRecord' } },
          },
        },
        AttendanceSummaryRecord: {
          type: 'object',
          properties: {
            employee_id:  { type: 'string' },
            name:         { type: 'string' },
            total_days:   { type: 'integer' },
            present:      { type: 'integer' },
            absent:       { type: 'integer' },
            half_day:     { type: 'integer' },
            on_leave:     { type: 'integer' },
            holidays:     { type: 'integer' },
            avg_hours:    { type: 'number' },
            total_hours:  { type: 'number' },
          },
        },
        AttendanceSummaryResponse: {
          type: 'object',
          properties: {
            success:   { type: 'boolean', example: true },
            from_date: { type: 'string', format: 'date', nullable: true },
            to_date:   { type: 'string', format: 'date', nullable: true },
            summary:   { type: 'array', items: { $ref: '#/components/schemas/AttendanceSummaryRecord' } },
          },
        },
        AttendanceMarkResponse: {
          type: 'object',
          properties: {
            success:    { type: 'boolean', example: true },
            message:    { type: 'string', example: 'Attendance marked successfully.' },
            attendance: { $ref: '#/components/schemas/AttendanceRecord' },
          },
        },

      },
    },
  },
  apis: ['./src/routes/*.js'],
};

const swaggerSpec = swaggerJsdoc(options);
module.exports = swaggerSpec;