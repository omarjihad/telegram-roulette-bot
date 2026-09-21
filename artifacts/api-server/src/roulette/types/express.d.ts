import { HydratedDocument } from 'mongoose';
import { IUser } from '../models/User';
import { AdminRole } from '../models/Admin';

declare global {
  namespace Express {
    interface Request {
      dbUser?: HydratedDocument<IUser>;
      telegramId?: number;
      adminRole?: AdminRole | null;
    }
  }
}

export {};
