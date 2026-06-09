import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { AppException } from '../exceptions/app.exception';
import { ErrorCodes } from '../exceptions/error-codes';
import { CORRELATION_ID_HEADER } from '../constants/app.constants';

/**
 * GlobalExceptionFilter — catches EVERY unhandled exception.
 *
 * Normalises all errors into the standard API error response shape:
 * {
 *   success: false,
 *   message: string,
 *   errorCode: string,
 *   timestamp: string,
 *   path: string,
 *   errors?: object   // validation errors only
 * }
 *
 * Handles:
 *  - AppException (domain exceptions with errorCode)
 *  - HttpException (NestJS built-ins like BadRequestException)
 *  - Prisma exceptions (unique, not found, FK violations)
 *  - Generic errors (500)
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const correlationId = request.headers[CORRELATION_ID_HEADER] as string;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errorCode: string = ErrorCodes.INTERNAL_SERVER_ERROR;
    let errors: Record<string, string[]> | undefined;

    if (exception instanceof AppException) {
      // Our domain exceptions — already structured
      status = exception.getStatus();
      const body = exception.getResponse() as { message: string; errorCode: string };
      message = body.message;
      errorCode = body.errorCode as string;

    } else if (exception instanceof HttpException) {
      // NestJS built-in exceptions (ValidationPipe, etc.)
      status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const bodyObj = body as Record<string, unknown>;
        message = (bodyObj.message as string) || message;

        // ValidationPipe returns array of messages
        if (Array.isArray(bodyObj.message)) {
          message = 'Validation failed';
          errorCode = ErrorCodes.VALIDATION_ERROR;
          // Group validation errors by field
          errors = this.formatValidationErrors(bodyObj.message as string[]);
        }
      }

      errorCode = this.httpStatusToErrorCode(status);

    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Prisma known errors — map to meaningful HTTP responses
      const result = this.handlePrismaError(exception);
      status = result.status;
      message = result.message;
      errorCode = result.errorCode;

    } else if (exception instanceof Error) {
      // Unexpected errors — log full stack, return generic 500
      this.logger.error(
        `Unhandled error: ${exception.message}`,
        exception.stack,
        { correlationId, path: request.url },
      );
    }

    // Log all non-500s at warn, 500s at error
    const logMeta = { correlationId, path: request.url, status };
    if (status >= 500) {
      this.logger.error(`[${status}] ${message}`, logMeta);
    } else {
      this.logger.warn(`[${status}] ${message}`, logMeta);
    }

    response.status(status).json({
      success: false,
      message,
      errorCode,
      timestamp: new Date().toISOString(),
      path: request.url,
      ...(errors && { errors }),
    });
  }

  private handlePrismaError(
    error: Prisma.PrismaClientKnownRequestError,
  ): { status: HttpStatus; message: string; errorCode: string } {
    switch (error.code) {
      case 'P2002': // Unique constraint failed
        return {
          status: HttpStatus.CONFLICT,
          message: `Duplicate value on field: ${(error.meta?.target as string[])?.join(', ')}`,
          errorCode: ErrorCodes.DB_UNIQUE_CONSTRAINT,
        };
      case 'P2025': // Record not found
        return {
          status: HttpStatus.NOT_FOUND,
          message: 'Record not found',
          errorCode: ErrorCodes.DB_RECORD_NOT_FOUND,
        };
      case 'P2003': // Foreign key constraint
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'Related record not found',
          errorCode: ErrorCodes.DB_FOREIGN_KEY_CONSTRAINT,
        };
      default:
        this.logger.error(`Unhandled Prisma error: ${error.code}`, error);
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Database error',
          errorCode: ErrorCodes.INTERNAL_SERVER_ERROR,
        };
    }
  }

  private httpStatusToErrorCode(status: HttpStatus): string {
    const map: Partial<Record<HttpStatus, string>> = {
      [HttpStatus.UNAUTHORIZED]: ErrorCodes.UNAUTHORIZED,
      [HttpStatus.FORBIDDEN]: ErrorCodes.FORBIDDEN,
      [HttpStatus.NOT_FOUND]: ErrorCodes.NOT_FOUND,
      [HttpStatus.BAD_REQUEST]: ErrorCodes.BAD_REQUEST,
      [HttpStatus.TOO_MANY_REQUESTS]: ErrorCodes.TOO_MANY_REQUESTS,
    };
    return map[status] || ErrorCodes.INTERNAL_SERVER_ERROR;
  }

  private formatValidationErrors(messages: string[]): Record<string, string[]> {
    // class-validator messages format: "field.constraint message"
    const grouped: Record<string, string[]> = {};
    for (const msg of messages) {
      const parts = msg.split(' ');
      const field = parts[0] || 'unknown';
      if (!grouped[field]) grouped[field] = [];
      grouped[field].push(msg);
    }
    return grouped;
  }
}
