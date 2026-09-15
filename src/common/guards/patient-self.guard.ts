import {
  Injectable,
  CanActivate,
  ExecutionContext,
  createParamDecorator,
} from '@nestjs/common';
import { Request } from 'express';
import { ForbiddenException } from '../exceptions/app.exception';
import { ErrorCodes } from '../exceptions/error-codes';
import { SystemRole } from '../enums/role.enum';
import { AuthenticatedUser } from '../types/jwt-payload.type';

/** Where the guard leaves the one patient id a handler is allowed to act on. */
export const PATIENT_SCOPE_KEY = 'patientScopeId';

/** The request shape this guard reads and writes. */
interface PatientScopedRequest extends Request {
  user?: AuthenticatedUser;
  [PATIENT_SCOPE_KEY]?: string;
}

/** Every spelling a patient id arrives under on a patient-scoped route. */
const PATIENT_ID_FIELDS = ['patientId', 'id'] as const;

/**
 * Which patient a request is allowed to act on.
 *
 * The same argument `resolveOrganizationId` makes about organisations, one
 * level down. A staff route takes its patient from the URL because a
 * receptionist legitimately works on whoever is in front of them. A portal
 * route cannot: the patient holding the phone is the subject *and* the caller,
 * so an id in the URL is a value they typed, and the only id that was ever
 * authenticated is the one in their token.
 *
 * So for a PATIENT-role caller this guard does not *check* the requested id
 * against their own — it discards it. Comparing and rejecting would turn every
 * patient-scoped route into a membership oracle: a 403 on someone else's id and
 * a 404 on an id that does not exist are different answers, and walking ids to
 * see which come back 403 enumerates the patient list. Substituting their own
 * id answers every request identically, with their own data.
 *
 * Staff pass through untouched. A caller with no patient record and no staff
 * standing is refused rather than defaulted: a PATIENT token with no
 * `patientId` is an account that was created but never linked, and guessing
 * which record it meant is exactly the mistake worth refusing.
 */
@Injectable()
export class PatientSelfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<PatientScopedRequest>();
    const user = request.user;

    if (!user) {
      // JwtAuthGuard is global, so an authenticated request always has one.
      // Reaching here means this guard was mounted on a @Public() route.
      throw new ForbiddenException(
        'This route requires a signed-in account.',
        ErrorCodes.FORBIDDEN,
      );
    }

    if (!isPatientCaller(user)) {
      request[PATIENT_SCOPE_KEY] = readRequestedPatientId(request);
      return true;
    }

    if (!user.patientId) {
      throw new ForbiddenException(
        'Your account is not linked to a patient record.',
        ErrorCodes.PATIENT_PORTAL_NOT_LINKED,
      );
    }

    overwriteRequestedPatientId(request, user.patientId);
    request[PATIENT_SCOPE_KEY] = user.patientId;
    return true;
  }
}

/**
 * True when this caller answers as a patient.
 *
 * Deliberately not given the SUPER_ADMIN override `resolveOrganizationId` has.
 * Cross-organisation administration is a real job somebody does from their own
 * account; being two patients at once is not. If a person genuinely needs both,
 * that is two accounts, and holding PATIENT is the narrower of the two — so it
 * is the one that wins.
 */
export function isPatientCaller(user: AuthenticatedUser): boolean {
  return user.roles?.includes(SystemRole.PATIENT) ?? false;
}

/**
 * The only patient id a caller may read, or `undefined` for staff.
 *
 * For a route that lists or fetches *somebody's* records rather than one
 * patient-scoped resource, the guard's param rewriting is not enough — a list
 * endpoint has no id to rewrite, so an unfiltered query answers with the whole
 * organisation. `GET /appointments` did exactly that: a patient signing in saw
 * ten appointments belonging to ten other patients, by name.
 *
 * So a listing route asks this, and narrows its own query. Staff get
 * `undefined` and are unaffected; a PATIENT with no linked record is refused
 * rather than defaulted, for the same reason the guard refuses one.
 */
export function patientScopeFor(user: AuthenticatedUser): string | undefined {
  if (!isPatientCaller(user)) return undefined;
  if (!user.patientId) {
    throw new ForbiddenException(
      'This account is not linked to a patient record.',
      ErrorCodes.PATIENT_PORTAL_NOT_LINKED,
    );
  }
  return user.patientId;
}

/** The patient id this request asked for, wherever it was written. */
function readRequestedPatientId(
  request: PatientScopedRequest,
): string | undefined {
  const params = request.params as Record<string, unknown> | undefined;
  const body = request.body as Record<string, unknown> | undefined;
  const query = request.query as Record<string, unknown> | undefined;

  for (const field of PATIENT_ID_FIELDS) {
    for (const source of [params, body, query]) {
      const value = source?.[field];
      if (typeof value === 'string' && value.length > 0) return value;
    }
  }

  return undefined;
}

/**
 * Replaces the requested id with the caller's own, in place.
 *
 * Belt and braces on top of `@PatientScope()`: a handler that reads
 * `@Param('id')` out of habit still gets the right record instead of silently
 * serving someone else's.
 *
 * `query` is deliberately absent. Under Express 5 `req.query` is a getter with
 * no setter that re-parses the query string on every access, so a write to it
 * lands on a throwaway object and the next reader — including Nest's
 * ValidationPipe — sees the original value again. A query parameter therefore
 * cannot be neutralised by rewriting it; it can only be not read, which is why
 * `@PatientScope()` and not the DTO is the authority on patient-scoped routes.
 */
function overwriteRequestedPatientId(
  request: PatientScopedRequest,
  patientId: string,
): void {
  const params = request.params as Record<string, unknown> | undefined;
  const body = request.body as Record<string, unknown> | undefined;

  for (const field of PATIENT_ID_FIELDS) {
    if (params && field in params) params[field] = patientId;
    if (body && typeof body === 'object' && field in body) {
      body[field] = patientId;
    }
  }
}

/**
 * @PatientScope() — the patient id `PatientSelfGuard` resolved for this request.
 *
 * The only trustworthy source on a patient-scoped route. Reading the id from
 * the params, body or query instead re-opens the hole the guard closed, and on
 * a query parameter the guard cannot close it for you.
 *
 * Undefined only for a staff caller who named no patient; the handler decides
 * what that means for it.
 */
export const PatientScope = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<PatientScopedRequest>();
    return request[PATIENT_SCOPE_KEY];
  },
);
