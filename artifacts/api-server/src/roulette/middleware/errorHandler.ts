import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError';
import { logger } from '../config/logger';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    if (!err.isOperational) {
      logger.error({ err }, 'Non-operational AppError');
    }
    return res.status(err.statusCode).json({ ok: false, code: err.code, message: err.message });
  }

  logger.error({ err, path: req.path }, 'Unhandled error');
  return res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ ok: false, code: 'NOT_FOUND', message: `Route not found: ${req.method} ${req.path}` });
}
