import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
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

        // A file is not a payload. `StreamableFile` wraps a live stream, and
        // wrapping it in the envelope both destroys the response — the client
        // gets JSON where it asked for a PNG — and throws on the way out:
        // serialising a stream walks its socket back to itself and fails with
        // "Converting circular structure to JSON", which surfaces as a 500 with
        // nothing in it about streams.
        if (data instanceof StreamableFile) return data;

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
