import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { CORRELATION_ID_HEADER } from '../constants/app.constants';

/**
 * RequestIdMiddleware — attaches a unique correlation ID to every request.
 *
 * Checks for existing x-correlation-id header (set by API gateway/load balancer).
 * Falls back to generating a new UUID v4.
 *
 * The correlation ID is:
 * - Added to response headers for client tracing
 * - Attached to request object for downstream logging
 * - Used by LoggingInterceptor and GlobalExceptionFilter
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const existingId = req.headers[CORRELATION_ID_HEADER] as string;
    const correlationId = existingId || uuidv4();

    req.headers[CORRELATION_ID_HEADER] = correlationId;
    res.setHeader(CORRELATION_ID_HEADER, correlationId);

    next();
  }
}
