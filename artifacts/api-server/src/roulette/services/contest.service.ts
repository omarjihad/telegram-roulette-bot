import mongoose, { HydratedDocument } from 'mongoose';
import { nanoid } from 'nanoid';
import { User, IUser } from '../models/User';
import { ContestReferral } from '../models/ContestReferral';
import { createNotification } from './notification.service';
import { checkAllForcedChats } from './forcedSub.service';
import { getBotInstance } from '../bot/instance';
import { logger } from '../config/logger';
import { env } from '../config/env';

export const LEADERBOARD_SIZE = 25;

/** The prize for first place. Only the #1 contestant wins it. */
export const CONTEST_PRIZE = {
  name: 'Santa Hat',
  number: '#38438',
  nftUrl: 'https://t.me/nft/SantaHat-38438',
  imageUrl: '/nft-santa-hat.jpg',
  attributes: [
    { label: 'الموديل', value: 'Cold Autumn', rarity: '2%' },
    { label: 'الرمز', value: "New Year's Eve", rarity: '2.4%' },
    { label: 'الخلفية', value: 'Satin Gold', rarity: '1.5%' },
  ],
  valueUsd: '~$17',
};

export const CONTEST_RULES = [
  'كل شخص يدخل البوت من رابطك لأول مرة ويكمل الاشتراك الإجباري والكابتشا يُحسب لك +1.',
  'إذا الشخص اللي دعوته حظر البوت تنحذف دعوته وتنقص من نقاطك -1.',
  'كل شخص يُحسب لشخص واحد بس، وما يُحسب إذا جان مسجّل بالبوت من قبل.',
  'ممنوع الحسابات الوهمية أو الأرقام المزيفة، وأي دعوة مخالفة تنلغي.',
  'المركز الأول فقط هو اللي يربح الجائزة.',
];

export function parseContestToken(startParam?: string | null): string | null {
  if (!startParam) return null;
  const match = startParam.match(/^race_([A-Za-z0-9_-]+)$/);
  return match ? match[1] : null;
}

export function buildContestLink(token: string): string | null {
  if (!env.BOT_USERNAME) return null;
  return env.MINI_APP_SHORT_NAME
    ? `https://t.me/${env.BOT_USERNAME}/${env.MINI_APP_SHORT_NAME}?startapp=race_${token}`
    : `https://t.me/${env.BOT_USERNAME}?start=race_${token}`;
}

function displayName(user: { username?: string; firstName?: string }) {
  return user.username ? '@' + user.username : user.firstName || 'مستخدم';
}

/** Called after the user read the intro and pressed "continue": gives them their link. */
export async function joinContest(user: HydratedDocument<IUser>) {
  if (!user.contestToken) user.contestToken = nanoid(12);
  if (!user.contestJoinedAt) user.contestJoinedAt = new Date();
  await user.save();
  return buildContestLink(user.contestToken);
}

/** A brand-new user opened someone's race link: record it, counted later once qualified. */
export async function registerContestReferralIfNew(params: {
  newUser: HydratedDocument<IUser>;
  token: string;
  isBrandNewUser: boolean;
}): Promise<'registered' | 'not_new' | 'self_referral' | 'already_referred' | 'contestant_not_found'> {
  const { newUser, token, isBrandNewUser } = params;
  if (!isBrandNewUser) return 'not_new';
  const contestant = await User.findOne({ contestToken: token, contestJoinedAt: { $ne: null } });
  if (!contestant) return 'contestant_not_found';
  if (contestant.telegramId === newUser.telegramId) return 'self_referral';
  if (await ContestReferral.exists({ invitee: newUser._id })) return 'already_referred';

  try {
    await ContestReferral.create({
      contestant: contestant._id,
      contestantTelegramId: contestant.telegramId,
      invitee: newUser._id,
      inviteeTelegramId: newUser.telegramId,
      status: 'pending',
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return 'already_referred';
    throw err;
  }
  return 'registered';
}

/** +1 for the contestant once the invitee has passed forced-sub and a captcha after joining. */
export async function tryCountContestReferral(inviteeUserId: mongoose.Types.ObjectId) {
  const entry = await ContestReferral.findOne({ invitee: inviteeUserId, status: 'pending' });
  if (!entry) return false;

  const invitee = await User.findById(inviteeUserId);
  if (!invitee || invitee.botBlocked) return false;
  if (!invitee.forcedSubOk || !invitee.captchaPassed || !invitee.captchaPassedAt) return false;
  if (invitee.captchaPassedAt.getTime() < entry.createdAt.getTime()) return false;

  if (process.env.NODE_ENV !== 'test') {
    const { allOk } = await checkAllForcedChats(getBotInstance(), invitee.telegramId);
    if (!allOk) return false;
  }

  const counted = await ContestReferral.updateOne(
    { _id: entry._id, status: 'pending' },
    { $set: { status: 'counted', countedAt: new Date() } }
  );
  if (counted.modifiedCount !== 1) return false;

  const score = await ContestReferral.countDocuments({ contestant: entry.contestant, status: 'counted' });
  await createNotification({
    userId: entry.contestant,
    telegramId: entry.contestantTelegramId,
    type: 'referral_progress',
    title: '🏆 سباق الدعوات: +1',
    body: `انضم ${displayName(invitee)} عن طريق رابطك وأكمل الشروط.\nنقاطك الحالية: ${score} 🔥`,
  }).catch((err) => logger.warn({ err }, 'failed to notify contestant'));
  return true;
}

/** The invitee blocked the bot: the entry is removed for good (-1 if it was counted). */
export async function removeContestReferralForBlockedInvitee(inviteeTelegramId: number) {
  const entry = await ContestReferral.findOneAndUpdate(
    { inviteeTelegramId, status: { $in: ['pending', 'counted'] } },
    { $set: { status: 'removed', removedAt: new Date() } },
    { new: false }
  );
  if (!entry || entry.status !== 'counted') return false;

  const invitee = await User.findOne({ telegramId: inviteeTelegramId }).select('username firstName');
  const score = await ContestReferral.countDocuments({ contestant: entry.contestant, status: 'counted' });
  await createNotification({
    userId: entry.contestant,
    telegramId: entry.contestantTelegramId,
    type: 'referral_progress',
    title: '🏆 سباق الدعوات: -1',
    body: `${invitee ? displayName(invitee) : 'مستخدم'} حظر البوت، فانحذفت دعوته من السباق.\nنقاطك الحالية: ${score}`,
  }).catch((err) => logger.warn({ err }, 'failed to notify contestant'));
  return true;
}

export async function getContestOverview(user: HydratedDocument<IUser>) {
  const rows = await ContestReferral.aggregate<{ _id: mongoose.Types.ObjectId; score: number; lastAt: Date }>([
    { $match: { status: 'counted' } },
    { $group: { _id: '$contestant', score: { $sum: 1 }, lastAt: { $max: '$countedAt' } } },
    // Ties go to whoever reached the score first.
    { $sort: { score: -1, lastAt: 1 } },
  ]);

  const top = rows.slice(0, LEADERBOARD_SIZE);
  const people = await User.find({ _id: { $in: top.map((r) => r._id) } }).select('username firstName photoUrl telegramId');
  const byId = new Map(people.map((p) => [String(p._id), p]));

  const myIndex = rows.findIndex((r) => String(r._id) === String(user._id));
  const joined = Boolean(user.contestJoinedAt && user.contestToken);

  return {
    joined,
    link: joined ? buildContestLink(user.contestToken!) : null,
    myScore: myIndex >= 0 ? rows[myIndex].score : 0,
    myRank: myIndex >= 0 ? myIndex + 1 : null,
    myPending: joined ? await ContestReferral.countDocuments({ contestant: user._id, status: 'pending' }) : 0,
    participants: rows.length,
    leaderboard: top.map((row, i) => {
      const person = byId.get(String(row._id));
      return {
        rank: i + 1,
        name: person ? displayName(person) : 'مستخدم',
        photoUrl: person?.photoUrl ?? null,
        score: row.score,
        isMe: String(row._id) === String(user._id),
      };
    }),
    prize: CONTEST_PRIZE,
    rules: CONTEST_RULES,
  };
}
