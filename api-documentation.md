# HMS v2 REST API Documentation

This document contains a comprehensive, highly-structured API specification for HMS v2. It includes query parameters, headers, request body structure, and responses for every endpoint.

---

## Global Context & Headers

All endpoints (except those marked `@Public`) require JWT authentication.

### Authentication Header

```http
Authorization: Bearer <accessToken>
```

### Common Response Envelope

Every API response follows a consistent JSON envelope:

```json
{
  "success": true,
  "data": { ... },
  "message": "Optional message details",
  "errorCode": null,
  "timestamp": "2026-06-13T21:54:00.000Z",
  "path": "/api/..."
}
```

In case of error, `success` is `false`, `data` is `null` or omitted, and `errorCode` and `message` are populated.

---

## 📦 Authentication Module

### `POST /api/auth/login`

**Purpose:** Authenticate with email and password

- **Authentication Required:** ❌ No (Public endpoint)

**Request Body:**

- **`email`** (Required, _string_): (e.g. `"admin@hospital.com"`)
- **`password`** (Required, _string_): (e.g. `"Admin@12345"`)

**Request Example:**

```json
{
  "email": "admin@hospital.com",
  "password": "Admin@12345"
}
```

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "accessToken": "string",
      "refreshToken": "string",
      "expiresIn": 0,
      "tokenType": "string"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.285Z"
  }
  ```

---

### `POST /api/auth/logout`

**Purpose:** Logout and revoke refresh token

- **Authentication Required:** ✅ Yes

**Request Body:**

- **`refreshToken`** (Required, _string_):

**Request Example:**

```json
{
  "refreshToken": "string"
}
```

**Responses:**

- **Status `204`**:

---

### `POST /api/auth/refresh`

**Purpose:** Refresh access token using refresh token

- **Authentication Required:** ✅ Yes

**Request Body:**

- **`refreshToken`** (Required, _string_):

**Request Example:**

```json
{
  "refreshToken": "string"
}
```

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "accessToken": "string",
      "refreshToken": "string",
      "expiresIn": 0,
      "tokenType": "string"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.285Z"
  }
  ```

---

## 📦 Users Module

### `GET /api/users`

**Purpose:** List all users with pagination

- **Authentication Required:** ✅ Yes

**Query Parameters:**

- `page` (Optional): Page number (1-indexed) _(type: number) (default: `1`)_
- `limit` (Optional): Items per page (max 100) _(type: number) (default: `10`)_
- `orderBy` (Optional): Field to order by _(type: string)_
- `orderDir` (Optional): _(type: string) (default: `desc`)_

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "string",
        "organizationId": "string",
        "email": "string",
        "fullName": "string",
        "firstName": "string",
        "lastName": "string",
        "phone": "string",
        "isActive": false,
        "lastLoginAt": "2026-06-13T16:39:03.285Z",
        "createdAt": "2026-06-13T16:39:03.285Z",
        "updatedAt": "2026-06-13T16:39:03.285Z"
      }
    ],
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.285Z"
  }
  ```

---

### `GET /api/users/{id}`

**Purpose:** Get user by ID

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "email": "string",
      "fullName": "string",
      "firstName": "string",
      "lastName": "string",
      "phone": "string",
      "isActive": false,
      "lastLoginAt": "2026-06-13T16:39:03.285Z",
      "createdAt": "2026-06-13T16:39:03.285Z",
      "updatedAt": "2026-06-13T16:39:03.285Z"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.285Z"
  }
  ```

---

### `POST /api/users`

**Purpose:** Create a new user (Admin only)

- **Authentication Required:** ✅ Yes

**Request Body:**

- **`email`** (Required, _string_): (e.g. `"john.doe@hospital.com"`)
- **`password`** (Required, _string_): (e.g. `"SecurePass@123"`)
- **`firstName`** (Required, _string_): (e.g. `"John"`)
- **`lastName`** (Required, _string_): (e.g. `"Doe"`)
- **`phone`** (Optional, _string_): (e.g. `"+919876543210"`)
- **`organizationId`** (Optional, _string_): (e.g. `"org_cuid_here"`)

**Request Example:**

```json
{
  "email": "john.doe@hospital.com",
  "password": "SecurePass@123",
  "firstName": "John",
  "lastName": "Doe",
  "phone": "+919876543210",
  "organizationId": "org_cuid_here"
}
```

**Responses:**

- **Status `201`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "email": "string",
      "fullName": "string",
      "firstName": "string",
      "lastName": "string",
      "phone": "string",
      "isActive": false,
      "lastLoginAt": "2026-06-13T16:39:03.285Z",
      "createdAt": "2026-06-13T16:39:03.285Z",
      "updatedAt": "2026-06-13T16:39:03.285Z"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.285Z"
  }
  ```

---

### `PUT /api/users/{id}`

**Purpose:** Update user profile

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:**

- **`firstName`** (Optional, _string_): (e.g. `"John"`)
- **`lastName`** (Optional, _string_): (e.g. `"Doe"`)
- **`phone`** (Optional, _string_): (e.g. `"+919876543210"`)
- **`organizationId`** (Optional, _string_): (e.g. `"org_cuid_here"`)

**Request Example:**

```json
{
  "firstName": "John",
  "lastName": "Doe",
  "phone": "+919876543210",
  "organizationId": "org_cuid_here"
}
```

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "email": "string",
      "fullName": "string",
      "firstName": "string",
      "lastName": "string",
      "phone": "string",
      "isActive": false,
      "lastLoginAt": "2026-06-13T16:39:03.285Z",
      "createdAt": "2026-06-13T16:39:03.285Z",
      "updatedAt": "2026-06-13T16:39:03.285Z"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.285Z"
  }
  ```

---

### `DELETE /api/users/{id}`

**Purpose:** Soft delete user (Admin only)

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `204`**:

---

## 📦 Patients Module

### `GET /api/patients`

**Purpose:** List patients with pagination, search, and status filters

- **Authentication Required:** ✅ Yes

**Query Parameters:**

- `page` (Optional): Page number (1-indexed) _(type: number) (default: `1`)_
- `limit` (Optional): Items per page (max 100) _(type: number) (default: `10`)_
- `orderBy` (Optional): Field to order by _(type: string)_
- `orderDir` (Optional): _(type: string) (default: `desc`)_
- `search` (Optional): Search term (matches first/last name, MRN, phone) _(type: string)_
- `status` (Optional): Filter by patient status _(type: string) (default: `all`)_

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "data": [
        {
          "id": "string",
          "organizationId": "string",
          "mrn": "string",
          "externalId": "string",
          "firstName": "string",
          "middleName": "string",
          "lastName": "string",
          "dateOfBirth": "2026-06-13T16:39:03.285Z",
          "gender": "string",
          "bloodGroup": "string",
          "phonePrimary": "string",
          "phoneSecondary": "string",
          "email": "string",
          "region": "string",
          "zone": "string",
          "woreda": "string",
          "kebele": "string",
          "houseNumber": "string",
          "addressDescription": "string",
          "emergencyContactName": "string",
          "emergencyContactPhone": "string",
          "emergencyContactRelationship": "string",
          "allergies": [],
          "chronicConditions": [],
          "currentMedications": [],
          "hasInsurance": false,
          "insuranceProvider": "string",
          "insuranceId": "string",
          "insuranceExpiryDate": "2026-06-13T16:39:03.285Z",
          "insuranceCoverageDetails": "string",
          "photoUrl": "string",
          "maritalStatus": "string",
          "occupation": "string",
          "educationLevel": "string",
          "isActive": false,
          "isVip": false,
          "notes": "string",
          "createdAt": "2026-06-13T16:39:03.285Z",
          "updatedAt": "2026-06-13T16:39:03.285Z",
          "createdById": "string",
          "updatedById": "string"
        }
      ],
      "meta": {
        "total": 100,
        "lastPage": 10,
        "currentPage": 1,
        "perPage": 10,
        "prev": null,
        "next": 2
      }
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.285Z"
  }
  ```

---

### `GET /api/patients/{id}`

**Purpose:** Get a single patient details

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "mrn": "string",
      "externalId": "string",
      "firstName": "string",
      "middleName": "string",
      "lastName": "string",
      "dateOfBirth": "2026-06-13T16:39:03.285Z",
      "gender": "string",
      "bloodGroup": "string",
      "phonePrimary": "string",
      "phoneSecondary": "string",
      "email": "string",
      "region": "string",
      "zone": "string",
      "woreda": "string",
      "kebele": "string",
      "houseNumber": "string",
      "addressDescription": "string",
      "emergencyContactName": "string",
      "emergencyContactPhone": "string",
      "emergencyContactRelationship": "string",
      "allergies": [],
      "chronicConditions": [],
      "currentMedications": [],
      "hasInsurance": false,
      "insuranceProvider": "string",
      "insuranceId": "string",
      "insuranceExpiryDate": "2026-06-13T16:39:03.285Z",
      "insuranceCoverageDetails": "string",
      "photoUrl": "string",
      "maritalStatus": "string",
      "occupation": "string",
      "educationLevel": "string",
      "isActive": false,
      "isVip": false,
      "notes": "string",
      "createdAt": "2026-06-13T16:39:03.285Z",
      "updatedAt": "2026-06-13T16:39:03.286Z",
      "createdById": "string",
      "updatedById": "string"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.286Z"
  }
  ```

---

### `POST /api/patients`

**Purpose:** Register a new patient

- **Authentication Required:** ✅ Yes

**Request Body:**

- **`firstName`** (Required, _string_): (e.g. `"Abebe"`)
- **`middleName`** (Optional, _string_): (e.g. `"Kebede"`)
- **`lastName`** (Required, _string_): (e.g. `"Assefa"`)
- **`dateOfBirth`** (Required, _string_): (e.g. `"1990-05-15"`)
- **`gender`** (Required, _string [enum: male, female, other]_): (e.g. `"male"`)
- **`bloodGroup`** (Optional, _string_): (e.g. `"A+"`)
- **`phonePrimary`** (Optional, _string_): (e.g. `"+251911123456"`)
- **`phoneSecondary`** (Optional, _string_): (e.g. `"+251911654321"`)
- **`email`** (Optional, _string_): (e.g. `"patient@example.com"`)
- **`region`** (Optional, _string_): (e.g. `"Addis Ababa"`)
- **`zone`** (Optional, _string_): (e.g. `"Bole"`)
- **`woreda`** (Optional, _string_): (e.g. `"Woreda 03"`)
- **`kebele`** (Optional, _string_): (e.g. `"Kebele 10"`)
- **`houseNumber`** (Optional, _string_): (e.g. `"1024"`)
- **`addressDescription`** (Optional, _string_): (e.g. `"Near Bole Medhanialem"`)
- **`emergencyContactName`** (Optional, _string_): (e.g. `"Aster Kebede"`)
- **`emergencyContactPhone`** (Optional, _string_): (e.g. `"+251911987654"`)
- **`emergencyContactRelationship`** (Optional, _string_): (e.g. `"Spouse"`)
- **`allergies`** (Optional, _array_):
- **`chronicConditions`** (Optional, _array_):
- **`currentMedications`** (Optional, _array_):
- **`hasInsurance`** (Optional, _boolean_): (e.g. `true`)
- **`insuranceProvider`** (Optional, _string_): (e.g. `"CBHI"`)
- **`insuranceId`** (Optional, _string_): (e.g. `"POL-998877"`)
- **`insuranceExpiryDate`** (Optional, _string_): (e.g. `"2026-12-31"`)
- **`photoUrl`** (Optional, _string_): (e.g. `"https://example.com/photo.jpg"`)
- **`maritalStatus`** (Optional, _string_): (e.g. `"married"`)
- **`occupation`** (Optional, _string_): (e.g. `"Teacher"`)
- **`educationLevel`** (Optional, _string_): (e.g. `"Degree"`)
- **`isVip`** (Optional, _boolean_): (e.g. `false`)
- **`notes`** (Optional, _string_): (e.g. `"Patient requires wheelchair assistance."`)
- **`externalId`** (Optional, _string_): (e.g. `"EXT-12345"`)

**Request Example:**

```json
{
  "firstName": "Abebe",
  "middleName": "Kebede",
  "lastName": "Assefa",
  "dateOfBirth": "1990-05-15",
  "gender": "male",
  "bloodGroup": "A+",
  "phonePrimary": "+251911123456",
  "phoneSecondary": "+251911654321",
  "email": "patient@example.com",
  "region": "Addis Ababa",
  "zone": "Bole",
  "woreda": "Woreda 03",
  "kebele": "Kebele 10",
  "houseNumber": "1024",
  "addressDescription": "Near Bole Medhanialem",
  "emergencyContactName": "Aster Kebede",
  "emergencyContactPhone": "+251911987654",
  "emergencyContactRelationship": "Spouse",
  "allergies": [],
  "chronicConditions": [],
  "currentMedications": [],
  "hasInsurance": true,
  "insuranceProvider": "CBHI",
  "insuranceId": "POL-998877",
  "insuranceExpiryDate": "2026-12-31",
  "photoUrl": "https://example.com/photo.jpg",
  "maritalStatus": "married",
  "occupation": "Teacher",
  "educationLevel": "Degree",
  "isVip": false,
  "notes": "Patient requires wheelchair assistance.",
  "externalId": "EXT-12345"
}
```

**Responses:**

- **Status `201`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "mrn": "string",
      "externalId": "string",
      "firstName": "string",
      "middleName": "string",
      "lastName": "string",
      "dateOfBirth": "2026-06-13T16:39:03.286Z",
      "gender": "string",
      "bloodGroup": "string",
      "phonePrimary": "string",
      "phoneSecondary": "string",
      "email": "string",
      "region": "string",
      "zone": "string",
      "woreda": "string",
      "kebele": "string",
      "houseNumber": "string",
      "addressDescription": "string",
      "emergencyContactName": "string",
      "emergencyContactPhone": "string",
      "emergencyContactRelationship": "string",
      "allergies": [],
      "chronicConditions": [],
      "currentMedications": [],
      "hasInsurance": false,
      "insuranceProvider": "string",
      "insuranceId": "string",
      "insuranceExpiryDate": "2026-06-13T16:39:03.286Z",
      "insuranceCoverageDetails": "string",
      "photoUrl": "string",
      "maritalStatus": "string",
      "occupation": "string",
      "educationLevel": "string",
      "isActive": false,
      "isVip": false,
      "notes": "string",
      "createdAt": "2026-06-13T16:39:03.286Z",
      "updatedAt": "2026-06-13T16:39:03.286Z",
      "createdById": "string",
      "updatedById": "string"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.286Z"
  }
  ```

---

### `PUT /api/patients/{id}`

**Purpose:** Update patient information

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:**

- **`firstName`** (Optional, _string_): (e.g. `"Abebe"`)
- **`middleName`** (Optional, _string_): (e.g. `"Kebede"`)
- **`lastName`** (Optional, _string_): (e.g. `"Assefa"`)
- **`dateOfBirth`** (Optional, _string_): (e.g. `"1990-05-15"`)
- **`gender`** (Optional, _string [enum: male, female, other]_): (e.g. `"male"`)
- **`bloodGroup`** (Optional, _string_): (e.g. `"A+"`)
- **`phonePrimary`** (Optional, _string_): (e.g. `"+251911123456"`)
- **`phoneSecondary`** (Optional, _string_): (e.g. `"+251911654321"`)
- **`email`** (Optional, _string_): (e.g. `"patient@example.com"`)
- **`region`** (Optional, _string_): (e.g. `"Addis Ababa"`)
- **`zone`** (Optional, _string_): (e.g. `"Bole"`)
- **`woreda`** (Optional, _string_): (e.g. `"Woreda 03"`)
- **`kebele`** (Optional, _string_): (e.g. `"Kebele 10"`)
- **`houseNumber`** (Optional, _string_): (e.g. `"1024"`)
- **`addressDescription`** (Optional, _string_): (e.g. `"Near Bole Medhanialem"`)
- **`emergencyContactName`** (Optional, _string_): (e.g. `"Aster Kebede"`)
- **`emergencyContactPhone`** (Optional, _string_): (e.g. `"+251911987654"`)
- **`emergencyContactRelationship`** (Optional, _string_): (e.g. `"Spouse"`)
- **`allergies`** (Optional, _array_):
- **`chronicConditions`** (Optional, _array_):
- **`currentMedications`** (Optional, _array_):
- **`hasInsurance`** (Optional, _boolean_): (e.g. `true`)
- **`insuranceProvider`** (Optional, _string_): (e.g. `"CBHI"`)
- **`insuranceId`** (Optional, _string_): (e.g. `"POL-998877"`)
- **`insuranceExpiryDate`** (Optional, _string_): (e.g. `"2026-12-31"`)
- **`photoUrl`** (Optional, _string_): (e.g. `"https://example.com/photo.jpg"`)
- **`maritalStatus`** (Optional, _string_): (e.g. `"married"`)
- **`occupation`** (Optional, _string_): (e.g. `"Teacher"`)
- **`educationLevel`** (Optional, _string_): (e.g. `"Degree"`)
- **`isVip`** (Optional, _boolean_): (e.g. `false`)
- **`notes`** (Optional, _string_): (e.g. `"Patient requires wheelchair assistance."`)
- **`externalId`** (Optional, _string_): (e.g. `"EXT-12345"`)
- **`isActive`** (Optional, _boolean_): Is patient active in system (e.g. `true`)

**Request Example:**

```json
{
  "firstName": "Abebe",
  "middleName": "Kebede",
  "lastName": "Assefa",
  "dateOfBirth": "1990-05-15",
  "gender": "male",
  "bloodGroup": "A+",
  "phonePrimary": "+251911123456",
  "phoneSecondary": "+251911654321",
  "email": "patient@example.com",
  "region": "Addis Ababa",
  "zone": "Bole",
  "woreda": "Woreda 03",
  "kebele": "Kebele 10",
  "houseNumber": "1024",
  "addressDescription": "Near Bole Medhanialem",
  "emergencyContactName": "Aster Kebede",
  "emergencyContactPhone": "+251911987654",
  "emergencyContactRelationship": "Spouse",
  "allergies": [],
  "chronicConditions": [],
  "currentMedications": [],
  "hasInsurance": true,
  "insuranceProvider": "CBHI",
  "insuranceId": "POL-998877",
  "insuranceExpiryDate": "2026-12-31",
  "photoUrl": "https://example.com/photo.jpg",
  "maritalStatus": "married",
  "occupation": "Teacher",
  "educationLevel": "Degree",
  "isVip": false,
  "notes": "Patient requires wheelchair assistance.",
  "externalId": "EXT-12345",
  "isActive": true
}
```

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "mrn": "string",
      "externalId": "string",
      "firstName": "string",
      "middleName": "string",
      "lastName": "string",
      "dateOfBirth": "2026-06-13T16:39:03.286Z",
      "gender": "string",
      "bloodGroup": "string",
      "phonePrimary": "string",
      "phoneSecondary": "string",
      "email": "string",
      "region": "string",
      "zone": "string",
      "woreda": "string",
      "kebele": "string",
      "houseNumber": "string",
      "addressDescription": "string",
      "emergencyContactName": "string",
      "emergencyContactPhone": "string",
      "emergencyContactRelationship": "string",
      "allergies": [],
      "chronicConditions": [],
      "currentMedications": [],
      "hasInsurance": false,
      "insuranceProvider": "string",
      "insuranceId": "string",
      "insuranceExpiryDate": "2026-06-13T16:39:03.286Z",
      "insuranceCoverageDetails": "string",
      "photoUrl": "string",
      "maritalStatus": "string",
      "occupation": "string",
      "educationLevel": "string",
      "isActive": false,
      "isVip": false,
      "notes": "string",
      "createdAt": "2026-06-13T16:39:03.286Z",
      "updatedAt": "2026-06-13T16:39:03.286Z",
      "createdById": "string",
      "updatedById": "string"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.286Z"
  }
  ```

---

### `DELETE /api/patients/{id}`

**Purpose:** Deactivate/soft-delete patient record

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `204`**:

---

## 📦 Appointments Module

### `GET /api/appointments`

**Purpose:** List appointments with pagination and filters

- **Authentication Required:** ✅ Yes

**Query Parameters:**

- `page` (Optional): Page number (1-indexed) _(type: number) (default: `1`)_
- `limit` (Optional): Items per page (max 100) _(type: number) (default: `10`)_
- `orderBy` (Optional): Field to order by _(type: string)_
- `orderDir` (Optional): _(type: string) (default: `desc`)_
- `date` (Optional): Target date to filter appointments (YYYY-MM-DD) _(type: string)_
- `status` (Optional): Filter by appointment status _(type: string)_
- `doctorId` (Optional): Filter by doctor ID _(type: string)_
- `patientId` (Optional): Filter by patient ID _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "data": [
        {
          "id": "string",
          "organizationId": "string",
          "patientId": "string",
          "doctorId": "string",
          "appointmentDate": "2026-06-13T16:39:03.286Z",
          "appointmentTime": "string",
          "durationMinutes": 0,
          "appointmentType": "string",
          "departmentId": "string",
          "status": "string",
          "chiefComplaint": "string",
          "notes": "string",
          "consultationNotes": "string",
          "checkedInAt": "2026-06-13T16:39:03.286Z",
          "checkedInById": "string",
          "startedAt": "2026-06-13T16:39:03.286Z",
          "completedAt": "2026-06-13T16:39:03.286Z",
          "cancelledAt": "2026-06-13T16:39:03.286Z",
          "cancelledById": "string",
          "cancellationReason": "string",
          "rescheduledFromId": "string",
          "rescheduledToId": "string",
          "reminderSent": false,
          "reminderSentAt": "2026-06-13T16:39:03.286Z",
          "createdAt": "2026-06-13T16:39:03.286Z",
          "updatedAt": "2026-06-13T16:39:03.286Z",
          "createdById": "string",
          "patient": {
            "id": "string",
            "mrn": "string",
            "firstName": "string",
            "lastName": "string",
            "phonePrimary": "string",
            "gender": "string",
            "dateOfBirth": "2026-06-13T16:39:03.286Z"
          },
          "doctor": {
            "id": "string",
            "fullName": "string",
            "specialization": "string"
          }
        }
      ],
      "meta": {
        "total": 100,
        "lastPage": 10,
        "currentPage": 1,
        "perPage": 10,
        "prev": null,
        "next": 2
      }
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.286Z"
  }
  ```

---

### `GET /api/appointments/{id}`

**Purpose:** Get details of a single appointment

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "patientId": "string",
      "doctorId": "string",
      "appointmentDate": "2026-06-13T16:39:03.287Z",
      "appointmentTime": "string",
      "durationMinutes": 0,
      "appointmentType": "string",
      "departmentId": "string",
      "status": "string",
      "chiefComplaint": "string",
      "notes": "string",
      "consultationNotes": "string",
      "checkedInAt": "2026-06-13T16:39:03.287Z",
      "checkedInById": "string",
      "startedAt": "2026-06-13T16:39:03.287Z",
      "completedAt": "2026-06-13T16:39:03.287Z",
      "cancelledAt": "2026-06-13T16:39:03.287Z",
      "cancelledById": "string",
      "cancellationReason": "string",
      "rescheduledFromId": "string",
      "rescheduledToId": "string",
      "reminderSent": false,
      "reminderSentAt": "2026-06-13T16:39:03.287Z",
      "createdAt": "2026-06-13T16:39:03.287Z",
      "updatedAt": "2026-06-13T16:39:03.287Z",
      "createdById": "string",
      "patient": {
        "id": "string",
        "mrn": "string",
        "firstName": "string",
        "lastName": "string",
        "phonePrimary": "string",
        "gender": "string",
        "dateOfBirth": "2026-06-13T16:39:03.287Z"
      },
      "doctor": {
        "id": "string",
        "fullName": "string",
        "specialization": "string"
      }
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.287Z"
  }
  ```

---

### `POST /api/appointments`

**Purpose:** Schedule a new appointment

- **Authentication Required:** ✅ Yes

**Request Body:**

- **`patientId`** (Required, _string_): ID of the patient (e.g. `"cuid-patient-123"`)
- **`doctorId`** (Optional, _string_): ID of the doctor user (e.g. `"cuid-doctor-456"`)
- **`appointmentDate`** (Required, _string_): Date of the appointment (e.g. `"2026-06-10"`)
- **`appointmentTime`** (Required, _string_): Time of the appointment (HH:mm) (e.g. `"09:30"`)
- **`durationMinutes`** (Optional, _number_): Duration of the appointment in minutes (e.g. `30`)
- **`appointmentType`** (Optional, _string_): Type of appointment (e.g. `"follow_up"`)
- **`chiefComplaint`** (Optional, _string_): Chief complaint (e.g. `"Routine checkup for hypertension"`)
- **`notes`** (Optional, _string_): General notes (e.g. `"Patient needs to bring blood work results."`)
- **`departmentId`** (Optional, _string_): ID of the department (e.g. `"cuid-department-789"`)

**Request Example:**

```json
{
  "patientId": "cuid-patient-123",
  "doctorId": "cuid-doctor-456",
  "appointmentDate": "2026-06-10",
  "appointmentTime": "09:30",
  "durationMinutes": 30,
  "appointmentType": "follow_up",
  "chiefComplaint": "Routine checkup for hypertension",
  "notes": "Patient needs to bring blood work results.",
  "departmentId": "cuid-department-789"
}
```

**Responses:**

- **Status `201`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "patientId": "string",
      "doctorId": "string",
      "appointmentDate": "2026-06-13T16:39:03.287Z",
      "appointmentTime": "string",
      "durationMinutes": 0,
      "appointmentType": "string",
      "departmentId": "string",
      "status": "string",
      "chiefComplaint": "string",
      "notes": "string",
      "consultationNotes": "string",
      "checkedInAt": "2026-06-13T16:39:03.287Z",
      "checkedInById": "string",
      "startedAt": "2026-06-13T16:39:03.287Z",
      "completedAt": "2026-06-13T16:39:03.287Z",
      "cancelledAt": "2026-06-13T16:39:03.287Z",
      "cancelledById": "string",
      "cancellationReason": "string",
      "rescheduledFromId": "string",
      "rescheduledToId": "string",
      "reminderSent": false,
      "reminderSentAt": "2026-06-13T16:39:03.287Z",
      "createdAt": "2026-06-13T16:39:03.287Z",
      "updatedAt": "2026-06-13T16:39:03.287Z",
      "createdById": "string",
      "patient": {
        "id": "string",
        "mrn": "string",
        "firstName": "string",
        "lastName": "string",
        "phonePrimary": "string",
        "gender": "string",
        "dateOfBirth": "2026-06-13T16:39:03.287Z"
      },
      "doctor": {
        "id": "string",
        "fullName": "string",
        "specialization": "string"
      }
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.287Z"
  }
  ```

---

### `PUT /api/appointments/{id}`

**Purpose:** Update appointment details or status

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:**

- **`doctorId`** (Optional, _string_): ID of the doctor user (e.g. `"cuid-doctor-456"`)
- **`appointmentDate`** (Optional, _string_): Rescheduled date (e.g. `"2026-06-11"`)
- **`appointmentTime`** (Optional, _string_): Rescheduled time (HH:mm) (e.g. `"10:00"`)
- **`durationMinutes`** (Optional, _number_): Duration in minutes (e.g. `45`)
- **`appointmentType`** (Optional, _string_): Type of appointment (e.g. `"emergency"`)
- **`chiefComplaint`** (Optional, _string_): Chief complaint (e.g. `"Severe headache"`)
- **`notes`** (Optional, _string_): Notes (e.g. `"Update patient room info."`)
- **`departmentId`** (Optional, _string_): ID of the department (e.g. `"cuid-department-789"`)
- **`status`** (Optional, _string [enum: scheduled, confirmed, checked_in, in_progress, completed, cancelled, no_show, rescheduled]_): Status of the appointment (e.g. `"checked_in"`)
- **`cancellationReason`** (Optional, _string_): Cancellation reason (e.g. `"Patient canceled due to personal reasons."`)
- **`consultationNotes`** (Optional, _string_): Consultation notes (e.g. `"Completed prescription details."`)
- **`reminderSent`** (Optional, _boolean_): Whether the reminder has been sent (e.g. `true`)

**Request Example:**

```json
{
  "doctorId": "cuid-doctor-456",
  "appointmentDate": "2026-06-11",
  "appointmentTime": "10:00",
  "durationMinutes": 45,
  "appointmentType": "emergency",
  "chiefComplaint": "Severe headache",
  "notes": "Update patient room info.",
  "departmentId": "cuid-department-789",
  "status": "checked_in",
  "cancellationReason": "Patient canceled due to personal reasons.",
  "consultationNotes": "Completed prescription details.",
  "reminderSent": true
}
```

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "patientId": "string",
      "doctorId": "string",
      "appointmentDate": "2026-06-13T16:39:03.287Z",
      "appointmentTime": "string",
      "durationMinutes": 0,
      "appointmentType": "string",
      "departmentId": "string",
      "status": "string",
      "chiefComplaint": "string",
      "notes": "string",
      "consultationNotes": "string",
      "checkedInAt": "2026-06-13T16:39:03.287Z",
      "checkedInById": "string",
      "startedAt": "2026-06-13T16:39:03.287Z",
      "completedAt": "2026-06-13T16:39:03.287Z",
      "cancelledAt": "2026-06-13T16:39:03.287Z",
      "cancelledById": "string",
      "cancellationReason": "string",
      "rescheduledFromId": "string",
      "rescheduledToId": "string",
      "reminderSent": false,
      "reminderSentAt": "2026-06-13T16:39:03.287Z",
      "createdAt": "2026-06-13T16:39:03.287Z",
      "updatedAt": "2026-06-13T16:39:03.287Z",
      "createdById": "string",
      "patient": {
        "id": "string",
        "mrn": "string",
        "firstName": "string",
        "lastName": "string",
        "phonePrimary": "string",
        "gender": "string",
        "dateOfBirth": "2026-06-13T16:39:03.287Z"
      },
      "doctor": {
        "id": "string",
        "fullName": "string",
        "specialization": "string"
      }
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.287Z"
  }
  ```

---

### `DELETE /api/appointments/{id}`

**Purpose:** Cancel/soft-delete appointment record

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `204`**:

---

## 📦 Billing Module

### `GET /api/billing`

**Purpose:** Multiplexed GET route matching Next.js API compatibility

- **Authentication Required:** ✅ Yes

**Query Parameters:**

- `resource` (Optional): _(type: string) (default: `invoices`)_
- `category` (Optional): _(type: string)_
- `status` (Optional): _(type: string)_
- `patientId` (Optional): _(type: string)_
- `invoiceId` (Optional): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:

  ```json
  {
    "success": true,
    "data": [
      {
        "id": "cmqckme00001603ijtlwfju5t",
        "organizationId": "string",
        "patientId": "string",
        "consultationId": null,
        "invoiceNumber": "INV1781368181481",
        "invoiceDate": "2026-06-13T16:29:41.481Z",
        "dueDate": null,
        "items": "[{\"type\":\"service\",\"referenceId\":\"srv-cuid\",\"description\":\"Consultation Fee\",\"quantity\":1,\"unitPrice\":350,\"tax\":0,\"total\":350}]",
        "subtotal": 350,
        "discountAmount": 50,
        "discountPercentage": 0,
        "taxAmount": 0,
        "totalAmount": 300,
        "paymentStatus": "partially_paid",
        "amountPaid": 150,
        "balanceDue": 150,
        "insuranceClaimAmount": 0,
        "insuranceClaimStatus": null,
        "patientCopayAmount": 0,
        "status": "sent",
        "notes": "Payment due on receipt",
        "termsAndConditions": null,
        "createdAt": "2026-06-13T16:29:41.856Z",
        "updatedAt": "2026-06-13T16:29:44.077Z",
        "createdById": "string",
        "cancelledAt": null,
        "cancelledById": null,
        "cancellationReason": null,
        "patient": {
          "id": "string",
          "mrn": "MRN202606135049",
          "firstName": "John",
          "lastName": "Doe",
          "phonePrimary": null,
          "hasInsurance": false,
          "insuranceProvider": null
        },
        "payments": []
      }
    ],
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `GET /api/billing/invoices`

**Purpose:** Get all invoices

* **Authentication Required:** ✅ Yes

**Query Parameters:**
- `status` (Optional): Filter by status:  *(type: string)*
- `patientId` (Optional): Filter by patient ID:  *(type: string)*

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
{
  "success": true,
  "data": [
    {
      "patientId": "patient-cuid",
      "consultationId": "consultation-cuid",
      "items": [
        {
          "type": "service",
          "referenceId": "srv-cuid",
          "description": "Consultation Fee",
          "quantity": 1,
          "unitPrice": 250,
          "discount": 0,
          "tax": 0,
          "total": 250
        }
      ],
      "discountAmount": 0,
      "discountPercentage": 0,
      "notes": "Payment due on receipt.",
      "dueDate": "2026-06-30"
    }
  ],
  "message": null,
  "errorCode": null,
  "timestamp": "2026-06-13T16:39:03.287Z"
}
````

---

### `GET /api/billing/payments`

**Purpose:** Get all payment transaction records

- **Authentication Required:** ✅ Yes

**Query Parameters:**

- `invoiceId` (Required): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": [
      {
        "invoiceId": "invoice-cuid",
        "patientId": "patient-cuid",
        "amount": 250,
        "paymentMethod": "cash",
        "paymentReference": "TXN-998877",
        "mobileMoneyProvider": "CBE Birr",
        "bankName": "Commercial Bank of Ethiopia",
        "chequeNumber": "CHQ-112233",
        "notes": "Payment received in full."
      }
    ],
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.287Z"
  }
  ```

---

### `GET /api/billing/services`

**Purpose:** Get all active billing services

- **Authentication Required:** ✅ Yes

**Query Parameters:**

- `category` (Required): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": [
      {
        "serviceName": "General Consultation",
        "serviceCode": "SRV-001",
        "serviceCategory": "consultation",
        "department": "Outpatient",
        "unitPrice": 250,
        "isTaxable": false,
        "taxPercentage": 15,
        "isCoveredByInsurance": true,
        "insuranceCopayPercentage": 20,
        "description": "Standard outpatient consultation fee"
      }
    ],
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.287Z"
  }
  ```

---

### `GET /api/billing/stats`

**Purpose:** Get billing dashboard statistics

- **Authentication Required:** ✅ Yes

**Request Body:** None.

**Responses:**

- **Status `200`**:

  ```json
  {
    "success": true,
    "data": {
      "todayRevenue": 300,
      "pendingInvoices": 2,
      "collectedToday": 300,
      "outstandingBalance": 300,
      "totalServices": 2
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `POST /api/billing`

**Purpose:** Multiplexed POST route matching Next.js API compatibility

* **Authentication Required:** ✅ Yes

**Request Body:**

- **`resource`** (Optional, *string [enum: invoice, service, payment]*):
- **`serviceName`** (Optional, *string*):
- **`serviceCode`** (Optional, *string*):
- **`serviceCategory`** (Optional, *string*):
- **`department`** (Optional, *string*):
- **`unitPrice`** (Optional, *number*):
- **`isTaxable`** (Optional, *boolean*):
- **`taxPercentage`** (Optional, *number*):
- **`isCoveredByInsurance`** (Optional, *boolean*):
- **`insuranceCopayPercentage`** (Optional, *number*):
- **`patientId`** (Optional, *string*):
- **`consultationId`** (Optional, *string*):
- **`items`** (Optional, *array*):
  - Items properties:
    - **`type`** (Required, *string*):  (e.g. `"service"`)
    - **`referenceId`** (Optional, *string*):  (e.g. `"srv-cuid"`)
    - **`description`** (Required, *string*):  (e.g. `"Consultation Fee"`)
    - **`quantity`** (Required, *number*):  (e.g. `1`)
    - **`unitPrice`** (Required, *number*):  (e.g. `250`)
    - **`discount`** (Optional, *number*):  (e.g. `0`)
    - **`tax`** (Optional, *number*):  (e.g. `0`)
    - **`total`** (Required, *number*):  (e.g. `250`)
- **`discountAmount`** (Optional, *number*):
- **`discountPercentage`** (Optional, *number*):
- **`invoiceId`** (Optional, *string*):
- **`amount`** (Optional, *number*):
- **`paymentMethod`** (Optional, *string*):
- **`paymentReference`** (Optional, *string*):
- **`mobileMoneyProvider`** (Optional, *string*):
- **`bankName`** (Optional, *string*):
- **`chequeNumber`** (Optional, *string*):
- **`description`** (Optional, *string*):
- **`notes`** (Optional, *string*):

**Request Example:**
```json
{
  "resource": "string",
  "serviceName": "string",
  "serviceCode": "string",
  "serviceCategory": "string",
  "department": "string",
  "unitPrice": 0,
  "isTaxable": false,
  "taxPercentage": 0,
  "isCoveredByInsurance": false,
  "insuranceCopayPercentage": 0,
  "patientId": "string",
  "consultationId": "string",
  "items": [
    {
      "type": "service",
      "referenceId": "srv-cuid",
      "description": "Consultation Fee",
      "quantity": 1,
      "unitPrice": 250,
      "discount": 0,
      "tax": 0,
      "total": 250
    }
  ],
  "discountAmount": 0,
  "discountPercentage": 0,
  "invoiceId": "string",
  "amount": 0,
  "paymentMethod": "string",
  "paymentReference": "string",
  "mobileMoneyProvider": "string",
  "bankName": "string",
  "chequeNumber": "string",
  "description": "string",
  "notes": "string"
}
````

**Responses:**

- **Status `201`**:

  ```json
  {
    "success": true,
    "data": {
      "note": "Response shape depends on the \"resource\" param. See POST /api/billing/invoices, /api/billing/payments, or /api/billing/services for specific shapes."
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `POST /api/billing/invoices`

**Purpose:** Create a new draft invoice

* **Authentication Required:** ✅ Yes

**Request Body:**

- **`patientId`** (Required, *string*):  (e.g. `"patient-cuid"`)
- **`consultationId`** (Optional, *string*):  (e.g. `"consultation-cuid"`)
- **`items`** (Required, *array*):
  - Items properties:
    - **`type`** (Required, *string*):  (e.g. `"service"`)
    - **`referenceId`** (Optional, *string*):  (e.g. `"srv-cuid"`)
    - **`description`** (Required, *string*):  (e.g. `"Consultation Fee"`)
    - **`quantity`** (Required, *number*):  (e.g. `1`)
    - **`unitPrice`** (Required, *number*):  (e.g. `250`)
    - **`discount`** (Optional, *number*):  (e.g. `0`)
    - **`tax`** (Optional, *number*):  (e.g. `0`)
    - **`total`** (Required, *number*):  (e.g. `250`)
- **`discountAmount`** (Optional, *number*):  (e.g. `0`)
- **`discountPercentage`** (Optional, *number*):  (e.g. `0`)
- **`notes`** (Optional, *string*):  (e.g. `"Payment due on receipt."`)
- **`dueDate`** (Optional, *string*):  (e.g. `"2026-06-30"`)

**Request Example:**
```json
{
  "patientId": "patient-cuid",
  "consultationId": "consultation-cuid",
  "items": [
    {
      "type": "service",
      "referenceId": "srv-cuid",
      "description": "Consultation Fee",
      "quantity": 1,
      "unitPrice": 250,
      "discount": 0,
      "tax": 0,
      "total": 250
    }
  ],
  "discountAmount": 0,
  "discountPercentage": 0,
  "notes": "Payment due on receipt.",
  "dueDate": "2026-06-30"
}
````

**Responses:**

- **Status `201`**:

  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "patientId": "string",
      "consultationId": null,
      "invoiceNumber": "INV1781368181481",
      "invoiceDate": "2026-06-13T16:29:41.481Z",
      "dueDate": "2026-06-30T00:00:00.000Z",
      "items": "[{\"type\":\"service\",\"referenceId\":\"srv-cuid\",\"description\":\"Consultation Fee\",\"quantity\":1,\"unitPrice\":250,\"discount\":0,\"tax\":0,\"total\":250}]",
      "subtotal": 250,
      "discountAmount": 0,
      "discountPercentage": 0,
      "taxAmount": 0,
      "totalAmount": 250,
      "paymentStatus": "unpaid",
      "amountPaid": 0,
      "balanceDue": 250,
      "insuranceClaimAmount": 0,
      "insuranceClaimStatus": null,
      "patientCopayAmount": 0,
      "status": "draft",
      "notes": "Payment due on receipt.",
      "termsAndConditions": null,
      "createdAt": "2026-06-13T16:29:41.856Z",
      "updatedAt": "2026-06-13T16:29:41.856Z",
      "createdById": "string",
      "cancelledAt": null,
      "cancelledById": null,
      "cancellationReason": null
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `POST /api/billing/payments`

**Purpose:** Record a new payment transaction against an invoice

* **Authentication Required:** ✅ Yes

**Request Body:**

- **`invoiceId`** (Required, *string*):  (e.g. `"invoice-cuid"`)
- **`patientId`** (Optional, *string*):  (e.g. `"patient-cuid"`)
- **`amount`** (Required, *number*):  (e.g. `250`)
- **`paymentMethod`** (Required, *string*):  (e.g. `"cash"`)
- **`paymentReference`** (Optional, *string*):  (e.g. `"TXN-998877"`)
- **`mobileMoneyProvider`** (Optional, *string*):  (e.g. `"CBE Birr"`)
- **`bankName`** (Optional, *string*):  (e.g. `"Commercial Bank of Ethiopia"`)
- **`chequeNumber`** (Optional, *string*):  (e.g. `"CHQ-112233"`)
- **`notes`** (Optional, *string*):  (e.g. `"Payment received in full."`)

**Request Example:**
```json
{
  "invoiceId": "invoice-cuid",
  "patientId": "patient-cuid",
  "amount": 250,
  "paymentMethod": "cash",
  "paymentReference": "TXN-998877",
  "mobileMoneyProvider": "CBE Birr",
  "bankName": "Commercial Bank of Ethiopia",
  "chequeNumber": "CHQ-112233",
  "notes": "Payment received in full."
}
````

**Responses:**

- **Status `201`**:

  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "invoiceId": "string",
      "patientId": "string",
      "paymentDate": "2026-06-13T17:04:00.000Z",
      "receiptNumber": "RCP1781368182583",
      "amount": 250,
      "paymentMethod": "cash",
      "paymentReference": "TXN-998877",
      "mobileMoneyProvider": null,
      "bankName": null,
      "chequeNumber": null,
      "notes": "Payment received in full.",
      "createdById": "string",
      "createdAt": "2026-06-13T17:04:00.000Z"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `POST /api/billing/services`

**Purpose:** Create a new billing service catalog entry

* **Authentication Required:** ✅ Yes

**Request Body:**

- **`serviceName`** (Required, *string*):  (e.g. `"General Consultation"`)
- **`serviceCode`** (Optional, *string*):  (e.g. `"SRV-001"`)
- **`serviceCategory`** (Optional, *string*):  (e.g. `"consultation"`)
- **`department`** (Optional, *string*):  (e.g. `"Outpatient"`)
- **`unitPrice`** (Required, *number*):  (e.g. `250`)
- **`isTaxable`** (Optional, *boolean*):  (e.g. `false`)
- **`taxPercentage`** (Optional, *number*):  (e.g. `15`)
- **`isCoveredByInsurance`** (Optional, *boolean*):  (e.g. `true`)
- **`insuranceCopayPercentage`** (Optional, *number*):  (e.g. `20`)
- **`description`** (Optional, *string*):  (e.g. `"Standard outpatient consultation fee"`)

**Request Example:**
```json
{
  "serviceName": "General Consultation",
  "serviceCode": "SRV-001",
  "serviceCategory": "consultation",
  "department": "Outpatient",
  "unitPrice": 250,
  "isTaxable": false,
  "taxPercentage": 15,
  "isCoveredByInsurance": true,
  "insuranceCopayPercentage": 20,
  "description": "Standard outpatient consultation fee"
}
````

**Responses:**

- **Status `201`**:

  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "serviceName": "General Consultation",
      "serviceCode": "SRV-001",
      "serviceCategory": "consultation",
      "department": "Outpatient",
      "unitPrice": 250,
      "isTaxable": false,
      "taxPercentage": 15,
      "isCoveredByInsurance": true,
      "insuranceCopayPercentage": 20,
      "description": "Standard outpatient consultation fee",
      "isActive": true,
      "createdAt": "2026-06-13T17:04:00.000Z",
      "updatedAt": "2026-06-13T17:04:00.000Z"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `PATCH /api/billing`

**Purpose:** Multiplexed PATCH route matching Next.js API compatibility

* **Authentication Required:** ✅ Yes

**Request Body:**

- **`resource`** (Required, *string [enum: invoice, service]*):
- **`id`** (Required, *string*):  (e.g. `"record-cuid"`)
- **`status`** (Optional, *string*):
- **`paymentStatus`** (Optional, *string*):
- **`cancellationReason`** (Optional, *string*):
- **`serviceName`** (Optional, *string*):
- **`serviceCode`** (Optional, *string*):
- **`serviceCategory`** (Optional, *string*):
- **`department`** (Optional, *string*):
- **`unitPrice`** (Optional, *number*):
- **`isTaxable`** (Optional, *boolean*):
- **`taxPercentage`** (Optional, *number*):
- **`isCoveredByInsurance`** (Optional, *boolean*):
- **`insuranceCopayPercentage`** (Optional, *number*):
- **`description`** (Optional, *string*):
- **`notes`** (Optional, *string*):
- **`isActive`** (Optional, *boolean*):

**Request Example:**
```json
{
  "resource": "string",
  "id": "record-cuid",
  "status": "string",
  "paymentStatus": "string",
  "cancellationReason": "string",
  "serviceName": "string",
  "serviceCode": "string",
  "serviceCategory": "string",
  "department": "string",
  "unitPrice": 0,
  "isTaxable": false,
  "taxPercentage": 0,
  "isCoveredByInsurance": false,
  "insuranceCopayPercentage": 0,
  "description": "string",
  "notes": "string",
  "isActive": false
}
````

**Responses:**

- **Status `200`**:

  ```json
  {
    "success": true,
    "data": {
      "note": "Response shape depends on the \"resource\" param. See PATCH /api/billing/invoices/{id} or /api/billing/services/{id} for specific shapes."
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `PATCH /api/billing/invoices/{id}`

**Purpose:** Update or cancel an invoice

* **Authentication Required:** ✅ Yes

**Path Parameters:**
- `id` (Required):  *(type: string)*

**Request Body:**

- **`status`** (Optional, *string*):  (e.g. `"sent"`)
- **`paymentStatus`** (Optional, *string*):  (e.g. `"paid"`)
- **`notes`** (Optional, *string*):  (e.g. `"Patient requested bill revision."`)
- **`cancellationReason`** (Optional, *string*):  (e.g. `"Insurance claims pending approval."`)

**Request Example:**
```json
{
  "status": "sent",
  "paymentStatus": "paid",
  "notes": "Patient requested bill revision.",
  "cancellationReason": "Insurance claims pending approval."
}
````

**Responses:**

- **Status `200`**:

  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "patientId": "string",
      "consultationId": null,
      "invoiceNumber": "INV1781368181481",
      "invoiceDate": "2026-06-13T16:29:41.481Z",
      "dueDate": "2026-06-30T00:00:00.000Z",
      "items": "[{\"type\":\"service\",\"description\":\"Consultation Fee\",\"quantity\":1,\"unitPrice\":250,\"total\":250}]",
      "subtotal": 250,
      "discountAmount": 0,
      "discountPercentage": 0,
      "taxAmount": 0,
      "totalAmount": 250,
      "paymentStatus": "paid",
      "amountPaid": 250,
      "balanceDue": 0,
      "insuranceClaimAmount": 0,
      "insuranceClaimStatus": null,
      "patientCopayAmount": 0,
      "status": "sent",
      "notes": "Patient requested bill revision.",
      "termsAndConditions": null,
      "createdAt": "2026-06-13T16:29:41.856Z",
      "updatedAt": "2026-06-13T17:04:00.000Z",
      "createdById": "string",
      "cancelledAt": null,
      "cancelledById": null,
      "cancellationReason": null
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `PATCH /api/billing/services/{id}`

**Purpose:** Update a billing service

* **Authentication Required:** ✅ Yes

**Path Parameters:**
- `id` (Required):  *(type: string)*

**Request Body:**

- **`serviceName`** (Optional, *string*):  (e.g. `"General Consultation"`)
- **`serviceCode`** (Optional, *string*):  (e.g. `"SRV-001"`)
- **`serviceCategory`** (Optional, *string*):  (e.g. `"consultation"`)
- **`department`** (Optional, *string*):  (e.g. `"Outpatient"`)
- **`unitPrice`** (Optional, *number*):  (e.g. `250`)
- **`isTaxable`** (Optional, *boolean*):  (e.g. `false`)
- **`taxPercentage`** (Optional, *number*):  (e.g. `15`)
- **`isCoveredByInsurance`** (Optional, *boolean*):  (e.g. `true`)
- **`insuranceCopayPercentage`** (Optional, *number*):  (e.g. `20`)
- **`description`** (Optional, *string*):  (e.g. `"Standard outpatient consultation fee"`)
- **`isActive`** (Optional, *boolean*):  (e.g. `true`)

**Request Example:**
```json
{
  "serviceName": "General Consultation",
  "serviceCode": "SRV-001",
  "serviceCategory": "consultation",
  "department": "Outpatient",
  "unitPrice": 250,
  "isTaxable": false,
  "taxPercentage": 15,
  "isCoveredByInsurance": true,
  "insuranceCopayPercentage": 20,
  "description": "Standard outpatient consultation fee",
  "isActive": true
}
````

**Responses:**

- **Status `200`**:

  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "serviceName": "General Consultation",
      "serviceCode": "SRV-001",
      "serviceCategory": "consultation",
      "department": "Outpatient",
      "unitPrice": 250,
      "isTaxable": false,
      "taxPercentage": 15,
      "isCoveredByInsurance": true,
      "insuranceCopayPercentage": 20,
      "description": "Standard outpatient consultation fee",
      "isActive": true,
      "createdAt": "2026-06-13T16:29:41.856Z",
      "updatedAt": "2026-06-13T17:04:00.000Z"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

## 📦 Consultations Module

### `GET /api/consultations`

**Purpose:** List consultations with filters and pagination

* **Authentication Required:** ✅ Yes

**Query Parameters:**
- `page` (Optional): Page number (1-indexed) *(type: number) (default: `1`)*
- `limit` (Optional): Items per page (max 100) *(type: number) (default: `10`)*
- `orderBy` (Optional): Field to order by *(type: string)*
- `orderDir` (Optional):  *(type: string) (default: `desc`)*
- `patientId` (Optional): Filter consultations by patient ID *(type: string)*
- `doctorId` (Optional): Filter consultations by doctor ID *(type: string)*
- `date` (Optional): Filter consultations by date (YYYY-MM-DD) *(type: string)*

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
{
  "success": true,
  "data": {
    "data": [
      {
        "id": "string",
        "organizationId": "string",
        "patientId": "string",
        "appointmentId": "string",
        "doctorId": "string",
        "visitDate": "2026-06-13T16:39:03.288Z",
        "visitType": "string",
        "temperature": 0,
        "bloodPressureSystolic": 0,
        "bloodPressureDiastolic": 0,
        "pulseRate": 0,
        "respiratoryRate": 0,
        "weight": 0,
        "height": 0,
        "oxygenSaturation": 0,
        "chiefComplaint": "string",
        "historyOfPresentIllness": "string",
        "physicalExamination": "string",
        "diagnosis": "string",
        "icd10Codes": "string",
        "treatmentPlan": "string",
        "followUpInstructions": "string",
        "followUpDate": "2026-06-13T16:39:03.288Z",
        "referredTo": "string",
        "referralReason": "string",
        "notes": "string",
        "attachments": "string",
        "isDeleted": false,
        "deletedAt": "2026-06-13T16:39:03.288Z",
        "createdAt": "2026-06-13T16:39:03.288Z",
        "updatedAt": "2026-06-13T16:39:03.288Z",
        "createdById": "string",
        "patient": {
          "id": "string",
          "mrn": "string",
          "firstName": "string",
          "lastName": "string",
          "phonePrimary": "string",
          "gender": "string",
          "dateOfBirth": "2026-06-13T16:39:03.288Z"
        },
        "doctor": {
          "id": "string",
          "fullName": "string",
          "specialization": "string"
        },
        "prescriptions": [
          {
            "id": "string",
            "organizationId": "string",
            "patientId": "string",
            "consultationId": "string",
            "doctorId": "string",
            "prescriptionDate": "2026-06-13T16:39:03.288Z",
            "items": "string",
            "status": "string",
            "dispensedById": "string",
            "dispensedAt": "2026-06-13T16:39:03.288Z",
            "notes": "string",
            "isRefill": false,
            "refillsAllowed": 0,
            "refillsRemaining": 0,
            "createdAt": "2026-06-13T16:39:03.288Z",
            "updatedAt": "2026-06-13T16:39:03.288Z"
          }
        ],
        "labOrders": [
          {
            "id": "order-cuid",
            "organizationId": "org-demo",
            "patientId": "patient-cuid",
            "consultationId": "consultation-cuid",
            "requestedById": "user-admin",
            "orderDate": "2024-01-01T00:00:00.000Z",
            "orderNumber": "LAB123456789",
            "tests": "[{\"testId\":\"id\",\"testName\":\"name\"}]",
            "clinicalIndication": "clinicalIndication",
            "provisionalDiagnosis": "provisionalDiagnosis",
            "priority": "routine",
            "status": "pending",
            "sampleCollectedAt": "2024-01-01T00:00:00.000Z",
            "sampleCollectedById": "sampleCollectedById",
            "accessionNumber": "accessionNumber",
            "resultsEnteredAt": "2024-01-01T00:00:00.000Z",
            "resultsEnteredById": "resultsEnteredById",
            "resultsVerifiedAt": "2024-01-01T00:00:00.000Z",
            "resultsVerifiedById": "resultsVerifiedById",
            "resultsReportedAt": "2024-01-01T00:00:00.000Z",
            "notes": "notes",
            "rejectionReason": "rejectionReason",
            "createdAt": "2024-01-01T00:00:00.000Z",
            "updatedAt": "2024-01-01T00:00:00.000Z",
            "createdById": "user-admin"
          }
        ],
        "radiologyOrders": [
          {
            "id": "order-cuid",
            "organizationId": "org-demo",
            "patientId": "patient-cuid",
            "consultationId": "consultation-cuid",
            "requestedById": "user-cuid",
            "examId": "exam-cuid",
            "orderDate": "2026-06-10T00:00:00.000Z",
            "orderNumber": "RAD1718000000000",
            "clinicalIndication": "Persistent cough",
            "provisionalDiagnosis": "Pneumonia",
            "relevantHistory": "Fever for 5 days",
            "urgency": "routine",
            "status": "pending",
            "scheduledDate": "2026-06-10T10:00:00.000Z",
            "examPerformedAt": "2026-06-10T10:30:00.000Z",
            "performedById": "user-cuid",
            "reportCreatedAt": "2026-06-10T11:00:00.000Z",
            "reportedById": "user-cuid",
            "reportVerifiedAt": "2026-06-10T12:00:00.000Z",
            "verifiedById": "user-cuid",
            "notes": "Wheelchair patient",
            "cancellationReason": "Patient did not arrive",
            "createdAt": "2026-06-10T00:00:00.000Z",
            "updatedAt": "2026-06-10T00:00:00.000Z",
            "createdById": "user-cuid"
          }
        ]
      }
    ],
    "meta": {
      "total": 100,
      "lastPage": 10,
      "currentPage": 1,
      "perPage": 10,
      "prev": null,
      "next": 2
    }
  },
  "message": null,
  "errorCode": null,
  "timestamp": "2026-06-13T16:39:03.288Z"
}
````

---

### `GET /api/consultations/{id}`

**Purpose:** Get details of a single consultation record

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "patientId": "string",
      "appointmentId": "string",
      "doctorId": "string",
      "visitDate": "2026-06-13T16:39:03.288Z",
      "visitType": "string",
      "temperature": 0,
      "bloodPressureSystolic": 0,
      "bloodPressureDiastolic": 0,
      "pulseRate": 0,
      "respiratoryRate": 0,
      "weight": 0,
      "height": 0,
      "oxygenSaturation": 0,
      "chiefComplaint": "string",
      "historyOfPresentIllness": "string",
      "physicalExamination": "string",
      "diagnosis": "string",
      "icd10Codes": "string",
      "treatmentPlan": "string",
      "followUpInstructions": "string",
      "followUpDate": "2026-06-13T16:39:03.288Z",
      "referredTo": "string",
      "referralReason": "string",
      "notes": "string",
      "attachments": "string",
      "isDeleted": false,
      "deletedAt": "2026-06-13T16:39:03.288Z",
      "createdAt": "2026-06-13T16:39:03.288Z",
      "updatedAt": "2026-06-13T16:39:03.288Z",
      "createdById": "string",
      "patient": {
        "id": "string",
        "mrn": "string",
        "firstName": "string",
        "lastName": "string",
        "phonePrimary": "string",
        "gender": "string",
        "dateOfBirth": "2026-06-13T16:39:03.288Z"
      },
      "doctor": {
        "id": "string",
        "fullName": "string",
        "specialization": "string"
      },
      "prescriptions": [
        {
          "id": "string",
          "organizationId": "string",
          "patientId": "string",
          "consultationId": "string",
          "doctorId": "string",
          "prescriptionDate": "2026-06-13T16:39:03.288Z",
          "items": "string",
          "status": "string",
          "dispensedById": "string",
          "dispensedAt": "2026-06-13T16:39:03.288Z",
          "notes": "string",
          "isRefill": false,
          "refillsAllowed": 0,
          "refillsRemaining": 0,
          "createdAt": "2026-06-13T16:39:03.288Z",
          "updatedAt": "2026-06-13T16:39:03.288Z"
        }
      ],
      "labOrders": [
        {
          "id": "order-cuid",
          "organizationId": "org-demo",
          "patientId": "patient-cuid",
          "consultationId": "consultation-cuid",
          "requestedById": "user-admin",
          "orderDate": "2024-01-01T00:00:00.000Z",
          "orderNumber": "LAB123456789",
          "tests": "[{\"testId\":\"id\",\"testName\":\"name\"}]",
          "clinicalIndication": "clinicalIndication",
          "provisionalDiagnosis": "provisionalDiagnosis",
          "priority": "routine",
          "status": "pending",
          "sampleCollectedAt": "2024-01-01T00:00:00.000Z",
          "sampleCollectedById": "sampleCollectedById",
          "accessionNumber": "accessionNumber",
          "resultsEnteredAt": "2024-01-01T00:00:00.000Z",
          "resultsEnteredById": "resultsEnteredById",
          "resultsVerifiedAt": "2024-01-01T00:00:00.000Z",
          "resultsVerifiedById": "resultsVerifiedById",
          "resultsReportedAt": "2024-01-01T00:00:00.000Z",
          "notes": "notes",
          "rejectionReason": "rejectionReason",
          "createdAt": "2024-01-01T00:00:00.000Z",
          "updatedAt": "2024-01-01T00:00:00.000Z",
          "createdById": "user-admin"
        }
      ],
      "radiologyOrders": [
        {
          "id": "order-cuid",
          "organizationId": "org-demo",
          "patientId": "patient-cuid",
          "consultationId": "consultation-cuid",
          "requestedById": "user-cuid",
          "examId": "exam-cuid",
          "orderDate": "2026-06-10T00:00:00.000Z",
          "orderNumber": "RAD1718000000000",
          "clinicalIndication": "Persistent cough",
          "provisionalDiagnosis": "Pneumonia",
          "relevantHistory": "Fever for 5 days",
          "urgency": "routine",
          "status": "pending",
          "scheduledDate": "2026-06-10T10:00:00.000Z",
          "examPerformedAt": "2026-06-10T10:30:00.000Z",
          "performedById": "user-cuid",
          "reportCreatedAt": "2026-06-10T11:00:00.000Z",
          "reportedById": "user-cuid",
          "reportVerifiedAt": "2026-06-10T12:00:00.000Z",
          "verifiedById": "user-cuid",
          "notes": "Wheelchair patient",
          "cancellationReason": "Patient did not arrive",
          "createdAt": "2026-06-10T00:00:00.000Z",
          "updatedAt": "2026-06-10T00:00:00.000Z",
          "createdById": "user-cuid"
        }
      ]
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.288Z"
  }
  ```

---

### `POST /api/consultations`

**Purpose:** Create a new clinical consultation record

- **Authentication Required:** ✅ Yes

**Request Body:**

- **`patientId`** (Required, _string_): Patient ID (e.g. `"cuid-patient-123"`)
- **`doctorId`** (Required, _string_): Doctor ID (e.g. `"cuid-doctor-456"`)
- **`appointmentId`** (Optional, _string_): Optional linked appointment ID (e.g. `"cuid-appointment-789"`)
- **`visitType`** (Optional, _string_): Type of visit (e.g., outpatient, emergency, follow_up) (e.g. `"outpatient"`)
- **`temperature`** (Optional, _number_): Temperature in Celsius (e.g. `36.8`)
- **`bloodPressureSystolic`** (Optional, _number_): Systolic blood pressure (e.g. `120`)
- **`bloodPressureDiastolic`** (Optional, _number_): Diastolic blood pressure (e.g. `80`)
- **`pulseRate`** (Optional, _number_): Pulse rate (beats per minute) (e.g. `72`)
- **`respiratoryRate`** (Optional, _number_): Respiratory rate (breaths per minute) (e.g. `16`)
- **`weight`** (Optional, _number_): Weight in kg (e.g. `70.5`)
- **`height`** (Optional, _number_): Height in cm (e.g. `175`)
- **`oxygenSaturation`** (Optional, _number_): Oxygen saturation percentage (e.g. `98`)
- **`chiefComplaint`** (Optional, _string_): Chief complaint (e.g. `"Persistent cough and fever for 3 days"`)
- **`historyOfPresentIllness`** (Optional, _string_): History of present illness (e.g. `"Patient reports cough started mild, grew severe, accompanied by chills."`)
- **`physicalExamination`** (Optional, _string_): Physical examination details (e.g. `"Chest clear on auscultation, throat congested."`)
- **`diagnosis`** (Optional, _string_): Diagnosis text (e.g. `"Acute bronchitis"`)
- **`icd10Codes`** (Optional, _array_): List of ICD-10 codes
- **`treatmentPlan`** (Optional, _string_): Treatment plan description (e.g. `"Rest, hydrate, and take amoxicillin."`)
- **`followUpInstructions`** (Optional, _string_): Follow-up instructions (e.g. `"Return if fever persists after 48 hours of antibiotic."`)
- **`followUpDate`** (Optional, _string_): Follow-up date (e.g. `"2026-06-17T00:00:00.000Z"`)
- **`referredTo`** (Optional, _string_): Referred to doctor or specialty (e.g. `"Pulmonologist"`)
- **`referralReason`** (Optional, _string_): Reason for referral (e.g. `"For advanced lung function test."`)
- **`notes`** (Optional, _string_): Additional clinical notes (e.g. `"Patient advised to stop smoking."`)
- **`prescriptionItems`** (Optional, _array_): Optional list of prescription items to create
  - Items properties:
    - **`drugId`** (Required, _string_): ID of the drug (e.g. `"cuid-drug-123"`)
    - **`drugName`** (Required, _string_): Name of the drug (e.g. `"Amoxicillin 500mg"`)
    - **`genericName`** (Optional, _string_): Generic name of the drug (e.g. `"Amoxicillin"`)
    - **`dosage`** (Required, _string_): Dosage details (e.g. `"500mg"`)
    - **`frequency`** (Required, _string_): Frequency description (e.g. `"Three times daily"`)
    - **`duration`** (Required, _string_): Duration of treatment (e.g. `"7 days"`)
    - **`quantity`** (Required, _number_): Total quantity to dispense (e.g. `21`)
    - **`instructions`** (Optional, _string_): Special instructions (e.g. `"Take after meals"`)

**Request Example:**

```json
{
  "patientId": "cuid-patient-123",
  "doctorId": "cuid-doctor-456",
  "appointmentId": "cuid-appointment-789",
  "visitType": "outpatient",
  "temperature": 36.8,
  "bloodPressureSystolic": 120,
  "bloodPressureDiastolic": 80,
  "pulseRate": 72,
  "respiratoryRate": 16,
  "weight": 70.5,
  "height": 175,
  "oxygenSaturation": 98,
  "chiefComplaint": "Persistent cough and fever for 3 days",
  "historyOfPresentIllness": "Patient reports cough started mild, grew severe, accompanied by chills.",
  "physicalExamination": "Chest clear on auscultation, throat congested.",
  "diagnosis": "Acute bronchitis",
  "icd10Codes": [],
  "treatmentPlan": "Rest, hydrate, and take amoxicillin.",
  "followUpInstructions": "Return if fever persists after 48 hours of antibiotic.",
  "followUpDate": "2026-06-17T00:00:00.000Z",
  "referredTo": "Pulmonologist",
  "referralReason": "For advanced lung function test.",
  "notes": "Patient advised to stop smoking.",
  "prescriptionItems": [
    {
      "drugId": "cuid-drug-123",
      "drugName": "Amoxicillin 500mg",
      "genericName": "Amoxicillin",
      "dosage": "500mg",
      "frequency": "Three times daily",
      "duration": "7 days",
      "quantity": 21,
      "instructions": "Take after meals"
    }
  ]
}
```

**Responses:**

- **Status `201`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "patientId": "string",
      "appointmentId": "string",
      "doctorId": "string",
      "visitDate": "2026-06-13T16:39:03.288Z",
      "visitType": "string",
      "temperature": 0,
      "bloodPressureSystolic": 0,
      "bloodPressureDiastolic": 0,
      "pulseRate": 0,
      "respiratoryRate": 0,
      "weight": 0,
      "height": 0,
      "oxygenSaturation": 0,
      "chiefComplaint": "string",
      "historyOfPresentIllness": "string",
      "physicalExamination": "string",
      "diagnosis": "string",
      "icd10Codes": "string",
      "treatmentPlan": "string",
      "followUpInstructions": "string",
      "followUpDate": "2026-06-13T16:39:03.288Z",
      "referredTo": "string",
      "referralReason": "string",
      "notes": "string",
      "attachments": "string",
      "isDeleted": false,
      "deletedAt": "2026-06-13T16:39:03.288Z",
      "createdAt": "2026-06-13T16:39:03.288Z",
      "updatedAt": "2026-06-13T16:39:03.288Z",
      "createdById": "string",
      "patient": {
        "id": "string",
        "mrn": "string",
        "firstName": "string",
        "lastName": "string",
        "phonePrimary": "string",
        "gender": "string",
        "dateOfBirth": "2026-06-13T16:39:03.288Z"
      },
      "doctor": {
        "id": "string",
        "fullName": "string",
        "specialization": "string"
      },
      "prescriptions": [
        {
          "id": "string",
          "organizationId": "string",
          "patientId": "string",
          "consultationId": "string",
          "doctorId": "string",
          "prescriptionDate": "2026-06-13T16:39:03.288Z",
          "items": "string",
          "status": "string",
          "dispensedById": "string",
          "dispensedAt": "2026-06-13T16:39:03.288Z",
          "notes": "string",
          "isRefill": false,
          "refillsAllowed": 0,
          "refillsRemaining": 0,
          "createdAt": "2026-06-13T16:39:03.288Z",
          "updatedAt": "2026-06-13T16:39:03.288Z"
        }
      ],
      "labOrders": [
        {
          "id": "order-cuid",
          "organizationId": "org-demo",
          "patientId": "patient-cuid",
          "consultationId": "consultation-cuid",
          "requestedById": "user-admin",
          "orderDate": "2024-01-01T00:00:00.000Z",
          "orderNumber": "LAB123456789",
          "tests": "[{\"testId\":\"id\",\"testName\":\"name\"}]",
          "clinicalIndication": "clinicalIndication",
          "provisionalDiagnosis": "provisionalDiagnosis",
          "priority": "routine",
          "status": "pending",
          "sampleCollectedAt": "2024-01-01T00:00:00.000Z",
          "sampleCollectedById": "sampleCollectedById",
          "accessionNumber": "accessionNumber",
          "resultsEnteredAt": "2024-01-01T00:00:00.000Z",
          "resultsEnteredById": "resultsEnteredById",
          "resultsVerifiedAt": "2024-01-01T00:00:00.000Z",
          "resultsVerifiedById": "resultsVerifiedById",
          "resultsReportedAt": "2024-01-01T00:00:00.000Z",
          "notes": "notes",
          "rejectionReason": "rejectionReason",
          "createdAt": "2024-01-01T00:00:00.000Z",
          "updatedAt": "2024-01-01T00:00:00.000Z",
          "createdById": "user-admin"
        }
      ],
      "radiologyOrders": [
        {
          "id": "order-cuid",
          "organizationId": "org-demo",
          "patientId": "patient-cuid",
          "consultationId": "consultation-cuid",
          "requestedById": "user-cuid",
          "examId": "exam-cuid",
          "orderDate": "2026-06-10T00:00:00.000Z",
          "orderNumber": "RAD1718000000000",
          "clinicalIndication": "Persistent cough",
          "provisionalDiagnosis": "Pneumonia",
          "relevantHistory": "Fever for 5 days",
          "urgency": "routine",
          "status": "pending",
          "scheduledDate": "2026-06-10T10:00:00.000Z",
          "examPerformedAt": "2026-06-10T10:30:00.000Z",
          "performedById": "user-cuid",
          "reportCreatedAt": "2026-06-10T11:00:00.000Z",
          "reportedById": "user-cuid",
          "reportVerifiedAt": "2026-06-10T12:00:00.000Z",
          "verifiedById": "user-cuid",
          "notes": "Wheelchair patient",
          "cancellationReason": "Patient did not arrive",
          "createdAt": "2026-06-10T00:00:00.000Z",
          "updatedAt": "2026-06-10T00:00:00.000Z",
          "createdById": "user-cuid"
        }
      ]
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.288Z"
  }
  ```

---

### `PUT /api/consultations/{id}`

**Purpose:** Update an existing consultation record via PUT

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:**

- **`visitType`** (Optional, _string_): Type of visit (e.g., outpatient, emergency, follow_up) (e.g. `"outpatient"`)
- **`temperature`** (Optional, _number_): Temperature in Celsius (e.g. `36.8`)
- **`bloodPressureSystolic`** (Optional, _number_): Systolic blood pressure (e.g. `120`)
- **`bloodPressureDiastolic`** (Optional, _number_): Diastolic blood pressure (e.g. `80`)
- **`pulseRate`** (Optional, _number_): Pulse rate (beats per minute) (e.g. `72`)
- **`respiratoryRate`** (Optional, _number_): Respiratory rate (breaths per minute) (e.g. `16`)
- **`weight`** (Optional, _number_): Weight in kg (e.g. `70.5`)
- **`height`** (Optional, _number_): Height in cm (e.g. `175`)
- **`oxygenSaturation`** (Optional, _number_): Oxygen saturation percentage (e.g. `98`)
- **`chiefComplaint`** (Optional, _string_): Chief complaint (e.g. `"Persistent cough and fever for 3 days"`)
- **`historyOfPresentIllness`** (Optional, _string_): History of present illness (e.g. `"Patient reports cough started mild, grew severe, accompanied by chills."`)
- **`physicalExamination`** (Optional, _string_): Physical examination details (e.g. `"Chest clear on auscultation, throat congested."`)
- **`diagnosis`** (Optional, _string_): Diagnosis text (e.g. `"Acute bronchitis"`)
- **`icd10Codes`** (Optional, _array_): List of ICD-10 codes
- **`treatmentPlan`** (Optional, _string_): Treatment plan description (e.g. `"Rest, hydrate, and take amoxicillin."`)
- **`followUpInstructions`** (Optional, _string_): Follow-up instructions (e.g. `"Return if fever persists after 48 hours of antibiotic."`)
- **`followUpDate`** (Optional, _string_): Follow-up date (e.g. `"2026-06-17T00:00:00.000Z"`)
- **`referredTo`** (Optional, _string_): Referred to doctor or specialty (e.g. `"Pulmonologist"`)
- **`referralReason`** (Optional, _string_): Reason for referral (e.g. `"For advanced lung function test."`)
- **`notes`** (Optional, _string_): Additional clinical notes (e.g. `"Patient advised to stop smoking."`)

**Request Example:**

```json
{
  "visitType": "outpatient",
  "temperature": 36.8,
  "bloodPressureSystolic": 120,
  "bloodPressureDiastolic": 80,
  "pulseRate": 72,
  "respiratoryRate": 16,
  "weight": 70.5,
  "height": 175,
  "oxygenSaturation": 98,
  "chiefComplaint": "Persistent cough and fever for 3 days",
  "historyOfPresentIllness": "Patient reports cough started mild, grew severe, accompanied by chills.",
  "physicalExamination": "Chest clear on auscultation, throat congested.",
  "diagnosis": "Acute bronchitis",
  "icd10Codes": [],
  "treatmentPlan": "Rest, hydrate, and take amoxicillin.",
  "followUpInstructions": "Return if fever persists after 48 hours of antibiotic.",
  "followUpDate": "2026-06-17T00:00:00.000Z",
  "referredTo": "Pulmonologist",
  "referralReason": "For advanced lung function test.",
  "notes": "Patient advised to stop smoking."
}
```

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "patientId": "string",
      "appointmentId": "string",
      "doctorId": "string",
      "visitDate": "2026-06-13T16:39:03.289Z",
      "visitType": "string",
      "temperature": 0,
      "bloodPressureSystolic": 0,
      "bloodPressureDiastolic": 0,
      "pulseRate": 0,
      "respiratoryRate": 0,
      "weight": 0,
      "height": 0,
      "oxygenSaturation": 0,
      "chiefComplaint": "string",
      "historyOfPresentIllness": "string",
      "physicalExamination": "string",
      "diagnosis": "string",
      "icd10Codes": "string",
      "treatmentPlan": "string",
      "followUpInstructions": "string",
      "followUpDate": "2026-06-13T16:39:03.289Z",
      "referredTo": "string",
      "referralReason": "string",
      "notes": "string",
      "attachments": "string",
      "isDeleted": false,
      "deletedAt": "2026-06-13T16:39:03.289Z",
      "createdAt": "2026-06-13T16:39:03.289Z",
      "updatedAt": "2026-06-13T16:39:03.289Z",
      "createdById": "string",
      "patient": {
        "id": "string",
        "mrn": "string",
        "firstName": "string",
        "lastName": "string",
        "phonePrimary": "string",
        "gender": "string",
        "dateOfBirth": "2026-06-13T16:39:03.289Z"
      },
      "doctor": {
        "id": "string",
        "fullName": "string",
        "specialization": "string"
      },
      "prescriptions": [
        {
          "id": "string",
          "organizationId": "string",
          "patientId": "string",
          "consultationId": "string",
          "doctorId": "string",
          "prescriptionDate": "2026-06-13T16:39:03.289Z",
          "items": "string",
          "status": "string",
          "dispensedById": "string",
          "dispensedAt": "2026-06-13T16:39:03.289Z",
          "notes": "string",
          "isRefill": false,
          "refillsAllowed": 0,
          "refillsRemaining": 0,
          "createdAt": "2026-06-13T16:39:03.289Z",
          "updatedAt": "2026-06-13T16:39:03.289Z"
        }
      ],
      "labOrders": [
        {
          "id": "order-cuid",
          "organizationId": "org-demo",
          "patientId": "patient-cuid",
          "consultationId": "consultation-cuid",
          "requestedById": "user-admin",
          "orderDate": "2024-01-01T00:00:00.000Z",
          "orderNumber": "LAB123456789",
          "tests": "[{\"testId\":\"id\",\"testName\":\"name\"}]",
          "clinicalIndication": "clinicalIndication",
          "provisionalDiagnosis": "provisionalDiagnosis",
          "priority": "routine",
          "status": "pending",
          "sampleCollectedAt": "2024-01-01T00:00:00.000Z",
          "sampleCollectedById": "sampleCollectedById",
          "accessionNumber": "accessionNumber",
          "resultsEnteredAt": "2024-01-01T00:00:00.000Z",
          "resultsEnteredById": "resultsEnteredById",
          "resultsVerifiedAt": "2024-01-01T00:00:00.000Z",
          "resultsVerifiedById": "resultsVerifiedById",
          "resultsReportedAt": "2024-01-01T00:00:00.000Z",
          "notes": "notes",
          "rejectionReason": "rejectionReason",
          "createdAt": "2024-01-01T00:00:00.000Z",
          "updatedAt": "2024-01-01T00:00:00.000Z",
          "createdById": "user-admin"
        }
      ],
      "radiologyOrders": [
        {
          "id": "order-cuid",
          "organizationId": "org-demo",
          "patientId": "patient-cuid",
          "consultationId": "consultation-cuid",
          "requestedById": "user-cuid",
          "examId": "exam-cuid",
          "orderDate": "2026-06-10T00:00:00.000Z",
          "orderNumber": "RAD1718000000000",
          "clinicalIndication": "Persistent cough",
          "provisionalDiagnosis": "Pneumonia",
          "relevantHistory": "Fever for 5 days",
          "urgency": "routine",
          "status": "pending",
          "scheduledDate": "2026-06-10T10:00:00.000Z",
          "examPerformedAt": "2026-06-10T10:30:00.000Z",
          "performedById": "user-cuid",
          "reportCreatedAt": "2026-06-10T11:00:00.000Z",
          "reportedById": "user-cuid",
          "reportVerifiedAt": "2026-06-10T12:00:00.000Z",
          "verifiedById": "user-cuid",
          "notes": "Wheelchair patient",
          "cancellationReason": "Patient did not arrive",
          "createdAt": "2026-06-10T00:00:00.000Z",
          "updatedAt": "2026-06-10T00:00:00.000Z",
          "createdById": "user-cuid"
        }
      ]
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.289Z"
  }
  ```

---

### `PATCH /api/consultations/{id}`

**Purpose:** Update an existing consultation record via PATCH

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:**

- **`visitType`** (Optional, _string_): Type of visit (e.g., outpatient, emergency, follow_up) (e.g. `"outpatient"`)
- **`temperature`** (Optional, _number_): Temperature in Celsius (e.g. `36.8`)
- **`bloodPressureSystolic`** (Optional, _number_): Systolic blood pressure (e.g. `120`)
- **`bloodPressureDiastolic`** (Optional, _number_): Diastolic blood pressure (e.g. `80`)
- **`pulseRate`** (Optional, _number_): Pulse rate (beats per minute) (e.g. `72`)
- **`respiratoryRate`** (Optional, _number_): Respiratory rate (breaths per minute) (e.g. `16`)
- **`weight`** (Optional, _number_): Weight in kg (e.g. `70.5`)
- **`height`** (Optional, _number_): Height in cm (e.g. `175`)
- **`oxygenSaturation`** (Optional, _number_): Oxygen saturation percentage (e.g. `98`)
- **`chiefComplaint`** (Optional, _string_): Chief complaint (e.g. `"Persistent cough and fever for 3 days"`)
- **`historyOfPresentIllness`** (Optional, _string_): History of present illness (e.g. `"Patient reports cough started mild, grew severe, accompanied by chills."`)
- **`physicalExamination`** (Optional, _string_): Physical examination details (e.g. `"Chest clear on auscultation, throat congested."`)
- **`diagnosis`** (Optional, _string_): Diagnosis text (e.g. `"Acute bronchitis"`)
- **`icd10Codes`** (Optional, _array_): List of ICD-10 codes
- **`treatmentPlan`** (Optional, _string_): Treatment plan description (e.g. `"Rest, hydrate, and take amoxicillin."`)
- **`followUpInstructions`** (Optional, _string_): Follow-up instructions (e.g. `"Return if fever persists after 48 hours of antibiotic."`)
- **`followUpDate`** (Optional, _string_): Follow-up date (e.g. `"2026-06-17T00:00:00.000Z"`)
- **`referredTo`** (Optional, _string_): Referred to doctor or specialty (e.g. `"Pulmonologist"`)
- **`referralReason`** (Optional, _string_): Reason for referral (e.g. `"For advanced lung function test."`)
- **`notes`** (Optional, _string_): Additional clinical notes (e.g. `"Patient advised to stop smoking."`)

**Request Example:**

```json
{
  "visitType": "outpatient",
  "temperature": 36.8,
  "bloodPressureSystolic": 120,
  "bloodPressureDiastolic": 80,
  "pulseRate": 72,
  "respiratoryRate": 16,
  "weight": 70.5,
  "height": 175,
  "oxygenSaturation": 98,
  "chiefComplaint": "Persistent cough and fever for 3 days",
  "historyOfPresentIllness": "Patient reports cough started mild, grew severe, accompanied by chills.",
  "physicalExamination": "Chest clear on auscultation, throat congested.",
  "diagnosis": "Acute bronchitis",
  "icd10Codes": [],
  "treatmentPlan": "Rest, hydrate, and take amoxicillin.",
  "followUpInstructions": "Return if fever persists after 48 hours of antibiotic.",
  "followUpDate": "2026-06-17T00:00:00.000Z",
  "referredTo": "Pulmonologist",
  "referralReason": "For advanced lung function test.",
  "notes": "Patient advised to stop smoking."
}
```

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "patientId": "string",
      "appointmentId": "string",
      "doctorId": "string",
      "visitDate": "2026-06-13T16:39:03.289Z",
      "visitType": "string",
      "temperature": 0,
      "bloodPressureSystolic": 0,
      "bloodPressureDiastolic": 0,
      "pulseRate": 0,
      "respiratoryRate": 0,
      "weight": 0,
      "height": 0,
      "oxygenSaturation": 0,
      "chiefComplaint": "string",
      "historyOfPresentIllness": "string",
      "physicalExamination": "string",
      "diagnosis": "string",
      "icd10Codes": "string",
      "treatmentPlan": "string",
      "followUpInstructions": "string",
      "followUpDate": "2026-06-13T16:39:03.289Z",
      "referredTo": "string",
      "referralReason": "string",
      "notes": "string",
      "attachments": "string",
      "isDeleted": false,
      "deletedAt": "2026-06-13T16:39:03.289Z",
      "createdAt": "2026-06-13T16:39:03.289Z",
      "updatedAt": "2026-06-13T16:39:03.289Z",
      "createdById": "string",
      "patient": {
        "id": "string",
        "mrn": "string",
        "firstName": "string",
        "lastName": "string",
        "phonePrimary": "string",
        "gender": "string",
        "dateOfBirth": "2026-06-13T16:39:03.289Z"
      },
      "doctor": {
        "id": "string",
        "fullName": "string",
        "specialization": "string"
      },
      "prescriptions": [
        {
          "id": "string",
          "organizationId": "string",
          "patientId": "string",
          "consultationId": "string",
          "doctorId": "string",
          "prescriptionDate": "2026-06-13T16:39:03.289Z",
          "items": "string",
          "status": "string",
          "dispensedById": "string",
          "dispensedAt": "2026-06-13T16:39:03.289Z",
          "notes": "string",
          "isRefill": false,
          "refillsAllowed": 0,
          "refillsRemaining": 0,
          "createdAt": "2026-06-13T16:39:03.289Z",
          "updatedAt": "2026-06-13T16:39:03.289Z"
        }
      ],
      "labOrders": [
        {
          "id": "order-cuid",
          "organizationId": "org-demo",
          "patientId": "patient-cuid",
          "consultationId": "consultation-cuid",
          "requestedById": "user-admin",
          "orderDate": "2024-01-01T00:00:00.000Z",
          "orderNumber": "LAB123456789",
          "tests": "[{\"testId\":\"id\",\"testName\":\"name\"}]",
          "clinicalIndication": "clinicalIndication",
          "provisionalDiagnosis": "provisionalDiagnosis",
          "priority": "routine",
          "status": "pending",
          "sampleCollectedAt": "2024-01-01T00:00:00.000Z",
          "sampleCollectedById": "sampleCollectedById",
          "accessionNumber": "accessionNumber",
          "resultsEnteredAt": "2024-01-01T00:00:00.000Z",
          "resultsEnteredById": "resultsEnteredById",
          "resultsVerifiedAt": "2024-01-01T00:00:00.000Z",
          "resultsVerifiedById": "resultsVerifiedById",
          "resultsReportedAt": "2024-01-01T00:00:00.000Z",
          "notes": "notes",
          "rejectionReason": "rejectionReason",
          "createdAt": "2024-01-01T00:00:00.000Z",
          "updatedAt": "2024-01-01T00:00:00.000Z",
          "createdById": "user-admin"
        }
      ],
      "radiologyOrders": [
        {
          "id": "order-cuid",
          "organizationId": "org-demo",
          "patientId": "patient-cuid",
          "consultationId": "consultation-cuid",
          "requestedById": "user-cuid",
          "examId": "exam-cuid",
          "orderDate": "2026-06-10T00:00:00.000Z",
          "orderNumber": "RAD1718000000000",
          "clinicalIndication": "Persistent cough",
          "provisionalDiagnosis": "Pneumonia",
          "relevantHistory": "Fever for 5 days",
          "urgency": "routine",
          "status": "pending",
          "scheduledDate": "2026-06-10T10:00:00.000Z",
          "examPerformedAt": "2026-06-10T10:30:00.000Z",
          "performedById": "user-cuid",
          "reportCreatedAt": "2026-06-10T11:00:00.000Z",
          "reportedById": "user-cuid",
          "reportVerifiedAt": "2026-06-10T12:00:00.000Z",
          "verifiedById": "user-cuid",
          "notes": "Wheelchair patient",
          "cancellationReason": "Patient did not arrive",
          "createdAt": "2026-06-10T00:00:00.000Z",
          "updatedAt": "2026-06-10T00:00:00.000Z",
          "createdById": "user-cuid"
        }
      ]
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.289Z"
  }
  ```

---

### `DELETE /api/consultations/{id}`

**Purpose:** Soft-delete a clinical consultation record

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `204`**:

---

## 📦 Inpatient Module

### `GET /api/inpatient`

**Purpose:** Multiplexed GET route matching Next.js API compatibility

- **Authentication Required:** ✅ Yes

**Query Parameters:**

- `resource` (Optional): _(type: string) (default: `wards`)_
- `wardId` (Optional): _(type: string)_
- `status` (Optional): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:

  ```json
  {
    "success": true,
    "data": [
      {
        "id": "string",
        "organizationId": "string",
        "departmentId": null,
        "name": "ICU Ward B",
        "code": "ICU-B",
        "type": "icu",
        "capacity": 10,
        "isActive": true,
        "createdAt": "2026-06-13T16:30:27.485Z",
        "updatedAt": "2026-06-13T16:30:27.485Z",
        "beds": [
          {
            "id": "string",
            "wardId": "string",
            "bedNumber": "ICU-B01",
            "type": "icu",
            "status": "available",
            "currentPatientId": null
          }
        ],
        "occupiedBeds": 0,
        "availableBeds": 10,
        "occupancyRate": 0
      }
    ],
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `GET /api/inpatient/admissions`

**Purpose:** Get patient admissions

* **Authentication Required:** ✅ Yes

**Query Parameters:**
- `status` (Required):  *(type: string)*

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
{
  "success": true,
  "data": [
    {
      "id": "string",
      "organizationId": "string",
      "patientId": "string",
      "bedId": null,
      "admissionDate": "2026-06-13T16:39:03.289Z",
      "admissionType": null,
      "admissionReason": null,
      "admittingDoctorId": null,
      "attendingDoctorId": null,
      "status": "string",
      "dischargeDate": null,
      "dischargeReason": null,
      "dischargeSummary": null,
      "dischargeDoctorId": null,
      "followUpDate": null,
      "followUpNotes": null,
      "createdAt": "2026-06-13T16:39:03.289Z",
      "updatedAt": "2026-06-13T16:39:03.289Z"
    }
  ],
  "message": null,
  "errorCode": null,
  "timestamp": "2026-06-13T16:39:03.289Z"
}
````

---

### `GET /api/inpatient/beds`

**Purpose:** Get beds with optional filters

- **Authentication Required:** ✅ Yes

**Query Parameters:**

- `wardId` (Required): _(type: string)_
- `status` (Required): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "string",
        "organizationId": "string",
        "wardId": "string",
        "bedNumber": "string",
        "type": null,
        "status": "string",
        "currentPatientId": null,
        "createdAt": "2026-06-13T16:39:03.289Z",
        "updatedAt": "2026-06-13T16:39:03.289Z"
      }
    ],
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.289Z"
  }
  ```

---

### `GET /api/inpatient/stats`

**Purpose:** Get inpatient occupancy statistics

- **Authentication Required:** ✅ Yes

**Request Body:** None.

**Responses:**

- **Status `200`**:

  ```json
  {
    "success": true,
    "data": {
      "totalBeds": 20,
      "occupiedBeds": 5,
      "availableBeds": 15,
      "todayAdmissions": 3,
      "todayDischarges": 2,
      "occupancyRate": 25
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `GET /api/inpatient/wards`

**Purpose:** Get all active wards with occupancy calculation

* **Authentication Required:** ✅ Yes

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
{
  "success": true,
  "data": [
    {
      "id": "string",
      "organizationId": "string",
      "departmentId": null,
      "name": "string",
      "code": null,
      "type": null,
      "capacity": 0,
      "isActive": false,
      "createdAt": "2026-06-13T16:39:03.289Z",
      "updatedAt": "2026-06-13T16:39:03.289Z",
      "occupiedBeds": 5,
      "availableBeds": 15,
      "occupancyRate": 25
    }
  ],
  "message": null,
  "errorCode": null,
  "timestamp": "2026-06-13T16:39:03.289Z"
}
````

---

### `POST /api/inpatient`

**Purpose:** Multiplexed POST route matching Next.js API compatibility

- **Authentication Required:** ✅ Yes

**Request Body:**

- **`resource`** (Optional, _string [enum: ward, bed, admission]_):
- **`name`** (Optional, _string_): (e.g. `"General Ward A"`)
- **`code`** (Optional, _string_): (e.g. `"GWA"`)
- **`type`** (Optional, _string_): (e.g. `"general"`)
- **`capacity`** (Optional, _number_): (e.g. `20`)
- **`departmentId`** (Optional, _string_): (e.g. `"dept-cuid"`)
- **`wardId`** (Optional, _string_): (e.g. `"ward-cuid"`)
- **`bedNumber`** (Optional, _string_): (e.g. `"B-101"`)
- **`status`** (Optional, _string_): (e.g. `"available"`)
- **`patientId`** (Optional, _string_): (e.g. `"patient-cuid"`)
- **`bedId`** (Optional, _string_): (e.g. `"bed-cuid"`)
- **`admissionType`** (Optional, _string_): (e.g. `"emergency"`)
- **`admissionReason`** (Optional, _string_): (e.g. `"Severe pneumonia"`)
- **`admittingDoctorId`** (Optional, _string_): (e.g. `"doc-cuid"`)
- **`attendingDoctorId`** (Optional, _string_): (e.g. `"doc-cuid"`)

**Request Example:**

```json
{
  "resource": "string",
  "name": "General Ward A",
  "code": "GWA",
  "type": "general",
  "capacity": 20,
  "departmentId": "dept-cuid",
  "wardId": "ward-cuid",
  "bedNumber": "B-101",
  "status": "available",
  "patientId": "patient-cuid",
  "bedId": "bed-cuid",
  "admissionType": "emergency",
  "admissionReason": "Severe pneumonia",
  "admittingDoctorId": "doc-cuid",
  "attendingDoctorId": "doc-cuid"
}
```

**Responses:**

- **Status `201`**:

  ```json
  {
    "success": true,
    "data": {
      "note": "Response shape depends on the \"resource\" param. See POST /api/inpatient/wards, /api/inpatient/beds, or /api/inpatient/admissions for specific shapes."
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `POST /api/inpatient/admissions`

**Purpose:** Admit a patient to a bed

* **Authentication Required:** ✅ Yes

**Request Body:**

- **`patientId`** (Required, *string*):  (e.g. `"patient-cuid"`)
- **`bedId`** (Optional, *string*):  (e.g. `"bed-cuid"`)
- **`admissionType`** (Optional, *string*):  (e.g. `"emergency"`)
- **`admissionReason`** (Optional, *string*):  (e.g. `"Severe pneumonia"`)
- **`admittingDoctorId`** (Optional, *string*):  (e.g. `"doc-cuid"`)
- **`attendingDoctorId`** (Optional, *string*):  (e.g. `"doc-cuid"`)

**Request Example:**
```json
{
  "patientId": "patient-cuid",
  "bedId": "bed-cuid",
  "admissionType": "emergency",
  "admissionReason": "Severe pneumonia",
  "admittingDoctorId": "doc-cuid",
  "attendingDoctorId": "doc-cuid"
}
````

**Responses:**

- **Status `201`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "patientId": "string",
      "bedId": null,
      "admissionDate": "2026-06-13T16:39:03.289Z",
      "admissionType": null,
      "admissionReason": null,
      "admittingDoctorId": null,
      "attendingDoctorId": null,
      "status": "string",
      "dischargeDate": null,
      "dischargeReason": null,
      "dischargeSummary": null,
      "dischargeDoctorId": null,
      "followUpDate": null,
      "followUpNotes": null,
      "createdAt": "2026-06-13T16:39:03.289Z",
      "updatedAt": "2026-06-13T16:39:03.289Z"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.289Z"
  }
  ```

---

### `POST /api/inpatient/beds`

**Purpose:** Create a new bed in a ward

- **Authentication Required:** ✅ Yes

**Request Body:**

- **`wardId`** (Required, _string_): (e.g. `"ward-cuid"`)
- **`bedNumber`** (Required, _string_): (e.g. `"B-101"`)
- **`type`** (Optional, _string_): (e.g. `"standard"`)
- **`status`** (Optional, _string_): (e.g. `"available"`)

**Request Example:**

```json
{
  "wardId": "ward-cuid",
  "bedNumber": "B-101",
  "type": "standard",
  "status": "available"
}
```

**Responses:**

- **Status `201`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "wardId": "string",
      "bedNumber": "string",
      "type": null,
      "status": "string",
      "currentPatientId": null,
      "createdAt": "2026-06-13T16:39:03.289Z",
      "updatedAt": "2026-06-13T16:39:03.289Z"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.289Z"
  }
  ```

---

### `POST /api/inpatient/wards`

**Purpose:** Create a new ward

- **Authentication Required:** ✅ Yes

**Request Body:**

- **`name`** (Required, _string_): (e.g. `"General Ward A"`)
- **`code`** (Optional, _string_): (e.g. `"GWA"`)
- **`type`** (Optional, _string_): (e.g. `"general"`)
- **`capacity`** (Optional, _number_): (e.g. `20`)
- **`departmentId`** (Optional, _string_): (e.g. `"dept-cuid"`)

**Request Example:**

```json
{
  "name": "General Ward A",
  "code": "GWA",
  "type": "general",
  "capacity": 20,
  "departmentId": "dept-cuid"
}
```

**Responses:**

- **Status `201`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "departmentId": null,
      "name": "string",
      "code": null,
      "type": null,
      "capacity": 0,
      "isActive": false,
      "createdAt": "2026-06-13T16:39:03.289Z",
      "updatedAt": "2026-06-13T16:39:03.289Z",
      "occupiedBeds": 5,
      "availableBeds": 15,
      "occupancyRate": 25
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.289Z"
  }
  ```

---

### `PATCH /api/inpatient`

**Purpose:** Multiplexed PATCH route matching Next.js API compatibility

- **Authentication Required:** ✅ Yes

**Request Body:**

- **`resource`** (Required, _string [enum: ward, bed, admission]_):
- **`id`** (Required, _string_): (e.g. `"record-cuid"`)
- **`status`** (Optional, _string_): (e.g. `"discharged"`)
- **`dischargeReason`** (Optional, _string_): (e.g. `"Fully recovered"`)
- **`dischargeSummary`** (Optional, _string_): (e.g. `"Discharged after complete recovery."`)
- **`dischargeDoctorId`** (Optional, _string_): (e.g. `"doc-cuid"`)
- **`dischargeDate`** (Optional, _string_):
- **`followUpDate`** (Optional, _string_):
- **`followUpNotes`** (Optional, _string_): (e.g. `"Return in 1 week"`)
- **`patientId`** (Optional, _string_): (e.g. `"patient-cuid"`)
- **`bedId`** (Optional, _string_): (e.g. `"bed-cuid"`)
- **`admissionType`** (Optional, _string_): (e.g. `"emergency"`)
- **`admissionReason`** (Optional, _string_): (e.g. `"Severe pneumonia"`)
- **`admittingDoctorId`** (Optional, _string_): (e.g. `"doc-cuid"`)
- **`attendingDoctorId`** (Optional, _string_): (e.g. `"doc-cuid"`)
- **`name`** (Optional, _string_): (e.g. `"General Ward A"`)
- **`code`** (Optional, _string_): (e.g. `"GWA"`)
- **`type`** (Optional, _string_): (e.g. `"general"`)
- **`capacity`** (Optional, _number_): (e.g. `20`)
- **`departmentId`** (Optional, _string_): (e.g. `"dept-cuid"`)
- **`isActive`** (Optional, _boolean_): (e.g. `true`)
- **`wardId`** (Optional, _string_): (e.g. `"ward-cuid"`)
- **`bedNumber`** (Optional, _string_): (e.g. `"B-101"`)
- **`currentPatientId`** (Optional, _string_): (e.g. `"patient-cuid"`)

**Request Example:**

```json
{
  "resource": "string",
  "id": "record-cuid",
  "status": "discharged",
  "dischargeReason": "Fully recovered",
  "dischargeSummary": "Discharged after complete recovery.",
  "dischargeDoctorId": "doc-cuid",
  "dischargeDate": "string",
  "followUpDate": "string",
  "followUpNotes": "Return in 1 week",
  "patientId": "patient-cuid",
  "bedId": "bed-cuid",
  "admissionType": "emergency",
  "admissionReason": "Severe pneumonia",
  "admittingDoctorId": "doc-cuid",
  "attendingDoctorId": "doc-cuid",
  "name": "General Ward A",
  "code": "GWA",
  "type": "general",
  "capacity": 20,
  "departmentId": "dept-cuid",
  "isActive": true,
  "wardId": "ward-cuid",
  "bedNumber": "B-101",
  "currentPatientId": "patient-cuid"
}
```

**Responses:**

- **Status `200`**:

  ```json
  {
    "success": true,
    "data": {
      "note": "Response shape depends on the \"resource\" param. See PATCH /api/inpatient/wards/{id}, /api/inpatient/beds/{id}, or /api/inpatient/admissions/{id} for specific shapes."
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `PATCH /api/inpatient/admissions/{id}`

**Purpose:** Update admission details or discharge patient

* **Authentication Required:** ✅ Yes

**Path Parameters:**
- `id` (Required):  *(type: string)*

**Request Body:**

- **`patientId`** (Optional, *string*):  (e.g. `"patient-cuid"`)
- **`bedId`** (Optional, *string*):  (e.g. `"bed-cuid"`)
- **`admissionType`** (Optional, *string*):  (e.g. `"emergency"`)
- **`admissionReason`** (Optional, *string*):  (e.g. `"Severe pneumonia"`)
- **`admittingDoctorId`** (Optional, *string*):  (e.g. `"doc-cuid"`)
- **`attendingDoctorId`** (Optional, *string*):  (e.g. `"doc-cuid"`)
- **`status`** (Optional, *string*):  (e.g. `"discharged"`)
- **`dischargeDate`** (Optional, *string*):
- **`dischargeReason`** (Optional, *string*):  (e.g. `"Fully recovered"`)
- **`dischargeSummary`** (Optional, *string*):  (e.g. `"Discharged after complete recovery."`)
- **`dischargeDoctorId`** (Optional, *string*):  (e.g. `"doc-cuid"`)
- **`followUpDate`** (Optional, *string*):
- **`followUpNotes`** (Optional, *string*):  (e.g. `"Return in 1 week"`)

**Request Example:**
```json
{
  "patientId": "patient-cuid",
  "bedId": "bed-cuid",
  "admissionType": "emergency",
  "admissionReason": "Severe pneumonia",
  "admittingDoctorId": "doc-cuid",
  "attendingDoctorId": "doc-cuid",
  "status": "discharged",
  "dischargeDate": "string",
  "dischargeReason": "Fully recovered",
  "dischargeSummary": "Discharged after complete recovery.",
  "dischargeDoctorId": "doc-cuid",
  "followUpDate": "string",
  "followUpNotes": "Return in 1 week"
}
````

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "patientId": "string",
      "bedId": null,
      "admissionDate": "2026-06-13T16:39:03.289Z",
      "admissionType": null,
      "admissionReason": null,
      "admittingDoctorId": null,
      "attendingDoctorId": null,
      "status": "string",
      "dischargeDate": null,
      "dischargeReason": null,
      "dischargeSummary": null,
      "dischargeDoctorId": null,
      "followUpDate": null,
      "followUpNotes": null,
      "createdAt": "2026-06-13T16:39:03.289Z",
      "updatedAt": "2026-06-13T16:39:03.289Z"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.289Z"
  }
  ```

---

### `PATCH /api/inpatient/beds/{id}`

**Purpose:** Update bed details or status

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:**

- **`wardId`** (Optional, _string_): (e.g. `"ward-cuid"`)
- **`bedNumber`** (Optional, _string_): (e.g. `"B-101"`)
- **`type`** (Optional, _string_): (e.g. `"standard"`)
- **`status`** (Optional, _string_): (e.g. `"occupied"`)
- **`currentPatientId`** (Optional, _string_): (e.g. `"patient-cuid"`)

**Request Example:**

```json
{
  "wardId": "ward-cuid",
  "bedNumber": "B-101",
  "type": "standard",
  "status": "occupied",
  "currentPatientId": "patient-cuid"
}
```

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "wardId": "string",
      "bedNumber": "string",
      "type": null,
      "status": "string",
      "currentPatientId": null,
      "createdAt": "2026-06-13T16:39:03.289Z",
      "updatedAt": "2026-06-13T16:39:03.289Z"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.289Z"
  }
  ```

---

### `PATCH /api/inpatient/wards/{id}`

**Purpose:** Update ward details

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:**

- **`name`** (Optional, _string_): (e.g. `"General Ward A"`)
- **`code`** (Optional, _string_): (e.g. `"GWA"`)
- **`type`** (Optional, _string_): (e.g. `"general"`)
- **`capacity`** (Optional, _number_): (e.g. `20`)
- **`departmentId`** (Optional, _string_): (e.g. `"dept-cuid"`)
- **`isActive`** (Optional, _boolean_): (e.g. `true`)

**Request Example:**

```json
{
  "name": "General Ward A",
  "code": "GWA",
  "type": "general",
  "capacity": 20,
  "departmentId": "dept-cuid",
  "isActive": true
}
```

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "departmentId": null,
      "name": "string",
      "code": null,
      "type": null,
      "capacity": 0,
      "isActive": false,
      "createdAt": "2026-06-13T16:39:03.289Z",
      "updatedAt": "2026-06-13T16:39:03.289Z",
      "occupiedBeds": 5,
      "availableBeds": 15,
      "occupancyRate": 25
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.289Z"
  }
  ```

---

## 📦 Laboratory Module

### `GET /api/laboratory`

**Purpose:** Multiplexed GET route matching Next.js API compatibility

- **Authentication Required:** ✅ Yes

**Query Parameters:**

- `resource` (Optional): _(type: string) (default: `tests`)_
- `category` (Optional): _(type: string)_
- `status` (Optional): _(type: string)_
- `priority` (Optional): _(type: string)_
- `orderId` (Optional): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:

  ```json
  {
    "success": true,
    "data": [
      {
        "id": "string",
        "organizationId": "string",
        "testName": "Complete Blood Count",
        "testCode": "CBC",
        "testCategory": "hematology",
        "testType": "quantitative",
        "specimenType": "blood",
        "specimenVolume": "2ml",
        "specimenContainer": "EDTA Tube",
        "resultType": "numeric",
        "unit": "g/dL",
        "referenceRanges": "{\"male\":{\"min\":13.5,\"max\":17.5}}",
        "price": 150,
        "turnaroundTime": 24,
        "department": "Hematology Lab",
        "preparationInstructions": "Fasting",
        "clinicalSignificance": "Anemia screen",
        "isActive": true,
        "createdAt": "2026-06-13T17:04:00.000Z",
        "updatedAt": "2026-06-13T17:04:00.000Z",
        "createdById": "string"
      }
    ],
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `GET /api/laboratory/orders`

**Purpose:** Get laboratory orders

* **Authentication Required:** ✅ Yes

**Query Parameters:**
- `status` (Optional): Filter by status *(type: string)*
- `priority` (Optional): Filter by priority:  *(type: string)*

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
{
  "success": true,
  "data": [
    {
      "id": "order-cuid",
      "organizationId": "org-demo",
      "patientId": "patient-cuid",
      "consultationId": "consultation-cuid",
      "requestedById": "user-admin",
      "orderDate": "2024-01-01T00:00:00.000Z",
      "orderNumber": "LAB123456789",
      "tests": "[{\"testId\":\"id\",\"testName\":\"name\"}]",
      "clinicalIndication": "clinicalIndication",
      "provisionalDiagnosis": "provisionalDiagnosis",
      "priority": "routine",
      "status": "pending",
      "sampleCollectedAt": "2024-01-01T00:00:00.000Z",
      "sampleCollectedById": "sampleCollectedById",
      "accessionNumber": "accessionNumber",
      "resultsEnteredAt": "2024-01-01T00:00:00.000Z",
      "resultsEnteredById": "resultsEnteredById",
      "resultsVerifiedAt": "2024-01-01T00:00:00.000Z",
      "resultsVerifiedById": "resultsVerifiedById",
      "resultsReportedAt": "2024-01-01T00:00:00.000Z",
      "notes": "notes",
      "rejectionReason": "rejectionReason",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z",
      "createdById": "user-admin"
    }
  ],
  "message": null,
  "errorCode": null,
  "timestamp": "2026-06-13T16:39:03.289Z"
}
````

---

### `GET /api/laboratory/results`

**Purpose:** Get laboratory results

- **Authentication Required:** ✅ Yes

**Query Parameters:**

- `orderId` (Required): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "result-cuid",
        "organizationId": "org-demo",
        "orderId": "order-cuid",
        "testId": "test-cuid",
        "resultValue": "13.5",
        "resultUnit": "g/dL",
        "isAbnormal": false,
        "isCritical": false,
        "flag": "N",
        "referenceRangeMin": 12,
        "referenceRangeMax": 16,
        "referenceRangeText": "12.0 - 16.0",
        "qcLevel": "level-1",
        "qcPassed": true,
        "methodUsed": "Analyzer-X",
        "instrumentUsed": "Beckman",
        "enteredById": "enteredById",
        "enteredAt": "2024-01-01T00:00:00.000Z",
        "verifiedById": "verifiedById",
        "verifiedAt": "2024-01-01T00:00:00.000Z",
        "comment": "comment",
        "technicianNotes": "technicianNotes",
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.289Z"
  }
  ```

---

### `GET /api/laboratory/stats`

**Purpose:** Get laboratory stats

- **Authentication Required:** ✅ Yes

**Request Body:** None.

**Responses:**

- **Status `200`**:

  ```json
  {
    "success": true,
    "data": {
      "pending": 3,
      "sampleCollected": 5,
      "inProgress": 2,
      "completedToday": 12,
      "criticalResults": 1,
      "totalTests": 22
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `GET /api/laboratory/tests`

**Purpose:** Get active laboratory tests

* **Authentication Required:** ✅ Yes

**Query Parameters:**
- `category` (Required):  *(type: string)*

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
{
  "success": true,
  "data": [
    {
      "id": "test-cuid",
      "organizationId": "org-demo",
      "testName": "Complete Blood Count",
      "testCode": "CBC",
      "testCategory": "hematology",
      "testType": "quantitative",
      "specimenType": "blood",
      "specimenVolume": "2ml",
      "specimenContainer": "EDTA Tube",
      "resultType": "numeric",
      "unit": "g/dL",
      "referenceRanges": "{\"male\": {\"min\": 13.5, \"max\": 17.5}}",
      "price": 150,
      "turnaroundTime": 24,
      "department": "Hematology Lab",
      "preparationInstructions": "Fasting",
      "clinicalSignificance": "Anemia screen",
      "isActive": true,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z",
      "createdById": "user-admin"
    }
  ],
  "message": null,
  "errorCode": null,
  "timestamp": "2026-06-13T16:39:03.289Z"
}
````

---

### `POST /api/laboratory`

**Purpose:** Multiplexed POST route matching Next.js API compatibility

- **Authentication Required:** ✅ Yes

**Request Body:**

- **`resource`** (Optional, _string [enum: test, order, result]_):
- **`testName`** (Optional, _string_): (e.g. `"Complete Blood Count"`)
- **`testCode`** (Optional, _string_): (e.g. `"CBC"`)
- **`testCategory`** (Optional, _string_): (e.g. `"hematology"`)
- **`testType`** (Optional, _string_): (e.g. `"quantitative"`)
- **`specimenType`** (Optional, _string_): (e.g. `"blood"`)
- **`specimenVolume`** (Optional, _string_): (e.g. `"2ml"`)
- **`specimenContainer`** (Optional, _string_): (e.g. `"EDTA Tube"`)
- **`resultType`** (Optional, _string_): (e.g. `"numeric"`)
- **`unit`** (Optional, _string_): (e.g. `"g/dL"`)
- **`referenceRanges`** (Optional, _string_): (e.g. `"12-16"`)
- **`price`** (Optional, _number_): (e.g. `150`)
- **`turnaroundTime`** (Optional, _number_): (e.g. `24`)
- **`department`** (Optional, _string_): (e.g. `"Hematology Lab"`)
- **`preparationInstructions`** (Optional, _string_): (e.g. `"Fasting"`)
- **`clinicalSignificance`** (Optional, _string_): (e.g. `"Anemia screen"`)
- **`patientId`** (Optional, _string_): (e.g. `"patient-id"`)
- **`consultationId`** (Optional, _string_): (e.g. `"consultation-id"`)
- **`tests`** (Optional, _array_):
  - Items properties:
    - **`testId`** (Required, _string_): (e.g. `"test-id"`)
    - **`testName`** (Required, _string_): (e.g. `"Complete Blood Count"`)
    - **`urgency`** (Optional, _string_): (e.g. `"routine"`)
- **`clinicalIndication`** (Optional, _string_): (e.g. `"Suspected Anemia"`)
- **`provisionalDiagnosis`** (Optional, _string_): (e.g. `"Anemia"`)
- **`priority`** (Optional, _string_): (e.g. `"routine"`)
- **`notes`** (Optional, _string_): (e.g. `"Some order notes"`)
- **`orderId`** (Optional, _string_): (e.g. `"order-id"`)
- **`testId`** (Optional, _string_): (e.g. `"test-id"`)
- **`resultValue`** (Optional, _string_): (e.g. `"13.5"`)
- **`resultUnit`** (Optional, _string_): (e.g. `"g/dL"`)
- **`isAbnormal`** (Optional, _boolean_): (e.g. `false`)
- **`isCritical`** (Optional, _boolean_): (e.g. `false`)
- **`flag`** (Optional, _string_): (e.g. `"N"`)
- **`comment`** (Optional, _string_): (e.g. `"Normal CBC result"`)

**Request Example:**

```json
{
  "resource": "string",
  "testName": "Complete Blood Count",
  "testCode": "CBC",
  "testCategory": "hematology",
  "testType": "quantitative",
  "specimenType": "blood",
  "specimenVolume": "2ml",
  "specimenContainer": "EDTA Tube",
  "resultType": "numeric",
  "unit": "g/dL",
  "referenceRanges": "12-16",
  "price": 150,
  "turnaroundTime": 24,
  "department": "Hematology Lab",
  "preparationInstructions": "Fasting",
  "clinicalSignificance": "Anemia screen",
  "patientId": "patient-id",
  "consultationId": "consultation-id",
  "tests": [
    {
      "testId": "test-id",
      "testName": "Complete Blood Count",
      "urgency": "routine"
    }
  ],
  "clinicalIndication": "Suspected Anemia",
  "provisionalDiagnosis": "Anemia",
  "priority": "routine",
  "notes": "Some order notes",
  "orderId": "order-id",
  "testId": "test-id",
  "resultValue": "13.5",
  "resultUnit": "g/dL",
  "isAbnormal": false,
  "isCritical": false,
  "flag": "N",
  "comment": "Normal CBC result"
}
```

**Responses:**

- **Status `201`**:

  ```json
  {
    "success": true,
    "data": {
      "note": "Response shape depends on the \"resource\" param. See POST /api/laboratory/tests, /api/laboratory/orders, or /api/laboratory/results for specific shapes."
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `POST /api/laboratory/orders`

**Purpose:** Create a new laboratory order

* **Authentication Required:** ✅ Yes

**Request Body:**

- **`patientId`** (Required, *string*):  (e.g. `"patient-cuid"`)
- **`consultationId`** (Optional, *string*):  (e.g. `"consultation-cuid"`)
- **`tests`** (Required, *array*):
  - Items properties:
    - **`testId`** (Required, *string*):  (e.g. `"test-id"`)
    - **`testName`** (Required, *string*):  (e.g. `"Complete Blood Count"`)
    - **`urgency`** (Optional, *string*):  (e.g. `"routine"`)
- **`clinicalIndication`** (Optional, *string*):  (e.g. `"Suspected Anemia"`)
- **`provisionalDiagnosis`** (Optional, *string*):  (e.g. `"Anemia"`)
- **`priority`** (Optional, *string*):  (e.g. `"routine"`)
- **`notes`** (Optional, *string*):  (e.g. `"Patient has history of fatigue"`)

**Request Example:**
```json
{
  "patientId": "patient-cuid",
  "consultationId": "consultation-cuid",
  "tests": [
    {
      "testId": "test-id",
      "testName": "Complete Blood Count",
      "urgency": "routine"
    }
  ],
  "clinicalIndication": "Suspected Anemia",
  "provisionalDiagnosis": "Anemia",
  "priority": "routine",
  "notes": "Patient has history of fatigue"
}
````

**Responses:**

- **Status `201`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "order-cuid",
      "organizationId": "org-demo",
      "patientId": "patient-cuid",
      "consultationId": "consultation-cuid",
      "requestedById": "user-admin",
      "orderDate": "2024-01-01T00:00:00.000Z",
      "orderNumber": "LAB123456789",
      "tests": "[{\"testId\":\"id\",\"testName\":\"name\"}]",
      "clinicalIndication": "clinicalIndication",
      "provisionalDiagnosis": "provisionalDiagnosis",
      "priority": "routine",
      "status": "pending",
      "sampleCollectedAt": "2024-01-01T00:00:00.000Z",
      "sampleCollectedById": "sampleCollectedById",
      "accessionNumber": "accessionNumber",
      "resultsEnteredAt": "2024-01-01T00:00:00.000Z",
      "resultsEnteredById": "resultsEnteredById",
      "resultsVerifiedAt": "2024-01-01T00:00:00.000Z",
      "resultsVerifiedById": "resultsVerifiedById",
      "resultsReportedAt": "2024-01-01T00:00:00.000Z",
      "notes": "notes",
      "rejectionReason": "rejectionReason",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z",
      "createdById": "user-admin"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.289Z"
  }
  ```

---

### `POST /api/laboratory/results`

**Purpose:** Add results to a laboratory test order

- **Authentication Required:** ✅ Yes

**Request Body:**

- **`orderId`** (Required, _string_): (e.g. `"order-cuid"`)
- **`testId`** (Required, _string_): (e.g. `"test-cuid"`)
- **`resultValue`** (Required, _string_): (e.g. `"13.5"`)
- **`resultUnit`** (Optional, _string_): (e.g. `"g/dL"`)
- **`isAbnormal`** (Optional, _boolean_): (e.g. `false`)
- **`isCritical`** (Optional, _boolean_): (e.g. `false`)
- **`flag`** (Optional, _string_): (e.g. `"N"`)
- **`comment`** (Optional, _string_): (e.g. `"Normal CBC result"`)

**Request Example:**

```json
{
  "orderId": "order-cuid",
  "testId": "test-cuid",
  "resultValue": "13.5",
  "resultUnit": "g/dL",
  "isAbnormal": false,
  "isCritical": false,
  "flag": "N",
  "comment": "Normal CBC result"
}
```

**Responses:**

- **Status `201`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "result-cuid",
      "organizationId": "org-demo",
      "orderId": "order-cuid",
      "testId": "test-cuid",
      "resultValue": "13.5",
      "resultUnit": "g/dL",
      "isAbnormal": false,
      "isCritical": false,
      "flag": "N",
      "referenceRangeMin": 12,
      "referenceRangeMax": 16,
      "referenceRangeText": "12.0 - 16.0",
      "qcLevel": "level-1",
      "qcPassed": true,
      "methodUsed": "Analyzer-X",
      "instrumentUsed": "Beckman",
      "enteredById": "enteredById",
      "enteredAt": "2024-01-01T00:00:00.000Z",
      "verifiedById": "verifiedById",
      "verifiedAt": "2024-01-01T00:00:00.000Z",
      "comment": "comment",
      "technicianNotes": "technicianNotes",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.289Z"
  }
  ```

---

### `POST /api/laboratory/tests`

**Purpose:** Create a new laboratory test catalog entry

- **Authentication Required:** ✅ Yes

**Request Body:**

- **`testName`** (Required, _string_): (e.g. `"Complete Blood Count"`)
- **`testCode`** (Optional, _string_): (e.g. `"CBC"`)
- **`testCategory`** (Optional, _string_): (e.g. `"hematology"`)
- **`testType`** (Optional, _string_): (e.g. `"quantitative"`)
- **`specimenType`** (Optional, _string_): (e.g. `"blood"`)
- **`specimenVolume`** (Optional, _string_): (e.g. `"2ml"`)
- **`specimenContainer`** (Optional, _string_): (e.g. `"EDTA Tube"`)
- **`resultType`** (Optional, _string_): (e.g. `"numeric"`)
- **`unit`** (Optional, _string_): (e.g. `"g/dL"`)
- **`referenceRanges`** (Optional, _string_): (e.g. `"{\"male\": {\"min\": 13.5, \"max\": 17.5}}"`)
- **`price`** (Optional, _number_): (e.g. `150`)
- **`turnaroundTime`** (Optional, _number_): (e.g. `24`)
- **`department`** (Optional, _string_): (e.g. `"Hematology Lab"`)
- **`preparationInstructions`** (Optional, _string_): (e.g. `"Fasting"`)
- **`clinicalSignificance`** (Optional, _string_): (e.g. `"Anemia screen"`)

**Request Example:**

```json
{
  "testName": "Complete Blood Count",
  "testCode": "CBC",
  "testCategory": "hematology",
  "testType": "quantitative",
  "specimenType": "blood",
  "specimenVolume": "2ml",
  "specimenContainer": "EDTA Tube",
  "resultType": "numeric",
  "unit": "g/dL",
  "referenceRanges": "{\"male\": {\"min\": 13.5, \"max\": 17.5}}",
  "price": 150,
  "turnaroundTime": 24,
  "department": "Hematology Lab",
  "preparationInstructions": "Fasting",
  "clinicalSignificance": "Anemia screen"
}
```

**Responses:**

- **Status `201`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "test-cuid",
      "organizationId": "org-demo",
      "testName": "Complete Blood Count",
      "testCode": "CBC",
      "testCategory": "hematology",
      "testType": "quantitative",
      "specimenType": "blood",
      "specimenVolume": "2ml",
      "specimenContainer": "EDTA Tube",
      "resultType": "numeric",
      "unit": "g/dL",
      "referenceRanges": "{\"male\": {\"min\": 13.5, \"max\": 17.5}}",
      "price": 150,
      "turnaroundTime": 24,
      "department": "Hematology Lab",
      "preparationInstructions": "Fasting",
      "clinicalSignificance": "Anemia screen",
      "isActive": true,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z",
      "createdById": "user-admin"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.289Z"
  }
  ```

---

### `PATCH /api/laboratory`

**Purpose:** Multiplexed PATCH route matching Next.js API compatibility

- **Authentication Required:** ✅ Yes

**Request Body:**

- **`resource`** (Required, _string [enum: test, order, result]_):
- **`id`** (Required, _string_): (e.g. `"record-id"`)
- **`status`** (Optional, _string_): (e.g. `"completed"`)
- **`priority`** (Optional, _string_): (e.g. `"routine"`)
- **`resultValue`** (Optional, _string_): (e.g. `"14.0"`)
- **`resultUnit`** (Optional, _string_): (e.g. `"g/dL"`)
- **`isAbnormal`** (Optional, _boolean_): (e.g. `false`)
- **`isCritical`** (Optional, _boolean_): (e.g. `false`)
- **`flag`** (Optional, _string_): (e.g. `"N"`)
- **`comment`** (Optional, _string_): (e.g. `"Normal CBC result"`)
- **`notes`** (Optional, _string_): (e.g. `"Some order notes"`)
- **`testName`** (Optional, _string_): (e.g. `"Complete Blood Count"`)
- **`price`** (Optional, _number_): (e.g. `160`)
- **`isActive`** (Optional, _boolean_): (e.g. `true`)
- **`verifiedAt`** (Optional, _string_): (e.g. `"2024-01-01T00:00:00.000Z"`)

**Request Example:**

```json
{
  "resource": "string",
  "id": "record-id",
  "status": "completed",
  "priority": "routine",
  "resultValue": "14.0",
  "resultUnit": "g/dL",
  "isAbnormal": false,
  "isCritical": false,
  "flag": "N",
  "comment": "Normal CBC result",
  "notes": "Some order notes",
  "testName": "Complete Blood Count",
  "price": 160,
  "isActive": true,
  "verifiedAt": "2024-01-01T00:00:00.000Z"
}
```

**Responses:**

- **Status `200`**:

  ```json
  {
    "success": true,
    "data": {
      "note": "Response shape depends on the \"resource\" param. See PATCH /api/laboratory/tests/{id}, /api/laboratory/orders/{id}, or /api/laboratory/results/{id} for specific shapes."
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `PATCH /api/laboratory/orders/{id}`

**Purpose:** Update laboratory order status or details

* **Authentication Required:** ✅ Yes

**Path Parameters:**
- `id` (Required):  *(type: string)*

**Request Body:**

- **`status`** (Optional, *string*):  (e.g. `"sample_collected"`)
- **`priority`** (Optional, *string*):  (e.g. `"urgent"`)
- **`sampleCollectedAt`** (Optional, *string (date-time)*):  (e.g. `"2024-01-01T10:00:00.000Z"`)
- **`sampleCollectedById`** (Optional, *string*):  (e.g. `"user-cuid"`)
- **`accessionNumber`** (Optional, *string*):  (e.g. `"ACC-123456"`)
- **`notes`** (Optional, *string*):  (e.g. `"Patient has history of fatigue"`)
- **`rejectionReason`** (Optional, *string*):  (e.g. `"Hemolyzed sample"`)

**Request Example:**
```json
{
  "status": "sample_collected",
  "priority": "urgent",
  "sampleCollectedAt": "2024-01-01T10:00:00.000Z",
  "sampleCollectedById": "user-cuid",
  "accessionNumber": "ACC-123456",
  "notes": "Patient has history of fatigue",
  "rejectionReason": "Hemolyzed sample"
}
````

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "order-cuid",
      "organizationId": "org-demo",
      "patientId": "patient-cuid",
      "consultationId": "consultation-cuid",
      "requestedById": "user-admin",
      "orderDate": "2024-01-01T00:00:00.000Z",
      "orderNumber": "LAB123456789",
      "tests": "[{\"testId\":\"id\",\"testName\":\"name\"}]",
      "clinicalIndication": "clinicalIndication",
      "provisionalDiagnosis": "provisionalDiagnosis",
      "priority": "routine",
      "status": "pending",
      "sampleCollectedAt": "2024-01-01T00:00:00.000Z",
      "sampleCollectedById": "sampleCollectedById",
      "accessionNumber": "accessionNumber",
      "resultsEnteredAt": "2024-01-01T00:00:00.000Z",
      "resultsEnteredById": "resultsEnteredById",
      "resultsVerifiedAt": "2024-01-01T00:00:00.000Z",
      "resultsVerifiedById": "resultsVerifiedById",
      "resultsReportedAt": "2024-01-01T00:00:00.000Z",
      "notes": "notes",
      "rejectionReason": "rejectionReason",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z",
      "createdById": "user-admin"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.289Z"
  }
  ```

---

### `PATCH /api/laboratory/results/{id}`

**Purpose:** Update results or verify them

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:**

- **`resultValue`** (Optional, _string_): (e.g. `"14.0"`)
- **`resultUnit`** (Optional, _string_): (e.g. `"g/dL"`)
- **`isAbnormal`** (Optional, _boolean_): (e.g. `false`)
- **`isCritical`** (Optional, _boolean_): (e.g. `false`)
- **`flag`** (Optional, _string_): (e.g. `"N"`)
- **`comment`** (Optional, _string_): (e.g. `"Normal CBC result"`)
- **`verifiedAt`** (Optional, _string (date-time)_): (e.g. `"2024-01-01T10:00:00.000Z"`)
- **`verifiedById`** (Optional, _string_): (e.g. `"user-cuid"`)

**Request Example:**

```json
{
  "resultValue": "14.0",
  "resultUnit": "g/dL",
  "isAbnormal": false,
  "isCritical": false,
  "flag": "N",
  "comment": "Normal CBC result",
  "verifiedAt": "2024-01-01T10:00:00.000Z",
  "verifiedById": "user-cuid"
}
```

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "result-cuid",
      "organizationId": "org-demo",
      "orderId": "order-cuid",
      "testId": "test-cuid",
      "resultValue": "13.5",
      "resultUnit": "g/dL",
      "isAbnormal": false,
      "isCritical": false,
      "flag": "N",
      "referenceRangeMin": 12,
      "referenceRangeMax": 16,
      "referenceRangeText": "12.0 - 16.0",
      "qcLevel": "level-1",
      "qcPassed": true,
      "methodUsed": "Analyzer-X",
      "instrumentUsed": "Beckman",
      "enteredById": "enteredById",
      "enteredAt": "2024-01-01T00:00:00.000Z",
      "verifiedById": "verifiedById",
      "verifiedAt": "2024-01-01T00:00:00.000Z",
      "comment": "comment",
      "technicianNotes": "technicianNotes",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.289Z"
  }
  ```

---

### `PATCH /api/laboratory/tests/{id}`

**Purpose:** Update a laboratory test

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:**

- **`testName`** (Optional, _string_): (e.g. `"Complete Blood Count"`)
- **`testCode`** (Optional, _string_): (e.g. `"CBC"`)
- **`testCategory`** (Optional, _string_): (e.g. `"hematology"`)
- **`testType`** (Optional, _string_): (e.g. `"quantitative"`)
- **`specimenType`** (Optional, _string_): (e.g. `"blood"`)
- **`specimenVolume`** (Optional, _string_): (e.g. `"2ml"`)
- **`specimenContainer`** (Optional, _string_): (e.g. `"EDTA Tube"`)
- **`resultType`** (Optional, _string_): (e.g. `"numeric"`)
- **`unit`** (Optional, _string_): (e.g. `"g/dL"`)
- **`referenceRanges`** (Optional, _string_): (e.g. `"{\"male\": {\"min\": 13.5, \"max\": 17.5}}"`)
- **`price`** (Optional, _number_): (e.g. `150`)
- **`turnaroundTime`** (Optional, _number_): (e.g. `24`)
- **`department`** (Optional, _string_): (e.g. `"Hematology Lab"`)
- **`preparationInstructions`** (Optional, _string_): (e.g. `"Fasting"`)
- **`clinicalSignificance`** (Optional, _string_): (e.g. `"Anemia screen"`)
- **`isActive`** (Optional, _boolean_): (e.g. `true`)

**Request Example:**

```json
{
  "testName": "Complete Blood Count",
  "testCode": "CBC",
  "testCategory": "hematology",
  "testType": "quantitative",
  "specimenType": "blood",
  "specimenVolume": "2ml",
  "specimenContainer": "EDTA Tube",
  "resultType": "numeric",
  "unit": "g/dL",
  "referenceRanges": "{\"male\": {\"min\": 13.5, \"max\": 17.5}}",
  "price": 150,
  "turnaroundTime": 24,
  "department": "Hematology Lab",
  "preparationInstructions": "Fasting",
  "clinicalSignificance": "Anemia screen",
  "isActive": true
}
```

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "test-cuid",
      "organizationId": "org-demo",
      "testName": "Complete Blood Count",
      "testCode": "CBC",
      "testCategory": "hematology",
      "testType": "quantitative",
      "specimenType": "blood",
      "specimenVolume": "2ml",
      "specimenContainer": "EDTA Tube",
      "resultType": "numeric",
      "unit": "g/dL",
      "referenceRanges": "{\"male\": {\"min\": 13.5, \"max\": 17.5}}",
      "price": 150,
      "turnaroundTime": 24,
      "department": "Hematology Lab",
      "preparationInstructions": "Fasting",
      "clinicalSignificance": "Anemia screen",
      "isActive": true,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z",
      "createdById": "user-admin"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.289Z"
  }
  ```

---

## 📦 Pharmacy Module

### `GET /api/pharmacy`

**Purpose:** Multiplexed GET route matching Next.js API compatibility

- **Authentication Required:** ✅ Yes

**Query Parameters:**

- `resource` (Optional): _(type: string) (default: `drugs`)_
- `category` (Optional): _(type: string)_
- `search` (Optional): _(type: string)_
- `status` (Optional): _(type: string)_
- `date` (Optional): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:

  ```json
  {
    "success": true,
    "data": [
      {
        "id": "string",
        "organizationId": "string",
        "drugName": "Paracetamol",
        "genericName": "Acetaminophen",
        "brandName": "Panadol",
        "drugCode": "DRG001",
        "drugCategory": "analgesic",
        "dosageForm": "tablet",
        "strength": "500mg",
        "quantityInStock": 100,
        "unitOfMeasure": "tablet",
        "reorderLevel": 10,
        "maximumStockLevel": null,
        "costPrice": 3.2,
        "sellingPrice": 5.5,
        "markupPercentage": null,
        "storageLocation": "Shelf A1",
        "requiresPrescription": false,
        "description": "Pain reliever",
        "isActive": true,
        "createdAt": "2026-06-13T17:04:00.000Z",
        "updatedAt": "2026-06-13T17:04:00.000Z"
      }
    ],
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `GET /api/pharmacy/drugs`

**Purpose:** Get active drugs catalog

* **Authentication Required:** ✅ Yes

**Query Parameters:**
- `category` (Optional): Filter by drug category *(type: string)*
- `search` (Optional): Search term for drug name or code *(type: string)*:  *(type: string)*

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
{
  "success": true,
  "data": [
    {
      "id": "string",
      "organizationId": "string",
      "drugName": "string",
      "genericName": "string",
      "brandName": "string",
      "drugCode": "string",
      "drugCategory": "string",
      "dosageForm": "string",
      "strength": "string",
      "quantityInStock": 0,
      "unitOfMeasure": "string",
      "reorderLevel": 0,
      "sellingPrice": 0,
      "costPrice": 0,
      "requiresPrescription": false,
      "storageLocation": "string",
      "description": "string",
      "isActive": false,
      "createdAt": "2026-06-13T16:39:03.290Z",
      "updatedAt": "2026-06-13T16:39:03.290Z"
    }
  ],
  "message": null,
  "errorCode": null,
  "timestamp": "2026-06-13T16:39:03.290Z"
}
````

---

### `GET /api/pharmacy/prescriptions`

**Purpose:** Get prescriptions

- **Authentication Required:** ✅ Yes

**Query Parameters:**

- `status` (Required): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "string",
        "organizationId": "string",
        "patientId": "string",
        "consultationId": "string",
        "doctorId": "string",
        "prescriptionDate": "2026-06-13T16:39:03.290Z",
        "items": "string",
        "status": "string",
        "dispensedById": "string",
        "dispensedAt": "2026-06-13T16:39:03.290Z",
        "notes": "string",
        "isRefill": false,
        "refillsAllowed": 0,
        "refillsRemaining": 0,
        "createdAt": "2026-06-13T16:39:03.290Z",
        "updatedAt": "2026-06-13T16:39:03.290Z"
      }
    ],
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.290Z"
  }
  ```

---

### `GET /api/pharmacy/sales`

**Purpose:** Get pharmacy sales

- **Authentication Required:** ✅ Yes

**Query Parameters:**

- `date` (Required): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "string",
        "organizationId": "string",
        "patientId": "string",
        "prescriptionId": "string",
        "servedById": "string",
        "saleDate": "2026-06-13T16:39:03.290Z",
        "saleType": "string",
        "items": "string",
        "subtotal": 0,
        "discountAmount": 0,
        "taxAmount": 0,
        "totalAmount": 0,
        "paymentStatus": "string",
        "paymentMethod": "string",
        "amountPaid": 0,
        "amountDue": 0,
        "receiptNumber": "string",
        "createdAt": "2026-06-13T16:39:03.290Z"
      }
    ],
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.290Z"
  }
  ```

---

### `GET /api/pharmacy/stats`

**Purpose:** Get pharmacy inventory and sales statistics

- **Authentication Required:** ✅ Yes

**Request Body:** None.

**Responses:**

- **Status `200`**:

  ```json
  {
    "success": true,
    "data": {
      "totalDrugs": 45,
      "lowStock": 5,
      "outOfStock": 2,
      "pendingPrescriptions": 8,
      "todaySales": 12500
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `POST /api/pharmacy`

**Purpose:** Multiplexed POST route matching Next.js API compatibility

* **Authentication Required:** ✅ Yes

**Request Body:**

- **`resource`** (Optional, *string [enum: drug, prescription, sale]*):
- **`drugName`** (Optional, *string*):  (e.g. `"Paracetamol"`)
- **`genericName`** (Optional, *string*):  (e.g. `"Acetaminophen"`)
- **`brandName`** (Optional, *string*):  (e.g. `"Panadol"`)
- **`drugCode`** (Optional, *string*):  (e.g. `"DRG001"`)
- **`drugCategory`** (Optional, *string*):  (e.g. `"analgesic"`)
- **`dosageForm`** (Optional, *string*):  (e.g. `"tablet"`)
- **`strength`** (Optional, *string*):  (e.g. `"500mg"`)
- **`quantityInStock`** (Optional, *number*):  (e.g. `100`)
- **`unitOfMeasure`** (Optional, *string*):  (e.g. `"tablet"`)
- **`reorderLevel`** (Optional, *number*):  (e.g. `10`)
- **`sellingPrice`** (Optional, *number*):  (e.g. `5.5`)
- **`costPrice`** (Optional, *number*):  (e.g. `3.2`)
- **`requiresPrescription`** (Optional, *boolean*):  (e.g. `false`)
- **`storageLocation`** (Optional, *string*):  (e.g. `"Shelf A1"`)
- **`description`** (Optional, *string*):  (e.g. `"Pain reliever"`)
- **`patientId`** (Optional, *string*):  (e.g. `"patient-id"`)
- **`doctorId`** (Optional, *string*):  (e.g. `"doctor-id"`)
- **`consultationId`** (Optional, *string*):  (e.g. `"consultation-id"`)
- **`items`** (Optional, *array*):
- **`notes`** (Optional, *string*):  (e.g. `"Take after food"`)
- **`prescriptionId`** (Optional, *string*):  (e.g. `"prescription-id"`)
- **`paymentMethod`** (Optional, *string*):  (e.g. `"cash"`)
- **`paymentStatus`** (Optional, *string*):  (e.g. `"paid"`)

**Request Example:**
```json
{
  "resource": "string",
  "drugName": "Paracetamol",
  "genericName": "Acetaminophen",
  "brandName": "Panadol",
  "drugCode": "DRG001",
  "drugCategory": "analgesic",
  "dosageForm": "tablet",
  "strength": "500mg",
  "quantityInStock": 100,
  "unitOfMeasure": "tablet",
  "reorderLevel": 10,
  "sellingPrice": 5.5,
  "costPrice": 3.2,
  "requiresPrescription": false,
  "storageLocation": "Shelf A1",
  "description": "Pain reliever",
  "patientId": "patient-id",
  "doctorId": "doctor-id",
  "consultationId": "consultation-id",
  "items": [],
  "notes": "Take after food",
  "prescriptionId": "prescription-id",
  "paymentMethod": "cash",
  "paymentStatus": "paid"
}
````

**Responses:**

- **Status `201`**:

  ```json
  {
    "success": true,
    "data": {
      "note": "Response shape depends on the \"resource\" param. See POST /api/pharmacy/drugs, /api/pharmacy/prescriptions, or /api/pharmacy/sales for specific shapes."
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `POST /api/pharmacy/drugs`

**Purpose:** Create a new drug catalog entry

* **Authentication Required:** ✅ Yes

**Request Body:**

- **`drugName`** (Required, *string*):  (e.g. `"Paracetamol"`)
- **`genericName`** (Optional, *string*):  (e.g. `"Acetaminophen"`)
- **`brandName`** (Optional, *string*):  (e.g. `"Panadol"`)
- **`drugCode`** (Optional, *string*):  (e.g. `"DRG001"`)
- **`drugCategory`** (Optional, *string*):  (e.g. `"analgesic"`)
- **`dosageForm`** (Optional, *string*):  (e.g. `"tablet"`)
- **`strength`** (Optional, *string*):  (e.g. `"500mg"`)
- **`quantityInStock`** (Optional, *number*):  (e.g. `100`)
- **`unitOfMeasure`** (Optional, *string*):  (e.g. `"tablet"`)
- **`reorderLevel`** (Optional, *number*):  (e.g. `10`)
- **`sellingPrice`** (Optional, *number*):  (e.g. `5.5`)
- **`costPrice`** (Optional, *number*):  (e.g. `3.2`)
- **`requiresPrescription`** (Optional, *boolean*):  (e.g. `false`)
- **`storageLocation`** (Optional, *string*):  (e.g. `"Shelf A1"`)
- **`description`** (Optional, *string*):  (e.g. `"Pain reliever"`)

**Request Example:**
```json
{
  "drugName": "Paracetamol",
  "genericName": "Acetaminophen",
  "brandName": "Panadol",
  "drugCode": "DRG001",
  "drugCategory": "analgesic",
  "dosageForm": "tablet",
  "strength": "500mg",
  "quantityInStock": 100,
  "unitOfMeasure": "tablet",
  "reorderLevel": 10,
  "sellingPrice": 5.5,
  "costPrice": 3.2,
  "requiresPrescription": false,
  "storageLocation": "Shelf A1",
  "description": "Pain reliever"
}
````

**Responses:**

- **Status `201`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "drugName": "string",
      "genericName": "string",
      "brandName": "string",
      "drugCode": "string",
      "drugCategory": "string",
      "dosageForm": "string",
      "strength": "string",
      "quantityInStock": 0,
      "unitOfMeasure": "string",
      "reorderLevel": 0,
      "sellingPrice": 0,
      "costPrice": 0,
      "requiresPrescription": false,
      "storageLocation": "string",
      "description": "string",
      "isActive": false,
      "createdAt": "2026-06-13T16:39:03.290Z",
      "updatedAt": "2026-06-13T16:39:03.290Z"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.290Z"
  }
  ```

---

### `POST /api/pharmacy/prescriptions`

**Purpose:** Create a new prescription

- **Authentication Required:** ✅ Yes

**Request Body:**

- **`patientId`** (Required, _string_): (e.g. `"patient-id"`)
- **`doctorId`** (Required, _string_): (e.g. `"doctor-id"`)
- **`consultationId`** (Optional, _string_): (e.g. `"consultation-id"`)
- **`items`** (Required, _array_):
  - Items properties:
    - **`drugId`** (Required, _string_): (e.g. `"drug-id"`)
    - **`drugName`** (Required, _string_): (e.g. `"Paracetamol"`)
    - **`dosage`** (Optional, _string_): (e.g. `"500mg"`)
    - **`frequency`** (Optional, _string_): (e.g. `"3 times daily"`)
    - **`duration`** (Optional, _string_): (e.g. `"5 days"`)
    - **`quantity`** (Required, _number_): (e.g. `15`)
    - **`instructions`** (Optional, _string_): (e.g. `"Take after meals"`)
- **`notes`** (Optional, _string_): (e.g. `"Take with warm water"`)

**Request Example:**

```json
{
  "patientId": "patient-id",
  "doctorId": "doctor-id",
  "consultationId": "consultation-id",
  "items": [
    {
      "drugId": "drug-id",
      "drugName": "Paracetamol",
      "dosage": "500mg",
      "frequency": "3 times daily",
      "duration": "5 days",
      "quantity": 15,
      "instructions": "Take after meals"
    }
  ],
  "notes": "Take with warm water"
}
```

**Responses:**

- **Status `201`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "patientId": "string",
      "consultationId": "string",
      "doctorId": "string",
      "prescriptionDate": "2026-06-13T16:39:03.290Z",
      "items": "string",
      "status": "string",
      "dispensedById": "string",
      "dispensedAt": "2026-06-13T16:39:03.290Z",
      "notes": "string",
      "isRefill": false,
      "refillsAllowed": 0,
      "refillsRemaining": 0,
      "createdAt": "2026-06-13T16:39:03.290Z",
      "updatedAt": "2026-06-13T16:39:03.290Z"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.290Z"
  }
  ```

---

### `POST /api/pharmacy/sales`

**Purpose:** Process a new drug sale

- **Authentication Required:** ✅ Yes

**Request Body:**

- **`patientId`** (Optional, _string_): (e.g. `"patient-id"`)
- **`prescriptionId`** (Optional, _string_): (e.g. `"prescription-id"`)
- **`items`** (Required, _array_):
  - Items properties:
    - **`drugId`** (Required, _string_): (e.g. `"drug-id"`)
    - **`batchId`** (Optional, _string_): (e.g. `"batch-id"`)
    - **`drugName`** (Required, _string_): (e.g. `"Paracetamol"`)
    - **`quantity`** (Required, _number_): (e.g. `2`)
    - **`unitPrice`** (Required, _number_): (e.g. `5.5`)
    - **`total`** (Required, _number_): (e.g. `11`)
- **`paymentMethod`** (Optional, _string_): (e.g. `"cash"`)
- **`paymentStatus`** (Optional, _string_): (e.g. `"paid"`)

**Request Example:**

```json
{
  "patientId": "patient-id",
  "prescriptionId": "prescription-id",
  "items": [
    {
      "drugId": "drug-id",
      "batchId": "batch-id",
      "drugName": "Paracetamol",
      "quantity": 2,
      "unitPrice": 5.5,
      "total": 11
    }
  ],
  "paymentMethod": "cash",
  "paymentStatus": "paid"
}
```

**Responses:**

- **Status `201`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "patientId": "string",
      "prescriptionId": "string",
      "servedById": "string",
      "saleDate": "2026-06-13T16:39:03.290Z",
      "saleType": "string",
      "items": "string",
      "subtotal": 0,
      "discountAmount": 0,
      "taxAmount": 0,
      "totalAmount": 0,
      "paymentStatus": "string",
      "paymentMethod": "string",
      "amountPaid": 0,
      "amountDue": 0,
      "receiptNumber": "string",
      "createdAt": "2026-06-13T16:39:03.290Z"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.290Z"
  }
  ```

---

### `PATCH /api/pharmacy`

**Purpose:** Multiplexed PATCH route matching Next.js API compatibility

- **Authentication Required:** ✅ Yes

**Request Body:**

- **`resource`** (Required, _string [enum: drug, prescription]_):
- **`id`** (Required, _string_): (e.g. `"record-id"`)
- **`drugName`** (Optional, _string_): (e.g. `"Paracetamol"`)
- **`quantityInStock`** (Optional, _number_): (e.g. `120`)
- **`sellingPrice`** (Optional, _number_): (e.g. `6`)
- **`status`** (Optional, _string_): (e.g. `"completed"`)
- **`notes`** (Optional, _string_): (e.g. `"Some prescription updates"`)

**Request Example:**

```json
{
  "resource": "string",
  "id": "record-id",
  "drugName": "Paracetamol",
  "quantityInStock": 120,
  "sellingPrice": 6,
  "status": "completed",
  "notes": "Some prescription updates"
}
```

**Responses:**

- **Status `200`**:

  ```json
  {
    "success": true,
    "data": {
      "note": "Response shape depends on the \"resource\" param. See PATCH /api/pharmacy/drugs/{id} or /api/pharmacy/prescriptions/{id} for specific shapes."
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `PATCH /api/pharmacy/drugs/{id}`

**Purpose:** Update drug details

* **Authentication Required:** ✅ Yes

**Path Parameters:**
- `id` (Required):  *(type: string)*

**Request Body:**

- **`drugName`** (Optional, *string*):  (e.g. `"Paracetamol"`)
- **`genericName`** (Optional, *string*):  (e.g. `"Acetaminophen"`)
- **`brandName`** (Optional, *string*):  (e.g. `"Panadol"`)
- **`drugCode`** (Optional, *string*):  (e.g. `"DRG001"`)
- **`drugCategory`** (Optional, *string*):  (e.g. `"analgesic"`)
- **`dosageForm`** (Optional, *string*):  (e.g. `"tablet"`)
- **`strength`** (Optional, *string*):  (e.g. `"500mg"`)
- **`quantityInStock`** (Optional, *number*):  (e.g. `100`)
- **`unitOfMeasure`** (Optional, *string*):  (e.g. `"tablet"`)
- **`reorderLevel`** (Optional, *number*):  (e.g. `10`)
- **`sellingPrice`** (Optional, *number*):  (e.g. `5.5`)
- **`costPrice`** (Optional, *number*):  (e.g. `3.2`)
- **`requiresPrescription`** (Optional, *boolean*):  (e.g. `false`)
- **`storageLocation`** (Optional, *string*):  (e.g. `"Shelf A1"`)
- **`description`** (Optional, *string*):  (e.g. `"Pain reliever"`)
- **`isActive`** (Optional, *boolean*):  (e.g. `true`)

**Request Example:**
```json
{
  "drugName": "Paracetamol",
  "genericName": "Acetaminophen",
  "brandName": "Panadol",
  "drugCode": "DRG001",
  "drugCategory": "analgesic",
  "dosageForm": "tablet",
  "strength": "500mg",
  "quantityInStock": 100,
  "unitOfMeasure": "tablet",
  "reorderLevel": 10,
  "sellingPrice": 5.5,
  "costPrice": 3.2,
  "requiresPrescription": false,
  "storageLocation": "Shelf A1",
  "description": "Pain reliever",
  "isActive": true
}
````

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "drugName": "string",
      "genericName": "string",
      "brandName": "string",
      "drugCode": "string",
      "drugCategory": "string",
      "dosageForm": "string",
      "strength": "string",
      "quantityInStock": 0,
      "unitOfMeasure": "string",
      "reorderLevel": 0,
      "sellingPrice": 0,
      "costPrice": 0,
      "requiresPrescription": false,
      "storageLocation": "string",
      "description": "string",
      "isActive": false,
      "createdAt": "2026-06-13T16:39:03.290Z",
      "updatedAt": "2026-06-13T16:39:03.290Z"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.290Z"
  }
  ```

---

### `PATCH /api/pharmacy/prescriptions/{id}`

**Purpose:** Update prescription details

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:**

- **`status`** (Optional, _string_): (e.g. `"pending"`)
- **`notes`** (Optional, _string_): (e.g. `"Updated notes"`)
- **`items`** (Optional, _array_):
  - Items properties:
    - **`drugId`** (Required, _string_): (e.g. `"drug-id"`)
    - **`drugName`** (Required, _string_): (e.g. `"Paracetamol"`)
    - **`dosage`** (Optional, _string_): (e.g. `"500mg"`)
    - **`frequency`** (Optional, _string_): (e.g. `"3 times daily"`)
    - **`duration`** (Optional, _string_): (e.g. `"5 days"`)
    - **`quantity`** (Required, _number_): (e.g. `15`)
    - **`instructions`** (Optional, _string_): (e.g. `"Take after meals"`)

**Request Example:**

```json
{
  "status": "pending",
  "notes": "Updated notes",
  "items": [
    {
      "drugId": "drug-id",
      "drugName": "Paracetamol",
      "dosage": "500mg",
      "frequency": "3 times daily",
      "duration": "5 days",
      "quantity": 15,
      "instructions": "Take after meals"
    }
  ]
}
```

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "patientId": "string",
      "consultationId": "string",
      "doctorId": "string",
      "prescriptionDate": "2026-06-13T16:39:03.290Z",
      "items": "string",
      "status": "string",
      "dispensedById": "string",
      "dispensedAt": "2026-06-13T16:39:03.290Z",
      "notes": "string",
      "isRefill": false,
      "refillsAllowed": 0,
      "refillsRemaining": 0,
      "createdAt": "2026-06-13T16:39:03.290Z",
      "updatedAt": "2026-06-13T16:39:03.290Z"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.290Z"
  }
  ```

---

## 📦 Radiology Module

### `GET /api/radiology`

**Purpose:** Multiplexed GET route matching legacy Next.js radiology API

- **Authentication Required:** ✅ Yes

**Query Parameters:**

- `resource` (Optional): _(type: string) (default: `exams`)_
- `category` (Optional): _(type: string)_
- `status` (Optional): _(type: string)_
- `urgency` (Optional): _(type: string)_
- `orderId` (Optional): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": [
      {
        "note": "Response shape depends on the resource param. Use ?resource=exams, ?resource=orders, ?resource=reports, or ?resource=stats. See dedicated sub-endpoints for specific shapes."
      }
    ],
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

---

### `GET /api/radiology/exams`

**Purpose:** List active radiology exams

- **Authentication Required:** ✅ Yes

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "exam-cuid",
        "organizationId": "org-demo",
        "examName": "Chest X-Ray PA View",
        "examCode": "CXR-PA",
        "examCategory": "x-ray",
        "bodyPart": "Chest",
        "modality": "DR",
        "price": 500,
        "estimatedDuration": 15,
        "preparationInstructions": "Remove metal objects",
        "contrastRequired": false,
        "description": "Plain radiograph",
        "isActive": true,
        "createdAt": "2026-06-10T00:00:00.000Z",
        "updatedAt": "2026-06-10T00:00:00.000Z",
        "createdById": "user-id"
      }
    ],
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.290Z"
  }
  ```

---

### `GET /api/radiology/exams/{id}`

**Purpose:** Get radiology exam by ID

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "exam-cuid",
      "organizationId": "org-demo",
      "examName": "Chest X-Ray PA View",
      "examCode": "CXR-PA",
      "examCategory": "x-ray",
      "bodyPart": "Chest",
      "modality": "DR",
      "price": 500,
      "estimatedDuration": 15,
      "preparationInstructions": "Remove metal objects",
      "contrastRequired": false,
      "description": "Plain radiograph",
      "isActive": true,
      "createdAt": "2026-06-10T00:00:00.000Z",
      "updatedAt": "2026-06-10T00:00:00.000Z",
      "createdById": "user-id"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.290Z"
  }
  ```

---

### `GET /api/radiology/orders`

**Purpose:** List radiology orders

- **Authentication Required:** ✅ Yes

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "order-cuid",
        "organizationId": "org-demo",
        "patientId": "patient-cuid",
        "consultationId": "consultation-cuid",
        "requestedById": "user-cuid",
        "examId": "exam-cuid",
        "orderDate": "2026-06-10T00:00:00.000Z",
        "orderNumber": "RAD1718000000000",
        "clinicalIndication": "Persistent cough",
        "provisionalDiagnosis": "Pneumonia",
        "relevantHistory": "Fever for 5 days",
        "urgency": "routine",
        "status": "pending",
        "scheduledDate": "2026-06-10T10:00:00.000Z",
        "examPerformedAt": "2026-06-10T10:30:00.000Z",
        "performedById": "user-cuid",
        "reportCreatedAt": "2026-06-10T11:00:00.000Z",
        "reportedById": "user-cuid",
        "reportVerifiedAt": "2026-06-10T12:00:00.000Z",
        "verifiedById": "user-cuid",
        "notes": "Wheelchair patient",
        "cancellationReason": "Patient did not arrive",
        "createdAt": "2026-06-10T00:00:00.000Z",
        "updatedAt": "2026-06-10T00:00:00.000Z",
        "createdById": "user-cuid"
      }
    ],
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.290Z"
  }
  ```

---

### `GET /api/radiology/orders/{id}`

**Purpose:** Get radiology order by ID

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "order-cuid",
      "organizationId": "org-demo",
      "patientId": "patient-cuid",
      "consultationId": "consultation-cuid",
      "requestedById": "user-cuid",
      "examId": "exam-cuid",
      "orderDate": "2026-06-10T00:00:00.000Z",
      "orderNumber": "RAD1718000000000",
      "clinicalIndication": "Persistent cough",
      "provisionalDiagnosis": "Pneumonia",
      "relevantHistory": "Fever for 5 days",
      "urgency": "routine",
      "status": "pending",
      "scheduledDate": "2026-06-10T10:00:00.000Z",
      "examPerformedAt": "2026-06-10T10:30:00.000Z",
      "performedById": "user-cuid",
      "reportCreatedAt": "2026-06-10T11:00:00.000Z",
      "reportedById": "user-cuid",
      "reportVerifiedAt": "2026-06-10T12:00:00.000Z",
      "verifiedById": "user-cuid",
      "notes": "Wheelchair patient",
      "cancellationReason": "Patient did not arrive",
      "createdAt": "2026-06-10T00:00:00.000Z",
      "updatedAt": "2026-06-10T00:00:00.000Z",
      "createdById": "user-cuid"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.290Z"
  }
  ```

---

### `GET /api/radiology/reports`

**Purpose:** List radiology reports

- **Authentication Required:** ✅ Yes

**Query Parameters:**

- `orderId` (Required): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "report-cuid",
        "organizationId": "org-demo",
        "orderId": "order-cuid",
        "technique": "PA chest radiograph obtained",
        "findings": "No focal consolidation",
        "impression": "No acute cardiopulmonary abnormality",
        "recommendations": "Clinical follow-up",
        "hasCriticalFindings": false,
        "criticalFindings": "Large pneumothorax",
        "comparedWithPrevious": false,
        "comparisonNotes": "Stable compared to prior study",
        "status": "draft",
        "createdAt": "2026-06-10T00:00:00.000Z",
        "updatedAt": "2026-06-10T00:00:00.000Z"
      }
    ],
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.290Z"
  }
  ```

---

### `GET /api/radiology/reports/{id}`

**Purpose:** Get radiology report by ID

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "report-cuid",
      "organizationId": "org-demo",
      "orderId": "order-cuid",
      "technique": "PA chest radiograph obtained",
      "findings": "No focal consolidation",
      "impression": "No acute cardiopulmonary abnormality",
      "recommendations": "Clinical follow-up",
      "hasCriticalFindings": false,
      "criticalFindings": "Large pneumothorax",
      "comparedWithPrevious": false,
      "comparisonNotes": "Stable compared to prior study",
      "status": "draft",
      "createdAt": "2026-06-10T00:00:00.000Z",
      "updatedAt": "2026-06-10T00:00:00.000Z"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.290Z"
  }
  ```

---

### `GET /api/radiology/stats/summary`

**Purpose:** Get radiology dashboard statistics

- **Authentication Required:** ✅ Yes

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "pending": 3,
      "inProgress": 2,
      "completedToday": 8,
      "criticalFindings": 1,
      "totalExams": 15
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `POST /api/radiology`

**Purpose:** Multiplexed POST route matching legacy Next.js radiology API

* **Authentication Required:** ✅ Yes

**Request Body:**

- **`resource`** (Optional, *string [enum: exam, order, report]*):
- **`examName`** (Optional, *string*):  (e.g. `"Chest X-Ray PA View"`)
- **`examCode`** (Optional, *string*):  (e.g. `"CXR-PA"`)
- **`examCategory`** (Optional, *string*):  (e.g. `"x-ray"`)
- **`bodyPart`** (Optional, *string*):  (e.g. `"Chest"`)
- **`modality`** (Optional, *string*):  (e.g. `"DR"`)
- **`price`** (Optional, *number*):  (e.g. `500`)
- **`estimatedDuration`** (Optional, *number*):  (e.g. `15`)
- **`preparationInstructions`** (Optional, *string*):  (e.g. `"Remove metal objects before exam"`)
- **`contrastRequired`** (Optional, *boolean*):  (e.g. `false`)
- **`description`** (Optional, *string*):  (e.g. `"Plain radiograph of chest"`)
- **`patientId`** (Optional, *string*):  (e.g. `"patient-cuid"`)
- **`consultationId`** (Optional, *string*):  (e.g. `"consultation-cuid"`)
- **`examId`** (Optional, *string*):  (e.g. `"exam-cuid"`)
- **`clinicalIndication`** (Optional, *string*):  (e.g. `"Persistent cough"`)
- **`provisionalDiagnosis`** (Optional, *string*):  (e.g. `"Pneumonia"`)
- **`relevantHistory`** (Optional, *string*):  (e.g. `"Fever for 5 days"`)
- **`urgency`** (Optional, *string*):  (e.g. `"routine"`)
- **`notes`** (Optional, *string*):  (e.g. `"Order notes"`)
- **`orderId`** (Optional, *string*):  (e.g. `"order-cuid"`)
- **`technique`** (Optional, *string*):  (e.g. `"PA chest radiograph obtained"`)
- **`findings`** (Optional, *string*):  (e.g. `"No focal consolidation"`)
- **`impression`** (Optional, *string*):  (e.g. `"No acute cardiopulmonary abnormality"`)
- **`recommendations`** (Optional, *string*):  (e.g. `"Clinical follow-up"`)
- **`hasCriticalFindings`** (Optional, *boolean*):  (e.g. `false`)
- **`criticalFindings`** (Optional, *string*):  (e.g. `"Large pneumothorax"`)
- **`comparedWithPrevious`** (Optional, *boolean*):  (e.g. `false`)
- **`comparisonNotes`** (Optional, *string*):  (e.g. `"Stable compared to prior study"`)

**Request Example:**
```json
{
  "resource": "string",
  "examName": "Chest X-Ray PA View",
  "examCode": "CXR-PA",
  "examCategory": "x-ray",
  "bodyPart": "Chest",
  "modality": "DR",
  "price": 500,
  "estimatedDuration": 15,
  "preparationInstructions": "Remove metal objects before exam",
  "contrastRequired": false,
  "description": "Plain radiograph of chest",
  "patientId": "patient-cuid",
  "consultationId": "consultation-cuid",
  "examId": "exam-cuid",
  "clinicalIndication": "Persistent cough",
  "provisionalDiagnosis": "Pneumonia",
  "relevantHistory": "Fever for 5 days",
  "urgency": "routine",
  "notes": "Order notes",
  "orderId": "order-cuid",
  "technique": "PA chest radiograph obtained",
  "findings": "No focal consolidation",
  "impression": "No acute cardiopulmonary abnormality",
  "recommendations": "Clinical follow-up",
  "hasCriticalFindings": false,
  "criticalFindings": "Large pneumothorax",
  "comparedWithPrevious": false,
  "comparisonNotes": "Stable compared to prior study"
}
````

**Responses:**

- **Status `201`**:
  ```json
  {
    "success": true,
    "data": {
      "note": "Response shape depends on the \"resource\" param. See POST /api/radiology/exams, /api/radiology/orders, or /api/radiology/reports for specific shapes."
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `POST /api/radiology/exams`

**Purpose:** Create radiology exam catalog item

* **Authentication Required:** ✅ Yes

**Request Body:**

- **`examName`** (Required, *string*):  (e.g. `"Chest X-Ray PA View"`)
- **`examCode`** (Optional, *string*):  (e.g. `"CXR-PA"`)
- **`examCategory`** (Optional, *string*):  (e.g. `"x-ray"`)
- **`bodyPart`** (Optional, *string*):  (e.g. `"Chest"`)
- **`modality`** (Optional, *string*):  (e.g. `"DR"`)
- **`price`** (Optional, *number*):  (e.g. `500`)
- **`estimatedDuration`** (Optional, *number*):  (e.g. `15`)
- **`preparationInstructions`** (Optional, *string*):  (e.g. `"Remove metal objects before exam"`)
- **`contrastRequired`** (Optional, *boolean*):  (e.g. `false`)
- **`description`** (Optional, *string*):  (e.g. `"Plain radiograph of chest"`)

**Request Example:**
```json
{
  "examName": "Chest X-Ray PA View",
  "examCode": "CXR-PA",
  "examCategory": "x-ray",
  "bodyPart": "Chest",
  "modality": "DR",
  "price": 500,
  "estimatedDuration": 15,
  "preparationInstructions": "Remove metal objects before exam",
  "contrastRequired": false,
  "description": "Plain radiograph of chest"
}
````

**Responses:**

- **Status `201`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "exam-cuid",
      "organizationId": "org-demo",
      "examName": "Chest X-Ray PA View",
      "examCode": "CXR-PA",
      "examCategory": "x-ray",
      "bodyPart": "Chest",
      "modality": "DR",
      "price": 500,
      "estimatedDuration": 15,
      "preparationInstructions": "Remove metal objects",
      "contrastRequired": false,
      "description": "Plain radiograph",
      "isActive": true,
      "createdAt": "2026-06-10T00:00:00.000Z",
      "updatedAt": "2026-06-10T00:00:00.000Z",
      "createdById": "user-id"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.291Z"
  }
  ```

---

### `POST /api/radiology/orders`

**Purpose:** Create radiology order

- **Authentication Required:** ✅ Yes

**Request Body:**

- **`patientId`** (Required, _string_): (e.g. `"patient-cuid"`)
- **`consultationId`** (Optional, _string_): (e.g. `"consultation-cuid"`)
- **`examId`** (Required, _string_): (e.g. `"exam-cuid"`)
- **`clinicalIndication`** (Optional, _string_): (e.g. `"Persistent cough"`)
- **`provisionalDiagnosis`** (Optional, _string_): (e.g. `"Pneumonia"`)
- **`relevantHistory`** (Optional, _string_): (e.g. `"Fever for 5 days"`)
- **`urgency`** (Optional, _string_): (e.g. `"routine"`)
- **`notes`** (Optional, _string_): (e.g. `"Wheelchair patient"`)

**Request Example:**

```json
{
  "patientId": "patient-cuid",
  "consultationId": "consultation-cuid",
  "examId": "exam-cuid",
  "clinicalIndication": "Persistent cough",
  "provisionalDiagnosis": "Pneumonia",
  "relevantHistory": "Fever for 5 days",
  "urgency": "routine",
  "notes": "Wheelchair patient"
}
```

**Responses:**

- **Status `201`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "order-cuid",
      "organizationId": "org-demo",
      "patientId": "patient-cuid",
      "consultationId": "consultation-cuid",
      "requestedById": "user-cuid",
      "examId": "exam-cuid",
      "orderDate": "2026-06-10T00:00:00.000Z",
      "orderNumber": "RAD1718000000000",
      "clinicalIndication": "Persistent cough",
      "provisionalDiagnosis": "Pneumonia",
      "relevantHistory": "Fever for 5 days",
      "urgency": "routine",
      "status": "pending",
      "scheduledDate": "2026-06-10T10:00:00.000Z",
      "examPerformedAt": "2026-06-10T10:30:00.000Z",
      "performedById": "user-cuid",
      "reportCreatedAt": "2026-06-10T11:00:00.000Z",
      "reportedById": "user-cuid",
      "reportVerifiedAt": "2026-06-10T12:00:00.000Z",
      "verifiedById": "user-cuid",
      "notes": "Wheelchair patient",
      "cancellationReason": "Patient did not arrive",
      "createdAt": "2026-06-10T00:00:00.000Z",
      "updatedAt": "2026-06-10T00:00:00.000Z",
      "createdById": "user-cuid"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.291Z"
  }
  ```

---

### `POST /api/radiology/reports`

**Purpose:** Create radiology report

- **Authentication Required:** ✅ Yes

**Request Body:**

- **`orderId`** (Required, _string_): (e.g. `"order-cuid"`)
- **`technique`** (Optional, _string_): (e.g. `"PA chest radiograph obtained"`)
- **`findings`** (Optional, _string_): (e.g. `"No focal consolidation"`)
- **`impression`** (Optional, _string_): (e.g. `"No acute cardiopulmonary abnormality"`)
- **`recommendations`** (Optional, _string_): (e.g. `"Clinical follow-up"`)
- **`hasCriticalFindings`** (Optional, _boolean_): (e.g. `false`)
- **`criticalFindings`** (Optional, _string_): (e.g. `"Large pneumothorax"`)
- **`comparedWithPrevious`** (Optional, _boolean_): (e.g. `false`)
- **`comparisonNotes`** (Optional, _string_): (e.g. `"Stable compared to prior study"`)

**Request Example:**

```json
{
  "orderId": "order-cuid",
  "technique": "PA chest radiograph obtained",
  "findings": "No focal consolidation",
  "impression": "No acute cardiopulmonary abnormality",
  "recommendations": "Clinical follow-up",
  "hasCriticalFindings": false,
  "criticalFindings": "Large pneumothorax",
  "comparedWithPrevious": false,
  "comparisonNotes": "Stable compared to prior study"
}
```

**Responses:**

- **Status `201`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "report-cuid",
      "organizationId": "org-demo",
      "orderId": "order-cuid",
      "technique": "PA chest radiograph obtained",
      "findings": "No focal consolidation",
      "impression": "No acute cardiopulmonary abnormality",
      "recommendations": "Clinical follow-up",
      "hasCriticalFindings": false,
      "criticalFindings": "Large pneumothorax",
      "comparedWithPrevious": false,
      "comparisonNotes": "Stable compared to prior study",
      "status": "draft",
      "createdAt": "2026-06-10T00:00:00.000Z",
      "updatedAt": "2026-06-10T00:00:00.000Z"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.291Z"
  }
  ```

---

### `PATCH /api/radiology`

**Purpose:** Multiplexed PATCH route matching legacy Next.js radiology API

- **Authentication Required:** ✅ Yes

**Request Body:**

- **`resource`** (Required, _string [enum: exam, order, report]_):
- **`id`** (Required, _string_): (e.g. `"record-cuid"`)
- **`examName`** (Optional, _string_): (e.g. `"updated name"`)
- **`examCode`** (Optional, _string_): (e.g. `"CXR-UPD"`)
- **`examCategory`** (Optional, _string_): (e.g. `"x-ray"`)
- **`bodyPart`** (Optional, _string_): (e.g. `"Chest"`)
- **`modality`** (Optional, _string_): (e.g. `"DR"`)
- **`price`** (Optional, _number_): (e.g. `600`)
- **`estimatedDuration`** (Optional, _number_): (e.g. `20`)
- **`preparationInstructions`** (Optional, _string_): (e.g. `"Updated prep"`)
- **`contrastRequired`** (Optional, _boolean_): (e.g. `false`)
- **`description`** (Optional, _string_): (e.g. `"Updated description"`)
- **`isActive`** (Optional, _boolean_): (e.g. `true`)
- **`status`** (Optional, _string_): (e.g. `"in_progress"`)
- **`urgency`** (Optional, _string_): (e.g. `"urgent"`)
- **`notes`** (Optional, _string_): (e.g. `"Updated notes"`)
- **`clinicalIndication`** (Optional, _string_): (e.g. `"Persistent cough"`)
- **`provisionalDiagnosis`** (Optional, _string_): (e.g. `"Pneumonia"`)
- **`relevantHistory`** (Optional, _string_): (e.g. `"History"`)
- **`scheduledDate`** (Optional, _string_): (e.g. `"2026-06-10T10:00:00.000Z"`)
- **`examPerformedAt`** (Optional, _string_): (e.g. `"2026-06-10T10:30:00.000Z"`)
- **`performedById`** (Optional, _string_): (e.g. `"user-cuid"`)
- **`cancellationReason`** (Optional, _string_): (e.g. `"Patient cancelled"`)
- **`technique`** (Optional, _string_): (e.g. `"PA chest radiograph obtained"`)
- **`findings`** (Optional, _string_): (e.g. `"No focal consolidation"`)
- **`impression`** (Optional, _string_): (e.g. `"No acute cardiopulmonary abnormality"`)
- **`recommendations`** (Optional, _string_): (e.g. `"Clinical follow-up"`)
- **`hasCriticalFindings`** (Optional, _boolean_): (e.g. `false`)
- **`criticalFindings`** (Optional, _string_): (e.g. `"Critical details"`)
- **`criticalNotifiedTo`** (Optional, _string_): (e.g. `"Dr Smith"`)
- **`criticalNotifiedAt`** (Optional, _string_): (e.g. `"2026-06-10T12:00:00.000Z"`)
- **`comparedWithPrevious`** (Optional, _boolean_): (e.g. `false`)
- **`comparisonNotes`** (Optional, _string_): (e.g. `"Stable"`)
- **`reportStatus`** (Optional, _string_): (e.g. `"final"`)
- **`verifiedAt`** (Optional, _string_): (e.g. `"2026-06-10T12:00:00.000Z"`)

**Request Example:**

```json
{
  "resource": "string",
  "id": "record-cuid",
  "examName": "updated name",
  "examCode": "CXR-UPD",
  "examCategory": "x-ray",
  "bodyPart": "Chest",
  "modality": "DR",
  "price": 600,
  "estimatedDuration": 20,
  "preparationInstructions": "Updated prep",
  "contrastRequired": false,
  "description": "Updated description",
  "isActive": true,
  "status": "in_progress",
  "urgency": "urgent",
  "notes": "Updated notes",
  "clinicalIndication": "Persistent cough",
  "provisionalDiagnosis": "Pneumonia",
  "relevantHistory": "History",
  "scheduledDate": "2026-06-10T10:00:00.000Z",
  "examPerformedAt": "2026-06-10T10:30:00.000Z",
  "performedById": "user-cuid",
  "cancellationReason": "Patient cancelled",
  "technique": "PA chest radiograph obtained",
  "findings": "No focal consolidation",
  "impression": "No acute cardiopulmonary abnormality",
  "recommendations": "Clinical follow-up",
  "hasCriticalFindings": false,
  "criticalFindings": "Critical details",
  "criticalNotifiedTo": "Dr Smith",
  "criticalNotifiedAt": "2026-06-10T12:00:00.000Z",
  "comparedWithPrevious": false,
  "comparisonNotes": "Stable",
  "reportStatus": "final",
  "verifiedAt": "2026-06-10T12:00:00.000Z"
}
```

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "note": "Response shape depends on the \"resource\" param. See PATCH /api/radiology/exams/{id}, /api/radiology/orders/{id}, or /api/radiology/reports/{id} for specific shapes."
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `PATCH /api/radiology/exams/{id}`

**Purpose:** Update radiology exam catalog item

* **Authentication Required:** ✅ Yes

**Path Parameters:**
- `id` (Required):  *(type: string)*

**Request Body:**

- **`examName`** (Optional, *string*):  (e.g. `"Chest X-Ray PA View"`)
- **`examCode`** (Optional, *string*):  (e.g. `"CXR-PA"`)
- **`examCategory`** (Optional, *string*):  (e.g. `"x-ray"`)
- **`bodyPart`** (Optional, *string*):  (e.g. `"Chest"`)
- **`modality`** (Optional, *string*):  (e.g. `"DR"`)
- **`price`** (Optional, *number*):  (e.g. `500`)
- **`estimatedDuration`** (Optional, *number*):  (e.g. `15`)
- **`preparationInstructions`** (Optional, *string*):  (e.g. `"Remove metal objects before exam"`)
- **`contrastRequired`** (Optional, *boolean*):  (e.g. `false`)
- **`description`** (Optional, *string*):  (e.g. `"Plain radiograph of chest"`)
- **`isActive`** (Optional, *boolean*):  (e.g. `true`)

**Request Example:**
```json
{
  "examName": "Chest X-Ray PA View",
  "examCode": "CXR-PA",
  "examCategory": "x-ray",
  "bodyPart": "Chest",
  "modality": "DR",
  "price": 500,
  "estimatedDuration": 15,
  "preparationInstructions": "Remove metal objects before exam",
  "contrastRequired": false,
  "description": "Plain radiograph of chest",
  "isActive": true
}
````

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "exam-cuid",
      "organizationId": "org-demo",
      "examName": "Chest X-Ray PA View",
      "examCode": "CXR-PA",
      "examCategory": "x-ray",
      "bodyPart": "Chest",
      "modality": "DR",
      "price": 500,
      "estimatedDuration": 15,
      "preparationInstructions": "Remove metal objects",
      "contrastRequired": false,
      "description": "Plain radiograph",
      "isActive": true,
      "createdAt": "2026-06-10T00:00:00.000Z",
      "updatedAt": "2026-06-10T00:00:00.000Z",
      "createdById": "user-id"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.291Z"
  }
  ```

---

### `PATCH /api/radiology/orders/{id}`

**Purpose:** Update radiology order

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:**

- **`patientId`** (Optional, _string_): (e.g. `"patient-cuid"`)
- **`consultationId`** (Optional, _string_): (e.g. `"consultation-cuid"`)
- **`examId`** (Optional, _string_): (e.g. `"exam-cuid"`)
- **`clinicalIndication`** (Optional, _string_): (e.g. `"Persistent cough"`)
- **`provisionalDiagnosis`** (Optional, _string_): (e.g. `"Pneumonia"`)
- **`relevantHistory`** (Optional, _string_): (e.g. `"Fever for 5 days"`)
- **`urgency`** (Optional, _string_): (e.g. `"routine"`)
- **`notes`** (Optional, _string_): (e.g. `"Wheelchair patient"`)
- **`status`** (Optional, _string_): (e.g. `"in_progress"`)
- **`scheduledDate`** (Optional, _string_): (e.g. `"2026-06-10T10:00:00.000Z"`)
- **`examPerformedAt`** (Optional, _string_): (e.g. `"2026-06-10T10:30:00.000Z"`)
- **`performedById`** (Optional, _string_): (e.g. `"user-cuid"`)
- **`reportCreatedAt`** (Optional, _string_): (e.g. `"2026-06-10T11:00:00.000Z"`)
- **`reportedById`** (Optional, _string_): (e.g. `"user-cuid"`)
- **`reportVerifiedAt`** (Optional, _string_): (e.g. `"2026-06-10T12:00:00.000Z"`)
- **`verifiedById`** (Optional, _string_): (e.g. `"user-cuid"`)
- **`cancellationReason`** (Optional, _string_): (e.g. `"Patient did not arrive"`)

**Request Example:**

```json
{
  "patientId": "patient-cuid",
  "consultationId": "consultation-cuid",
  "examId": "exam-cuid",
  "clinicalIndication": "Persistent cough",
  "provisionalDiagnosis": "Pneumonia",
  "relevantHistory": "Fever for 5 days",
  "urgency": "routine",
  "notes": "Wheelchair patient",
  "status": "in_progress",
  "scheduledDate": "2026-06-10T10:00:00.000Z",
  "examPerformedAt": "2026-06-10T10:30:00.000Z",
  "performedById": "user-cuid",
  "reportCreatedAt": "2026-06-10T11:00:00.000Z",
  "reportedById": "user-cuid",
  "reportVerifiedAt": "2026-06-10T12:00:00.000Z",
  "verifiedById": "user-cuid",
  "cancellationReason": "Patient did not arrive"
}
```

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "order-cuid",
      "organizationId": "org-demo",
      "patientId": "patient-cuid",
      "consultationId": "consultation-cuid",
      "requestedById": "user-cuid",
      "examId": "exam-cuid",
      "orderDate": "2026-06-10T00:00:00.000Z",
      "orderNumber": "RAD1718000000000",
      "clinicalIndication": "Persistent cough",
      "provisionalDiagnosis": "Pneumonia",
      "relevantHistory": "Fever for 5 days",
      "urgency": "routine",
      "status": "pending",
      "scheduledDate": "2026-06-10T10:00:00.000Z",
      "examPerformedAt": "2026-06-10T10:30:00.000Z",
      "performedById": "user-cuid",
      "reportCreatedAt": "2026-06-10T11:00:00.000Z",
      "reportedById": "user-cuid",
      "reportVerifiedAt": "2026-06-10T12:00:00.000Z",
      "verifiedById": "user-cuid",
      "notes": "Wheelchair patient",
      "cancellationReason": "Patient did not arrive",
      "createdAt": "2026-06-10T00:00:00.000Z",
      "updatedAt": "2026-06-10T00:00:00.000Z",
      "createdById": "user-cuid"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.291Z"
  }
  ```

---

### `PATCH /api/radiology/reports/{id}`

**Purpose:** Update radiology report

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:**

- **`orderId`** (Optional, _string_): (e.g. `"order-cuid"`)
- **`technique`** (Optional, _string_): (e.g. `"PA chest radiograph obtained"`)
- **`findings`** (Optional, _string_): (e.g. `"No focal consolidation"`)
- **`impression`** (Optional, _string_): (e.g. `"No acute cardiopulmonary abnormality"`)
- **`recommendations`** (Optional, _string_): (e.g. `"Clinical follow-up"`)
- **`hasCriticalFindings`** (Optional, _boolean_): (e.g. `false`)
- **`criticalFindings`** (Optional, _string_): (e.g. `"Large pneumothorax"`)
- **`comparedWithPrevious`** (Optional, _boolean_): (e.g. `false`)
- **`comparisonNotes`** (Optional, _string_): (e.g. `"Stable compared to prior study"`)
- **`criticalNotifiedTo`** (Optional, _string_): (e.g. `"Dr Smith"`)
- **`criticalNotifiedAt`** (Optional, _string_): (e.g. `"2026-06-10T12:00:00.000Z"`)
- **`images`** (Optional, _string_): (e.g. `"[{\"url\":\"https://example.com/image.jpg\",\"caption\":\"PA\"}]"`)
- **`dicomStudyUid`** (Optional, _string_): (e.g. `"1.2.840.113619"`)
- **`templateUsed`** (Optional, _string_): (e.g. `"Chest X-Ray Normal Template"`)
- **`reportedById`** (Optional, _string_): (e.g. `"user-cuid"`)
- **`reportedAt`** (Optional, _string_): (e.g. `"2026-06-10T11:00:00.000Z"`)
- **`verifiedById`** (Optional, _string_): (e.g. `"user-cuid"`)
- **`verifiedAt`** (Optional, _string_): (e.g. `"2026-06-10T12:00:00.000Z"`)
- **`status`** (Optional, _string_): (e.g. `"final"`)
- **`amendmentReason`** (Optional, _string_): (e.g. `"Typo correction"`)
- **`amendedAt`** (Optional, _string_): (e.g. `"2026-06-10T13:00:00.000Z"`)
- **`amendedById`** (Optional, _string_): (e.g. `"user-cuid"`)

**Request Example:**

```json
{
  "orderId": "order-cuid",
  "technique": "PA chest radiograph obtained",
  "findings": "No focal consolidation",
  "impression": "No acute cardiopulmonary abnormality",
  "recommendations": "Clinical follow-up",
  "hasCriticalFindings": false,
  "criticalFindings": "Large pneumothorax",
  "comparedWithPrevious": false,
  "comparisonNotes": "Stable compared to prior study",
  "criticalNotifiedTo": "Dr Smith",
  "criticalNotifiedAt": "2026-06-10T12:00:00.000Z",
  "images": "[{\"url\":\"https://example.com/image.jpg\",\"caption\":\"PA\"}]",
  "dicomStudyUid": "1.2.840.113619",
  "templateUsed": "Chest X-Ray Normal Template",
  "reportedById": "user-cuid",
  "reportedAt": "2026-06-10T11:00:00.000Z",
  "verifiedById": "user-cuid",
  "verifiedAt": "2026-06-10T12:00:00.000Z",
  "status": "final",
  "amendmentReason": "Typo correction",
  "amendedAt": "2026-06-10T13:00:00.000Z",
  "amendedById": "user-cuid"
}
```

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "report-cuid",
      "organizationId": "org-demo",
      "orderId": "order-cuid",
      "technique": "PA chest radiograph obtained",
      "findings": "No focal consolidation",
      "impression": "No acute cardiopulmonary abnormality",
      "recommendations": "Clinical follow-up",
      "hasCriticalFindings": false,
      "criticalFindings": "Large pneumothorax",
      "comparedWithPrevious": false,
      "comparisonNotes": "Stable compared to prior study",
      "status": "draft",
      "createdAt": "2026-06-10T00:00:00.000Z",
      "updatedAt": "2026-06-10T00:00:00.000Z"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.291Z"
  }
  ```

---

## 📦 Queue Module

### `GET /api/queue`

**Purpose:** List queue entries by service area and status

- **Authentication Required:** ✅ Yes

**Query Parameters:**

- `serviceArea` (Optional): _(type: string)_
- `status` (Optional): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "string",
        "organizationId": "string",
        "patientId": null,
        "serviceArea": "string",
        "serviceType": null,
        "queueNumber": "string",
        "priority": "string",
        "assignedToId": null,
        "assignedRoom": null,
        "status": "string",
        "joinedQueueAt": "2026-06-13T16:39:03.291Z",
        "calledAt": null,
        "serviceStartedAt": null,
        "serviceCompletedAt": null,
        "estimatedWaitMinutes": null,
        "displayMessage": null,
        "waitTime": 0,
        "patient": {
          "id": "string",
          "mrn": "string",
          "firstName": "string",
          "lastName": "string",
          "phonePrimary": null,
          "gender": null
        },
        "createdAt": "2026-06-13T16:39:03.291Z",
        "updatedAt": "2026-06-13T16:39:03.291Z"
      }
    ],
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.291Z"
  }
  ```

---

### `POST /api/queue`

**Purpose:** Add a patient to the queue

- **Authentication Required:** ✅ Yes

**Request Body:**

- **`patientId`** (Required, _string_): (e.g. `"clx123abc456"`)
- **`serviceArea`** (Required, _string_): (e.g. `"opd"`)
- **`serviceType`** (Optional, _string_): (e.g. `"consultation"`)
- **`priority`** (Optional, _string [enum: urgent, normal, low, routine]_):
- **`assignedToId`** (Optional, _string_): (e.g. `"clx-staff-123"`)
- **`assignedRoom`** (Optional, _string_): (e.g. `"Room 3"`)

**Request Example:**

```json
{
  "patientId": "clx123abc456",
  "serviceArea": "opd",
  "serviceType": "consultation",
  "priority": "string",
  "assignedToId": "clx-staff-123",
  "assignedRoom": "Room 3"
}
```

**Responses:**

- **Status `201`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "patientId": null,
      "serviceArea": "string",
      "serviceType": null,
      "queueNumber": "string",
      "priority": "string",
      "assignedToId": null,
      "assignedRoom": null,
      "status": "string",
      "joinedQueueAt": "2026-06-13T16:39:03.291Z",
      "calledAt": null,
      "serviceStartedAt": null,
      "serviceCompletedAt": null,
      "estimatedWaitMinutes": null,
      "displayMessage": null,
      "waitTime": 0,
      "patient": {
        "id": "string",
        "mrn": "string",
        "firstName": "string",
        "lastName": "string",
        "phonePrimary": null,
        "gender": null
      },
      "createdAt": "2026-06-13T16:39:03.291Z",
      "updatedAt": "2026-06-13T16:39:03.291Z"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.291Z"
  }
  ```

---

### `PATCH /api/queue/{id}`

**Purpose:** Update queue item status and assignment

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:**

- **`status`** (Optional, _string [enum: waiting, called, in_service, completed, cancelled, no_show]_): (e.g. `"called"`)
- **`priority`** (Optional, _string [enum: urgent, normal, low, routine]_): (e.g. `"urgent"`)
- **`serviceType`** (Optional, _string_): (e.g. `"consultation"`)
- **`assignedToId`** (Optional, _string_): (e.g. `"clx-staff-123"`)
- **`assignedRoom`** (Optional, _string_): (e.g. `"Room 3"`)
- **`estimatedWaitMinutes`** (Optional, _number_): (e.g. `15`)
- **`displayMessage`** (Optional, _string_): (e.g. `"Please proceed to Room 3"`)

**Request Example:**

```json
{
  "status": "called",
  "priority": "urgent",
  "serviceType": "consultation",
  "assignedToId": "clx-staff-123",
  "assignedRoom": "Room 3",
  "estimatedWaitMinutes": 15,
  "displayMessage": "Please proceed to Room 3"
}
```

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "patientId": null,
      "serviceArea": "string",
      "serviceType": null,
      "queueNumber": "string",
      "priority": "string",
      "assignedToId": null,
      "assignedRoom": null,
      "status": "string",
      "joinedQueueAt": "2026-06-13T16:39:03.291Z",
      "calledAt": null,
      "serviceStartedAt": null,
      "serviceCompletedAt": null,
      "estimatedWaitMinutes": null,
      "displayMessage": null,
      "waitTime": 0,
      "patient": {
        "id": "string",
        "mrn": "string",
        "firstName": "string",
        "lastName": "string",
        "phonePrimary": null,
        "gender": null
      },
      "createdAt": "2026-06-13T16:39:03.291Z",
      "updatedAt": "2026-06-13T16:39:03.291Z"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.291Z"
  }
  ```

---

### `DELETE /api/queue/{id}`

**Purpose:** Remove a queue item

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `204`**:

---

## 📦 Death Certificates Module

### `GET /api/death-certificates`

**Purpose:** Get death certificates with search and filter

- **Authentication Required:** ✅ Yes

**Query Parameters:**

- `search` (Optional): Search term for MRN, certificate number, or name _(type: string)_
- `place` (Optional): Place of death filter _(type: string) (default: `all`)_
- `limit` (Optional): Number of items to return _(type: number) (default: `50`)_
- `offset` (Optional): Number of items to skip _(type: number) (default: `0`)_

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "data": [
        {
          "patientId": "string",
          "dateOfDeath": "string",
          "timeOfDeath": "string",
          "placeOfDeath": "string",
          "locationDetails": "string",
          "ageAtDeathYears": 0,
          "ageAtDeathMonths": 0,
          "ageAtDeathDays": 0,
          "sex": "string",
          "maritalStatus": "string",
          "occupation": "string",
          "address": "string",
          "immediateCause": "string",
          "antecedentCauseB": "string",
          "antecedentCauseC": "string",
          "antecedentCauseD": "string",
          "otherConditions": "string",
          "mannerOfDeath": "string",
          "autopsyPerformed": false,
          "autopsyFindings": "string",
          "isMaternalDeath": false,
          "pregnancyRelated": "string",
          "certifiedById": "string",
          "certifierQualification": "string",
          "licenseNumber": "string",
          "signatureUrl": "string"
        }
      ],
      "meta": {
        "total": 100,
        "lastPage": 10,
        "currentPage": 1,
        "perPage": 10,
        "prev": null,
        "next": 2
      }
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.291Z"
  }
  ```

---

### `GET /api/death-certificates/{id}`

**Purpose:** Get death certificate details

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "patientId": "string",
      "dateOfDeath": "string",
      "timeOfDeath": "string",
      "placeOfDeath": "string",
      "locationDetails": "string",
      "ageAtDeathYears": 0,
      "ageAtDeathMonths": 0,
      "ageAtDeathDays": 0,
      "sex": "string",
      "maritalStatus": "string",
      "occupation": "string",
      "address": "string",
      "immediateCause": "string",
      "antecedentCauseB": "string",
      "antecedentCauseC": "string",
      "antecedentCauseD": "string",
      "otherConditions": "string",
      "mannerOfDeath": "string",
      "autopsyPerformed": false,
      "autopsyFindings": "string",
      "isMaternalDeath": false,
      "pregnancyRelated": "string",
      "certifiedById": "string",
      "certifierQualification": "string",
      "licenseNumber": "string",
      "signatureUrl": "string"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.291Z"
  }
  ```

---

### `GET /api/death-certificates/{id}/print`

**Purpose:** Get printable HTML of a death certificate

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:

---

### `POST /api/death-certificates`

**Purpose:** Create a new death certificate

- **Authentication Required:** ✅ Yes

**Request Body:**

- **`patientId`** (Required, _string_): Associated patient ID
- **`dateOfDeath`** (Required, _string_): Date of death in ISO or YYYY-MM-DD format
- **`timeOfDeath`** (Optional, _string_): Time of death (HH:mm)
- **`placeOfDeath`** (Required, _string [enum: inpatient, emergency, doa, home, other]_): Place of death
- **`locationDetails`** (Optional, _string_): Specific location details
- **`ageAtDeathYears`** (Optional, _number_): Age at death in years
- **`ageAtDeathMonths`** (Optional, _number_): Age at death in months
- **`ageAtDeathDays`** (Optional, _number_): Age at death in days
- **`sex`** (Required, _string_): Sex/Gender of patient at time of death
- **`maritalStatus`** (Optional, _string_): Marital status of patient
- **`occupation`** (Optional, _string_): Occupation of patient
- **`address`** (Optional, _string_): Residential address
- **`immediateCause`** (Required, _string_): Immediate cause of death
- **`antecedentCauseB`** (Optional, _string_): Antecedent cause B
- **`antecedentCauseC`** (Optional, _string_): Antecedent cause C
- **`antecedentCauseD`** (Optional, _string_): Antecedent cause D
- **`otherConditions`** (Optional, _string_): Other significant conditions
- **`mannerOfDeath`** (Required, _string [enum: natural, accident, suicide, homicide, pending, undetermined]_): Manner of death
- **`autopsyPerformed`** (Optional, _boolean_): Autopsy performed flag
- **`autopsyFindings`** (Optional, _string_): Autopsy findings details
- **`isMaternalDeath`** (Optional, _boolean_): Maternal death flag
- **`pregnancyRelated`** (Optional, _string [enum: pregnant, within_42_days, within_1_year, not_related]_): Pregnancy related flag if maternal death
- **`certifiedById`** (Required, _string_): ID of certifying doctor
- **`certifierQualification`** (Optional, _string_): Certifier qualification description
- **`licenseNumber`** (Optional, _string_): License number of certifier
- **`signatureUrl`** (Optional, _string_): Signature image URL

**Request Example:**

```json
{
  "patientId": "string",
  "dateOfDeath": "string",
  "timeOfDeath": "string",
  "placeOfDeath": "string",
  "locationDetails": "string",
  "ageAtDeathYears": 0,
  "ageAtDeathMonths": 0,
  "ageAtDeathDays": 0,
  "sex": "string",
  "maritalStatus": "string",
  "occupation": "string",
  "address": "string",
  "immediateCause": "string",
  "antecedentCauseB": "string",
  "antecedentCauseC": "string",
  "antecedentCauseD": "string",
  "otherConditions": "string",
  "mannerOfDeath": "string",
  "autopsyPerformed": false,
  "autopsyFindings": "string",
  "isMaternalDeath": false,
  "pregnancyRelated": "string",
  "certifiedById": "string",
  "certifierQualification": "string",
  "licenseNumber": "string",
  "signatureUrl": "string"
}
```

**Responses:**

- **Status `201`**:
  ```json
  {
    "success": true,
    "data": {
      "patientId": "string",
      "dateOfDeath": "string",
      "timeOfDeath": "string",
      "placeOfDeath": "string",
      "locationDetails": "string",
      "ageAtDeathYears": 0,
      "ageAtDeathMonths": 0,
      "ageAtDeathDays": 0,
      "sex": "string",
      "maritalStatus": "string",
      "occupation": "string",
      "address": "string",
      "immediateCause": "string",
      "antecedentCauseB": "string",
      "antecedentCauseC": "string",
      "antecedentCauseD": "string",
      "otherConditions": "string",
      "mannerOfDeath": "string",
      "autopsyPerformed": false,
      "autopsyFindings": "string",
      "isMaternalDeath": false,
      "pregnancyRelated": "string",
      "certifiedById": "string",
      "certifierQualification": "string",
      "licenseNumber": "string",
      "signatureUrl": "string"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.291Z"
  }
  ```

---

### `PATCH /api/death-certificates/{id}`

**Purpose:** Update death certificate details

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:**

- **`dateOfDeath`** (Optional, _string_): Date of death in ISO or YYYY-MM-DD format
- **`timeOfDeath`** (Optional, _string_): Time of death (HH:mm)
- **`placeOfDeath`** (Optional, _string [enum: inpatient, emergency, doa, home, other]_): Place of death
- **`locationDetails`** (Optional, _string_): Specific location details
- **`immediateCause`** (Optional, _string_): Immediate cause of death
- **`antecedentCauseB`** (Optional, _string_): Antecedent cause B
- **`antecedentCauseC`** (Optional, _string_): Antecedent cause C
- **`antecedentCauseD`** (Optional, _string_): Antecedent cause D
- **`otherConditions`** (Optional, _string_): Other significant conditions
- **`mannerOfDeath`** (Optional, _string [enum: natural, accident, suicide, homicide, pending, undetermined]_): Manner of death
- **`autopsyPerformed`** (Optional, _boolean_): Autopsy performed flag
- **`autopsyFindings`** (Optional, _string_): Autopsy findings details
- **`isMaternalDeath`** (Optional, _boolean_): Maternal death flag
- **`pregnancyRelated`** (Optional, _string [enum: pregnant, within_42_days, within_1_year, not_related]_): Pregnancy related flag if maternal death
- **`certifiedById`** (Optional, _string_): ID of certifying doctor
- **`certifierQualification`** (Optional, _string_): Certifier qualification description
- **`licenseNumber`** (Optional, _string_): License number of certifier
- **`signatureUrl`** (Optional, _string_): Signature image URL

**Request Example:**

```json
{
  "dateOfDeath": "string",
  "timeOfDeath": "string",
  "placeOfDeath": "string",
  "locationDetails": "string",
  "immediateCause": "string",
  "antecedentCauseB": "string",
  "antecedentCauseC": "string",
  "antecedentCauseD": "string",
  "otherConditions": "string",
  "mannerOfDeath": "string",
  "autopsyPerformed": false,
  "autopsyFindings": "string",
  "isMaternalDeath": false,
  "pregnancyRelated": "string",
  "certifiedById": "string",
  "certifierQualification": "string",
  "licenseNumber": "string",
  "signatureUrl": "string"
}
```

**Responses:**

- **Status `200`**:

  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "patientId": "string",
      "certificateNumber": "DC202606131235",
      "dateOfDeath": "2026-06-11T00:00:00.000Z",
      "timeOfDeath": "14:30",
      "placeOfDeath": "inpatient",
      "locationDetails": "ICU Bed 3",
      "ageAtDeathYears": 56,
      "ageAtDeathMonths": null,
      "ageAtDeathDays": null,
      "sex": "male",
      "maritalStatus": "married",
      "occupation": "Engineer",
      "address": "Addis Ababa, Ethiopia",
      "immediateCause": "Cardiac Arrest",
      "antecedentCauseB": "Myocardial infarction",
      "antecedentCauseC": "Coronary artery disease",
      "antecedentCauseD": null,
      "otherConditions": null,
      "mannerOfDeath": "natural",
      "autopsyPerformed": false,
      "autopsyFindings": null,
      "isMaternalDeath": false,
      "pregnancyRelated": null,
      "certifiedById": "string",
      "certificationDate": "2026-06-13T16:28:08.315Z",
      "certifierQualification": "MD, Cardiologist",
      "licenseNumber": "LIC-998877",
      "signatureUrl": null,
      "issuedTo": null,
      "issuedToRelationship": null,
      "issuedToNationalId": null,
      "issuedAt": null,
      "issuedById": null,
      "createdAt": "2026-06-13T16:28:08.696Z",
      "updatedAt": "2026-06-13T17:04:00.000Z"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `PATCH /api/death-certificates/{id}/issue`

**Purpose:** Record issuance of a death certificate

* **Authentication Required:** ✅ Yes

**Path Parameters:**
- `id` (Required):  *(type: string)*

**Request Body:**

- **`issuedTo`** (Required, *string*): Name of person whom the certificate is issued to
- **`issuedToRelationship`** (Required, *string*): Relationship to deceased
- **`issuedToNationalId`** (Optional, *string*): National ID of the person issued to
- **`issuedById`** (Required, *string*): Staff user ID of the person issuing the certificate

**Request Example:**
```json
{
  "issuedTo": "string",
  "issuedToRelationship": "string",
  "issuedToNationalId": "string",
  "issuedById": "string"
}
````

**Responses:**

- **Status `200`**:

  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "patientId": "string",
      "certificateNumber": "DC202606131235",
      "dateOfDeath": "2026-06-11T00:00:00.000Z",
      "timeOfDeath": "14:30",
      "placeOfDeath": "inpatient",
      "locationDetails": "ICU Bed 3",
      "ageAtDeathYears": 56,
      "ageAtDeathMonths": null,
      "ageAtDeathDays": null,
      "sex": "male",
      "maritalStatus": "married",
      "occupation": "Engineer",
      "address": "Addis Ababa, Ethiopia",
      "immediateCause": "Cardiac Arrest",
      "antecedentCauseB": "Myocardial infarction",
      "antecedentCauseC": "Coronary artery disease",
      "antecedentCauseD": null,
      "otherConditions": null,
      "mannerOfDeath": "natural",
      "autopsyPerformed": false,
      "autopsyFindings": null,
      "isMaternalDeath": false,
      "pregnancyRelated": null,
      "certifiedById": "string",
      "certificationDate": "2026-06-13T16:28:08.315Z",
      "certifierQualification": "MD, Cardiologist",
      "licenseNumber": "LIC-998877",
      "signatureUrl": null,
      "issuedTo": "Tigist Kebede",
      "issuedToRelationship": "Spouse",
      "issuedToNationalId": "ET1234567",
      "issuedAt": "2026-06-13T17:04:00.000Z",
      "issuedById": "string",
      "createdAt": "2026-06-13T16:28:08.696Z",
      "updatedAt": "2026-06-13T17:04:00.000Z"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `DELETE /api/death-certificates/{id}`

**Purpose:** Delete a death certificate

* **Authentication Required:** ✅ Yes

**Path Parameters:**
- `id` (Required):  *(type: string)*

**Request Body:** None.

**Responses:**

- **Status `200`**:

  ```json
{
  "success": true,
  "data": {
    "id": "string",
    "deleted": true
  },
  "message": "Death certificate deleted successfully",
  "errorCode": null,
  "timestamp": "2026-06-13T17:04:00.000Z"
}
````

---

## 📦 Settings Module

### `GET /api/settings/departments`

**Purpose:** Get all departments for an organization

- **Authentication Required:** ✅ Yes

**Query Parameters:**

- `organizationId` (Required): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:

  ```json
  {
    "success": true,
    "data": [
      {
        "id": "string",
        "organizationId": "string",
        "name": "Cardiology",
        "code": "CARD",
        "description": "Cardiology Department",
        "headId": null,
        "isActive": true,
        "createdAt": "2026-06-13T17:04:00.000Z",
        "updatedAt": "2026-06-13T17:04:00.000Z"
      }
    ],
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `GET /api/settings/departments/{id}`

**Purpose:** Get a single department by ID

* **Authentication Required:** ✅ Yes

**Path Parameters:**
- `id` (Required):  *(type: string)*

**Request Body:** None.

**Responses:**

- **Status `200`**:

  ```json
{
  "success": true,
  "data": {
    "id": "string",
    "organizationId": "string",
    "name": "Cardiology",
    "code": "CARD",
    "description": "Cardiology Department",
    "headId": null,
    "isActive": true,
    "createdAt": "2026-06-13T17:04:00.000Z",
    "updatedAt": "2026-06-13T17:04:00.000Z",
    "users": []
  },
  "message": null,
  "errorCode": null,
  "timestamp": "2026-06-13T17:04:00.000Z"
}
````

---

### `GET /api/settings/integrations`

**Purpose:** Get all machine integrations for an organization

- **Authentication Required:** ✅ Yes

**Query Parameters:**

- `organizationId` (Required): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:

  ```json
  {
    "success": true,
    "data": [
      {
        "id": "string",
        "organizationId": "string",
        "machineName": "Sysmex XN-1000",
        "machineType": "lab_analyzer",
        "manufacturer": "Sysmex",
        "model": "XN-1000",
        "serialNumber": "SN-12345",
        "department": "laboratory",
        "connectionType": "hl7",
        "connectionDetails": {
          "ipAddress": "192.168.1.100",
          "port": 5000,
          "apiEndpoint": "",
          "apiKey": ""
        },
        "testMapping": {
          "WBC": "test-wbc-id",
          "RBC": "test-rbc-id"
        },
        "isActive": true,
        "connectionStatus": "connected",
        "lastConnectedAt": null,
        "lastResultReceivedAt": null,
        "createdAt": "2026-06-13T17:04:00.000Z",
        "updatedAt": "2026-06-13T17:04:00.000Z",
        "createdById": "string"
      }
    ],
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `GET /api/settings/integrations/{id}`

**Purpose:** Get machine integration details by ID

* **Authentication Required:** ✅ Yes

**Path Parameters:**
- `id` (Required):  *(type: string)*

**Request Body:** None.

**Responses:**

- **Status `200`**:

  ```json
{
  "success": true,
  "data": {
    "id": "string",
    "organizationId": "string",
    "machineName": "Sysmex XN-1000",
    "machineType": "lab_analyzer",
    "manufacturer": "Sysmex",
    "model": "XN-1000",
    "serialNumber": "SN-12345",
    "department": "laboratory",
    "connectionType": "hl7",
    "connectionDetails": {
      "ipAddress": "192.168.1.100",
      "port": 5000,
      "apiEndpoint": "",
      "apiKey": ""
    },
    "testMapping": {
      "WBC": "test-wbc-id",
      "RBC": "test-rbc-id"
    },
    "isActive": true,
    "connectionStatus": "connected",
    "lastConnectedAt": null,
    "lastResultReceivedAt": null,
    "createdAt": "2026-06-13T17:04:00.000Z",
    "updatedAt": "2026-06-13T17:04:00.000Z",
    "createdById": "string"
  },
  "message": null,
  "errorCode": null,
  "timestamp": "2026-06-13T17:04:00.000Z"
}
````

---

### `GET /api/settings/organization`

**Purpose:** Get organization details by ID

- **Authentication Required:** ✅ Yes

**Query Parameters:**

- `id` (Required): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:

  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "name": "System Hospital",
      "slug": "system",
      "logoUrl": null,
      "primaryColor": "#2563eb",
      "secondaryColor": "#7c3aed",
      "email": "org@hospital.com",
      "phone": "+919876543210",
      "address": "123 Health Ave",
      "city": "Health City",
      "region": "Health Region",
      "country": "Ethiopia",
      "subscriptionTier": "basic",
      "subscriptionStatus": "trial",
      "subscriptionStartedAt": null,
      "subscriptionEndsAt": null,
      "isActive": true,
      "createdAt": "2026-06-13T16:25:16.828Z",
      "updatedAt": "2026-06-13T17:04:00.000Z",
      "createdById": null,
      "settings": {
        "currency": "ETB",
        "language": "en",
        "timezone": "Africa/Addis_Ababa",
        "workingHours": {
          "start": "08:00",
          "end": "17:00"
        },
        "appointmentDuration": 30
      },
      "modulesEnabled": {
        "pharmacy": true,
        "laboratory": true,
        "radiology": false,
        "inpatient": false,
        "inventory": true,
        "accounting": false
      }
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `GET /api/settings/users`

**Purpose:** Get all users for organization with optional role filtering

* **Authentication Required:** ✅ Yes

**Query Parameters:**
- `organizationId` (Optional):  *(type: string)*
- `role` (Optional):  *(type: string)*

**Request Body:** None.

**Responses:**

- **Status `200`**:

  ```json
{
  "success": true,
  "data": [
    {
      "id": "string",
      "organizationId": "string",
      "email": "alice.smith@hospital.com",
      "fullName": "Dr. Alice Smith",
      "firstName": null,
      "lastName": null,
      "phone": "+919876543210",
      "dateOfBirth": null,
      "gender": null,
      "address": null,
      "employeeId": "EMP001",
      "role": "DOCTOR",
      "departmentId": null,
      "specialization": "Cardiology",
      "licenseNumber": "LIC12345",
      "isActive": true,
      "lastLoginAt": null,
      "preferences": null,
      "defaultCalendar": "ethiopian",
      "isDeleted": false,
      "deletedAt": null,
      "createdAt": "2026-06-13T17:04:00.000Z",
      "updatedAt": "2026-06-13T17:04:00.000Z",
      "department": null
    }
  ],
  "message": null,
  "errorCode": null,
  "timestamp": "2026-06-13T17:04:00.000Z"
}
````

---

### `GET /api/settings/users/{id}`

**Purpose:** Get a user by ID

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:

  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "email": "alice.smith@hospital.com",
      "fullName": "Dr. Alice Smith",
      "firstName": null,
      "lastName": null,
      "phone": "+919876543210",
      "dateOfBirth": null,
      "gender": null,
      "address": null,
      "employeeId": "EMP001",
      "role": "DOCTOR",
      "departmentId": null,
      "specialization": "Cardiology",
      "licenseNumber": "LIC12345",
      "isActive": true,
      "lastLoginAt": null,
      "preferences": null,
      "defaultCalendar": "ethiopian",
      "isDeleted": false,
      "deletedAt": null,
      "createdAt": "2026-06-13T17:04:00.000Z",
      "updatedAt": "2026-06-13T17:04:00.000Z",
      "department": null
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `POST /api/settings/departments`

**Purpose:** Create a new department

* **Authentication Required:** ✅ Yes

**Request Body:**

- **`organizationId`** (Required, *string*):  (e.g. `"org-demo"`)
- **`name`** (Required, *string*):  (e.g. `"Cardiology"`)
- **`code`** (Optional, *string*):  (e.g. `"CARD"`)
- **`description`** (Optional, *string*):  (e.g. `"Cardiology Department"`)
- **`headId`** (Optional, *string*):  (e.g. `"head-user-id"`)
- **`isActive`** (Optional, *boolean*):  (e.g. `true`)

**Request Example:**
```json
{
  "organizationId": "org-demo",
  "name": "Cardiology",
  "code": "CARD",
  "description": "Cardiology Department",
  "headId": "head-user-id",
  "isActive": true
}
````

**Responses:**

- **Status `201`**:

  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "name": "Cardiology",
      "code": "CARD",
      "description": "Cardiology Department",
      "headId": null,
      "isActive": true,
      "createdAt": "2026-06-13T17:04:00.000Z",
      "updatedAt": "2026-06-13T17:04:00.000Z"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `POST /api/settings/integrations`

**Purpose:** Register a new machine integration

* **Authentication Required:** ✅ Yes

**Request Body:**

- **`organizationId`** (Required, *string*):  (e.g. `"org-demo"`)
- **`machineName`** (Required, *string*):  (e.g. `"Sysmex XN-1000"`)
- **`machineType`** (Required, *string [enum: lab_analyzer, radiology_equipment, vital_signs_monitor]*):  (e.g. `"lab_analyzer"`)
- **`machineModel`** (Optional, *string*):  (e.g. `"XN-1000"`)
- **`manufacturer`** (Optional, *string*):  (e.g. `"Sysmex"`)
- **`serialNumber`** (Optional, *string*):  (e.g. `"SN-12345"`)
- **`connectionType`** (Required, *string [enum: hl7, astm, rest_api, file_upload, serial]*):  (e.g. `"hl7"`)
- **`ipAddress`** (Optional, *string*):  (e.g. `"192.168.1.100"`)
- **`port`** (Optional, *number*):  (e.g. `5000`)
- **`apiEndpoint`** (Optional, *string*):  (e.g. `"http://api.sysmex.local"`)
- **`apiKey`** (Optional, *string*):  (e.g. `"api-key-sysmex"`)
- **`department`** (Optional, *string*):  (e.g. `"laboratory"`)
- **`isActive`** (Optional, *boolean*):  (e.g. `true`)

**Request Example:**
```json
{
  "organizationId": "org-demo",
  "machineName": "Sysmex XN-1000",
  "machineType": "lab_analyzer",
  "machineModel": "XN-1000",
  "manufacturer": "Sysmex",
  "serialNumber": "SN-12345",
  "connectionType": "hl7",
  "ipAddress": "192.168.1.100",
  "port": 5000,
  "apiEndpoint": "http://api.sysmex.local",
  "apiKey": "api-key-sysmex",
  "department": "laboratory",
  "isActive": true
}
````

**Responses:**

- **Status `201`**:

  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "machineName": "Sysmex XN-1000",
      "machineType": "lab_analyzer",
      "manufacturer": "Sysmex",
      "model": "XN-1000",
      "serialNumber": "SN-12345",
      "department": "laboratory",
      "connectionType": "hl7",
      "connectionDetails": {
        "ipAddress": "192.168.1.100",
        "port": 5000,
        "apiEndpoint": "",
        "apiKey": ""
      },
      "testMapping": {
        "WBC": "test-wbc-id",
        "RBC": "test-rbc-id"
      },
      "isActive": true,
      "connectionStatus": "connected",
      "lastConnectedAt": null,
      "lastResultReceivedAt": null,
      "createdAt": "2026-06-13T17:04:00.000Z",
      "updatedAt": "2026-06-13T17:04:00.000Z",
      "createdById": "string"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `POST /api/settings/users`

**Purpose:** Create a new user

* **Authentication Required:** ✅ Yes

**Request Body:**

- **`organizationId`** (Optional, *string*):  (e.g. `"org-demo"`)
- **`fullName`** (Required, *string*):  (e.g. `"Dr. Alice Smith"`)
- **`email`** (Required, *string*):  (e.g. `"alice.smith@hospital.com"`)
- **`phone`** (Optional, *string*):  (e.g. `"+919876543210"`)
- **`employeeId`** (Optional, *string*):  (e.g. `"EMP001"`)
- **`role`** (Required, *string*):  (e.g. `"DOCTOR"`)
- **`departmentId`** (Optional, *string*):  (e.g. `"dept-uuid"`)
- **`specialization`** (Optional, *string*):  (e.g. `"Cardiology"`)
- **`licenseNumber`** (Optional, *string*):  (e.g. `"LIC12345"`)
- **`isActive`** (Optional, *boolean*):  (e.g. `true`)

**Request Example:**
```json
{
  "organizationId": "org-demo",
  "fullName": "Dr. Alice Smith",
  "email": "alice.smith@hospital.com",
  "phone": "+919876543210",
  "employeeId": "EMP001",
  "role": "DOCTOR",
  "departmentId": "dept-uuid",
  "specialization": "Cardiology",
  "licenseNumber": "LIC12345",
  "isActive": true
}
````

**Responses:**

- **Status `201`**:

  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "email": "alice.smith@hospital.com",
      "fullName": "Dr. Alice Smith",
      "firstName": null,
      "lastName": null,
      "phone": "+919876543210",
      "dateOfBirth": null,
      "gender": null,
      "address": null,
      "employeeId": "EMP001",
      "role": "DOCTOR",
      "departmentId": null,
      "specialization": "Cardiology",
      "licenseNumber": "LIC12345",
      "isActive": true,
      "lastLoginAt": null,
      "preferences": null,
      "defaultCalendar": "ethiopian",
      "isDeleted": false,
      "deletedAt": null,
      "createdAt": "2026-06-13T17:04:00.000Z",
      "updatedAt": "2026-06-13T17:04:00.000Z",
      "department": null
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `PUT /api/settings/departments/{id}`

**Purpose:** Update a department by ID

* **Authentication Required:** ✅ Yes

**Path Parameters:**
- `id` (Required):  *(type: string)*

**Request Body:**

- **`name`** (Optional, *string*):  (e.g. `"Cardiology"`)
- **`code`** (Optional, *string*):  (e.g. `"CARD"`)
- **`description`** (Optional, *string*):  (e.g. `"Cardiology Department"`)
- **`headId`** (Optional, *string*):  (e.g. `"head-user-id"`)
- **`isActive`** (Optional, *boolean*):  (e.g. `true`)

**Request Example:**
```json
{
  "name": "Cardiology",
  "code": "CARD",
  "description": "Cardiology Department",
  "headId": "head-user-id",
  "isActive": true
}
````

**Responses:**

- **Status `200`**:

  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "name": "Cardiology Updated",
      "code": "CARD",
      "description": "Cardiology Department",
      "headId": null,
      "isActive": true,
      "createdAt": "2026-06-13T17:04:00.000Z",
      "updatedAt": "2026-06-13T17:04:00.000Z"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `PUT /api/settings/integrations/{id}`

**Purpose:** Update machine integration configuration by ID

* **Authentication Required:** ✅ Yes

**Path Parameters:**
- `id` (Required):  *(type: string)*

**Request Body:**

- **`machineName`** (Optional, *string*):  (e.g. `"Sysmex XN-1000"`)
- **`machineType`** (Optional, *string [enum: lab_analyzer, radiology_equipment, vital_signs_monitor]*):  (e.g. `"lab_analyzer"`)
- **`machineModel`** (Optional, *string*):  (e.g. `"XN-1000"`)
- **`manufacturer`** (Optional, *string*):  (e.g. `"Sysmex"`)
- **`serialNumber`** (Optional, *string*):  (e.g. `"SN-12345"`)
- **`connectionType`** (Optional, *string [enum: hl7, astm, rest_api, file_upload, serial]*):  (e.g. `"hl7"`)
- **`ipAddress`** (Optional, *string*):  (e.g. `"192.168.1.100"`)
- **`port`** (Optional, *number*):  (e.g. `5000`)
- **`apiEndpoint`** (Optional, *string*):  (e.g. `"http://api.sysmex.local"`)
- **`apiKey`** (Optional, *string*):  (e.g. `"api-key-sysmex"`)
- **`department`** (Optional, *string*):  (e.g. `"laboratory"`)
- **`isActive`** (Optional, *boolean*):  (e.g. `true`)
- **`connectionStatus`** (Optional, *string [enum: connected, disconnected, error]*):  (e.g. `"connected"`)

**Request Example:**
```json
{
  "machineName": "Sysmex XN-1000",
  "machineType": "lab_analyzer",
  "machineModel": "XN-1000",
  "manufacturer": "Sysmex",
  "serialNumber": "SN-12345",
  "connectionType": "hl7",
  "ipAddress": "192.168.1.100",
  "port": 5000,
  "apiEndpoint": "http://api.sysmex.local",
  "apiKey": "api-key-sysmex",
  "department": "laboratory",
  "isActive": true,
  "connectionStatus": "connected"
}
````

**Responses:**

- **Status `200`**:

  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "machineName": "Sysmex XN-2000",
      "machineType": "lab_analyzer",
      "manufacturer": "Sysmex",
      "model": "XN-1000",
      "serialNumber": "SN-12345",
      "department": "laboratory",
      "connectionType": "hl7",
      "connectionDetails": {
        "ipAddress": "192.168.1.100",
        "port": 5000,
        "apiEndpoint": "",
        "apiKey": ""
      },
      "testMapping": {
        "WBC": "test-wbc-id",
        "RBC": "test-rbc-id"
      },
      "isActive": true,
      "connectionStatus": "connected",
      "lastConnectedAt": null,
      "lastResultReceivedAt": null,
      "createdAt": "2026-06-13T17:04:00.000Z",
      "updatedAt": "2026-06-13T17:04:00.000Z",
      "createdById": "string"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `PUT /api/settings/modules`

**Purpose:** Update organization enabled modules

* **Authentication Required:** ✅ Yes

**Request Body:**

- **`organizationId`** (Required, *string*):  (e.g. `"org-demo"`)
- **`modulesEnabled`** (Required, *object*):  (e.g. `{"pharmacy":true,"laboratory":true}`)

**Request Example:**
```json
{
  "organizationId": "org-demo",
  "modulesEnabled": {
    "pharmacy": true,
    "laboratory": true
  }
}
````

**Responses:**

- **Status `200`**:

  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "name": "System Hospital",
      "slug": "system",
      "logoUrl": null,
      "primaryColor": "#2563eb",
      "secondaryColor": "#7c3aed",
      "email": "org@hospital.com",
      "phone": "+919876543210",
      "address": "123 Health Ave",
      "city": "Health City",
      "region": "Health Region",
      "country": "Ethiopia",
      "subscriptionTier": "basic",
      "subscriptionStatus": "trial",
      "subscriptionStartedAt": null,
      "subscriptionEndsAt": null,
      "isActive": true,
      "createdAt": "2026-06-13T16:25:16.828Z",
      "updatedAt": "2026-06-13T17:04:00.000Z",
      "createdById": null,
      "settings": {
        "currency": "ETB",
        "language": "en",
        "timezone": "Africa/Addis_Ababa",
        "workingHours": {
          "start": "08:00",
          "end": "17:00"
        },
        "appointmentDuration": 30
      },
      "modulesEnabled": {
        "pharmacy": true,
        "laboratory": true
      }
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `PUT /api/settings/organization`

**Purpose:** Update organization configuration

* **Authentication Required:** ✅ Yes

**Request Body:**

- **`id`** (Required, *string*):  (e.g. `"org-demo"`)
- **`name`** (Optional, *string*):  (e.g. `"General Hospital"`)
- **`logoUrl`** (Optional, *string*):  (e.g. `"http://logo.url"`)
- **`primaryColor`** (Optional, *string*):  (e.g. `"#ffffff"`)
- **`secondaryColor`** (Optional, *string*):  (e.g. `"#000000"`)
- **`email`** (Optional, *string*):  (e.g. `"org@hospital.com"`)
- **`phone`** (Optional, *string*):  (e.g. `"+919876543210"`)
- **`address`** (Optional, *string*):  (e.g. `"123 Health Ave"`)
- **`city`** (Optional, *string*):  (e.g. `"Health City"`)
- **`region`** (Optional, *string*):  (e.g. `"Health Region"`)
- **`country`** (Optional, *string*):  (e.g. `"Ethiopia"`)
- **`isActive`** (Optional, *boolean*):  (e.g. `true`)
- **`settings`** (Optional, *object*):  (e.g. `{"currency":"ETB","timezone":"Africa/Addis_Ababa"}`)
- **`modulesEnabled`** (Optional, *object*):  (e.g. `{"pharmacy":true,"laboratory":true}`)

**Request Example:**
```json
{
  "id": "org-demo",
  "name": "General Hospital",
  "logoUrl": "http://logo.url",
  "primaryColor": "#ffffff",
  "secondaryColor": "#000000",
  "email": "org@hospital.com",
  "phone": "+919876543210",
  "address": "123 Health Ave",
  "city": "Health City",
  "region": "Health Region",
  "country": "Ethiopia",
  "isActive": true,
  "settings": {
    "currency": "ETB",
    "timezone": "Africa/Addis_Ababa"
  },
  "modulesEnabled": {
    "pharmacy": true,
    "laboratory": true
  }
}
````

**Responses:**

- **Status `200`**:

  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "name": "System Hospital",
      "slug": "system",
      "logoUrl": null,
      "primaryColor": "#2563eb",
      "secondaryColor": "#7c3aed",
      "email": "org@hospital.com",
      "phone": "+919876543210",
      "address": "123 Health Ave",
      "city": "Health City",
      "region": "Health Region",
      "country": "Ethiopia",
      "subscriptionTier": "basic",
      "subscriptionStatus": "trial",
      "subscriptionStartedAt": null,
      "subscriptionEndsAt": null,
      "isActive": true,
      "createdAt": "2026-06-13T16:25:16.828Z",
      "updatedAt": "2026-06-13T17:04:00.000Z",
      "createdById": null,
      "settings": {
        "currency": "ETB",
        "language": "en",
        "timezone": "Africa/Addis_Ababa",
        "workingHours": {
          "start": "08:00",
          "end": "17:00"
        },
        "appointmentDuration": 30
      },
      "modulesEnabled": {
        "pharmacy": true,
        "laboratory": true,
        "radiology": false,
        "inpatient": false,
        "inventory": true,
        "accounting": false
      }
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `PUT /api/settings/users/{id}`

**Purpose:** Update user settings by ID

* **Authentication Required:** ✅ Yes

**Path Parameters:**
- `id` (Required):  *(type: string)*

**Request Body:**

- **`fullName`** (Optional, *string*):  (e.g. `"Dr. Alice Smith"`)
- **`phone`** (Optional, *string*):  (e.g. `"+919876543210"`)
- **`employeeId`** (Optional, *string*):  (e.g. `"EMP001"`)
- **`role`** (Optional, *string*):  (e.g. `"DOCTOR"`)
- **`departmentId`** (Optional, *string*):  (e.g. `"dept-uuid"`)
- **`specialization`** (Optional, *string*):  (e.g. `"Cardiology"`)
- **`licenseNumber`** (Optional, *string*):  (e.g. `"LIC12345"`)
- **`isActive`** (Optional, *boolean*):  (e.g. `true`)

**Request Example:**
```json
{
  "fullName": "Dr. Alice Smith",
  "phone": "+919876543210",
  "employeeId": "EMP001",
  "role": "DOCTOR",
  "departmentId": "dept-uuid",
  "specialization": "Cardiology",
  "licenseNumber": "LIC12345",
  "isActive": true
}
````

**Responses:**

- **Status `200`**:

  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "email": "alice.smith@hospital.com",
      "fullName": "Dr. Alice Smith",
      "firstName": null,
      "lastName": null,
      "phone": "+919876543210",
      "dateOfBirth": null,
      "gender": null,
      "address": null,
      "employeeId": "EMP001",
      "role": "DOCTOR",
      "departmentId": null,
      "specialization": "Cardiology",
      "licenseNumber": "LIC12345",
      "isActive": true,
      "lastLoginAt": null,
      "preferences": null,
      "defaultCalendar": "ethiopian",
      "isDeleted": false,
      "deletedAt": null,
      "createdAt": "2026-06-13T17:04:00.000Z",
      "updatedAt": "2026-06-13T17:04:00.000Z",
      "department": null
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `DELETE /api/settings/departments/{id}`

**Purpose:** Delete a department by ID

* **Authentication Required:** ✅ Yes

**Path Parameters:**
- `id` (Required):  *(type: string)*

**Request Body:** None.

**Responses:**

- **Status `200`**:

  ```json
{
  "success": true,
  "data": {
    "id": "string",
    "deleted": true
  },
  "message": "Department deleted successfully",
  "errorCode": null,
  "timestamp": "2026-06-13T17:04:00.000Z"
}
````

---

### `DELETE /api/settings/integrations/{id}`

**Purpose:** Delete machine integration by ID

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:

  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "deleted": true
    },
    "message": "Machine integration deleted successfully",
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `DELETE /api/settings/users/{id}`

**Purpose:** Soft delete user by ID

* **Authentication Required:** ✅ Yes

**Path Parameters:**
- `id` (Required):  *(type: string)*

**Request Body:** None.

**Responses:**

- **Status `200`**:

  ```json
{
  "success": true,
  "data": {
    "id": "string",
    "isDeleted": true,
    "deletedAt": "2026-06-13T17:04:00.000Z"
  },
  "message": "User soft-deleted successfully",
  "errorCode": null,
  "timestamp": "2026-06-13T17:04:00.000Z"
}
````

---

## 📦 Health Module

### `GET /api/health`

**Purpose:** Full health check (DB + Redis + Memory + Disk)

- **Authentication Required:** ✅ Yes

**Request Body:** None.

**Responses:**

- **Status `200`**: The Health Check is successful
  ```json
  {
    "success": true,
    "data": {
      "status": "ok",
      "info": {
        "database": {
          "status": "up"
        }
      },
      "error": {},
      "details": {
        "database": {
          "status": "up"
        }
      }
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.292Z"
  }
  ```
- **Status `503`**: The Health Check is not successful
  ```json
  {
    "success": false,
    "data": {
      "status": "error",
      "info": {
        "database": {
          "status": "up"
        }
      },
      "error": {
        "redis": {
          "status": "down",
          "message": "Could not connect"
        }
      },
      "details": {
        "database": {
          "status": "up"
        },
        "redis": {
          "status": "down",
          "message": "Could not connect"
        }
      }
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.292Z"
  }
  ```

---

### `GET /api/health/live`

**Purpose:** Liveness probe — is the process alive?

- **Authentication Required:** ✅ Yes

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "status": "ok",
      "timestamp": "2026-06-13T17:10:30.090Z"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:10:30.090Z"
  }
  ```

---

### `GET /api/health/ready`

**Purpose:** Readiness probe — are dependencies ready?

- **Authentication Required:** ✅ Yes

**Request Body:** None.

**Responses:**

- **Status `200`**: The Health Check is successful
  ```json
  {
    "success": true,
    "data": {
      "status": "ok",
      "info": {
        "database": {
          "status": "up"
        }
      },
      "error": {},
      "details": {
        "database": {
          "status": "up"
        }
      }
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.292Z"
  }
  ```
- **Status `503`**: The Health Check is not successful
  ```json
  {
    "success": false,
    "data": {
      "status": "error",
      "info": {
        "database": {
          "status": "up"
        }
      },
      "error": {
        "redis": {
          "status": "down",
          "message": "Could not connect"
        }
      },
      "details": {
        "database": {
          "status": "up"
        },
        "redis": {
          "status": "down",
          "message": "Could not connect"
        }
      }
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.292Z"
  }
  ```

---

## 📦 Dashboard Module

### `GET /api/dashboard`

**Purpose:** Get hospital dashboard statistics

- **Authentication Required:** ✅ Yes

**Request Body:** None.

**Responses:**

- **Status `200`**: Dashboard stats and breakdowns
  ```json
  {
    "success": true,
    "data": {
      "stats": {
        "totalPatients": 1250,
        "todayAppointments": 45,
        "pendingLabOrders": 12,
        "pendingPrescriptions": 8,
        "todayRevenue": 125000,
        "occupiedBeds": 85,
        "availableBeds": 15,
        "queueWaiting": 23,
        "criticalAlerts": 2
      },
      "appointmentStatuses": {
        "scheduled": 20,
        "confirmed": 15,
        "completed": 8,
        "cancelled": 2
      },
      "queueByService": {
        "opd": 15,
        "emergency": 5,
        "mch": 3
      },
      "recentPatients": [
        {
          "id": "clx123...",
          "mrn": "MRN202501150001",
          "firstName": "Abebe",
          "lastName": "Kebede",
          "gender": "male",
          "dateOfBirth": "1990-05-15T00:00:00.000Z",
          "createdAt": "2025-01-15T10:00:00.000Z"
        }
      ],
      "upcomingAppointments": [
        {
          "id": "clx456...",
          "appointmentDate": "2025-01-15T00:00:00.000Z",
          "appointmentTime": "10:30",
          "status": "confirmed",
          "patient": {
            "id": "clx123...",
            "mrn": "MRN202501150001",
            "firstName": "Abebe",
            "lastName": "Kebede"
          }
        }
      ]
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.292Z"
  }
  ```

---

## 📦 Integrations Module

### `GET /api/integrations/machines`

**Purpose:** Get all machine integrations

- **Authentication Required:** ✅ Yes

**Query Parameters:**

- `organizationId` (Optional): _(type: string)_
- `machineType` (Optional): _(type: string)_
- `department` (Optional): _(type: string)_
- `status` (Optional): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:

  ```json
  {
    "success": true,
    "data": [
      {
        "id": "string",
        "organizationId": "string",
        "machineName": "Sysmex XN-1000",
        "machineType": "lab_analyzer",
        "manufacturer": "Sysmex",
        "model": "XN-1000",
        "serialNumber": "SN-123456",
        "department": "laboratory",
        "connectionType": "hl7",
        "connectionDetails": {
          "ip_address": "192.168.1.50",
          "port": 5000
        },
        "testMapping": {
          "WBC": "test-wbc-id",
          "RBC": "test-rbc-id"
        },
        "isActive": true,
        "connectionStatus": "connected",
        "lastConnectedAt": null,
        "lastResultReceivedAt": null,
        "createdAt": "2026-06-13T17:04:00.000Z",
        "updatedAt": "2026-06-13T17:04:00.000Z",
        "createdById": "string",
        "_count": {
          "resultsQueue": 0
        }
      }
    ],
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `GET /api/integrations/machines/{id}`

**Purpose:** Get machine integration details

* **Authentication Required:** ✅ Yes

**Path Parameters:**
- `id` (Required):  *(type: string)*

**Request Body:** None.

**Responses:**

- **Status `200`**:

  ```json
{
  "success": true,
  "data": {
    "id": "string",
    "organizationId": "string",
    "machineName": "Sysmex XN-1000",
    "machineType": "lab_analyzer",
    "manufacturer": "Sysmex",
    "model": "XN-1000",
    "serialNumber": "SN-123456",
    "department": "laboratory",
    "connectionType": "hl7",
    "connectionDetails": {
      "ip_address": "192.168.1.50",
      "port": 5000
    },
    "testMapping": {
      "WBC": "test-wbc-id",
      "RBC": "test-rbc-id"
    },
    "isActive": true,
    "connectionStatus": "connected",
    "lastConnectedAt": null,
    "lastResultReceivedAt": null,
    "createdAt": "2026-06-13T17:04:00.000Z",
    "updatedAt": "2026-06-13T17:04:00.000Z",
    "createdById": "string",
    "_count": {
      "resultsQueue": 0,
      "integrationLogs": 0
    },
    "integrationLogs": []
  },
  "message": null,
  "errorCode": null,
  "timestamp": "2026-06-13T17:04:00.000Z"
}
````

---

### `GET /api/integrations/results-queue`

**Purpose:** Get results from the import queue

- **Authentication Required:** ✅ Yes

**Query Parameters:**

- `organizationId` (Optional): _(type: string)_
- `status` (Optional): _(type: string)_
- `machineId` (Optional): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:

  ```json
  {
    "success": true,
    "data": [
      {
        "id": "string",
        "organizationId": "string",
        "machineIntegrationId": "string",
        "rawData": "{\"test\":\"WBC\",\"result\":\"7.2\",\"unit\":\"10^9/L\"}",
        "parsedData": {
          "testCode": "WBC",
          "resultValue": "7.2",
          "resultUnit": "10^9/L",
          "isAbnormal": false
        },
        "status": "pending",
        "errorMessage": null,
        "processedAt": null,
        "createdAt": "2026-06-13T17:04:00.000Z",
        "updatedAt": "2026-06-13T17:04:00.000Z"
      }
    ],
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `POST /api/integrations/machines`

**Purpose:** Register a new machine integration

* **Authentication Required:** ✅ Yes

**Request Body:**

- **`organizationId`** (Optional, *string*):  (e.g. `"org-demo"`)
- **`machineName`** (Required, *string*):  (e.g. `"Sysmex XN-1000"`)
- **`machineType`** (Required, *string [enum: lab_analyzer, radiology_equipment, vital_signs_monitor]*):  (e.g. `"lab_analyzer"`)
- **`manufacturer`** (Optional, *string*):  (e.g. `"Sysmex"`)
- **`model`** (Optional, *string*):  (e.g. `"XN-1000"`)
- **`serialNumber`** (Optional, *string*):  (e.g. `"SN-123456"`)
- **`department`** (Optional, *string*):  (e.g. `"laboratory"`)
- **`connectionType`** (Required, *string [enum: hl7, astm, rest_api, file_upload, serial]*):  (e.g. `"hl7"`)
- **`connectionDetails`** (Optional, *object*):  (e.g. `{"ip_address":"192.168.1.50","port":5000}`)
- **`testMapping`** (Optional, *object*):  (e.g. `{"WBC":"test-wbc-id","RBC":"test-rbc-id"}`)

**Request Example:**
```json
{
  "organizationId": "org-demo",
  "machineName": "Sysmex XN-1000",
  "machineType": "lab_analyzer",
  "manufacturer": "Sysmex",
  "model": "XN-1000",
  "serialNumber": "SN-123456",
  "department": "laboratory",
  "connectionType": "hl7",
  "connectionDetails": {
    "ip_address": "192.168.1.50",
    "port": 5000
  },
  "testMapping": {
    "WBC": "test-wbc-id",
    "RBC": "test-rbc-id"
  }
}
````

**Responses:**

- **Status `201`**:

  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "machineName": "Sysmex XN-1000",
      "machineType": "lab_analyzer",
      "manufacturer": "Sysmex",
      "model": "XN-1000",
      "serialNumber": "SN-123456",
      "department": "laboratory",
      "connectionType": "hl7",
      "connectionDetails": {
        "ip_address": "192.168.1.50",
        "port": 5000
      },
      "testMapping": {
        "WBC": "test-wbc-id",
        "RBC": "test-rbc-id"
      },
      "isActive": true,
      "connectionStatus": "connected",
      "lastConnectedAt": null,
      "lastResultReceivedAt": null,
      "createdAt": "2026-06-13T17:04:00.000Z",
      "updatedAt": "2026-06-13T17:04:00.000Z",
      "createdById": "string",
      "_count": {
        "resultsQueue": 0
      }
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `POST /api/integrations/results/upload`

**Purpose:** No description provided.

* **Authentication Required:** ✅ Yes

**Request Body:**

- **`file`** (Optional, *string (binary)*):
- **`organizationId`** (Optional, *string*):
- **`machineIntegrationId`** (Optional, *string*):

**Request Example:**
```json
{
  "file": "string",
  "organizationId": "string",
  "machineIntegrationId": "string"
}
````

**Responses:**

- **Status `201`**:

  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "machineIntegrationId": "string",
      "rawData": "...raw file content...",
      "parsedData": {
        "records": 5,
        "imported": 5
      },
      "status": "processed",
      "errorMessage": null,
      "processedAt": "2026-06-13T17:04:00.000Z",
      "createdAt": "2026-06-13T17:04:00.000Z",
      "updatedAt": "2026-06-13T17:04:00.000Z"
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `PATCH /api/integrations/machines/{id}`

**Purpose:** Update machine integration configuration

* **Authentication Required:** ✅ Yes

**Path Parameters:**
- `id` (Required):  *(type: string)*

**Request Body:**

- **`machineName`** (Optional, *string*):  (e.g. `"Sysmex XN-1000"`)
- **`manufacturer`** (Optional, *string*):  (e.g. `"Sysmex"`)
- **`model`** (Optional, *string*):  (e.g. `"XN-1000"`)
- **`serialNumber`** (Optional, *string*):  (e.g. `"SN-123456"`)
- **`department`** (Optional, *string*):  (e.g. `"laboratory"`)
- **`connectionDetails`** (Optional, *object*):  (e.g. `{"ip_address":"192.168.1.50","port":5000}`)
- **`testMapping`** (Optional, *object*):  (e.g. `{"WBC":"test-wbc-id"}`)
- **`isActive`** (Optional, *boolean*):  (e.g. `true`)
- **`connectionStatus`** (Optional, *string [enum: connected, disconnected, error]*):  (e.g. `"connected"`)

**Request Example:**
```json
{
  "machineName": "Sysmex XN-1000",
  "manufacturer": "Sysmex",
  "model": "XN-1000",
  "serialNumber": "SN-123456",
  "department": "laboratory",
  "connectionDetails": {
    "ip_address": "192.168.1.50",
    "port": 5000
  },
  "testMapping": {
    "WBC": "test-wbc-id"
  },
  "isActive": true,
  "connectionStatus": "connected"
}
````

**Responses:**

- **Status `200`**:

  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "machineName": "Sysmex XN-3000",
      "machineType": "lab_analyzer",
      "manufacturer": "Sysmex",
      "model": "XN-1000",
      "serialNumber": "SN-123456",
      "department": "laboratory",
      "connectionType": "hl7",
      "connectionDetails": {
        "ip_address": "192.168.1.50",
        "port": 5000
      },
      "testMapping": {
        "WBC": "test-wbc-id",
        "RBC": "test-rbc-id"
      },
      "isActive": true,
      "connectionStatus": "connected",
      "lastConnectedAt": null,
      "lastResultReceivedAt": null,
      "createdAt": "2026-06-13T17:04:00.000Z",
      "updatedAt": "2026-06-13T17:04:00.000Z",
      "createdById": "string",
      "_count": {
        "resultsQueue": 0
      }
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `DELETE /api/integrations/machines/{id}`

**Purpose:** Delete machine integration

* **Authentication Required:** ✅ Yes

**Path Parameters:**
- `id` (Required):  *(type: string)*

**Request Body:** None.

**Responses:**

- **Status `200`**:

  ```json
{
  "success": true,
  "data": {
    "id": "string",
    "deleted": true
  },
  "message": "Machine integration deleted successfully",
  "errorCode": null,
  "timestamp": "2026-06-13T17:04:00.000Z"
}
````

---

## 📦 PreTriage Module

### `GET /api/pre-triage`

**Purpose:** List pre-triage screenings with filters and pagination

- **Authentication Required:** ✅ Yes

**Query Parameters:**

- `page` (Optional): Page number (1-indexed) _(type: number) (default: `1`)_
- `limit` (Optional): Items per page (max 100) _(type: number) (default: `10`)_
- `orderBy` (Optional): Field to order by _(type: string) (default: `screenedAt`)_
- `orderDir` (Optional): _(type: string) (default: `desc`)_
- `status` (Optional): Filter by screening status (e.g. screening, routed, registered_as_patient, all) _(type: string) (default: `all`)_
- `search` (Optional): Search term for first/last name or screening number _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "data": [
        {
          "id": "string",
          "organizationId": "string",
          "screeningNumber": "string",
          "firstName": "string",
          "lastName": "string",
          "age": 0,
          "gender": "string",
          "phone": "string",
          "chiefComplaint": "string",
          "briefHistory": "string",
          "temperature": 0,
          "bloodPressureSystolic": 0,
          "bloodPressureDiastolic": 0,
          "pulseRate": 0,
          "routedTo": "string",
          "status": "string",
          "patientId": "string",
          "screenedAt": "2026-06-13T16:39:03.292Z",
          "screenedById": "string",
          "routedAt": "2026-06-13T16:39:03.292Z",
          "routedById": "string",
          "isDeleted": false,
          "deletedAt": "2026-06-13T16:39:03.292Z",
          "updatedAt": "2026-06-13T16:39:03.292Z",
          "screenedBy": {
            "fullName": "string"
          },
          "patient": {
            "mrn": "string",
            "firstName": "string",
            "lastName": "string"
          }
        }
      ],
      "meta": {
        "total": 100,
        "lastPage": 10,
        "currentPage": 1,
        "perPage": 10,
        "prev": null,
        "next": 2
      }
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.292Z"
  }
  ```

---

### `GET /api/pre-triage/{id}`

**Purpose:** Get details of a single pre-triage screening

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "screeningNumber": "string",
      "firstName": "string",
      "lastName": "string",
      "age": 0,
      "gender": "string",
      "phone": "string",
      "chiefComplaint": "string",
      "briefHistory": "string",
      "temperature": 0,
      "bloodPressureSystolic": 0,
      "bloodPressureDiastolic": 0,
      "pulseRate": 0,
      "routedTo": "string",
      "status": "string",
      "patientId": "string",
      "screenedAt": "2026-06-13T16:39:03.292Z",
      "screenedById": "string",
      "routedAt": "2026-06-13T16:39:03.292Z",
      "routedById": "string",
      "isDeleted": false,
      "deletedAt": "2026-06-13T16:39:03.292Z",
      "updatedAt": "2026-06-13T16:39:03.292Z",
      "screenedBy": {
        "fullName": "string"
      },
      "patient": {
        "mrn": "string",
        "firstName": "string",
        "lastName": "string"
      }
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.292Z"
  }
  ```

---

### `POST /api/pre-triage`

**Purpose:** Create a new pre-triage screening record

- **Authentication Required:** ✅ Yes

**Request Body:**

- **`firstName`** (Optional, _string_): (e.g. `"John"`)
- **`lastName`** (Optional, _string_): (e.g. `"Doe"`)
- **`age`** (Optional, _number_): (e.g. `35`)
- **`gender`** (Optional, _string_): (e.g. `"male"`)
- **`phone`** (Optional, _string_): (e.g. `"+251911123456"`)
- **`chiefComplaint`** (Optional, _string_): (e.g. `"Fever and cough"`)
- **`briefHistory`** (Optional, _string_): (e.g. `"Symptoms started 3 days ago."`)
- **`temperature`** (Optional, _number_): (e.g. `38.5`)
- **`bloodPressureSystolic`** (Optional, _number_): (e.g. `120`)
- **`bloodPressureDiastolic`** (Optional, _number_): (e.g. `80`)
- **`pulseRate`** (Optional, _number_): (e.g. `75`)
- **`routedTo`** (Optional, _string_): (e.g. `"adult_triage"`)

**Request Example:**

```json
{
  "firstName": "John",
  "lastName": "Doe",
  "age": 35,
  "gender": "male",
  "phone": "+251911123456",
  "chiefComplaint": "Fever and cough",
  "briefHistory": "Symptoms started 3 days ago.",
  "temperature": 38.5,
  "bloodPressureSystolic": 120,
  "bloodPressureDiastolic": 80,
  "pulseRate": 75,
  "routedTo": "adult_triage"
}
```

**Responses:**

- **Status `201`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "screeningNumber": "string",
      "firstName": "string",
      "lastName": "string",
      "age": 0,
      "gender": "string",
      "phone": "string",
      "chiefComplaint": "string",
      "briefHistory": "string",
      "temperature": 0,
      "bloodPressureSystolic": 0,
      "bloodPressureDiastolic": 0,
      "pulseRate": 0,
      "routedTo": "string",
      "status": "string",
      "patientId": "string",
      "screenedAt": "2026-06-13T16:39:03.292Z",
      "screenedById": "string",
      "routedAt": "2026-06-13T16:39:03.292Z",
      "routedById": "string",
      "isDeleted": false,
      "deletedAt": "2026-06-13T16:39:03.292Z",
      "updatedAt": "2026-06-13T16:39:03.292Z",
      "screenedBy": {
        "fullName": "string"
      },
      "patient": {
        "mrn": "string",
        "firstName": "string",
        "lastName": "string"
      }
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.292Z"
  }
  ```

---

### `POST /api/pre-triage/{id}/convert`

**Purpose:** Convert pre-triage screening to a Patient record

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `200`**:

  ```json
  {
    "success": true,
    "data": {
      "patientId": "string",
      "mrn": "MRN202606130698"
    },
    "message": "Pre-triage screening converted to patient successfully",
    "errorCode": null,
    "timestamp": "2026-06-13T17:04:00.000Z"
  }
  ```

````

---

### `PATCH /api/pre-triage/{id}`

**Purpose:** Update an existing pre-triage screening

* **Authentication Required:** ✅ Yes

**Path Parameters:**
- `id` (Required):  *(type: string)*

**Request Body:**

- **`firstName`** (Optional, *string*):  (e.g. `"John"`)
- **`lastName`** (Optional, *string*):  (e.g. `"Doe"`)
- **`age`** (Optional, *number*):  (e.g. `35`)
- **`gender`** (Optional, *string*):  (e.g. `"male"`)
- **`phone`** (Optional, *string*):  (e.g. `"+251911123456"`)
- **`chiefComplaint`** (Optional, *string*):  (e.g. `"Fever and cough"`)
- **`briefHistory`** (Optional, *string*):  (e.g. `"Symptoms started 3 days ago."`)
- **`temperature`** (Optional, *number*):  (e.g. `38.5`)
- **`bloodPressureSystolic`** (Optional, *number*):  (e.g. `120`)
- **`bloodPressureDiastolic`** (Optional, *number*):  (e.g. `80`)
- **`pulseRate`** (Optional, *number*):  (e.g. `75`)
- **`routedTo`** (Optional, *string*):  (e.g. `"adult_triage"`)
- **`status`** (Optional, *string*):  (e.g. `"screening"`)
- **`patientId`** (Optional, *string*):  (e.g. `"cuid-patient-id"`)

**Request Example:**
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "age": 35,
  "gender": "male",
  "phone": "+251911123456",
  "chiefComplaint": "Fever and cough",
  "briefHistory": "Symptoms started 3 days ago.",
  "temperature": 38.5,
  "bloodPressureSystolic": 120,
  "bloodPressureDiastolic": 80,
  "pulseRate": 75,
  "routedTo": "adult_triage",
  "status": "screening",
  "patientId": "cuid-patient-id"
}
````

**Responses:**

- **Status `200`**:
  ```json
  {
    "success": true,
    "data": {
      "id": "string",
      "organizationId": "string",
      "screeningNumber": "string",
      "firstName": "string",
      "lastName": "string",
      "age": 0,
      "gender": "string",
      "phone": "string",
      "chiefComplaint": "string",
      "briefHistory": "string",
      "temperature": 0,
      "bloodPressureSystolic": 0,
      "bloodPressureDiastolic": 0,
      "pulseRate": 0,
      "routedTo": "string",
      "status": "string",
      "patientId": "string",
      "screenedAt": "2026-06-13T16:39:03.292Z",
      "screenedById": "string",
      "routedAt": "2026-06-13T16:39:03.292Z",
      "routedById": "string",
      "isDeleted": false,
      "deletedAt": "2026-06-13T16:39:03.292Z",
      "updatedAt": "2026-06-13T16:39:03.292Z",
      "screenedBy": {
        "fullName": "string"
      },
      "patient": {
        "mrn": "string",
        "firstName": "string",
        "lastName": "string"
      }
    },
    "message": null,
    "errorCode": null,
    "timestamp": "2026-06-13T16:39:03.292Z"
  }
  ```

---

### `DELETE /api/pre-triage/{id}`

**Purpose:** Soft-delete a pre-triage screening

- **Authentication Required:** ✅ Yes

**Path Parameters:**

- `id` (Required): _(type: string)_

**Request Body:** None.

**Responses:**

- **Status `204`**:

---
