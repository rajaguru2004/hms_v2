# HMS v2 — Agent Coding Rules & Architecture Standards

> **Purpose**: This file is read by all AI coding agents working on this codebase.
> Follow these rules without exception. Deviations require explicit human approval.

---

## 1. ARCHITECTURE INVARIANTS

### Layering
```
HTTP Request
    ↓
Controller        (HTTP, validation, thin, no business logic)
    ↓
Service           (business logic, orchestration, transactions)
    ↓
Repository        (data access, Prisma queries)
    ↓
Prisma / DB
```

**NEVER:**
- Call `prisma.*` directly from a Service. Use Repository methods.
- Put business logic in Controller. Controllers only: parse input, call service, return.
- Put HTTP-specific code (Request, Response) in Service or Repository.
- Put database queries in Controller.

### Module Boundaries
- Each feature = one module folder under `src/modules/`
- Module must have: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `*.repository.ts`, `dto/`
- Cross-module data access: inject the other module's Service (never Repository directly)
- Global modules: `PrismaModule`, `AuditModule`, `AppCacheModule` — do NOT re-import these

---

## 2. NAMING CONVENTIONS

| Artifact       | Pattern                  | Example                    |
|----------------|--------------------------|----------------------------|
| File           | kebab-case               | `user-profile.service.ts`  |
| Class          | PascalCase               | `UserProfileService`       |
| Interface      | PascalCase, no I prefix  | `UserProfile` not `IUser`  |
| Type           | PascalCase               | `CreateUserResult`         |
| Enum           | PascalCase               | `AuditAction`              |
| Enum value     | SCREAMING_SNAKE_CASE     | `AuditAction.SOFT_DELETE`  |
| Constant       | SCREAMING_SNAKE_CASE     | `MAX_LIMIT`                |
| Variable/param | camelCase                | `userId`, `createdAt`      |
| DB column      | snake_case (Prisma @map) | `created_at`               |

---

## 3. TYPESCRIPT RULES

- **Strict mode is ON**. No `any`, no `!` non-null assertion unless proven safe.
- Every function must have explicit return type.
- Use `unknown` instead of `any` when type is genuinely unknown.
- Use `readonly` for class properties that don't change after construction.
- Prefer `interface` for shapes, `type` for unions/intersections.
- Use `as const` for object literals used as lookup maps.
- No unused imports. No unused variables.
- `void` operator for intentional floating promises (e.g., `void auditService.log(...)`).

---

## 4. API RESPONSE STANDARD

Every response MUST follow this envelope (enforced by `ResponseInterceptor`):

```json
// Success
{
  "success": true,
  "message": "Operation completed successfully",
  "data": {},
  "timestamp": "2024-01-01T00:00:00.000Z",
  "path": "/api/users"
}

// Error
{
  "success": false,
  "message": "User not found",
  "errorCode": "USER_NOT_FOUND",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "path": "/api/users/abc"
}

// Paginated list
{
  "success": true,
  "message": "Operation completed successfully",
  "data": {
    "data": [...],
    "meta": {
      "page": 1,
      "limit": 10,
      "total": 100,
      "totalPages": 10,
      "hasNextPage": true,
      "hasPreviousPage": false
    }
  }
}
```

**Rules:**
- Never return plain objects from controllers — interceptor handles wrapping.
- Never return password/hash fields from any endpoint.
- All list endpoints must use `BaseRepository.paginate()`.
- All error codes must exist in `src/common/exceptions/error-codes.ts`.

---

## 5. DATABASE RULES

### Soft Delete
- All entities have `isDeleted`, `deletedAt` fields.
- All `findMany`/`findById` queries MUST filter `isDeleted: false` by default.
- `BaseRepository` does this automatically — use it.
- Never use `deleteMany` on business entities. Use `softDelete()`.
- Hard delete only for: GDPR erasure, test cleanup (`cleanDatabase()`).

### Migrations
- Every schema change requires a Prisma migration: `npx prisma migrate dev --name <desc>`
- Migration name format: `add_patient_table`, `add_index_user_email`
- Never edit migration files after they're committed.
- Never edit `schema.prisma` without creating a migration.

### Audit Fields
Every table MUST have:
```
id          String    @id @default(uuid())
createdAt   DateTime  @default(now())
updatedAt   DateTime  @updatedAt
createdBy   String?
updatedBy   String?
isDeleted   Boolean   @default(false)
deletedAt   DateTime?
```

### Indexes
- Always index FK columns.
- Always index email, phone, and other search fields.
- Always index `isDeleted` on large tables.
- Add `@@index` in schema, not raw SQL.

---

## 6. SECURITY RULES

- **NEVER** log passwords, tokens, or PII.
- **NEVER** return password hash in API responses.
- **ALWAYS** hash passwords with bcrypt, `SALT_ROUNDS = 12`.
- **ALWAYS** use `ErrorCodes` from `error-codes.ts` — never raw strings.
- **ALWAYS** validate input with class-validator DTOs. No manual validation.
- **NEVER** use `eval()`, `Function()`, or dynamic code execution.
- **NEVER** construct SQL strings manually — use Prisma parameterized queries.
- Rate limiting: all endpoints inherit 100 req/60s global throttle. Reduce for auth routes.
- JWT secrets must be >= 32 characters. Validated by Joi schema at startup.

---

## 7. ERROR HANDLING

- Throw `AppException` subclasses from Services, never from Controllers.
- Use `NotFoundException`, `ConflictException`, `UnauthorizedException`, `ForbiddenException`.
- Add new error codes to `src/common/exceptions/error-codes.ts` before using.
- Never throw generic `Error` — always use domain exceptions.
- `GlobalExceptionFilter` handles all exceptions — do not catch in middleware/interceptors.
- Audit log failures must NEVER throw — use fire-and-forget pattern.

---

## 8. CACHING RULES

- Use `AppCacheService` — never use Redis client directly in services.
- Cache key format: `entity:id:field` — e.g., `user:abc123:profile`
- Always invalidate cache on update/delete.
- Cache TTL defaults: user profile = 300s, roles = 600s.
- Never cache sensitive data (passwords, tokens, full audit logs).
- `AppCacheService.buildKey(...parts)` — use this to build keys.

---

## 9. AUDIT LOGGING RULES

- All CREATE, UPDATE, DELETE operations must log to `AuditService`.
- Log `oldValues` on UPDATE (what changed, not entire object).
- Log `newValues` on UPDATE (only changed fields).
- Use `void auditService.log(...)` — non-blocking, non-throwing.
- Never audit log: password fields, tokens, internal metadata.
- `AuditAction` enum in `src/common/enums/action.enum.ts` — use it.

---

## 10. TESTING RULES

### Unit Tests
- Every Service method needs a unit test.
- Mock Repository, not Prisma directly.
- Mock AuditService and CacheService.
- Use `jest.fn()` for mocks, `jest.spyOn()` for partial mocks.
- File: `*.spec.ts` co-located with source file.

### E2E Tests
- Use a separate test database (`hms_v2_test`).
- Clean database before each test: `prismaService.cleanDatabase()`.
- Test the full HTTP request-response cycle via Supertest.
- File: `test/*.e2e-spec.ts`.

### Coverage Target
- Statements: >= 80%
- Branches: >= 75%
- Functions: >= 80%

### Mocking Prisma
```typescript
// Use this pattern in unit tests:
const mockPrismaService = {
  user: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};
```

### Live API Verification Scripts
For verifying APIs directly against a running server (without spinning up NestJS test containers or modifying database configurations in the script), write lightweight standalone verification scripts:

- **Target**: Query the live running server directly (defaulting to `http://localhost:3000/api`). Do NOT initialize the NestJS application context or modify environment database URLs within the verification script.
- **Location**: Store scripts under the `test/` directory, prefixing the filename with `verify-` (e.g., `test/verify-billing.ts`).
- **Dependencies**: Use native Node.js `fetch` (available in Node.js 18+) for HTTP calls. Avoid external libraries like `axios` or `supertest` in these scripts to keep them lightweight.
- **Authentication Flow**:
  1. Authenticate first by calling the `/auth/login` endpoint with seed credentials (e.g., `admin@hms.local` / `Admin@HMS2024!`).
  2. Extract the JWT `accessToken` from the response.
  3. Append `Authorization: Bearer <token>` and `Content-Type: application/json` headers to all subsequent request headers.
- **Test Execution Flow**:
  1. **Prerequisites First**: Seed or create dependencies required by the module (e.g., create a patient before creating an invoice).
  2. **Core API Actions**: Test the API flow sequentially (e.g., create a resource, fetch list/details, update status/values, and record linked items).
  3. **Clean Assertions**: Check response statuses (`res.ok`), parse the envelope, verify fields, and throw descriptive errors immediately upon any failure.
- **Execution Command**: Run directly with `npx ts-node test/verify-<name>.ts`.

---

## 11. SWAGGER/API DOCUMENTATION RULES

Every controller must have:
- `@ApiTags('ModuleName')` on class
- `@ApiOperation({ summary: '...' })` on each endpoint
- `@ApiBearerAuth()` on protected controllers
- `@ApiResponse({ status: 200, type: ResponseDto })` for success
- DTO classes must use `@ApiProperty()` / `@ApiPropertyOptional()`

---

## 12. LOGGING RULES

- Use NestJS `Logger` class — `private readonly logger = new Logger(ClassName.name)`
- Log levels: `error` for failures, `warn` for unusual but recoverable, `log` for operations, `debug` for dev-only.
- Never use `console.log` in production code (only `console.error` in AuditService fallback).
- Include `correlationId` in logs where available.
- Structured logging: pass objects, not string concatenation.

```typescript
// Correct
this.logger.log({ method, url, status, duration, userId, correlationId });

// Wrong
this.logger.log(`${method} ${url} ${status} ${duration}`);
```

---

## 13. DEPENDENCY INJECTION RULES

- Use constructor injection only.
- Never use `@Inject(TOKEN)` for service classes — only for value providers.
- Mark services `@Injectable()`.
- Export from module only what other modules need.
- Don't create circular dependencies — restructure if needed.

---

## 14. GIT COMMIT RULES

Conventional Commits format:

```
<type>(<scope>): <subject>

type: feat | fix | refactor | test | docs | chore | perf | security
scope: auth | users | patients | billing | health | prisma | config
subject: imperative, lowercase, no period

Examples:
feat(auth): add refresh token rotation
fix(users): prevent email enumeration on login
refactor(prisma): extract base repository generic type
test(users): add unit tests for UserService.create
security(auth): increase bcrypt rounds to 14
```

---

## 15. FOLDER STRUCTURE RULES

```
src/
├── config/          Config factories only
├── common/          Shared: guards, decorators, filters, types, utils
│   ├── constants/
│   ├── decorators/
│   ├── dto/
│   ├── enums/
│   ├── exceptions/
│   ├── filters/
│   ├── guards/
│   ├── interceptors/
│   ├── middleware/
│   ├── pipes/
│   ├── types/
│   └── utils/
├── prisma/          PrismaService + BaseRepository
│   └── repositories/
├── modules/         Feature modules
│   ├── auth/
│   ├── users/
│   ├── patients/    (future)
│   └── ...
├── audit/           AuditService (global)
├── cache/           AppCacheService (global)
├── events/          EventEmitter2 (future)
└── jobs/            Scheduled jobs (future)
```

Adding new modules:
1. Create folder `src/modules/<module-name>/`
2. Create: `<name>.module.ts`, `<name>.controller.ts`, `<name>.service.ts`, `<name>.repository.ts`, `dto/<name>.dto.ts`
3. Extend `BaseRepository`
4. Import module in `app.module.ts`
5. Add permissions to `permission.enum.ts`
6. Add to seed if needed

---

## 16. PERFORMANCE RULES

- Never use N+1 queries — use Prisma `include` for relations.
- Paginate all list endpoints — max 100 items per page.
- Use `select` to fetch only needed fields for large tables.
- Cache read-heavy endpoints with appropriate TTL.
- Avoid `findMany` without `take` on large tables.
- Use database indexes for all search/filter columns.

---

## 17. HMS DOMAIN RULES

This is a Hospital Management System. Additional constraints:

- Patient data is PHI (Protected Health Information) — extra care required.
- All PHI access must be audit logged.
- No patient data in error messages.
- Appointment/medical record access must check department-level permissions.
- Doctor can only access their own patients' data (row-level security — implement when needed).
- Billing data requires `BILLING_STAFF` or higher role.
- Lab results require `LAB_TECHNICIAN` or `DOCTOR` role.

---

## 18. WHAT AGENTS MUST DO BEFORE CODING

1. Read this rules file completely.
2. Check `src/common/exceptions/error-codes.ts` for existing error codes.
3. Check `src/common/enums/permission.enum.ts` for existing permissions.
4. Extend `BaseRepository` — never write raw Prisma in services.
5. Add Swagger decorators to all new controllers.
6. Write unit tests for all new service methods.
7. Add audit logging for all create/update/delete operations.
8. Update `prisma/seed.ts` if adding new roles/permissions.
9. Run `npm run build` — must pass before committing.
10. Run `npm run lint` — must pass before committing.

---

*Last updated: HMS v2 initial setup*
*Maintainer: Senior Staff Engineering Team*
