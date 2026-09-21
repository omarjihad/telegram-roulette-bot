import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { User } from '../models/User';
import { Referral } from '../models/Referral';
import { ClaimTask } from '../models/ClaimTask';
import { UserTask } from '../models/UserTask';
import { UserPrize } from '../models/UserPrize';
import { AppError } from '../utils/AppError';

async function findUser(query: string) {
  const trimmed = query.trim().replace(/^@/, '');
  if (!trimmed) throw new AppError('username or telegram ID is required', 422, 'VALIDATION_ERROR');
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const user = await User.findOne(/^\d+$/.test(trimmed) ? { telegramId: Number(trimmed) } : { username: new RegExp(`^${escaped}$`, 'i') });
  if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');
  return user;
}

export const adminLookupUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await findUser(String(req.query.query ?? ''));
  const [pendingReferrals, qualifiedReferrals, claimTasks, completedTasks, userTasks, inventory] = await Promise.all([
    Referral.countDocuments({ referrer: user._id, status: 'pending' }),
    Referral.countDocuments({ referrer: user._id, status: 'qualified' }),
    ClaimTask.countDocuments({ user: user._id }),
    ClaimTask.countDocuments({ user: user._id, status: 'completed' }),
    UserTask.countDocuments({ user: user._id }),
    UserPrize.countDocuments({ user: user._id }),
  ]);
  res.json({
    ok: true,
    user: {
      telegramId: user.telegramId,
      username: user.username,
      firstName: user.firstName,
      createdAt: user.createdAt,
      totalSpins: user.totalSpins,
      spinCredits: user.spinCredits ?? 0,
      spinPoints: user.spinPoints,
      spinPointsSpent: user.spinPointsSpent ?? 0,
      pendingReferrals,
      qualifiedReferrals,
      claimTasks,
      completedTasks,
      completedSubscriptionTasks: userTasks,
      inventory,
      dailyStreakDay: user.dailyStreakDay,
      dailyLastClaimAt: user.dailyLastClaimAt,
      isBanned: user.isBanned,
    },
  });
});

export const adminListUserReferrals = asyncHandler(async (req: Request, res: Response) => {
  const user = await findUser(req.params.query);
  const referrals = await Referral.find({ referrer: user._id })
    .sort({ createdAt: -1 })
    .limit(200)
    .populate('invitee', 'username firstName telegramId photoUrl');
  res.json({
    ok: true,
    referrals: referrals.map((referral) => {
      const invitee = referral.invitee as unknown as { username?: string; firstName?: string; telegramId?: number } | null;
      return {
        id: referral._id,
        status: referral.status,
        createdAt: referral.createdAt,
        qualifiedAt: referral.qualifiedAt,
        invitee: invitee
          ? { telegramId: invitee.telegramId, username: invitee.username, firstName: invitee.firstName }
          : null,
      };
    }),
  });
});