import { ERROR_CODE, HTTP_STATUS } from '../../constants/http.js';

/**
 * An error we intentionally surface to the client.
 * Anything that is NOT an ApiError is a bug, and the error handler turns it
 * into a generic 500 rather than leaking a stack trace or SQL text.
 */
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.expected = true;
  }

  static badRequest(code, message) {
    return new ApiError(HTTP_STATUS.BAD_REQUEST, code, message);
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODE.NOT_FOUND, message);
  }
}
