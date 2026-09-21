import { User } from '../models/User';
import { AppError } from '../utils/AppError';
import { writeAudit } from '../models/AuditLog';

export async function deductUserPoints(
  telegramId: number,
  amount: number,
  actorId: number,
  actorUsername?: string,
) {
  if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
    throw new AppError('Telegram ID must be a positive integer', 422, 'VALIDATION_ERROR');
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError('The points amount must be greater than zero', 422, 'VALIDATION_ERROR');
  }

  const user = await User.findOneAndUpdate(
    { telegramId, spinPoints: { $gte: amount } },
    { $inc: { spinPoints: -amount } },
    { new: true },
  ).select('telegramId username firstName spinPoints');

  if (!user) {
    const exists = await User.exists({ telegramId });
    if (!exists) throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    throw new AppError('The user does not have enough spin-points', 409, 'INSUFFICIENT_POINTS');
  }

  await writeAudit({
    actorId,
    actorUsername,
    action: 'user.points_deduct',
    target: String(telegramId),
    metadata: { amount, remainingBalance: user.spinPoints },
  });

  return {
    telegramId: user.telegramId,
    username: user.username,
    firstName: user.firstName,
    deducted: amount,
    remainingBalance: user.spinPoints,
  };
}