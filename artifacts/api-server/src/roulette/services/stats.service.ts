import { User } from '../models/User';
import { RouletteSpin } from '../models/RouletteSpin';
import { UserPrize } from '../models/UserPrize';
import { Prize } from '../models/Prize';
import { Referral } from '../models/Referral';
import { WithdrawalRequest } from '../models/WithdrawalRequest';
import { ForcedChat } from '../models/ForcedChat';
import { Admin } from '../models/Admin';
import { AdView } from '../models/AdView';
import { GameSession } from '../models/GameSession';
import { ExchangeListing } from '../models/ExchangeListing';
import { ExchangeOffer } from '../models/ExchangeOffer';
import { ExchangeReport } from '../models/ExchangeReport';
import { MediationTicket } from '../models/MediationTicket';

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
    activity: await getActivityStats(),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TZ = 'Asia/Baghdad';
const TZ_OFFSET_MS = 3 * 60 * 60 * 1000; // Iraq is UTC+3 all year

/** Midnight in Baghdad, `daysAgo` days back. */
function baghdadDayStart(daysAgo = 0, now = Date.now()) {
  return new Date(Math.floor((now + TZ_OFFSET_MS) / DAY_MS) * DAY_MS - TZ_OFFSET_MS - daysAgo * DAY_MS);
}

/** Count per Baghdad day over the last `days` days, oldest first, zero-filled. */
async function perDay(model: { aggregate: (p: object[]) => Promise<{ _id: string; n: number }[]> }, field: string, days: number, match: object = {}) {
  const since = baghdadDayStart(days - 1);
  const rows = await model.aggregate([
    { $match: { ...match, [field]: { $gte: since } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone: TZ } }, n: { $sum: 1 } } },
  ]);
  const byDay = new Map(rows.map((r) => [r._id, r.n]));
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(since.getTime() + i * DAY_MS + TZ_OFFSET_MS).toISOString().slice(0, 10);
    return { day: d, count: byDay.get(d) ?? 0 };
  });
}

/** Activity, games, ads, exchange and mediation numbers for the developer stats page. */
export async function getActivityStats() {
  const today = baghdadDayStart(0);
  const week = baghdadDayStart(6);
  const month = baghdadDayStart(29);
  const agg = <T>(m: unknown) => m as { aggregate: (p: object[]) => Promise<T> };
  const [
    activeToday, activeWeek, activeMonth, blocked, english,
    spinsToday, spinsWeek, adsToday, adsWeek, roundsToday, roundsWeek,
    referralsToday, referralsWeek, withdrawalsToday,
    listingsActive, listingsToday, viewsTotal, offersTotal, offersAccepted, reportsOpen,
    ticketsToday, ticketsCompleted,
    newUsers14, spins14, ads14,
  ] = await Promise.all([
    User.countDocuments({ lastSeenAt: { $gte: today } }),
    User.countDocuments({ lastSeenAt: { $gte: week } }),
    User.countDocuments({ lastSeenAt: { $gte: month } }),
    User.countDocuments({ botBlocked: true }),
    User.countDocuments({ language: 'en' }),
    RouletteSpin.countDocuments({ createdAt: { $gte: today } }),
    RouletteSpin.countDocuments({ createdAt: { $gte: week } }),
    AdView.countDocuments({ createdAt: { $gte: today } }),
    AdView.countDocuments({ createdAt: { $gte: week } }),
    GameSession.countDocuments({ createdAt: { $gte: today } }),
    GameSession.countDocuments({ createdAt: { $gte: week } }),
    Referral.countDocuments({ status: 'qualified', qualifiedAt: { $gte: today } }),
    Referral.countDocuments({ status: 'qualified', qualifiedAt: { $gte: week } }),
    WithdrawalRequest.countDocuments({ createdAt: { $gte: today } }),
    ExchangeListing.countDocuments({ status: 'active' }),
    ExchangeListing.countDocuments({ createdAt: { $gte: today } }),
    agg<{ n: number }[]>(ExchangeListing).aggregate([{ $group: { _id: null, n: { $sum: { $ifNull: ['$views', 0] } } } }]),
    ExchangeOffer.countDocuments({}),
    ExchangeOffer.countDocuments({ status: 'accepted' }),
    ExchangeReport.countDocuments({ status: 'open' }),
    MediationTicket.countDocuments({ createdAt: { $gte: today } }),
    MediationTicket.countDocuments({ status: 'completed' }),
    perDay(agg(User), 'createdAt', 14),
    perDay(agg(RouletteSpin), 'createdAt', 14),
    perDay(agg(AdView), 'createdAt', 14),
  ]);
  return {
    active: { today: activeToday, week: activeWeek, month: activeMonth, blocked, english },
    today: { spins: spinsToday, ads: adsToday, rounds: roundsToday, referrals: referralsToday, withdrawals: withdrawalsToday },
    week: { spins: spinsWeek, ads: adsWeek, rounds: roundsWeek, referrals: referralsWeek },
    exchange: {
      active: listingsActive,
      today: listingsToday,
      views: viewsTotal[0]?.n ?? 0,
      offers: offersTotal,
      offersAccepted,
      reportsOpen,
      ticketsToday,
      ticketsCompleted,
    },
    series: newUsers14.map((d, i) => ({ day: d.day, users: d.count, spins: spins14[i].count, ads: ads14[i].count })),
  };
}
