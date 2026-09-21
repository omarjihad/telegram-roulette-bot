import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError';

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.adminRole) {
    return next(new AppError('Admin access required', 403, 'FORBIDDEN'));
  }
  next();
}

export function requireOwner(req: Request, _res: Response, next: NextFunction) {
  if (req.adminRole !== 'owner') {
    return next(new AppError('Owner access required', 403, 'FORBIDDEN'));
  }
  next();
}
