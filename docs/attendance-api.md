# Attendance API — RazorpayX People Integration

Base URL: `/api/attendance`  
All endpoints require a **Bearer token** in the `Authorization` header.

---

## Authentication

```
Authorization: Bearer <jwt_token>
```

| Role      | Access                        |
|-----------|-------------------------------|
| `admin`   | All endpoints                 |
| `manager` | GET list, GET single employee |

---

## Endpoints

### 1. Live Fetch Employee from RazorpayX

Calls RazorpayX `people/view` directly. **Does not write to the database.**

```
GET /api/attendance/people/view/:employee_id
```

**Path Parameter**

| Parameter     | Type    | Required | Description                       |
|---------------|---------|----------|-----------------------------------|
| `employee_id` | integer | Yes      | Numeric employee ID in RazorpayX  |

**Query Parameter**

| Parameter       | Type   | Default      | Description                    |
|-----------------|--------|--------------|--------------------------------|
| `employee_type` | string | `"employee"` | RazorpayX employee type        |

**Example Request**
```
GET /api/attendance/people/view/1
```

**Example Response `200`**
```json
{
  "success": true,
  "employee": {
    "name": "Rushikesh Laxman Baikar",
    "email": "rbaikar06@gmail.com",
    "date-of-hiring": "11/05/2026",
    "title": "Accounts Executives",
    "department": "Accounts",
    "manager-employee-id": "17",
    "manager-email": "office@electromechengineering.com",
    "pan": "CQDPB7079R",
    "bank-ifsc": "HDFC0002869",
    "bank-account-number": "50100459550683",
    "date-of-birth": "27/09/1998",
    "is_active": true,
    "phone_number": "+917028638687"
  }
}
```

**Error Responses**

| Code  | Description                          |
|-------|--------------------------------------|
| `400` | `employee_id` is not numeric         |
| `502` | RazorpayX API returned an error      |

---

### 2. Store Employee in Local DB

Saves employee data from the request body into the `razorpayx_employees` table.  
Rejects with `409` if another employee already has the **same email or phone number**.

```
POST /api/attendance/people
```

**Request Body**

```json
{
  "employee_id": "1",
  "employee": {
    "name": "Rushikesh Laxman Baikar",
    "email": "rbaikar06@gmail.com",
    "phone_number": "+917028638687",
    "date-of-birth": "27/09/1998",
    "date-of-hiring": "11/05/2026",
    "title": "Accounts Executives",
    "department": "Accounts",
    "manager-employee-id": "17",
    "manager-email": "office@electromechengineering.com",
    "pan": "CQDPB7079R",
    "bank-ifsc": "HDFC0002869",
    "bank-account-number": "50100459550683",
    "is_active": true
  }
}
```

**Body Fields**

| Field                          | Type    | Required | Notes                                      |
|--------------------------------|---------|----------|--------------------------------------------|
| `employee_id`                  | string  | Yes      | Numeric RazorpayX employee ID              |
| `employee.name`                | string  | No       | Full name                                  |
| `employee.email`               | string  | No       | Must be unique across all employees        |
| `employee.phone_number`        | string  | No       | Must be unique across all employees        |
| `employee.date-of-birth`       | string  | No       | Format: `DD/MM/YYYY`                       |
| `employee.date-of-hiring`      | string  | No       | Format: `DD/MM/YYYY`                       |
| `employee.title`               | string  | No       | Job title                                  |
| `employee.department`          | string  | No       | Department name                            |
| `employee.manager-employee-id` | string  | No       | RazorpayX ID of the manager                |
| `employee.manager-email`       | string  | No       | Manager's email                            |
| `employee.pan`                 | string  | No       | PAN card number                            |
| `employee.bank-ifsc`           | string  | No       | Bank IFSC code                             |
| `employee.bank-account-number` | string  | No       | Bank account number                        |
| `employee.is_active`           | boolean | No       | Defaults to `true`                         |

**Example Response `200`**
```json
{
  "success": true,
  "message": "Employee stored in database.",
  "employee": {
    "id": 1,
    "employee_id": "1",
    "name": "Rushikesh Laxman Baikar",
    "email": "rbaikar06@gmail.com",
    "phone_number": "+917028638687",
    "date_of_birth": "1998-09-27",
    "date_of_hiring": "2026-05-11",
    "title": "Accounts Executives",
    "department": "Accounts",
    "manager_employee_id": "17",
    "manager_email": "office@electromechengineering.com",
    "pan": "CQDPB7079R",
    "bank_ifsc": "HDFC0002869",
    "bank_account_number": "50100459550683",
    "is_active": true,
    "annual_ctc": null,
    "custom_salary_structure": false,
    "last_synced_at": "2026-06-04T10:00:00.000Z",
    "created_at": "2026-06-04T10:00:00.000Z",
    "updated_at": "2026-06-04T10:00:00.000Z"
  }
}
```

**Error Responses**

| Code  | Description                                        |
|-------|----------------------------------------------------|
| `400` | `employee_id` or `employee` object missing         |
| `409` | Another employee already has the same email or phone number |

---

### 3. Get All Employees (Local DB)

Returns all employees stored in the `razorpayx_employees` table, ordered by name.

```
GET /api/attendance/people
```

No request body or query parameters required.

**Example Response `200`**
```json
{
  "success": true,
  "total": 2,
  "employees": [
    {
      "id": 1,
      "employee_id": "1",
      "name": "Rushikesh Laxman Baikar",
      "email": "rbaikar06@gmail.com",
      "phone_number": "+917028638687",
      "date_of_birth": "1998-09-27",
      "date_of_hiring": "2026-05-11",
      "title": "Accounts Executives",
      "department": "Accounts",
      "manager_employee_id": "17",
      "manager_email": "office@electromechengineering.com",
      "pan": "CQDPB7079R",
      "bank_ifsc": "HDFC0002869",
      "bank_account_number": "50100459550683",
      "annual_ctc": "600000.00",
      "custom_salary_structure": false,
      "is_active": true,
      "user_id": null,
      "technician_id": null,
      "last_synced_at": "2026-06-04T10:00:00.000Z",
      "created_at": "2026-06-04T10:00:00.000Z",
      "updated_at": "2026-06-04T10:00:00.000Z"
    }
  ]
}
```

---

### 4. Get Single Employee (Local DB)

Returns one employee from the local DB by their RazorpayX `employee_id`.

```
GET /api/attendance/people/:employee_id
```

**Path Parameter**

| Parameter     | Type   | Required | Description                      |
|---------------|--------|----------|----------------------------------|
| `employee_id` | string | Yes      | RazorpayX employee ID            |

**Example Request**
```
GET /api/attendance/people/1
```

**Example Response `200`**
```json
{
  "success": true,
  "employee": {
    "id": 1,
    "employee_id": "1",
    "name": "Rushikesh Laxman Baikar",
    "email": "rbaikar06@gmail.com",
    "phone_number": "+917028638687",
    "date_of_birth": "1998-09-27",
    "date_of_hiring": "2026-05-11",
    "title": "Accounts Executives",
    "department": "Accounts",
    "manager_employee_id": "17",
    "manager_email": "office@electromechengineering.com",
    "pan": "CQDPB7079R",
    "bank_ifsc": "HDFC0002869",
    "bank_account_number": "50100459550683",
    "annual_ctc": "600000.00",
    "custom_salary_structure": false,
    "is_active": true,
    "user_id": null,
    "technician_id": null,
    "last_synced_at": "2026-06-04T10:00:00.000Z",
    "created_at": "2026-06-04T10:00:00.000Z",
    "updated_at": "2026-06-04T10:00:00.000Z"
  }
}
```

**Error Responses**

| Code  | Description                                                    |
|-------|----------------------------------------------------------------|
| `404` | Employee not found — use `POST /api/attendance/people` to store first |

---

### 5. Edit Employee (RazorpayX + Local DB)

Calls RazorpayX `people/edit` and mirrors the changed fields into the local DB.  
Send **only the fields you want to update** — all fields are optional.

```
PUT /api/attendance/people/:employee_id
```

**Path Parameter**

| Parameter     | Type    | Required | Description                      |
|---------------|---------|----------|----------------------------------|
| `employee_id` | integer | Yes      | Numeric RazorpayX employee ID    |

**Request Body**

```json
{
  "email": "varun.chawla@mailinator.com",
  "title": "Senior Recruiter",
  "department": "Human Resources",
  "manager-employee-id": 127,
  "manager-employee-type": "contractor",
  "bank-ifsc": "CORP0002106",
  "bank-account-number": "1234567890",
  "pan": "AGCPJ0387P",
  "phone-number": "9810012345",
  "hiring-date": "2020-01-01",
  "state": "karnataka",
  "pt-enabled": true,
  "pastSalary": 0,
  "pastExemption": 0,
  "pastTds": 0,
  "previousEmployerSalary": 0,
  "previousEmployerTds": 0
}
```

**Body Fields**

| Field                    | Type    | Description                                      |
|--------------------------|---------|--------------------------------------------------|
| `email`                  | string  | Updated email                                    |
| `title`                  | string  | Updated job title                                |
| `department`             | string  | Updated department                               |
| `manager-employee-id`    | integer | RazorpayX ID of new manager                      |
| `manager-employee-type`  | string  | `"employee"` or `"contractor"`                   |
| `bank-ifsc`              | string  | Updated bank IFSC                                |
| `bank-account-number`    | string  | Updated bank account number                      |
| `pan`                    | string  | Updated PAN                                      |
| `phone-number`           | string  | Updated phone number                             |
| `hiring-date`            | string  | Format: `YYYY-MM-DD`                             |
| `state`                  | string  | State for professional tax (e.g. `"karnataka"`)  |
| `pt-enabled`             | boolean | Enable professional tax                          |
| `pastSalary`             | number  | Previous employer salary                         |
| `pastExemption`          | number  | Previous employer exemption                      |
| `pastTds`                | number  | Previous employer TDS                            |
| `previousEmployerSalary` | number  | Previous employer total salary                   |
| `previousEmployerTds`    | number  | Previous employer total TDS                      |

**Example Response `200`**
```json
{
  "success": true,
  "message": "Employee updated in RazorpayX and local DB.",
  "razorpayx_response": { },
  "employee": {
    "id": 1,
    "employee_id": "3",
    "title": "Senior Recruiter",
    "department": "Human Resources",
    "updated_at": "2026-06-04T11:00:00.000Z"
  }
}
```

**Error Responses**

| Code  | Description                          |
|-------|--------------------------------------|
| `400` | `employee_id` is not numeric         |
| `502` | RazorpayX API returned an error      |

---

### 6. Set Employee Salary (RazorpayX + Local DB)

Calls RazorpayX `people/set-salary` and stores `annual_ctc` and `custom_salary_structure` in the local DB.

```
POST /api/attendance/people/:employee_id/salary
```

**Path Parameter**

| Parameter     | Type    | Required | Description                      |
|---------------|---------|----------|----------------------------------|
| `employee_id` | integer | Yes      | Numeric RazorpayX employee ID    |

**Request Body**

```json
{
  "annual-ctc": 600000,
  "custom-salary-structure": false
}
```

**Body Fields**

| Field                      | Type    | Required | Description                                          |
|----------------------------|---------|----------|------------------------------------------------------|
| `annual-ctc`               | number  | Yes      | Annual CTC in rupees                                 |
| `custom-salary-structure`  | boolean | No       | Use custom structure? Defaults to `false`            |

**Example Response `200`**
```json
{
  "success": true,
  "message": "Salary set in RazorpayX and updated in local DB.",
  "razorpayx_response": { },
  "employee": {
    "id": 1,
    "employee_id": "3",
    "annual_ctc": "600000.00",
    "custom_salary_structure": false,
    "updated_at": "2026-06-04T11:30:00.000Z"
  }
}
```

**Error Responses**

| Code  | Description                          |
|-------|--------------------------------------|
| `400` | Missing `annual-ctc` or invalid `employee_id` |
| `502` | RazorpayX API returned an error      |

---

## Summary Table

| Method | Endpoint                                      | Auth         | Description                              |
|--------|-----------------------------------------------|--------------|------------------------------------------|
| GET    | `/api/attendance/people/view/:employee_id`    | admin        | Live fetch from RazorpayX, no DB write   |
| POST   | `/api/attendance/people`                      | admin        | Store employee from body into local DB   |
| GET    | `/api/attendance/people`                      | admin/manager| List all employees from local DB         |
| GET    | `/api/attendance/people/:employee_id`         | admin/manager| Get single employee from local DB        |
| PUT    | `/api/attendance/people/:employee_id`         | admin        | Edit employee in RazorpayX + local DB    |
| POST   | `/api/attendance/people/:employee_id/salary`  | admin        | Set salary in RazorpayX + local DB       |

---

## Database Table: `razorpayx_employees`

| Column                   | Type          | Notes                             |
|--------------------------|---------------|-----------------------------------|
| `id`                     | SERIAL        | Primary key                       |
| `employee_id`            | VARCHAR(50)   | Unique — numeric RazorpayX ID     |
| `name`                   | VARCHAR(150)  |                                   |
| `email`                  | VARCHAR(255)  | Unique per employee               |
| `phone_number`           | VARCHAR(20)   | Unique per employee               |
| `date_of_birth`          | DATE          |                                   |
| `date_of_hiring`         | DATE          |                                   |
| `title`                  | VARCHAR(150)  |                                   |
| `department`             | VARCHAR(150)  |                                   |
| `manager_employee_id`    | VARCHAR(50)   |                                   |
| `manager_email`          | VARCHAR(255)  |                                   |
| `pan`                    | VARCHAR(20)   |                                   |
| `bank_ifsc`              | VARCHAR(20)   |                                   |
| `bank_account_number`    | VARCHAR(60)   |                                   |
| `annual_ctc`             | NUMERIC(12,2) | Set via set-salary API            |
| `custom_salary_structure`| BOOLEAN       | Set via set-salary API            |
| `is_active`              | BOOLEAN       | Defaults to `true`                |
| `user_id`                | INTEGER       | FK → users(id), optional          |
| `technician_id`          | INTEGER       | FK → technicians(id), optional    |
| `raw_data`               | JSONB         | Full API response stored for audit|
| `last_synced_at`         | TIMESTAMPTZ   |                                   |
| `created_at`             | TIMESTAMPTZ   |                                   |
| `updated_at`             | TIMESTAMPTZ   | Auto-updated on every change      |

---

## Error Response Format

All errors follow this structure:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message"
  }
}
```

Common error codes:

| Code                      | HTTP | Meaning                                    |
|---------------------------|------|--------------------------------------------|
| `MISSING_REQUIRED_FIELDS` | 400  | A required field was not provided          |
| `DUPLICATE_EMPLOYEE`      | 409  | Email or phone number already in use       |
| `EMPLOYEE_NOT_FOUND`      | 404  | Employee ID not in local DB                |
| `RAZORPAYX_ERROR`         | 502  | RazorpayX API call failed                  |
| `DB_ERROR`                | 500  | Internal database error                    |
