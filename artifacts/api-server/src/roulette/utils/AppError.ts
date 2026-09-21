export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode = 400, code = 'BAD_REQUEST') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const Errors = {
  notFound: (msg = 'Not found') => new AppError(msg, 404, 'NOT_FOUND'),
  unauthorized: (msg = 'Unauthorized') => new AppError(msg, 401, 'UNAUTHORIZED'),
  forbidden: (msg = 'Forbidden') => new AppError(msg, 403, 'FORBIDDEN'),
  conflict: (msg = 'Conflict') => new AppError(msg, 409, 'CONFLICT'),
  tooMany: (msg = 'Too many requests') => new AppError(msg, 429, 'RATE_LIMITED'),
  validation: (msg = 'Validation failed') => new AppError(msg, 422, 'VALIDATION_ERROR'),
  banned: (msg = 'User is banned') => new AppError(msg, 403, 'BANNED'),
  maintenance: (msg = 'Under maintenance') => new AppError(msg, 503, 'MAINTENANCE'),
};
