import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { CORRELATION_ID_HEADER } from '../constants/app.constants';

/**
 * LoggingInterceptor — structured request/response logging.
 *
 * Logs: method, url, status, duration, userId, ip, correlationId.
 * Works alongside Pino HTTP middleware for full request lifecycle coverage.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, url, ip } = request;
    const correlationId = request.headers[CORRELATION_ID_HEADER] as string;
    const userId = (request as unknown as Record<string, unknown>).user
      ? ((request as unknown as Record<string, unknown>).user as { id: string }).id
      : 'anonymous';

    const startTime = Date.now();

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse<Response>();
        const duration = Date.now() - startTime;

        this.logger.log({
          method,
          url,
          status: response.statusCode,
          duration: `${duration}ms`,
          userId,
          ip,
          correlationId,
        });
      }),
    );
  }
}
