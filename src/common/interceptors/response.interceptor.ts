import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Request } from 'express';

/**
 * ResponseInterceptor — wraps all successful responses in the standard envelope.
 *
 * Before: { id: '...', name: '...' }
 * After:  { success: true, message: 'Success', data: { id, name }, timestamp }
 *
 * Applied globally in main.ts so no per-controller boilerplate needed.
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();

    return next.handle().pipe(
      map((data: unknown) => {
        // If data already has our envelope shape, pass through
        if (this.isApiResponse(data)) return data;

        return {
          success: true,
          message: 'Operation completed successfully',
          data,
          timestamp: new Date().toISOString(),
          path: request.url,
        };
      }),
    );
  }

  private isApiResponse(data: unknown): boolean {
    return (
      typeof data === 'object' &&
      data !== null &&
      'success' in data &&
      'timestamp' in data
    );
  }
}
