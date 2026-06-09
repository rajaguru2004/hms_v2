/**
 * Standard API response envelope.
 * Every response from the system uses this shape.
 * Enforced by the ResponseInterceptor.
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  timestamp: string;
  path?: string;
}

/**
 * Standard error response — extends ApiResponse with error details.
 */
export interface ApiErrorResponse extends ApiResponse<null> {
  success: false;
  errorCode: string;
  errors?: Record<string, string[]>;
}
