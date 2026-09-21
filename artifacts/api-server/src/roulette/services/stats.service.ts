import { User } from '../models/User';
import { RouletteSpin } from '../models/RouletteSpin';
import { UserPrize } from '../models/UserPrize';
import { Prize } from '../models/Prize';
import { Referral } from '../models/Referral';
import { WithdrawalRequest } from '../models/WithdrawalRequest';
import { ForcedChat } from '../models/ForcedChat';
import { Admin } from '../models/Admin';

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfWeek(d = new Date()) {
  const x = startOfDay(d);
  const day = x.getDay();
  x.setDate(x.getDate() - day);
  return x;
}
function startOfMonth(d = new Date()) {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}

export async function getDashboardStats() {
  const [
    totalUsers,
    newToday,
    newThisWeek,
    newThisMonth,
    bannedCount,
    totalSpins,
    delivered,
    pendingPrizes,
    expiredPrizes,
    totalReferrals,
    qualifiedReferrals,
    rejectedReferrals,
    pendingWithdrawals,
    approvedWithdrawals,
    deliveredWithdrawals,
    rejectedWithdrawals,
    channelsCount,
    developersCount,
    prizes,
    pointsTotals,
    topPointsUsers,
    dailyWheelSpins,
    pointsWheelSpins,
  ] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ createdAt: { $gte: startOfDay() } }),
    User.countDocuments({ createdAt: { $gte: startOfWeek() } }),
    User.countDocuments({ createdAt: { $gte: startOfMonth() } }),
    User.countDocuments({ isBanned: true }),
    RouletteSpin.countDocuments({}),
    UserPrize.countDocuments({ status: 'approved' }),
    UserPrize.countDocuments({ status: { $in: ['active', 'claim_requested'] } }),
    UserPrize.countDocuments({ status: 'expired' }),
    Referral.countDocuments({}),
    Referral.countDocuments({ status: 'qualified' }),
    Referral.countDocuments({ status: 'rejected' }),
    WithdrawalRequest.countDocuments({ status: 'pending' }),
     WithdrawalRequest.countDocuments({ status: { $in: ['approved', 'delivered'] } }),
     WithdrawalRequest.countDocuments({ status: 'delivered' }),
    WithdrawalRequest.countDocuments({ status: 'rejected' }),
    ForcedChat.countDocuments({}),
    Admin.countDocuments({}),
    Prize.find({}).sort({ displayOrder: 1 }),
    User.aggregate([
      {
        $group: {
          _id: null,
          available: { $sum: '$spinPoints' },
          spent: { $sum: { $ifNull: ['$spinPointsSpent', 0] } },
        },
      },
    ]),
    User.find({}).sort({ spinPoints: -1 }).limit(10).select('telegramId username firstName spinPoints').lean(),
    RouletteSpin.countDocuments({ mode: 'daily' }),
    RouletteSpin.countDocuments({ mode: 'points' }),
  ]);

  return {
    users: { total: totalUsers, newToday, newThisWeek, newThisMonth, banned: bannedCount },
    spins: { total: totalSpins },
    points: {
      available: pointsTotals[0]?.available ?? 0,
      spent: pointsTotals[0]?.spent ?? 0,
      topUsers: topPointsUsers.map((user) => ({
        telegramId: user.telegramId,
        username: user.username,
        firstName: user.firstName,
        points: user.spinPoints,
      })),
    },
    wheels: { daily: dailyWheelSpins, points: pointsWheelSpins },
    prizes: {
      delivered,
      pending: pendingPrizes,
      expired: expiredPrizes,
      perPrize: prizes.map((p) => ({
        key: p.key,
        name: p.name,
        stock: p.isUnlimited ? '∞' : p.stock,
        delivered: p.deliveredCount,
        pending: p.pendingCount,
        isActive: p.isActive,
      })),
    },
    referrals: { total: totalReferrals, qualified: qualifiedReferrals, rejected: rejectedReferrals },
    withdrawals: { pending: pendingWithdrawals, approved: approvedWithdrawals, delivered: deliveredWithdrawals, rejected: rejectedWithdrawals },
    channels: channelsCount,
    developers: developersCount,
  };
}
