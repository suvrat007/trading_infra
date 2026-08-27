/**
 * Express 4 does not catch rejected promises from async handlers — the request
 * would hang until the client times out. Wrapping forwards the rejection to
 * next(), so every failure lands in the one error-handling middleware.
 */
export function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
