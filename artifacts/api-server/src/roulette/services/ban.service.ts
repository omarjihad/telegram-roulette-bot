import { User } from '../models/User';
import { findUserByLookup } from './user.service';
import { writeAudit } from '../models/AuditLog';
import { AppError } from '../utils/AppError';

export async function banUser(lookup: string, actorId: number, actorUsername?: string, reason?: string) {
  const user = await findUserByLookup(lookup);
  if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');

  user.isBanned = true;
  user.bannedAt = new Date();
  user.bannedBy = actorId;
  user.banReason = reason;
  await user.save();

  await writeAudit({ actorId, actorUsername, action: 'user.ban', target: String(user.telegramId), metadata: { reason } });
  return user;
}

export async function unbanUser(lookup: string, actorId: number, actorUsername?: string) {
  const user = await findUserByLookup(lookup);
  if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');

  user.isBanned = false;
  user.bannedAt = undefined;
  user.bannedBy = undefined;
  user.banReason = undefined;
  await user.save();

  await writeAudit({ actorId, actorUsername, action: 'user.unban', target: String(user.telegramId) });
  return user;
}

export async function listBanned() {
  return User.find({ isBanned: true }).sort({ bannedAt: -1 });
}

export async function unbanAll(actorId: number, actorUsername?: string) {
  await User.updateMany({ isBanned: true }, { isBanned: false, bannedAt: undefined, bannedBy: undefined, banReason: undefined });
  await writeAudit({ actorId, actorUsername, action: 'user.unban_all' });
}
