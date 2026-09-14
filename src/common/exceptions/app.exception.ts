import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes';

/**
 * Base application exception.
 * All domain exceptions extend this class.
 * Carries a machine-readable errorCode alongside HTTP status.
 *
 * Usage:
 *   throw new AppException('User not found', ErrorCodes.USER_NOT_FOUND, HttpStatus.NOT_FOUND);
 */
export class AppException extends HttpException {
  public readonly errorCode: ErrorCode;

  constructor(
    message: string,
    errorCode: ErrorCode,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super({ message, errorCode }, status);
    this.errorCode = errorCode;
  }
}

// ── Convenience subclasses ─────────────────────────────────────────────────

export class NotFoundException extends AppException {
  constructor(message: string, errorCode: ErrorCode) {
    super(message, errorCode, HttpStatus.NOT_FOUND);
  }
}

/**
 * A request the server understood and refuses on its own terms.
 *
 * Distinct from a validation failure: the shape was right, the meaning was not
 * (creating an account with no password, paying more than an invoice's
 * balance). The message is shown to a person, so it says what to do next.
 */
export class BadRequestException extends AppException {
  constructor(message: string, errorCode: ErrorCode) {
    super(message, errorCode, HttpStatus.BAD_REQUEST);
  }
}

export class ConflictException extends AppException {
  constructor(message: string, errorCode: ErrorCode) {
    super(message, errorCode, HttpStatus.CONFLICT);
  }
}

export class UnauthorizedException extends AppException {
  constructor(message: string, errorCode: ErrorCode) {
    super(message, errorCode, HttpStatus.UNAUTHORIZED);
  }
}

export class ForbiddenException extends AppException {
  constructor(message: string, errorCode: ErrorCode) {
    super(message, errorCode, HttpStatus.FORBIDDEN);
  }
}
